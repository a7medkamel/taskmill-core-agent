"use strict";

var Promise         = require('bluebird')
  , winston         = require('winston')
  , _               = require('lodash')
  , os              = require('os')
  , url             = require('url')
  , uuid            = require('node-uuid')
  , config          = require('config')
  ;

class Agent {
  constructor(PoolFactory) {
    this.pool = PoolFactory();

    if (!this.pool) {
      throw new Error('"type" param not defined or recognized');
    }

    this.group = config.get('group.id');
    this.id = uuid.v4();

    if (!this.group) {
      throw new Error('group id is required for the agent to connect to the relay. make sure that your group id is unique.');
    }

    var mem_mb = os.totalmem() / 1024 / 1024;
    var mem_os = Math.max(config.get('kernal.mem-min'), config.get('kernal.mem-ratio') * mem_mb);
    this.capacity = Math.floor((mem_mb - mem_os) /  config.get('worker.mem'))
  }

  initialize(cb) {
    Promise
      .promisify(this.pool.kill_workers, { context : this.pool })()
      .nodeify(cb)
      ;
  }

  listen() {
    winston.info('connecting to', config.get('relay.hostname'));

    this.socket = require('socket.io-client')(url.format({
        protocol  : config.get('relay.protocol')
      , hostname  : config.get('relay.hostname')
      , port      : config.get('relay.port')
    }));

    this.socket.on('connect', () => {
      winston.info('connected');
      this.start_heartbeat();
    });

    this.socket.on('disconnect', () =>{
      this.end_heartbeat();
      winston.info('disconnected');
    });

    this.socket.on('/run', (task, cb) => {
      Promise
        .try(() =>{
          return this.pool.create(this, task);
        })
        .then((worker) => {
          return Promise.promisify(worker.run, { context : worker })();
        })
        .then(() =>{ return undefined; /*mask response*/ })
        .catch((err) => { 
          // todo [akamel] abstract to common module [also used in relay]
          throw {
              type    : _.isError(err)? 'exception' : 'notification'
            , error   : err.message
            // todo [akamel] should we expose this? its OSS anyway
            , stack   : err.stack
            , target  : 'taskmill-core-agent'
          };
        })
        .nodeify(cb)
        ;
    });

    this.socket.on('/SIGKILL', (task, cb) => {
      Promise
        .try(() =>{
          return task.id;
        })
        .then((id) => {
          this.pool.kill(id);
        })
        .then(() => { return undefined; /*mask response*/ })
        .catch((err) => { 
          // todo [akamel] abstract to common module [also used in relay]
          throw {
              type    : _.isError(err)? 'exception' : 'notification'
            , error   : err.message
            // todo [akamel] should we expose this? its OSS anyway
            , stack   : err.stack
            , target  : 'taskmill-core-agent'
          };
        })
        .nodeify(cb)
        ;
    });
  }

  start_heartbeat() {
    this.end_heartbeat();

    var ping = () => {
      var data = {
          name                : os.hostname()
        , id                  : this.id
        , group               : this.group
        , uptime              : process.uptime()
        , capacity            : this.capacity
        , workers             : this.pool.info()
      };

      this.socket.emit('/ping', data);
    };
    
    this.heartbeat_timer_token = setInterval(ping, 10 * 1000);
    ping();
  }

  end_heartbeat() {
    if (this.heartbeat_timer_token) {
      clearInterval(this.heartbeat_timer_token);
    }
  }
}

module.exports = Agent;