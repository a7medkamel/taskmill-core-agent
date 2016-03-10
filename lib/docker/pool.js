"use strict";

var Promise         = require('bluebird')
  , _               = require('lodash')
  , Docker          = require('dockerode')
  , config          = require('config')
  , sink            = require('through2-sink')
  , DockerEvents    = require('docker-events')
  , Pool            = require('../core/pool')
  ;

class DockerPool extends Pool {
  constructor(agent, task) {
    super();

    var docker_options = undefined;

    if (config.has('docker.hostname') && config.get('docker.hostname') != undefined) {
      docker_options = {
          protocol  : config.get('docker.protocol')
        , host      : config.get('docker.hostname')
        , port      : config.get('docker.port')
      };

      if (config.has('docker.cert')) {
        var fs = require('fs');
        docker_options.ca     = fs.readFileSync(config.get('docker.ca'));
        docker_options.cert   = fs.readFileSync(config.get('docker.cert'));
        docker_options.key    = fs.readFileSync(config.get('docker.key'));
      }
    }

    this.docker = new Docker(docker_options);

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

    this.docker_emitter.on('stop', (msg) => {
      var c = this.docker.getContainer(msg.id);
      if (c) {
        c.remove(_.noop);
      }
    });  
  }

  run(worker, cb) {
    var log = config.get('worker.log-stdout')
      , cfg = worker.config
      ;

    // todo [akamel] read from worker.code-module
    cfg['code-module'] = 'taskmill-code-arbitrary';

    // docker opts
    var image       = config.get('worker.image')
      , cmd         = ['node', '/home/worker/index.js', '--NODE_CONFIG=' + JSON.stringify(cfg)]
      , streams     = [
                          sink(function(chunk){ 
                            worker.stdout(chunk);
                            log && process.stdout.write(chunk);
                          })
                        , sink(function(chunk){
                            worker.stderr(chunk);
                            log && process.stderr.write(chunk);
                          })
                      ]
      , create_opts = { 
                          Tty           : false 
                      }
      , start_opts  = {
                        HostConfig    : {
                            ExtraHosts    : ['__relay.io:' + config.get('tunnel.hostname')]
                          // , CpuShares     : 128
                          // , Memory        : 16*1024*1024
                        }
                      }
      ;

    return new Promise((res, rej) => {
                this.docker.run(image, cmd, streams, create_opts, start_opts, (err, data, container) => {
                  worker.resolve(container);
                  
                  if (err) {
                    return rej(err);
                  }
                  res(data, container);
                }).on('container', (container) => {
                  worker.resolve(container)
                });
              })
              .finally(() => {
                // todo [akamel] do we need this or is the die/stop event enough?
                this.remove(worker);
              });
  }

  kill_worker(worker, cb) {
    worker
      .runInfoAsync()
      .then((container) => {
        if (container) {
          return Promise.promisify(container.stop, { context : container })()
        }
      })
      // todo [akamel] should we call remove here or let the event kill it?
      .nodeify(cb);
  }

  kill_workers(cb) {
    Promise
      .promisify(this.docker.listContainers, { context : this.docker })({ all : true })
      .bind(this)
      .each(function(item){
        var container = this.docker.getContainer(item.Id);

        return Promise.promisify(container.remove, { context : container })({ force : true });
      })
      .nodeify(cb)
      ;
  }
}

module.exports = DockerPool;