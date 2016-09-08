"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , config        = require('config-url')
  , winston       = require('winston')
  , Container     = require('./Container')
  ;

class SingleUseContainer extends Container {
  constructor(options) {
    super({ 'keep-alive' : true });
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

  end() {
    this.__req.__obj.end(this.__req.res);
  }
}

module.exports = SingleUseContainer;