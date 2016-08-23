"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , EventEmitter  = require('events').EventEmitter
  , man           = require('taskmill-core-man')
  ;

class Worker extends EventEmitter {
  constructor(request, pool) {
    super();

    this.request      = request;
    this.id           = request.id;
    this.pool         = pool;

    // todo [akamel] do we really need this?
    this.on('die', () => {
      this.request.stdout(null);
    });
  }

  // todo [akamel] put this back
  // kill() {
  //   this.pool.kill(this);
  // }

  initialize() {
    return this.request
                .getBlob()
                .then((result) => {
                  // todo [akamel] maybe we should rename to content? arg.....
                  this.request.doc.blob = result.content;
                  this.request.doc.manual = man.get(result.blob);

                  return this;
                });
  }
}

module.exports = Worker;