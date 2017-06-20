"use strict";

var _                     = require('lodash')
  , Promise               = require('bluebird')
  , winston               = require('winston')
  , config                = require('config')
  , path                  = require('path')
  , url                   = require('url')
  , uuid                  = require('node-uuid')
  , onFinished            = require('on-finished')
  , tar_fs                = require('tar-fs')
  , createOutputStream    = require('create-output-stream')
  , zlib                  = require('zlib')
  , codedb_sdk            = require('taskmill-core-codedb-sdk')
  , make_sdk              = require('taskmill-core-make-sdk')
  , Container             = require('./container')
  , WError                = require('verror').WError
  , VError                = require('verror').VError
  ;

let agent_url = config.getUrlObject('agent.url');

class Maker{
  constructor(agent) {
    this.agent = agent;
  }

  make(remote, sha, options = {}) {
    let container = new Container(this.agent.docker, remote, sha);

    return make(container, remote, sha, options);
  }

  static dirname(remote) {
    let url_parsed = url.parse(remote);
    return path.join('.disk', url_parsed.hostname, url_parsed.pathname);
  }

  static writeFile(filename, blob) {
    return Promise
            .fromCallback((cb) => {
              if (!blob) {
                return cb();
              }

              let ws = createOutputStream(filename, { flags : 'w' });

              ws.end(blob);

              onFinished(ws, () => cb(undefined, filename));
            });
  }

  static writeTar(dirname, stream) {
    return Promise
            .fromCallback((cb) => {
              if (!stream) {
                return cb();
              }

              let ws = stream.pipe(zlib.createGunzip()).pipe(tar_fs.extract(dirname));

              // todo [akamel] are we catching errors on all levels?
              onFinished(ws, () => cb(undefined, dirname));
            });
  }

  static archive(remote, sha, options = {}) {
    let { token, bearer } = options;

    return Promise
            .fromCallback((cb) => {
              codedb_sdk
                .archive(remote, { branch : sha, token, bearer, make : true })
                .on('response', (response) => {
                  if (response.statusCode != 200) {
                    return cb(new Error(`codedb archive error ${response.statusCode}`));
                  }

                  cb(undefined, response);
                })
                .on('error', (err) => cb(err))
            });
  }
}

function track(container, result) {
  let kill = () => { return container.sigkill(); };

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

    make_sdk
      .set(result, { ttl : 5 })
      .catch((err) => {
        console.error('error extend live container', err, result);
      });
  };

  container.on('stats', monitor);

  container.once('die', () => {
    make_sdk
      .del(result.hash)
      .catch((err) => {
        console.error('error unset dead container', err, result);
      });
  });

  return make_sdk.set(result, { ttl : 5 });
}

// process.on("unhandledRejection", function(reason, promise) {
//     console.error(reason, promise);
// });

function make(container, remote, sha, options = {}) {
    let time = process.hrtime();

    let { blob, filename, token, cache, bearer } = options;

    let single_use = !cache || !!blob;

    let { key, hash } = make_sdk.key(remote, sha, { single_use });

    if (single_use) {
      return go_make();
    } else {
      return make_sdk
              .lock(hash)
              .catch((err) => {
                throw new WError({ name : 'MAKE_LOCK_TAKEN', cause : err, info : { entity : `${key}`, message : 'lock taken' } }, `lock ${hash} taken`);
              })
              .then((lock) => {
                console.log('got lock', lock, key, hash);
                let t = setTimeout(() => {
                  console.log('extend lock', lock, key, hash);
                  make_sdk
                    .extend(lock)
                    .catch((err) => {
                      console.log('stop extend lock', lock, key, hash);
                      // console.error(err);
                      clearTimeout(t);
                    })
                }, 1000);

                return go_make()
                        .finally(() => {
                          // make_sdk.unlock(lock);
                          console.log('stop extend lock', lock, key, hash);
                          clearTimeout(t);
                        });
              });
    }

    function go_make() {
      // mount file to container
      let disk = Maker.dirname(remote);
      let blobname = path.join(disk, `${uuid.v4()}.layer`);
      let tarname = path.join(disk, sha);

      return Promise
              .all([
                  Maker.writeFile(blobname, blob)
                , Maker.archive(remote, sha, { token, bearer }).then((stream) => { return Maker.writeTar(tarname, stream); })
              ])
              .spread((blobname, tarname) => {
                container.mount(tarname, '/mnt/src/');
                if (blobname) {
                  container.mount(blobname, path.join('/mnt/src/', filename));
                }

                return container.await();
              })
              .then((result) => {
                let { hostname, protocol } = agent_url
                  , { port } = result
                  ;

                return {
                    key
                  , hash
                  , single_use
                  , remote
                  , sha
                  , protocol  : protocol
                  , hostname  : hostname
                  , port      : port
                  , run_url   : url.format({ protocol, hostname, port })
                  , stats     : {
                    time : process.hrtime(time)
                  }
                };
              })
              .tap((result) => {
                return track(container, result);
              })
              .catch((err) => {
                console.error(err.message);
                throw err.message;
              });
    }
  }

  module.exports = Maker;
