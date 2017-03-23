"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , config        = require('config-url')
  , winston       = require('winston')
  , Container     = require('./Container')
  ;

class SingleUseContainer extends Container {
  constructor() {
    super(...arguments);

    this.__keep_alive = false;
  }
  
  stdout(chunk) {
    let req = this.__req;
    if (req) {
      req.__obj.stdout(chunk);
    }
    
    super.stdout(chunk);
  }

  stderr(chunk) {
    let req = this.__req;
    if (req) {
      req.__obj.stderr(chunk);
    }
    
    super.stderr(chunk);
  }

  acquire(req) {
    this.__req = req;
  }

  release(req) { }

  count() { return 1; }

  sigkill() {
    this.end();

    super.sigkill();
  }

  end(err) {
    let req = this.__req;
    if (req) {
      req.__obj.end(err, this.__req, this.__req.__obj.res);
    }

    return this.wipe();
  }
}

module.exports = SingleUseContainer;