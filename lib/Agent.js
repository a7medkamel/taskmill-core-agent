"use strict";

var Promise         = require('bluebird')
  , winston         = require('winston')
  , _               = require('lodash')
  , os              = require('os')
  , ip              = require('ip')
  , uuid            = require('node-uuid')
  , config          = require('config-url')
  , Request         = require('./model/Request')
  , Docker          = require('./Docker')
  , Worker          = require('./model/Worker')
  ;

class Agent {
  constructor() {
    this.group = config.get('agent.group-id');
    this.id = uuid.v4();

    this.name = `${os.hostname()} (${ip.address()})`;

    if (!this.group) {
      throw new Error('config error: "agent.group-id" is required for the agent to connect to the relay. make sure that your group id is unique uuid.');
    }
  }

  initialize() {
    var docker = Docker.get();
    return Promise.all([ docker.clean(), docker.pull() ]);
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

    const http = require('http');

    let proxy = http.createServer((req, res) => {
      res.headers = { 
        'RunOn-Agent' : this.name
      };

      req.__obj = new Request(req, res);

      Worker
        .get(req, res)
        .then((worker) => worker.handle(req, res))
        .catch((err) => {
          winston.error(err);

          res.statusCode = 500;
          res.write(err.toString());
          res.end();
        });
      // todo [akamel] handle other worker events here
    }).listen(config.getUrlObject('agent').port);
    // server.on('clientError', (err, socket) => {
    //   socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    // });
  }

  start_heartbeat() {
    this.end_heartbeat();

    var ping = () => {
      var data = {
          name                : this.name
          // todo [akamel] use machine name or url in production [agent specific]
        , run_url             : config.getUrl('agent')
        , id                  : this.id
        , group               : this.group
        , uptime              : process.uptime()
        , totalmem            : os.totalmem()
        , freemem             : os.freemem()
        , loadavg             : os.loadavg()
        , cpus                : os.cpus()
        // , workers             : this.pool.info()
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