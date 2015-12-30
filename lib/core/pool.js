var util            = require('util')
  , _               = require('lodash')
  , EventEmitter    = require('events').EventEmitter
  ;

function Pool(){
  EventEmitter.call(this);
};

util.inherits(Pool, EventEmitter);

Pool.prototype.workers = {};

Pool.prototype.add = function(worker) {
  this.workers[worker.id] = worker;
};

Pool.prototype.kill = function(id) {
  var worker = this.workers[id];
  if (worker) {
    this.kill_worker(worker);
  }
};

Pool.prototype.remove = function(worker) {
  delete this.workers[worker.id];
};

Pool.prototype.info = function() {
  return _.map(this.workers, function(i){ return i.info(); });
};

module.exports = Pool;