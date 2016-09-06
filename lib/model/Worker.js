"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , EventEmitter  = require('events').EventEmitter
  , winston       = require('winston')
  , Container     = require('./Container')
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

    this.__container = new Container();
  }

  container() {
    return this.__container.ready();
  }
  
  handle(req, res) {
    return req.__obj
            .acl()
            .then(() => req.__obj.initialize())
            .then(() => this.container())
            .tap((container) => container.pipe(req, res));
            // .catch((err) => {
            //   // todo [akamel] handle error
            //   console.log('container::timeout', err);
            //   this.emit('timeout', err, null, container);
            // });
          // super.run(image, cmd, streams, create_opts, {}, (err, data, container) => {
          // }).on('container', (result) => {
          // })
  }

  static get(req, res) {

    return Promise.try(() => {
      let key = req.__obj.canCoHost()
                  ? req.__obj.remote
                  : `${req.__obj.remote}#${req.__obj.id}`;

      if (!store[key]) {
        store[key] = new Worker(key);
      }

      return store[key];
    });
  }
}

var store = {};

module.exports = Worker;