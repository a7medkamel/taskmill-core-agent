"use strict";

var Promise     = require('bluebird')
  , winston     = require('winston')
  , url         = require('url')
  , codedb_sdk  = require('taskmill-core-codedb-sdk')
  , fse         = require('fs-extra')
  , path        = require('path')
  , _           = require('lodash')
  , onFinished  = require('on-finished')
  , tar_fs      = require('tar-fs')
  , zlib        = require('zlib')
  ;


class Repository {
  constructor(remote) {
    this.remote = remote;
    
    let url_parsed = url.parse(this.remote);

    this.__root = path.join('.disk', url_parsed.hostname, url_parsed.pathname);

    this.__lock = {};
  }

  blob(name, options = {}) {
    let { branch, token, populate, bearer } = options;

    return codedb_sdk.blob(this.remote, name, { branch, token, populate, bearer });
  }

  // todo [akamel] mount file to container, because we can't write it into the /sha folder
  hotreload(name, content, options = {}) {
    let { branch, token, populate, bearer } = options;

    return codedb_sdk.hotreload(this.remote, name, content, { branch, token, populate, bearer });
  }

  path(sha) {
    return path.join(this.__root, sha);
  }

  archive(options = {}) {
    let { branch, token, bearer } = options;

    let ifnonematch = undefined;

    return Promise
            .fromCallback((cb) => {
              codedb_sdk
                .archive(this.remote, { branch, token, ifnonematch, make : true, bearer })
                .on('response', (response) => {
                  let sha   = response.headers['etag']
                    , to    = this.path(sha)
                    ;

                  // if there is a new response
                  if (response.statusCode == 304) {
                    return cb(undefined, { path : to, sha }); 
                  }

                  // todo [akamel] we make the disk folder even if err
                  if (response.statusCode != 200) {
                    return cb(new Error(`codedb archive error ${response.statusCode}`));
                  }

                  return Promise
                          .fromCallback((cb) => response.pipe(zlib.createGunzip()).pipe(tar_fs.extract(to)).on('finish', cb).on('end', cb))
                          .then(() => {
                            return { path : to, sha };
                          })
                          .asCallback(cb);
                })
                .on('error', (err) => cb(err))
            });
  }

  acquire(options = {}) {
    let { sha } = options;

    this.__lock[sha] = this.__lock[sha]? this.__lock[sha] + 1 : 1;

    return this.archive();
  }

  release(options = {}) {
    let { sha } = options;

    return Promise
            .try(() => {
              this.__lock[sha]--;
              
              console.log('--', sha, this.__lock[sha]);

              if (!this.__lock[sha]) {
                 return Promise.fromCallback((cb) => fse.remove(this.path(sha), cb));
              }
            });
  }

  static get(id) {
    return Promise.try(() => {
      if (!Repository.store[id]) {
        Repository.store[id] = new Repository(id);
      }

      return Repository.store[id];
    });
  }
}

Repository.store = {};

module.exports = Repository;