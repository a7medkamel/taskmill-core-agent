"use strict";

var Promise         = require('bluebird')
  , winston         = require('winston')
  , _               = require('lodash')
  , os              = require('os')
  , ip              = require('ip')
  , uuid            = require('node-uuid')
  , config          = require('config-url')
  , Docker          = require('./docker')
  , Maker           = require('./make')
  ;

let make_url = config.getUrl('make');

class Agent {
  constructor() {
    this.id = uuid.v4();

    this.name = `${os.hostname()} (${ip.address()})`;

    this.docker = new Docker();
  }

  clean() {
    return this.docker.clean();
  }

  pull() {
    return this.docker.pull();
  }

  connect() {
    winston.info('agent connecting to', make_url);

    this.socket = require('socket.io-client')(make_url);

    this.socket.on('connect', () => {
      winston.info('connected');
      this.start_heartbeat();
    });

    this.socket.on('disconnect', () =>{
      this.end_heartbeat();
      winston.info('disconnected');
    });

    this.socket.on('/make', (msg = {}, cb) => {
      let { remote, sha, blob, filename, token, cache, bearer } = msg;

      let maker = new Maker(this);

      maker
        .make(remote, sha, { blob, filename, token, cache, bearer })
        .asCallback(cb);
    });
  }

  start_heartbeat() {
    this.end_heartbeat();

    var ping = () => {
      var data = {
          name                : this.name
        , id                  : this.id
        , uptime              : process.uptime()
        , totalmem            : os.totalmem()
        , freemem             : os.freemem()
        , loadavg             : os.loadavg()
        , cpus                : os.cpus()
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
