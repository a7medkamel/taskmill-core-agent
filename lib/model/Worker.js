"use strict";

var _                     = require('lodash')
  , Promise               = require('bluebird')
  , EventEmitter          = require('events').EventEmitter
  , winston               = require('winston')
  , config                = require('config')
  , Request               = require('./Request')
  , MultiUseContainer     = require('./MultiUseContainer')
  , SingleUseContainer    = require('./SingleUseContainer')
  ;

class Worker extends EventEmitter {
  constructor(id, options) {
    super();

    this.id = id;
    this.options = options;
    
    // todo [akamel] what is this for?
    // - when does this worker ever get deleted?
    // - maybe on idle?
    this.once('finish', () => delete store[id]);
  }

  container() {
    if (!this.__container) {
      let single_use = !_.get(this.options, 'keep-alive');
      let container = single_use? new SingleUseContainer() : new MultiUseContainer();

      let kill = () => {
        container.removeListener('stats', monitor);
        container.sigkill();

        // decomission this container right away
        delete this.__container;
      };
      
      let monitor = (stats) => {
        let max_usage = config.get('worker.max-memory') * 1024 * 1024;
        if (stats.memory_stats.usage > max_usage) {
          winston.info('kill - memory limit', this.id);
          return kill();
        }

        let max_idle = config.get('worker.max-idle') * 1000;
        if (stats.idle > max_idle) {
          winston.info('kill - idle limit', this.id);
          return kill();
        }
      };

      container.on('stats', monitor);

      let term = (msg) => {
        winston.info('container terminated:', msg.id);
        // this container died, unknown reason, decomision
        if (this.__container === container) {
          delete this.__container;
        }
      }

      container.once('stop', () => {});
      container.once('die', term);

      this.__container = container;
    }

    return this.__container;
  }

  acquire(req) {
    let container = this.container();

    container.acquire(req);

    return container;
  }
  
  handle(req, res) {
    return req.__obj
            .acl()
            .then(() => this.acquire(req))
            .then((container) => {
              container
                .ready()
                .then(() => container.handle(req, res));
            });
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
      let can_cohost = req.__obj.canCoHost();

      let key = can_cohost
                  ? req.__obj.remote
                  : `${req.__obj.remote}#${req.__obj.id}`;

      if (!store[key]) {
        store[key] = new Worker(key, { 'keep-alive' : can_cohost });
      }

      return store[key];
    });
  }

  static handle(req, res) {
    req.__obj = new Request(req, res);

    return Worker
            .get(req, res)
            .then((worker) => worker.handle(req, res))
            .catch((err) => {
              winston.error(err);

              res.statusCode = 500;
              res.write(err.toString());
              res.end();
            });
  }
}

var store = {};

module.exports = Worker;