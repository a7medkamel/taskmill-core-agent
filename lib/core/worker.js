"use strict";

var _             = require('lodash')
  , config        = require('config')
  , Promise       = require('bluebird')
  , EventEmitter  = require('events').EventEmitter
  ;

// todo [akamel] decode chunk to utf-8?
function socket_stream(chunk, type){
  this.agent.socket.emit('/worker-stdio', {
      id    : this.id
    , text  : chunk.toString('utf8')
    , type  : type
  });
};

class Worker extends EventEmitter {
  constructor(agent, task) {
    // console.log('worker created at', task.id, (new Date()).getTime());
    super();

    this.task         = task;
    this.id           = task.id;
    this.agent        = agent;
    this.pool         = agent.pool;

    let _c = new Promise((res, rej) => { 
              this.resolve = res;
              this.reject = rej;
            });

    this.runInfoAsync = () => _c;

    this.config = {
      "req"         : task,
      "tunnel"      : {
        "protocol"  : config.get('tunnel.protocol'),
        "hostname"  : '__relay.io',
        "port"      : config.has('tunnel.port')? config.get('tunnel.port') : undefined
      },
      "services"      : {
        "protocol"  : config.get('services.protocol'),
        "hostname"  : config.get('services.hostname'),
        "port"      : config.has('services.port')? config.get('services.port') : undefined
      }
    }
  }

  info() {
    return _.pick(this, 'id');
  }

  stdout(chunk) {
    socket_stream.call(this, chunk, 'stdout');
  }

  stderr(chunk) {
    socket_stream.call(this, chunk, 'stderr');
  }

  kill() {
    this.pool.kill(this);
  }

  run(cb) {
    var worker = this;
    this.pool.run(this, function(){
      worker.runAt = process.hrtime();
      cb.apply(this, _.toArray(arguments));
    });
  }
}

module.exports = Worker;