"use strict";

var Promise         = require('bluebird')
  , winston         = require('winston')
  , _               = require('lodash')
  , os              = require('os')
  , uuid            = require('node-uuid')
  , config          = require('config-url')
  , request         = require('request')
  , retry           = require('bluebird-retry')
  // , net             = require('net')
  , ip              = require('ip')
  , Request         = require('./Request')
  ;

class Agent {
  constructor(pool) {
    this.pool = pool;

    if (!this.pool) {
      throw new Error('"type" param not defined or recognized');
    }

    this.group = config.get('agent.group-id');
    this.id = uuid.v4();

    if (!this.group) {
      throw new Error('config error: "agent.group-id" is required for the agent to connect to the relay. make sure that your group id is unique uuid.');
    }
  }

  initialize(cb) {
    return this.pool.initialize().asCallback(cb);
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
      // todo [akamel] we only parse this to get the request id out... seems we should be able to bypass it
      let r = new Request(JSON.parse(req.headers['__metadata']));
      this.pool
            .run(r)
            .then((worker) => {
              return Promise.fromCallback((cb) => {
                worker.on('ready', (err, data, container) => {
                  let port = data.NetworkSettings.Ports['80/tcp'][0].HostPort;

                  // todo [akamel] rename doc to metadata
                  let headers = {
                      '__metadata' : JSON.stringify(r.doc)
                  };

                  let time = process.hrtime();
                  let count = 0;
                  retry(() => 
                    Promise
                      .fromCallback((cb) => {
                        res.setHeader('RunOn-Agent', `${os.hostname()} (${ip.address()})`);
                        count++;
                        let url = 'http://localhost:' + port;
                        req
                          .pipe(request({ url : url, headers : headers }))
                          .on('error', (err) => {
                            cb(new Error('request failed: ' + url));
                          })
                          .pipe(res)
                          .on('error', (err) => {
                            cb(new Error('response failed'));
                          });

                        res.on('finish', cb);
                      })
                  , { interval : 10, timeout : 5000, max_tries : -1, backoff : 2, max_interval : 60 })
                  .then(() => {
                    let diff = process.hrtime(time);
                    winston.info(`needed ${count} retries to connect to container, in ${(diff[0] * 1e9 + diff[1]) / 1e6} seconds`);
                  })
                  .asCallback(cb);
                });
              });
            })
            .catch((err) => {
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
          name                : os.hostname()
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