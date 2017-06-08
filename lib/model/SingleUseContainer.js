"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , config        = require('config-url')
  , winston       = require('winston')
  , onFinished    = require('on-finished')
  , Container     = require('./Container')
  ;

class SingleUseContainer extends Container {
  constructor() {
    super(...arguments);
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

  sigkill(err) {
    this.end(err);

    super.sigkill();
  }

  end(err) {
    let req = this.__req;
    if (req) {
      req.__obj.end(err, this.__req, this.__req.__obj.res);
    }

    return this.wipe();
  }

  handle(req, res) {
    onFinished(res, (err, req) => {
      this.sigkill();
    });

    return super.handle(req, res);
  }
}

module.exports = SingleUseContainer;