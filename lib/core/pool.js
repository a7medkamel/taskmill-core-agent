var Promise         = require('bluebird')
  , _               = require('lodash')
  ;

function Pool(){ };

Pool.prototype._next_id = 0;
Pool.prototype.workers = {};

Pool.prototype.workers_ready = {};

Pool.prototype.register_worker = function(worker) {
  this.workers[worker.id] = worker;

  worker.on('draining', function(){
    delete this.workers_ready[worker.id];
  }.bind(this));

  worker.on('drained', function(){
    this.kill_worker(worker);
  }.bind(this));

  worker.on('disconnected', function(){
    delete this.workers_ready[worker.id];
  }.bind(this));

  worker.on('connected', function(){
    this.workers_ready[worker.id] = worker;
  }.bind(this));
};

Pool.prototype.get_worker = function() {
  return _.sample(this.workers_ready);
};

Pool.prototype.findById = function(id) {
  return this.workers[id];
};

Pool.prototype.size = function() {
  return _.size(this.workers);
};

Pool.prototype.info = function() {
  return _.map(this.workers, function(i){ return i.info(); });
};

module.exports = Pool;