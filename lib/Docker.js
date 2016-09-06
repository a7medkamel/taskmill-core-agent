"use strict";

var Promise         = require('bluebird')
  , _               = require('lodash')
  , winston         = require('winston')
  , config          = require('config-url')
  , sink            = require('through2-sink')
  , DockerEvents    = require('docker-events')
  , ip              = require('ip')
  , retry           = require('bluebird-retry')
  , Worker          = require('./model/Worker')
  ;

class Docker extends require('dockerode') {
  constructor() {
    super();

    this.de = new DockerEvents({ docker: this });

    this.de.start();

    // todo [akamel] might not need to listen to both die and stop
    // https://github.com/docker/docker/issues/10654
    this.de.on('die', (msg) => {
      var c = this.getContainer(msg.id);
      if (c) {
        c.remove(_.noop);
      }
    });

    // this is called when a stop signal is sent to the container
    this.de.on('stop', (msg) => { });  
  }

  initialize() {
    return Promise.all([ this.clean(), this.pull() ]);
  }

  clean() {
    return Promise
            .fromCallback((cb) => {
              super.listContainers({ all : true }, cb);
            })
            .each((item) => {
              var container = super.getContainer(item.Id);

              return Promise.fromCallback((cb) => { container.remove({ force : true }, cb); });
            });
  }

  pull() {
    return Promise
            .try(() => {
              if (config.has('worker.pull') && config.get('worker.pull')) {
                return Promise
                        .fromCallback((cb) => {
                          winston.info('docker::pull', config.getUrl('worker.image'));
                          super.pull(config.get('worker.image'), (err, stream) => {
                            if (err) {
                              return cb(err);
                            }

                            super.modem.followProgress(stream, cb, (e) => { winston.info(e); });
                          });
                        });
              }
            });
  }

  run(request) {
    return request
            .acl()
            .then(() => request.initialize())
            .then(() => Worker.get(request))
            .then((worker) => {
              let log = config.get('worker.log-stdout');

              let cfg = {
                'services'    : { url : config.getUrl('services') },
                'code-module' : config.get('worker.code-module')
              }

              // cfg.req.blob = 'module.exports = function(req, res, next) { setTimeout(() => { res.send(\'After Time Out!\') }, 30000) ;};'
              // docker opts
              var image       = config.get('worker.image')
                // , cmd         = ['cat', '/etc/hosts']
                // , cmd         = ['node', '/home/worker/docker-container-test.js', '--NODE_CONFIG=' + JSON.stringify(cfg)]
                , cmd         = ['node', '/home/worker/index.js', '--NODE_CONFIG=' + JSON.stringify(cfg)]
                , streams     = [
                                    sink(function(chunk){ 
                                      request.stdout(chunk);
                                      log && process.stdout.write(chunk);
                                    })
                                  , sink(function(chunk){
                                      request.stderr(chunk);
                                      log && process.stderr.write(chunk);
                                    })
                                ]
                , create_opts = { 
                                    Tty           : false 
                                  , Env           : ['NODE_ENV=production']
                                  , WorkingDir    : '/home/worker/'
                                  , ExposedPorts  : { '80/tcp': {} }
                                  , HostConfig    : {
                                        ExtraHosts    : ['__host.io:' + ip.address()]
                                      , PortBindings  : { '80/tcp': [{ HostPort : '' }] }
                                      // , CpuShares     : 128
                                      // , Memory        : 16*1024*1024
                                    }
                                }
                ;

              super.run(image, cmd, streams, create_opts, {}, (err, data, container) => {
                worker.emit('finish', err, data, container);
              }).on('container', (result) => {
                // console.log('container::fork', result);
                worker.emit('fork', result);
                let container = super.getContainer(result.id);
                var time = process.hrtime();
                retry(() => 
                  Promise
                    .fromCallback((cb) => container.inspect(cb))
                    .tap((info) => {
                      if (!info.NetworkSettings.Ports) {
                        throw new Error('NetworkSettings not bound');
                      }
                    })
                , { interval : 50, timeout : 5000, max_tries : -1 })
                .then((info) => {
                  var diff = process.hrtime(time);
                  console.log('port ready in:', info.NetworkSettings.Ports, (diff[0] * 1e9 + diff[1]) / 1e9 );

                  worker.emit('ready', null, info, container);
                  // console.log('container::ready', info);
                })
                .catch((err) => {
                  // todo [akamel] handle error
                  console.log('container::timeout', err);
                  worker.emit('timeout', err, null, container);
                });
              })

              return worker;
            });

  }

  // kill_worker(worker, cb) {
  //   return worker
  //           .runInfoAsync()
  //           .then((container) => {
  //             if (container) {
  //               return Promise.promisify(container.stop, { context : container })()
  //             }
  //           })
  //           // todo [akamel] should we call remove here or let the event kill it?
  //           .nodeify(cb);
  // }
}

module.exports = Docker;