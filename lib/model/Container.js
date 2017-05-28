"use strict";

var _                   = require('lodash')
  , Promise             = require('bluebird')
  , EventEmitter        = require('events').EventEmitter
  , retry               = require('bluebird-retry')
  , config              = require('config-url')
  , request             = require('request')
  , urljoin             = require('url-join')
  , url                 = require('url')
  , path                = require('path')
  , winston             = require('winston')
  , createOutputStream  = require('create-output-stream')
  , fse                 = require('fs-extra')
  , rp                  = require('request-promise')
  , onFinished          = require('on-finished')
  , Time                = require('time-diff')
  , Docker              = require('../Docker')
  , uuid                = require('node-uuid')
  , git                 = require('taskmill-core-git')
  , Repository          = require('./Repository')
  ;

class Container extends EventEmitter {
  constructor(remote, sha) {
    super();          

    this.remote = remote;
    this.sha = sha;

    let url_parsed = url.parse(remote);

    this.disk = path.join('.disk', url_parsed.hostname, url_parsed.pathname);

    this.__mount = [];

    this.await = _.once(this.await);
    this.build = _.once(this.build);

    this.end = _.once(this.end);
    
    this.__container = new Promise((resolve, reject) => {
        this.on_boot = (err, res) => {
          if (err) {
            return reject(err);
          }

          resolve(res);
        };
    });
  }

  mount(local, remote, done) {
    this.__mount.push({ local, remote, done });
  }

  boot() {
    if (this.__boot_promise) {
      return this.__boot_promise;
    }

    let docker = Docker.get();

    let opt = {
        binds       : []
      , config      : {
          remote    : this.remote
        , sha       : this.sha
        , base_url  : '/'
      }
    };

    if (config.get('worker.mount')) {
      opt.binds.push(...config.get('worker.mount'));
    }

    // todo [akamel] wipe these out after container close
    opt.binds.push(..._.map(this.__mount, (i) => `${path.resolve(process.cwd(), i.local)}/:${i.remote}`));

    let ret = Promise
                .fromCallback((cb) => {
                  fse.ensureDir(this.disk, cb);
                })
                .then(() => {
                  return docker
                          .create(opt)
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
                          })
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
                          });
                })
                .asCallback(this.on_boot);

    this.__boot_promise = ret;

    return ret;
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

  isListening() {
    return this
            .__container
            .then((container) => {
              let time = new Time();
              time.start('port');
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
                        winston.info('port ready in:', info.NetworkSettings.Ports, time.end('port'));
                        
                        let port = info.NetworkSettings.Ports['80/tcp'][0].HostPort;

                        let count = 0;
                        this.url = `http://localhost:${port}`;

                        time.start('listening');
                        return retry(() => { 
                                  count++;
                                  return rp.get(this.url);
                                }, { interval : 10, timeout : 500 * 1000, max_tries : -1, backoff : 2, max_interval : 60 })
                                .then(() => {
                                  winston.info(`needed ${count} retries to connect to container, in ${time.end('listening')}`);
                                });
                      });
            });
  }

  build(options = {}) {
    let repository = this.repository();

    return repository
            .acquire({
                sha     : this.sha
              , bearer  : options.bearer
            });
  }

  await() {
    return this
            .boot()
            .then(() => this.isListening());
  }

  repository() {
    return Repository.get(this.remote);
  }

  acquire(req) {
    throw new Error('not implemented');
  }

  release(req) {
    throw new Error('not implemented');
  }

  handle(req, res) {
    req.profiler.start('container.handle');

    onFinished(res, (err) => {
      req.profiler.done('container.handle');

      this.release(req);
      if (this.count() === 0) {
        this.emit('drain');
      }

      req.profiler.done('req');
      console.log(req.profiler.toString());
    });

    this.pipe(req, res);
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
              // let base_url = git.base_url(this.remote, req.url);

              // headers.base_url = base_url;
              // console.log(base_url);
              let url = urljoin(this.url, req.url);
              req
                .pipe(request(url, { headers : headers }))
                .on('response', (response) => {

                  res.statusCode = response.statusCode;

                  // todo [akamel] only do if content-type is not specified?
                  let content_type = _.get(req.__obj.doc, 'manual.output["content-type"]');
                  if (content_type) {
                    response.headers['content-type'] = content_type;
                  }

                  // todo [akamel] consider moving these headers to worker?
                  let pragma = _.get(req.__obj.doc, 'manual.pragma');
                  if (pragma) {
                    response.headers['Manual-Pragma'] = JSON.stringify(pragma);
                  }

                  // if (res.statusCode == 304) {
                  //   console.log('ending with 304');
                  //   res.end();
                  //   return;
                  // }
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

  hotreload(name, content) {
    return Promise
            .try(() => {
              let filename  = path.join(this.disk, `${uuid.v4()}.layer`)
                , ws        = createOutputStream(filename, { flags : 'w' })
                ;

              ws.end(content);

              return Promise
                      .fromCallback((cb) => onFinished(ws, cb))
                      .then(() => { 
                        this
                          .mount(filename, path.join('/mnt/src/', name), () => {
                            return Promise.fromCallback((cb) => fse.remove(filename, cb));
                          });
                      });
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
              // todo [akamel] this isn't ideal; we supress error log if container is already dead
              if (err.message.match(/container already stopped/)) {
                return;
              }

              winston.error(err);
            });
  }

  end() {
    throw new Error('not implemented');
  }

  wipe() {
    return Promise.map(this.__mount, (i) => i.done());
  }
}

module.exports = Container;