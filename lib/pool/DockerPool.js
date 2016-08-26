"use strict";

var Promise         = require('bluebird')
  , _               = require('lodash')
  , winston         = require('winston')
  , Docker          = require('dockerode')
  , config          = require('config-url')
  , sink            = require('through2-sink')
  , DockerEvents    = require('docker-events')
  , Pool            = require('./Pool')
  , ip              = require('ip')
  , retry           = require('bluebird-retry')
  ;

class DockerPool extends Pool {
  constructor(options) {
    super();

    this.docker = new Docker();

    this.docker_emitter = new DockerEvents({ docker: this.docker });

    this.docker_emitter.start();

    // todo [akamel] might not need to listen to both die and stop
    // https://github.com/docker/docker/issues/10654
    this.docker_emitter.on('die', (msg) => {
      var c = this.docker.getContainer(msg.id);
      if (c) {
        c.remove(_.noop);
      }
    });

    // this is called when a stop signal is sent to the container
    this.docker_emitter.on('stop', (msg) => { });  
  }

  initialize() {
    return Promise.all([ this.clean(), this.pull() ]);
  }

  clean() {
    return Promise
            .fromCallback((cb) => {
              this.docker.listContainers({ all : true }, cb);
            })
            .each((item) => {
              var container = this.docker.getContainer(item.Id);

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
                          this.docker.pull(config.get('worker.image'), (err, stream) => {
                            if (err) {
                              return cb(err);
                            }

                            this.docker.modem.followProgress(stream, cb, (e) => { winston.info(e); });
                          });
                        });
              }
            });
  }

  run(request) {
    // todo [akamel] this isn't too clean, consider seperating worker creation from initialize
    return super
            .run(request)
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
                                      worker.request.stdout(chunk);
                                      log && process.stdout.write(chunk);
                                    })
                                  , sink(function(chunk){
                                      worker.request.stderr(chunk);
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

              this.docker.run(image, cmd, streams, create_opts, {}, (err, data, container) => {
                worker.emit('finish', err, data, container);
              }).on('container', (result) => {
                // console.log('container::fork', result);
                worker.emit('fork', result);
                let container = this.docker.getContainer(result.id);
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

module.exports = DockerPool;