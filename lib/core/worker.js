var _             = require('lodash')
  , config        = require('config')
  , util          = require('util')
  , path          = require('path')
  , config        = require('config')
  , EventEmitter  = require('events').EventEmitter
  ;

function Worker(agent, task) {
// console.log('worker created at', task.id, (new Date()).getTime());
  EventEmitter.call(this);

  this.task         = task;
  this.id           = task.id;
  this.agent        = agent;
  this.pool         = agent.pool;
  this.dir          = config.get('worker.dir');

  this.dir = path.isAbsolute(this.dir)
              ? this.dir
              : path.join(process.cwd(), this.dir);
}

util.inherits(Worker, EventEmitter);

Worker.prototype.info = function() {
  return _.pick(this, 'id', 'dir');
  return info;
};

// todo [akamel] decode chunk to utf-8?
function socket_stream(chunk, type){
  this.agent.socket.emit('worker-stdio', {
      id    : this.id
    , text  : chunk.toString('utf8')
    , type  : type
  });
};

Worker.prototype.stdout = function(chunk){
  socket_stream.call(this, chunk, 'stdout');
};

Worker.prototype.stderr = function(chunk){
  socket_stream.call(this, chunk, 'stderr');
};

Worker.prototype.kill = function(){
  this.pool.kill(this);
};

Worker.prototype.run = function(cb){
  var worker = this;
  this.pool.run(this, function(){
    worker.runAt = process.hrtime();
    cb.apply(this, _.toArray(arguments));
  });
};

module.exports = Worker;