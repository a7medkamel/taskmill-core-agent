"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , Docker        = require('../Docker')
  , EventEmitter  = require('events').EventEmitter
  ;

class Container extends EventEmitter {
  constructor(options) {
    super();

    let docker = Docker.get();
    this.__container = docker
                        .create()
                        .tap((container) => {
                          return docker.start(container);
                        });
  }

  ready() {
    return this.__container;
  }
}

module.exports = Container;