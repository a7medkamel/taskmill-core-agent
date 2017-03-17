"use strict";

var _                   = require('lodash')
  , Promise             = require('bluebird')
  , EventEmitter        = require('events').EventEmitter
  , retry               = require('bluebird-retry')
  , config              = require('config-url')
  , request             = require('request')
  , urljoin             = require('url-join')
  , path                = require('path')
  , winston             = require('winston')
  , createOutputStream  = require('create-output-stream')
  , fse                 = require('fs-extra')
  , tar                 = require('tar-fs')
  , rp                  = require('request-promise')
  , onFinished          = require('on-finished')
  , Time                = require('time-diff')
  , Docker              = require('../Docker')
  , Repository          = require('./Repository')
  ;

class Container extends EventEmitter {
  constructor(remote, disk, options = {}) {
    super();          

    this.remote = remote;
    this.disk = disk;

    this.key = options.key;

    this.options = options;

    this.ready = _.memoize(this.isListening);
    this.boot = _.memoize(this.boot);
    this.build = _.memoize(this.build);

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

  boot() {
    let docker = Docker.get();

    let opt = {
        'keep-alive'  : this.__keep_alive
      , 'binds'       : [
          `${path.resolve(process.cwd(), this.disk)}/:/mnt/`
          // todo [akamel] map preinstalled packages instead of using AMP module to alter search path
        ]
    };

    if (config.get('worker.mount')) {
      opt.binds.push(...config.get('worker.mount'));
    }

    // todo [akamel] cleanup keep-alive and binds -- all mixed together
    return Promise
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

  build() {
    return this
            .repository()
            .then((repository) => {

              // todo [akamel] rename this junk
              let to          = urljoin(process.cwd(), this.disk)
                , repo_to     = urljoin(process.cwd(), this.disk, 'src/')
                , build_to    = urljoin(process.cwd(), this.disk, 'src/node_modules')
                // , pack_tar    = urljoin(to, 'pack.tar')
                ;

              return repository
                      .archive({
                          branch    : this.options.branch
                        , token     : undefined /*token*/
                        , to        : repo_to
                      })
                      // .then(() => {
                      //   let df = Promise.fromCallback((cb) => fse.copy('./lib/jit/Dockerfile', path.join(to, 'Dockerfile'), { overwrite : true }, cb))
                      //     , pf = Promise.fromCallback((cb) => fse.copy('./lib/jit/package.json', path.join(to, 'package.json'), { overwrite : false }, cb))
                      //     ;

                      //   return Promise.all([df, pf]);
                      // })
                      // .then(() => {
                      //   return Promise
                      //           .fromCallback((cb) => {
                      //             tar
                      //               .pack(to)
                      //               .pipe(fse.createWriteStream(pack_tar))
                      //               .on('finish', cb);
                      //           });
                      // })
                      // .then(() => {
                      //   // todo [akamel] move def to begining of file?
                      //   let docker = new require('dockerode')();

                      //   return Promise
                      //           .fromCallback((cb) => {
                      //             docker
                      //               .run(
                      //                   'a7medkamel/taskmill-core-worker-setup'
                      //                 , []
                      //                 , [ process.stdout, process.stderr ]
                      //                 , { 
                      //                     Tty : false
                      //                   , HostConfig : { 'Binds' : [`${to}/:/mnt/`] }
                      //                   }, cb);
                      //           });
                      // })
                      // .then(() => {
                      //   // todo [akamel] move def to begining of file?
                      //   let docker = new require('dockerode')();

                      //   return Promise
                      //           .fromCallback((cb) => {
                      //             docker.buildImage(tar.pack(to), { t : this.key }, (err, stream) => {
                      //               if (err) {
                      //                 return cb(err);
                      //               }

                      //               docker.modem.followProgress(stream, (err, result) => {
                      //                 // console.log('end???')
                      //                 // console.log(err, result);
                      //                 cb(err);
                      //               }, (event) => {
                      //                 // console.log(event);
                      //               });
                      //             });
                      //           });
                      // })
                      .then((archive) => {
                        if (archive.etag_match) {
                          return;
                        }

                        return Promise
                                .fromCallback((cb) => fse.access(path.join(archive.path, 'package.json'), fse.constants.R_OK, cb))
                                .then(() => true)
                                .catch(() => false)
                                .then((build_required) => {
                                  if (build_required) {
                                    // build complete, boot up and copy data
                                    let docker = new require('dockerode')();

                                    return Promise
                                            .fromCallback((cb) => {
                                              docker
                                                .run(
                                                    // 'a7medkamel/taskmill-core-worker-base'
                                                    'a7medkamel/taskmill-core-worker'
                                                  , ['npm', 'install']
                                                  , [ process.stdout, process.stderr ]
                                                  , { 
                                                        Tty : false
                                                      , WorkingDir : '/mnt/src/'
                                                      , HostConfig : { 'Binds' : [`${to}/:/mnt/`] }
                                                    }
                                                  , cb
                                                );
                                            });
                                  }
                                });
                      });
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
    onFinished(req, (err, req) => {
      this.release(req);
      if (this.count() === 0) {
        this.emit('drain');
      }
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

  write(name, content) {
    return Promise
            .try(() => {
              let filename  = path.join(this.disk, 'src', name)
                , ws        = createOutputStream(filename, { flags : 'w' })
                ;

              ws.end(content);

              return Promise
                      .fromCallback((cb) => {
                        onFinished(ws, cb);
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
              winston.error(err);
            });
  }

  end() {
    throw new Error('not implemented');
  }
}

module.exports = Container;