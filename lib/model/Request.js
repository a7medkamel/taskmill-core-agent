"use strict";

var _             = require('lodash')
  , Promise       = require('bluebird')
  , urljoin       = require('url-join')
  , winston       = require('winston')
  , io            = require('socket.io-client')
  , config        = require('config-url')
  , onFinished    = require('on-finished')
  ;

class Request {
  constructor(req, res) {
    // todo [akamel] we only parse this to get the request id out... seems we should be able to bypass it
    let doc = JSON.parse(req.headers['__metadata']);
    
    this.doc    = doc;
    this.id     = doc.id;
    // todo [akamel] don't do this on each call; this is wasteful
    this.socket = _.has(this.doc, 'tty.ws')? io(urljoin(this.doc.tty.ws, 'tty')) : undefined;

    // todo [akamel] this is silly
    this._has_blob_header = !!doc.blob;

    this.remote = doc.remote;

    // todo [akamel] do we really need this?
    res.on('finish', () => {
      this.stdout(null);
    });

    this.req = req;
    this.res = res;
  }

  stdout(chunk) {
    this.tty(chunk, 'stdout');
  }

  stderr(chunk) {
    this.tty(chunk, 'stderr');
  }

  end(err, req, res) {
    this.decline(err, req, res);
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

  canCoHost() {
    return !this._has_blob_header && !this.socket;
  }

  // can this request run
  acl(options) {
    return Promise
            .try(() => {
              if (!this.doc.remote) {
                throw new Error('unknown remote repository');
              }

              if (this.doc.blob) {
                if (!config.get('agent.allow-foreign-code')) {
                  throw new Error('running foreign code is not allowed');
                }
              }
            });
  }

  // todo [akamel] these are copied form gateway
  decline(err, req, res) {
    if (!onFinished.isFinished(res)) {
      res.setHeader('cache-control', 'no-cache');
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.write(JSON.stringify(this.errorify(err, req, res)));
      res.end();
    } else {
      winston.error('can\'t decline, res already ended', err);
    }
  }

  errorify(err, req, res) {
    err = err || {};

    var ret = {
        type    : err.stack? 'exception' : 'notification'
      , message : err.message
      // todo [akamel] should we expose this? its OSS anyway
      , stack   : err.stack
      , details : req.url
      , target  : 'taskmill-core-gateway'
    };

    return ret;
  }
}

module.exports = Request;