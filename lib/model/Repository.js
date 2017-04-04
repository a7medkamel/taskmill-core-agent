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
  }

  blob(name, options = {}) {
    return codedb_sdk.blob(this.remote, name, { branch : options.branch, token : options.token, populate : options.populate });
  }

  hotreload(name, content, options = {}) {
    return codedb_sdk.hotreload(this.remote, name, content, { branch : options.branch, token : options.token, populate : options.populate });
  }

  archive(options = {}) {
    // todo [akamel] move etag read outside this function
    let etag_filename = path.join(options.to, '../.etag');

    return Promise
            .fromCallback((cb) => fse.readFile(etag_filename, cb))
            .catch((err) => {})
            .then((etag) => {
              return Promise
                      .fromCallback((cb) => {
                        codedb_sdk
                          .archive(this.remote, { branch : options.branch, token : options.token, ifnonematch : etag, make : true })
                          .on('response', (response) => {
                            // if there is a new response
                            if (response.statusCode == 304) {
                              return cb(undefined, { path : options.to, etag_match : true }); 
                            }

                            // todo [akamel] we make the disk folder even if err
                            if (response.statusCode != 200) {
                              return cb(new Error(`codedb archive error ${response.statusCode}`));
                            }

                            let etag  = response.headers['etag']
                              , to    = options.to
                              ;

                            this
                              .write_tar(response, to, etag_filename, etag)
                              .asCallback(cb);                            
                          })
                          .on('error', (err) => cb(err))
                      });
            });
  }

  write_tar(stream, to, etag_filename, etag) {
    return Promise
            .fromCallback((cb) => stream
                                    .pipe(zlib.createGunzip())
                                    .pipe(tar_fs.extract(to))
                                    .on('finish', cb)
                                    .on('end', cb)
                          )
            .tap(() => console.log('unpack-ed'))
            .then(() => Promise.fromCallback((cb) => fse.outputFile(etag_filename, etag, cb)))
            .tap(() => console.log('etag-ed'))
            .then(() => {
              return { path : to, etag_match : false };
            });
  }

  // todo [akamel] is this used anywhere?
  end(res) {
    if(!res.headersSent) {
      res.statusCode = 500;
      res.write(JSON.stringify({ message : 'Container Died' }));
      res.end();
    }
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