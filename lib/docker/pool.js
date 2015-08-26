var Promise         = require('bluebird')
  , _               = require('lodash')
  , util            = require('util')
  , Docker          = require('dockerode')
  , path            = require('path')
  , config          = require('config')
  , Worker          = require('../core/worker')
  , Pool            = require('../core/pool')
  ;

function DockerPool(){
  // Super constructor
  Pool.call(this);

  var docker_options = undefined;

  if (config.has('docker.host') && config.get('docker.host') != undefined) {
    docker_options = {
        protocol  : config.get('docker.protocol')
      , host      : config.get('docker.host')
      , port      : config.get('docker.port')
    };
  }

  this.docker = new Docker(docker_options);
};

util.inherits(DockerPool, Pool);

DockerPool.prototype.create_worker = function(agent, cb) {
  var id    = this._next_id ++
    , worker = new Worker({
          dir         : config.get('worker.dir')
        , agent       : agent
        , id          : id
        , protocol    : 'http'
        , host        : config.has('docker.host')? config.get('docker.host') : 'localhost'
        , port        : config.get('worker.port') + id
      })
    ;

  this.register_worker(worker);

  cb && cb(undefined, worker);
};

DockerPool.prototype.prepare = function(id, cb) {
  var worker = _.isObject(id)? id : this.findById(id);

  Promise
    .resolve(worker)
    .bind(this)
    .then(function(worker){
      if (!worker) {
        throw new Error('unknown worker');
      }

      return worker;
    })
    .then(function(worker){
      return Promise
              .promisify(this.docker.createContainer, this.docker)({
                  Image     : 'a7medkamel/taskmill-hosted-worker'
                , Cmd       : ['node', '/home/worker/index.js']
                , CpuShares : 128
                , Memory    : 16*1024*1024
                , ExposedPorts :{
                   '80/tcp': {}
                }
              })
              .then(function(res){
                worker.container = this.docker.getContainer(res.id);

                return worker;
              }.bind(this));
    })
    // .then(function(worker){
    //   worker.container.attach({stream: true, stdout: true, stderr: true, tty : false}, function (err, stream) {
    //     worker.container.modem.demuxStream(stream, process.stdout, process.stderr);
    //   });

    //   return worker;
    // })
    .nodeify(cb)
    ;
}

DockerPool.prototype.start = function(id, cb) {
  var worker = _.isObject(id)? id : this.findById(id);

   Promise
    .resolve(worker)
    .bind(this)
    .then(function(worker){
      if (!worker) {
        throw new Error('unknown worker');
      }

      return worker;
    })
    .then(function(worker){
      var dir   = path.isAbsolute(worker.dir)
                      ? worker.dir
                      : path.join(process.cwd(), worker.dir)
        , port  = worker.port.toString()
        ;

      // todo [akamel] start can fail; and then the whole process fails
      return Promise
              .promisify(worker.container.start, worker.container)({
                  'Binds':[
                      dir + ':/home/worker:ro'
                  ]
                , 'PortBindings':{ '80/tcp': [{ 'HostPort':  port }] }
              })
              .then(function(){
                return worker;
              });
    })
    .nodeify(cb)
    ;
}

DockerPool.prototype.restart_worker = function(id, cb) {
  Promise
    .promisify(this.kill_worker, this)(id)
    // .catch(function(){})
    .bind(this)
    .then(function(){
      return Promise.promisify(this.start, this)(id)
    })
    .nodeify(cb)
    ;
};

DockerPool.prototype.kill_worker = function(id, cb) {
  var worker = _.isObject(id)? id : this.findById(id);

  worker.container.stop(cb || _.noop);
};

DockerPool.prototype.kill_workers = function(cb) {
  // todo [akamel] looks like this is failing sometimes;
  Promise
    .promisify(this.docker.listContainers, this.docker)({ all : true })
    .bind(this)
    .each(function(item){
      var container = this.docker.getContainer(item.Id);

      return Promise.promisify(container.remove, container)({ force : true });
    })
    .nodeify(cb)
    ;
};

module.exports = DockerPool;