"use strict";

var Promise         = require('bluebird')
  , winston         = require('winston')
  , _               = require('lodash')
  , os              = require('os')
  , uuid            = require('node-uuid')
  , config          = require('config-url')
  ;

class Agent {
  constructor(PoolFactory) {
    this.pool = PoolFactory();

    if (!this.pool) {
      throw new Error('"type" param not defined or recognized');
    }

    this.group = config.get('agent.group-id');
    this.id = uuid.v4();

    if (!this.group) {
      throw new Error('group id is required for the agent to connect to the relay. make sure that your group id is unique.');
    }
  }

  initialize(cb) {
    return this.pool
              .initialize()
              .nodeify(cb);
  }

  listen() {
    winston.info('agent connecting to', config.getUrl('relay'));

    let url = config.getUrl('relay');

    this.socket = require('socket.io-client')(url);

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
          return worker.run();
        })
        .return(undefined /*mask response*/)
        .catch((err) => { 
          // todo [akamel] abstract to common module [also used in relay]
          throw {
              type    : _.isError(err)? 'exception' : 'notification'
            , message : err.message
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
        , totalmem            : os.totalmem()
        , freemem             : os.freemem()
        , loadavg             : os.loadavg()
        , cpus                : os.cpus()
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