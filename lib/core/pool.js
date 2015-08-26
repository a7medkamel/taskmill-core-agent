var Promise         = require('bluebird')
  , _               = require('lodash')
  , util            = require('util')
  , EventEmitter    = require('events').EventEmitter
  ;

function Pool(){
  EventEmitter.call(this);
};

util.inherits(Pool, EventEmitter);

Pool.prototype._next_id = 0;
Pool.prototype.workers = {};

Pool.prototype.workers_ready = {};

Pool.prototype.register_worker = function(worker) {
  this.workers[worker.id] = worker;

  worker.on('draining', function(){
    delete this.workers_ready[worker.id];
  }.bind(this));

  worker.on('drained', function(){
    // todo [akamel] delay this is a tmp hack to reduce sockethangup errors
    _.delay(function(){
      worker.kill_worker(worker);
    }, 1000);
  });

  worker.on('disconnected', function(){
    delete this.workers_ready[worker.id];
  }.bind(this));

  worker.on('connected', function(){
    this.emit('worker.connected');

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
  return _.map(this.workers_ready, function(i){ return i.info(); });
};

module.exports = Pool;