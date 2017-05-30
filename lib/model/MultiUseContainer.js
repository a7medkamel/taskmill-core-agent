"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , config        = require('config-url')
  , winston       = require('winston')
  , Container     = require('./Container')
  ;

class MultiUseContainer extends Container {
  constructor() {
    super(...arguments);

    this.register = false;
    
    this.__reqs = {};
  }

  acquire(req, res) {
    let key = req.__obj.id;

    this.__reqs[key] = req;

    delete this.__idle_since;
  }

  release(req) {
    let key = req.__obj.id;

    delete this.__reqs[key];

    if (this.count() === 0) {
      this.__idle_since = new Date().getTime();
    }
  }

  // todo [akamel] perf
  count() {
    return _.size(_.keys(this.__reqs));
  }

  sigkill(err) {
    this.end(err);

    super.sigkill();
  }

  end(err) {
    _.each(this.__reqs, (req, key) => {
      req.__obj.end(err, req, req.__obj.res);
    });

    return this.wipe();
  }
}

module.exports = MultiUseContainer;