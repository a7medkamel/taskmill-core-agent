"use strict";

var _               = require('lodash')
  , EventEmitter    = require('events').EventEmitter
  , Worker          = require('./worker')
  ;

class Pool extends EventEmitter {
  constructor() {
    super();

    this.workers = {};
  }

  create(agent, task) {
    var worker = new Worker(agent, task);
    this.add(worker);

    return worker;
  }

  add(worker) {
    this.workers[worker.id] = worker;
  }

  kill(id) {
    var worker = this.workers[id];
    if (worker) {
      this.kill_worker(worker);
    }
  };

  remove(worker) {
    delete this.workers[worker.id];
  };

  info() {
    return _.map(this.workers, function(i){ return i.info(); });
  };
};

module.exports = Pool;