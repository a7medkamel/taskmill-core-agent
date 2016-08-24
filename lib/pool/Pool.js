"use strict";

var _               = require('lodash')
  , EventEmitter    = require('events').EventEmitter
  , Worker          = require('../Worker')
  ;

class Pool extends EventEmitter {
  constructor() {
    super();

    this.workers = {};
  }

  run(request) {
    let worker = this.workers[request.id] = new Worker(request, this);

    worker.on('finish', () => {
      delete this.workers[request.id];
    });

    return worker
            .initialize()
            .then(() => worker);
  }

  // kill(id) {
  //   var worker = this.workers[id];
  //   if (worker) {
  //     this.kill_worker(worker);
  //   }
  // };

  // info() {
  //   return _.map(this.workers, function(i){ return i.info(); });
  // };
};

module.exports = Pool;