"use strict";

var Promise         = require('bluebird')
  , _               = require('lodash')
  , winston         = require('winston')
  , config          = require('config-url')
  , sink            = require('through2-sink')
  , DockerEvents    = require('docker-events')
  , ip              = require('ip')
  , EventEmitter    = require('events').EventEmitter
  ;

class Docker extends EventEmitter {
  constructor() {
    super();

    this.dockerode = new require('dockerode')();

    this.de = new DockerEvents({ docker: this.dockerode });

    this.de.start();

    // https://github.com/docker/docker/issues/10654
    this.de.on('die', (msg) => {
      this.emit(`die:${msg.id}`, msg);

      var container = this.dockerode.getContainer(msg.id);
      if (container) {
        container.remove(_.noop);
      }
    });

    // this is called when a stop signal is sent to the container
    this.de.on('stop', (msg) => {
      this.emit(`stop:${msg.id}`, msg);
    });
  }

  clean() {
    return Promise
            .fromCallback((cb) => {
              this.dockerode.listContainers({ all : true }, cb);
            })
            .each((item) => {
              if (item.Image.match(/^a7medkamel/)) {
                let container = this.dockerode.getContainer(item.Id);

                return Promise.fromCallback((cb) => { container.remove({ force : true }, cb); });
              }
            });
  }

  pull() {
    return Promise
            .try(() => {
              if (config.has('worker.pull') && config.get('worker.pull')) {
                return Promise
                        .fromCallback((cb) => {
                          winston.info('docker::pull', config.getUrl('worker.image'));
                          this.dockerode.pull(config.get('worker.image'), (err, stream) => {
                            if (err) {
                              return cb(err);
                            }

                            this.dockerode.modem.followProgress(stream, cb, (e) => { winston.info(e); });
                          });
                        });
              }
            });
  }

  create(options = {}) {
    let cfg = {
      'services'    : { url : config.getUrl('services') },
      'account'     : { url : config.getUrl('account') },
      'code-module' : config.get('worker.code-module'),
      'code-dirname': '/mnt/'
    }

    _.defaults(cfg, options.config);

    let opt = {
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

    if (options.binds) {
      opt['HostConfig']['Binds'] = options.binds;
    }

    return Promise.fromCallback((cb) => {
      this.dockerode.createContainer(opt, cb);
    });
  }

  start(container) {
    return Promise
            .fromCallback((cb) => {
              container.attach({stream: true, stdout: true, stderr: true}, function (err, stream) {
                let emitter = new EventEmitter();
                if (stream) {
                  let stdout = sink((chunk) => emitter.emit('stdout', chunk))
                    , stderr = sink((chunk) => emitter.emit('stderr', chunk))
                    ;

                  container.modem.demuxStream(stream, stdout, stderr);
                }

                cb(err, emitter);
              });
            })
            .then((emitter) => {
              return Promise
                      .fromCallback((cb) => container.start(cb))
                      .return([ container, emitter ]);
            });
  }
}

module.exports = Docker;
