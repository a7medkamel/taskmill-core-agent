var Promise         = require('bluebird')
  , _               = require('lodash')
  , ps              = require('ps-node')
  , config          = require('config')
  , spawn           = require('child_process').spawn
  , Worker          = require('../core/worker')
  ;

function ProcessPool(){ };

ProcessPool.prototype._next_id = 0;
ProcessPool.prototype.workers = {};

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

  this.workers[id] = worker;

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
      console.log('spawing worker', worker.id);
      worker.process = spawn('node', [ 'index.js', '--port', worker.port ], {
                          cwd   : worker.dir
                        , stdio : config.get('worker.pipe')? 'inherit' : null
                      });

      return worker;
    })
    .nodeify(cb)
    ;
}

ProcessPool.prototype.kill_worker = function(id, cb) {
  // this.docker
  //       .getContainer(id)
  //       .remove({ force : true }, cb || function(){})
  //       ;
  throw new Error('not implemented');
};

ProcessPool.prototype.kill_workers = function(cb) {
  Promise
    .promisify(ps.lookup)({
      command: 'node',
      arguments: '--debug'
    })
    .each(function(proc){
      return Promise.promisify(ps.kill)(proc.pid);
    })
    .nodeify(cb)
    ;
};

ProcessPool.prototype.get_worker = function(cb) {
  return _.sample(this.workers);
};

ProcessPool.prototype.size = function(cb) {
  return _.size(this.workers);
};

module.exports = ProcessPool;