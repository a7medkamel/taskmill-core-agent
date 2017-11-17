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
  , mon                   = require('./monitor')
  , pretty_hrtime         = require('pretty-hrtime')
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
                return cb(new Error('blob is empty'));
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

// process.on("unhandledRejection", function(reason, promise) {
//     console.error(reason, promise);
// });

function make(container, remote, sha, options = {}) {
    let time = process.hrtime();

    let { blob, blob_type, filename, token, cache, bearer, tailf } = options;

    let single_use = (cache === false) || !!blob;

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
                winston.info('lock', key, hash);
                let t = setInterval(() => {
                  winston.info('lock:extend', key, hash);
                  make_sdk
                    .extend(lock)
                    .catch((err) => {
                      winston.error('lock:extend', key, hash, err);
                      clearInterval(t);
                    })
                }, 1000);

                return go_make()
                        .finally(() => {
                          winston.info('lock:abandon', key, hash);
                          clearInterval(t);
                        });
              });
    }

    function go_make() {
      return Promise
              .try(() => {
                // mount file to container
                let disk    = Maker.dirname(remote)
                  , tarname = path.join(disk, sha)
                  , hrtime  = process.hrtime
                  , mk      = {}
                  ;

                container.mount(`${tarname}/`, '/mnt/src/');

                if (blob) {
                  if (blob_type == 'application/x-gtar') {
                    return;
                  }

                  let blobname = path.join(disk, `${uuid.v4()}.layer`);

                  container.mount(blobname, path.join('/mnt/src/', filename));

                  mk['blob'] = Maker.writeFile(blobname, blob);
                }

                mk['machine'] = container.await();
                mk['tar'] = Maker.archive(remote, sha, { token, bearer }).then((stream) => { return Maker.writeTar(tarname, stream); })

                return Promise
                        .props(mk)
                        .then((result) => {
                          let { blob, tar, machine }  = result
                            , diff                    = process.hrtime(time)
                            , { hostname, protocol }  = agent_url
                            , { port }                = machine
                            , { secret }              = container
                            ;

                          winston.info(`container:e2e ${pretty_hrtime(diff)}`);
                          return {
                              key
                            , hash
                            , single_use
                            , remote
                            , sha
                            , protocol
                            , hostname
                            , port
                            , secret
                            , tailf
                            , run_url   : url.format({ protocol, hostname, port })
                            , stats     : {
                                  boottime  : new Date().getTime()
                                , time      : diff
                              }
                          };
                        })
                        .tap((result) => {
                          return mon.monitor(container, result);
                        })
              })
              .catch((err) => {
                winston.error('go_make', err);
                throw err.message;
              });
    }
  }

  module.exports = Maker;
