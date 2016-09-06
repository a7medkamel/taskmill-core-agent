"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , Docker        = require('../Docker')
  , EventEmitter  = require('events').EventEmitter
  , retry         = require('bluebird-retry')
  , request       = require('request')
  , urljoin       = require('url-join')
  , winston       = require('winston')
  , rp            = require('request-promise')
  ;

class Container extends EventEmitter {
  constructor(options) {
    super();

    let docker = Docker.get();
    this.__container = docker
                        .create()
                        .tap((container) => {
                          return docker.start(container);
                        });
  }

  ready() {
    return this
            .__container
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
                        console.log('port ready in:', info.NetworkSettings.Ports, (diff[0] * 1e9 + diff[1]) / 1e9 );
                        
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
            })
            .return(this);
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
}

module.exports = Container;