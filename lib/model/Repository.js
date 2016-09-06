"use strict";

var Promise     = require('bluebird')
  , winston     = require('winston')
  , url         = require('url')
  , codedb_sdk  = require('taskmill-core-codedb-sdk')
  , _           = require('lodash')
  ;


class Repository {
  constructor(remote) {
    this.remote = remote;
  }

  blob(name, options) {
    options = options || {};

    return codedb_sdk.blob(this.remote, name, { branch : options.branch, token : options.token });
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