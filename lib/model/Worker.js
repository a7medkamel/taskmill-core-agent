"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , EventEmitter  = require('events').EventEmitter
  , request       = require('request')
  , urljoin       = require('url-join')
  , retry         = require('bluebird-retry')
  , rp            = require('request-promise')
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
  }

  container() {
    return (new Container()).ready();
  }
  
  handle(req, res) {
    return req.__obj
            .acl()
            .then(() => req.__obj.initialize())
            .then(() => this.container())
            .then((container) => {
              // todo [akamel] need to place where DockerEvents is...
              // this.emit('finish', err, data, container);

              // console.log('container::fork', result);
              // this.emit('fork', result);
              // let container = super.getContainer(result.id);
              var time = process.hrtime();
              return retry(() => 
                        Promise
                          .fromCallback((cb) => container.inspect(cb))
                          .tap((info) => {
                            if (!info.NetworkSettings.Ports) {
                              throw new Error('NetworkSettings not bound');
                            }
                          })
                      , { interval : 50, timeout : 5000, max_tries : -1 })
                      .then((info) => {
                        let time = process.hrtime();

                        var diff = process.hrtime(time);
                        console.log('port ready in:', info.NetworkSettings.Ports, (diff[0] * 1e9 + diff[1]) / 1e9 );
                        
                        let port = info.NetworkSettings.Ports['80/tcp'][0].HostPort;

                        // todo [akamel] rename doc to metadata
                        let headers = {
                            '__metadata' : JSON.stringify(req.__obj.doc)
                        };

                        // set input content type as per manual if it is not already set
                        if (!req.headers['content-type']) {
                          let content_type = _.get(req.__obj.doc, 'manual.input["content-type"]');
                          if (content_type) {
                            headers['content-type'] = content_type;
                          }
                        }

                        let count = 0;
                        let url = `http://localhost:${port}`;

                        return retry(() => { 
                                  count++;
                                  return rp.get(url);
                                }, { interval : 10, timeout : 5000, max_tries : -1, backoff : 2, max_interval : 60 })
                                .then(() =>
                                  Promise
                                    .fromCallback((cb) => {
                                      req
                                        .pipe(request({ url : urljoin(url, req.url), headers : headers }))
                                        .on('response', (res) => {
                                          // todo [akamel] only do if content-type is not specified?
                                          let content_type = _.get(req.__obj.doc, 'manual.output["content-type"]');
                                          if (content_type) {
                                            res.headers['content-type'] = content_type;
                                          }

                                          // todo [akamel] consider moving these headers to worker?
                                          let pragma = _.get(req.__obj.doc, 'manual.pragma');
                                          if (pragma) {
                                            res.headers['Manual-Pragma'] = JSON.stringify(pragma);
                                          }
                                        })
                                        .on('error', (err) => {
                                          cb(new Error('request failed: ' + url));
                                        })
                                        .pipe(res)
                                        .on('error', (err) => {
                                          cb(new Error('response failed'));
                                        });

                                      res.on('finish', cb);
                                    })
                                )
                                .then(() => {
                                  let diff = process.hrtime(time);
                                  winston.info(`needed ${count} retries to connect to container, in ${(diff[0] * 1e9 + diff[1]) / 1e6} seconds`);
                                });
                      });
            })
            .then((container) => {

              return this;
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