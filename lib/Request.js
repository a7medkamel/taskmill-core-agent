"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , urljoin       = require('url-join')
  , io            = require('socket.io-client')
  , config        = require('config-url')
  , codedb_sdk    = require('taskmill-core-codedb-sdk')
  ;

class Request {
  constructor(doc) {
    this.doc    = doc;
    this.id     = doc.id;
    // todo [akamel] don't do this on each call; this is wasteful
    this.socket = _.has(this.doc, 'tty.ws')? io(urljoin(this.doc.tty.ws, 'tty')) : undefined;
  }

  stdout(chunk) {
    this.tty(chunk, 'stdout');
  }

  stderr(chunk) {
    this.tty(chunk, 'stderr');
  }

  // todo [akamel] decode chunk to utf-8?
  tty(chunk, type) {
    if (this.socket) {
      this.socket.emit('/stream', {
          id        : this.id
        , tty_id    : this.doc.tty.id 
        , text      : chunk? chunk.toString('utf8') : chunk 
        , type      : type
      });
    }
  }

  getBlob() {
    // todo [akamel] get oauth token
    return Promise
              .try(() => {
                if (this.doc.remote && !this.doc.blob) {
                  return codedb_sdk.blob(this.doc.remote, this.doc.filename, { branch : this.doc.branch, token : undefined /*token*/, url : this.doc.codedb_url });
                } else {
                  if (!config.get('agent.allow-foreign-code')) {
                    throw new Error('running foreign code is not allowed');
                  }

                  return {
                    content : this.doc.blob
                  };
                }
              });
  }
}

module.exports = Request;