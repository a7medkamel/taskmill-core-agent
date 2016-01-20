var Promise         = require('bluebird')
  , _               = require('lodash')
  , util            = require('util')
  , Docker          = require('dockerode')
  , config          = require('config')
  , sink            = require('through2-sink')
  , DockerEvents    = require('docker-events')
  , Pool            = require('../core/pool')
  , Worker          = require('../core/worker')
  ;

function DockerPool(agent){
  // Super constructor
  Pool.call(this);

  var docker_options = undefined;

  this.agent = agent;

  if (config.has('docker.host') && config.get('docker.host') != undefined) {
    docker_options = {
        protocol  : config.get('docker.protocol')
      , host      : config.get('docker.host')
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
};

util.inherits(DockerPool, Pool);

DockerPool.prototype.create = function(task) {
  var worker = new Worker(this.agent, task);
  this.add(worker);

  return worker;
};

DockerPool.prototype.run = function(worker, cb) {

  var log           = config.get('worker.log-stdout')
    , worker_config = JSON.stringify({
        "req"         : worker.task,
        "port"        : 80,
        "code-module" : "taskmill-code-arbitrary",
        "tunnel"      : {
          "protocol"  : "http",
          "host"      : "__relay.io",
          "port"      : 8989
        }
      })
    ;

  // var image       = 'a7medkamel/taskmill-hosted-worker'
  var image       = 'a7medkamel/taskmill-core-worker'
    , cmd         = ['node', '/home/worker/index.js', '--NODE_CONFIG=' + worker_config]
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
                          ExtraHosts    : ['__relay.io:' + config.get('relay.ip')]
                        // , CpuShares     : 128
                        // , Memory        : 16*1024*1024
                      }
                    }
    ;

  var pool = this;
  this.docker.run(image, cmd, streams, create_opts, start_opts, function(err, data, container){
    // todo [akamel] handle worker container end
    pool.remove(worker);
    
    if (err) {
      return cb(err);
    }
    cb();
  }).on('container', function (container) {
    worker.container = container;
  });

  this.docker_emitter.on('die', (msg) => {
    var c = this.docker.getContainer(msg.id);
    if (c) {
      c.remove(_.noop);
    }
  });
}

DockerPool.prototype.kill_worker = function(worker, cb) {
  // todo [akamel] what if we call kill before the container is assigned?
  worker.container && worker.container.stop(cb || _.noop);

  this.remove(worker);
};

DockerPool.prototype.kill_workers = function(cb) {
  // todo [akamel] looks like this is failing sometimes;
  Promise
    .promisify(this.docker.listContainers, { context : this.docker })({ all : true })
    .bind(this)
    .each(function(item){
      var container = this.docker.getContainer(item.Id);

      return Promise.promisify(container.remove, { context : container })({ force : true });
    })
    .nodeify(cb)
    ;
};

module.exports = DockerPool;