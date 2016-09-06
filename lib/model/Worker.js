"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , EventEmitter  = require('events').EventEmitter
  , request       = require('request')
  , retry         = require('bluebird-retry')
  , Docker        = require('../Docker')
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
  }

  handle(req, res) {
    let request = req.__obj;

    let docker = Docker.get();

    return request
            .acl()
            .then(() => request.initialize())
            .then(() => {
              return docker
                      .create()
                      .then((container) => {
                        return docker.start(container);
                      });
            })
            .then((container) => {
              // todo [akamel] need to place where DockerEvents is...
              // this.emit('finish', err, data, container);

              // console.log('container::fork', result);
              // this.emit('fork', result);
              // let container = super.getContainer(result.id);
              var time = process.hrtime();
              retry(() => 
                Promise
                  .fromCallback((cb) => container.inspect(cb))
                  .tap((info) => {
                    if (!info.NetworkSettings.Ports) {
                      throw new Error('NetworkSettings not bound');
                    }
                  })
              , { interval : 50, timeout : 5000, max_tries : -1 })
              .then((info) => {
                var diff = process.hrtime(time);
                console.log('port ready in:', info.NetworkSettings.Ports, (diff[0] * 1e9 + diff[1]) / 1e9 );

                this.emit('ready', null, info, container);
                // console.log('container::ready', info);
              })
              .catch((err) => {
                // todo [akamel] handle error
                console.log('container::timeout', err);
                this.emit('timeout', err, null, container);
              });

              return this;
            });
          // super.run(image, cmd, streams, create_opts, {}, (err, data, container) => {
          // }).on('container', (result) => {
          // })
  }

  static get(req, res) {

    return Promise.try(() => {
      let key = req.__obj.canCoHost()
                  ? req.__obj.remote
                  : `${request.remote}#${request.id}`;

      if (!store[key]) {
        store[key] = new Worker(key);
      }

      return store[key];
    });
  }
}

var store = {};

module.exports = Worker;