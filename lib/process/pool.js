var Promise         = require('bluebird')
  , _               = require('lodash')
  , util            = require('util')
  , ps              = require('ps-node')
  , config          = require('config')
  , spawn           = require('child_process').spawn
  , Worker          = require('../core/worker')
  , Pool            = require('../core/pool')
  ;

function ProcessPool(){
  Pool.call(this);
};

util.inherits(ProcessPool, Pool);

ProcessPool.prototype.create_worker = function(agent, cb) {
  var id    = this._next_id ++
    , worker = new Worker({
          dir         : config.get('worker.dir')
        , agent       : agent
        , id          : id
        , protocol    : 'http'
        , host        : 'localhost'
        , port        : config.get('worker.port') + id
      })
    ;

  this.register_worker(worker);

  cb && cb(undefined, worker);
};

ProcessPool.prototype.prepare = function(id, cb) {
  var worker = _.isObject(id)? id : this.workers[id];

  Promise
    .resolve(worker)
    .nodeify(cb)
    ;
}

ProcessPool.prototype.start = function(id, cb) {
  var worker = _.isObject(id)? id : this.workers[id];

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
      console.log('spawning worker', worker.id);
      var worker_config = JSON.stringify({
        port : worker.port
      });

      worker.process = spawn('node', [ 'index.js', '--NODE_CONFIG=' + worker_config], {
                          cwd   : worker.dir
                        , stdio : config.get('worker.pipe')? 'inherit' : null
                      });

      return worker;
    })
    .nodeify(cb)
    ;
}

ProcessPool.prototype.restart_worker = function(id, cb) {
  var worker = _.isObject(id)? id : this.workers[id];

  Promise
    .promisify(ps.kill)(worker.process.pid)
    .bind(this)
    .catch(function(){}) // eat up errors
    .then(function(){
      return Promise.promisify(this.start, this)(worker);
    })
    .nodeify(cb)
};

ProcessPool.prototype.kill_worker = function(id, cb) {
  var worker = _.isObject(id)? id : this.workers[id];

  ps.kill(worker.process.pid, cb || _.noop);
};

ProcessPool.prototype.kill_workers = function(cb) {
  // todo [akamel] arguments doesn't really work here
  Promise
    .promisify(ps.lookup)({
      command: 'node',
      arguments: 'index.js'
    })
    .each(function(proc){
      return Promise.promisify(ps.kill)(proc.pid);
    })
    .nodeify(cb)
    ;
};

module.exports = ProcessPool;