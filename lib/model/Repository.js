"use strict";

var Promise     = require('bluebird')
  , winston     = require('winston')
  , url         = require('url')
  , codedb_sdk  = require('taskmill-core-codedb-sdk')
  , fse         = require('fs-extra')
  , path        = require('path')
  , _           = require('lodash')
  , onFinished  = require('on-finished')
  , tar         = require('tar-pack')
  , zlib        = require('zlib')
  ;


class Repository {
  constructor(remote) {
    this.remote = remote;
  }

  blob(name, options = {}) {
    return codedb_sdk.blob(this.remote, name, { branch : options.branch, token : options.token, populate : options.populate });
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
                          .archive(this.remote, { branch : options.branch, token : options.token, etag : etag })
                          .on('response', (response) => {
                            // if there is a new response
                            if (response.statusCode == 304) {
                              return cb(undefined, { path : options.to, etag_match : true }); 
                            }

                            response
                              .pipe(tar.unpack(options.to, (err, res) => {
                                if (err) {
                                  return cb(err, { path : options.to });
                                }

                                fse.outputFile(etag_filename, response.headers['etag'], (err) => cb(err, { path : options.to, etag_match : false }));
                              }));
                          })
                          .on('error', (err) => cb(err))
                      });
            });
  }

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