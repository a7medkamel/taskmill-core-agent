"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , urljoin       = require('url-join')
  , dns           = require('dns')
  , config        = require('config-url')
  , codedb_sdk    = require('taskmill-core-codedb-sdk')
  , man           = require('taskmill-core-man')
  , EventEmitter  = require('events').EventEmitter
  ;

// todo [akamel] decode chunk to utf-8?
function socket_stream(chunk, type){
  if (this.task.tty && this.task.tty.ws) {
    // todo [akamel] don't do this on each call; this is wasteful
    var socket = require('socket.io-client')(urljoin(this.task.tty.ws, 'tty'));

    socket.emit('/stream', {
        id        : this.id
      , tty_id    : this.task.tty.id 
      , text      : chunk? chunk.toString('utf8') : chunk 
      , type      : type
    });
  }
};

class Worker extends EventEmitter {
  constructor(agent, task) {
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

    // todo [akamel] do we really need this?
    this.on('die', () => {
      socket_stream.call(this, null, 'stdout');
    });
  }

  // todo [akamel] this can be optemized / cache?
  getConfig() {
    let tunnel    = config.getUrlObject('tunnel')
      , services  = config.getUrlObject('services')
      ;

    let ret = {
      "req"       : this.task,
      "tunnel"    : { url : config.getUrl('tunnel') },
      "services"  : { url : config.getUrl('services') }
    }

    return Promise.resolve(ret);
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

  run() {
    // todo [akamel] get oauth token
    let p$code  = undefined
      , doc     = this.task
      ;

    return Promise
              .try(() => {
                if (doc.remote && !doc.blob) {
                  return codedb_sdk.blob(doc.remote, doc.filename, { branch : doc.branch, token : undefined /*token*/, url : doc.codedb_url });
                } else {
                  if (!config.get('agent.allow-foreign-code')) {
                    throw new Error('running foreign code is not allowed');
                  }

                  return {
                    content : doc.blob
                  };
                }
              })
              .then((result) => {
                // todo [akamel] maybe we should rename to content? arg.....
                this.task.blob = result.content;
                this.task.manual = man.get(result.blob);

                return this.pool.run(this);
              });
  }
}

module.exports = Worker;