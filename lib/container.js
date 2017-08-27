"use strict";

var _                   = require('lodash')
  , Promise             = require('bluebird')
  , EventEmitter        = require('events').EventEmitter
  , retry               = require('bluebird-retry')
  , config              = require('config-url')
  , request             = require('request')
  , path                = require('path')
  , winston             = require('winston')
  , randtoken           = require('rand-token')
  , rp                  = require('request-promise')
  , onFinished          = require('on-finished')
  , Time                = require('time-diff')
  ;

class Container extends EventEmitter {
  constructor(docker, remote, sha) {
    super();

    this.secret = randtoken.generate(16);

    this.docker = docker;
    this.remote = remote;
    this.sha = sha;

    this.__mount = [];

    this.await = _.once(this.await);

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

    let { remote, sha, secret } = this;

    let opt = {
        binds       : []
      , config      : {
          remote
        , sha
        , secret
        , base_url  : '/'
      }
    };

    if (config.has('worker.mount')) {
      let m = _.compact(config.get('worker.mount'));
      opt.binds.push(...m);
    }

    // todo [akamel] wipe these out after container close
    opt.binds.push(..._.map(this.__mount, (i) => {
      let local   = path.resolve(process.cwd(), i.local)
        , remote  = i.remote
        ;

      if (_.last(remote) == '/') {
        local += '/';
      }

      return `${local}:${remote}`);
    });

    let ret = this
                .docker
                .create(opt)
                .tap((container) => {
                  this.docker.once(`stop:${container.id}`, (msg) => {
                    this.emit('stop', msg);
                  });

                  this.docker.once(`die:${container.id}`, (msg) => {
                    this.emit('die', msg);

                    this.removeAllListeners();
                  })

                  let ret = this.docker.start(container);

                  ret
                    .spread((container, emitter) => {
                      // todo [akamel] detach events when container dies
                      emitter.on('stdout', (chunk) => this.emit('stdout', chunk));
                      emitter.on('stderr', (chunk) => this.emit('stderr', chunk));
                    })

                  return ret;
                })
                .tap((container) => {
                  container.stats({ stream : true }, (err, stream) => {
                    stream.on('data', (buf) => {
                      let stats = JSON.parse(buf.toString());

                      stats.idle = this.__idle_since
                                    ? new Date().getTime() - this.__idle_since
                                    : 0;

                      this.stats = stats;
                      this.emit('stats', stats);
                    });

                    this.once('die', () => {
                      stream.removeAllListeners();
                      stream.destroy();
                    });
                  });
                })
                .asCallback(this.on_boot);

    this.__boot_promise = ret;

    return ret;
  }

  port() {
    // todo [akamel] we will call __container in retry loop
    return this
            .__container
            .then((container) => {
              return container.inspect();
            })
            .then((info) => {
              let port = _.get(info.NetworkSettings.Ports, '80/tcp.0.HostPort');
              if (_.isUndefined(port)) {
                throw new Error('port not bound');
              }

              return port;
            });
  }

  isListening() {
    return this
            .__container
            .then((container) => {
              let time = new Time();
              time.start('port');
              return retry(() => this.port(), { interval : 50, timeout : 5000, max_tries : -1 })
                      .then((port) => {
                        winston.info(`container:port ${time.end('port', 'ms')}`);

                        let count = 0;
                        this.url = `http://localhost:${port}`;
                        this.port = port;

                        time.start('ping');
                        return retry(() => {
                                  count++;
                                  return rp.get(this.url); //.catch((err) => { console.error(err); throw err; });
                                }, { interval : 100, timeout : 500 * 1000, max_tries : -1, backoff : 2, max_interval : 100 })
                                .then(() => {
                                  winston.info(`container:ping ${time.end('ping', 'ms')} [${count} pings]`);
                                  return { port };
                                });
                      });
            });
  }

  await() {
    let time = new Time();
    time.start('boot');
    return this
            .boot()
            .tap(() => {
              winston.info(`container:boot ${time.end('boot', 'ms')}`);
            })
            .then(() => this.isListening())
            // .tap(() => {
            //   winston.info(`container:await ${time.end('await', 'ms')}`);
            // });

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

  // wipe() {
  //   return Promise.map(this.__mount, (i) => i.done());
  // }
}

module.exports = Container;
