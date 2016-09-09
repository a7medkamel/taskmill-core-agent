"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , EventEmitter  = require('events').EventEmitter
  , retry         = require('bluebird-retry')
  , config        = require('config-url')
  , request       = require('request')
  , urljoin       = require('url-join')
  , winston       = require('winston')
  , rp            = require('request-promise')
  , onFinished    = require('on-finished')
  , Docker        = require('../Docker')
  ;

class Container extends EventEmitter {
  constructor(options) {
    super();

    let docker = Docker.get();

    this.__container = docker
                        .create({ 'keep-alive' : _.get(options, 'keep-alive') })
                        .tap((container) => {
                          docker.once(`stop:${container.id}`, (msg) => {
                            this.emit('stop', msg);
                          });

                          docker.once(`die:${container.id}`, (msg) => {
                            this.emit('die', msg);

                            // in case container was externaly killed
                            this.end();

                            this.removeAllListeners();
                          })

                          docker
                            .start(container)
                            .spread((container, emitter) => {
                              // todo [akamel] detach events when container dies
                              emitter.on('stdout', (chunk) => this.stdout(chunk));
                              emitter.on('stderr', (chunk) => this.stderr(chunk));
                            })
                            .return(container);
                        });

    this.ready = _.memoize(this.ready);

    this.end = _.once(this.end);
  }
  
  stdout(chunk) {
    if (config.get('worker.log')) {
      process.stdout.write(chunk);
    }
  }

  stderr(chunk) {
    if (config.get('worker.log')) {
      process.stderr.write(chunk);
    }
  }

  ready() {
    return this
            .__container
            .tap((container) => {
              container.stats({ stream : true }, (err, stream) => {
                let handler = (buf) => {
                  let stats = JSON.parse(buf.toString());

                  stats.idle = this.__idle_since
                                ? new Date().getTime() - this.__idle_since
                                : 0;

                  this.stats = stats;
                  this.emit('stats', stats);
                }

                stream.on('data', handler);
                this.once('die', () => {
                  stream.removeListener('data', handler);
                  stream.destroy();
                });
              });
            })
            .then((container) => {
              let time = process.hrtime();
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

                        var diff = process.hrtime(time);
                        winston.info('port ready in:', info.NetworkSettings.Ports, (diff[0] * 1e9 + diff[1]) / 1e9 );
                        
                        let port = info.NetworkSettings.Ports['80/tcp'][0].HostPort;

                        let count = 0;
                        this.url = `http://localhost:${port}`;

                        var time = process.hrtime();
                        return retry(() => { 
                                  count++;
                                  return rp.get(this.url);
                                }, { interval : 10, timeout : 5000, max_tries : -1, backoff : 2, max_interval : 60 })
                                .then(() => {
                                  let diff = process.hrtime(time);
                                  winston.info(`needed ${count} retries to connect to container, in ${(diff[0] * 1e9 + diff[1]) / 1e6} seconds`);
                                });
                      });
            });
  }

  acquire(req) {
    throw new Error('not implemented');
  }

  release(req) {
    throw new Error('not implemented');
  }

  handle(req, res) {
    onFinished(req, (err, req) => {
      this.release(req);
      if (this.count() === 0) {
        this.emit('drain');
      }
    });

    req.__obj
      .initialize()
      .then(() => this.pipe(req, res));
  }

  count() {
    throw new Error('not implemented');
  }

  pipe(req, res) {
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

    return Promise
            .fromCallback((cb) => {
              req
                .pipe(request({ url : urljoin(this.url, req.url), headers : headers }))
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
                  cb(new Error('request failed: ' + this.url));
                })
                .pipe(res)
                .on('error', (err) => {
                  cb(new Error('response failed'));
                });

              res.on('finish', cb);
            });
  }

  // sigterm() {
  //   if (this.count() === 0) {
  //     return this.sigkill();
  //   } else {
  //     return Promise
  //             .fromCallback((cb) => {
  //               this.on('drain', () => {
  //                 if (this.count() === 0) {
  //                   this.sigkill().asCallback(cb);
  //                 }
  //               });
  //             });
  //   } 
  // }

  sigkill() {
    return this
            .__container
            .tap((container) => {
              return Promise.fromCallback((cb) => container.stop({ t : 1 }, cb));
            })
            .catch((err) => {
              winston.error(err);
            });
  }

  end() {
    throw new Error('not implemented');
  }
}

module.exports = Container;