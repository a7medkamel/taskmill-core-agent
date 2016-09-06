"use strict";

var Promise         = require('bluebird')
  , _               = require('lodash')
  , winston         = require('winston')
  , config          = require('config-url')
  , sink            = require('through2-sink')
  , DockerEvents    = require('docker-events')
  , ip              = require('ip')
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

  create() {
    let cfg = {
      'services'    : { url : config.getUrl('services') },
      'code-module' : config.get('worker.code-module')
    }

    let options = {
        Image         : config.get('worker.image')
      , Cmd           : ['node', '/home/worker/index.js', '--NODE_CONFIG=' + JSON.stringify(cfg)]
      , Tty           : false 
      , Env           : ['NODE_ENV=production']
      , WorkingDir    : '/home/worker/'
      , ExposedPorts  : { '80/tcp': {} }
      , HostConfig    : {
            ExtraHosts    : ['__host.io:' + ip.address()]
          , PortBindings  : { '80/tcp': [{ HostPort : '' }] }
          // , CpuShares     : 128
          // , Memory        : 16*1024*1024
        }
    };

    return Promise.fromCallback((cb) => {
      super.createContainer(options, cb);
    });
  }

  // todo [akamel] this breaks socketio stdio
  start(container) {
    return Promise
            .fromCallback((cb) => {
              container.attach({stream: true, stdout: true, stderr: true}, function (err, stream) {
                if (stream) {
                  let log = config.get('worker.log-stdout');
                  let stdout = sink(function(chunk){ 
                                // request.stdout(chunk);
                                log && process.stdout.write(chunk);
                              });

                  let stderr = sink(function(chunk){
                                // request.stderr(chunk);
                                log && process.stderr.write(chunk);
                              });

                  container.modem.demuxStream(stream, process.stdout, process.stderr);
                }

                cb(err, stream);
              });
            })
            .then(() => {
              return Promise.fromCallback((cb) => container.start(cb));
            })
            // todo [akamel] might not be needed, .start might return container
            .then(() => container);
  }

  static get() {
    __instance = __instance || new Docker();

    return __instance;
  }
}

var __instance = undefined;

module.exports = Docker;