"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , EventEmitter  = require('events').EventEmitter
  ;

class Container extends EventEmitter {
  constructor(options) {
    super();

    // this.id = id;
    // todo [akamel] do we really need this?
    // this.once('die', () => {
    //   this.request.stdout(null);
    // });

    // this.once('finish', () => delete store[id]);
  }
}

module.exports = Container;