"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , EventEmitter  = require('events').EventEmitter
  ;

class Worker extends EventEmitter {
  constructor(id, options) {
    super();

    this.id = id;
    // todo [akamel] do we really need this?
    // this.once('die', () => {
    //   this.request.stdout(null);
    // });

    this.once('finish', () => delete store[id]);
  }

  static get(request) {
    return Promise.try(() => {
      let key = request.canCoHost()
                  ? request.remote
                  : `${request.remote}#${request.id}`;

      if (!store[key]) {
        store[key] = new Worker(key);
      }

      return store[key];
    });
  }
}

var store = {};

module.exports = Worker;