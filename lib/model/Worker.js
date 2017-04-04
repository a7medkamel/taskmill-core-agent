"use strict";

var _                     = require('lodash')
  , Promise               = require('bluebird')
  , EventEmitter          = require('events').EventEmitter
  , winston               = require('winston')
  , crypto                = require('crypto')
  , urljoin               = require('url-join')
  , config                = require('config')
  , filenamifyUrl         = require('filenamify-url')
  , Request               = require('./Request')
  , MultiUseContainer     = require('./MultiUseContainer')
  , SingleUseContainer    = require('./SingleUseContainer')
  ;

class Worker extends EventEmitter {
  constructor(id, remote, options = {}) {
    super();

    this.id = id;
    this.remote = remote;
    this.branch = options.branch;

    this.options = options;

    // todo [akamel] what is this for?
    // - when does this worker ever get deleted?
    // - maybe on idle?
    this.once('finish', () => delete store[id]);
  }

  container() {
    if (!this.__container) {
      let single_use    = !this.options['keep-alive']
        , ContainerType = single_use? SingleUseContainer : MultiUseContainer
        , checksum      = crypto
                            .createHash('sha1')
                            .update(this.id)
                            .digest('hex')
        , key           = filenamifyUrl(this.id, { replacement : '.' }) + '.' + checksum
        , disk          = urljoin('.disk', key);
        ;

      let container = new ContainerType(this.remote, disk, {
          branch  : this.branch
        , key     : key
      });

      let kill = () => {
        container.removeListener('stats', monitor);

        // decomission this container right away
        this.release(container);
      };
      
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
      };

      container.on('stats', monitor);

      let term = (msg) => {
        winston.info('container terminated:', msg.id);
        // this container died, unknown reason, decomision
        this.release(container, new Error(`container terminated`));
      }

      container.once('stop', () => {});
      container.once('die', term);

      this.__container = container;
    }

    return this.__container;
  }

  acquire(req) {
    let container = this.container();

    container.acquire(req);

    return container;
  }

  release(container, err) {
    if (container) {
      container.sigkill(err);
      if (this.__container === container) {
          delete this.__container;
      }
    } else {
      this.__container.sigkill(err);
      delete this.__container;
    }
  }
  
  handle(req, res) {
    return req.__obj
            .acl()
            .then(() => this.acquire(req))
            .then((container) => {
              // todo [akamel] get oauth token, run private code
              // todo [akamel] can we make some of this parallel, blob and archive?
              let blob = container
                          .repository()
                          .then((repository) => {
                            let content   = req.__obj.doc.blob
                              , filename  = req.__obj.doc.filename
                              , branch    = req.__obj.doc.branch
                              , opts      = {
                                                branch    : branch
                                              , token     : undefined /*token*/
                                              , populate  : {
                                                  manual : true
                                              }
                                            }
                              ;

                            if (content) {
                              return repository.hotreload(filename, content, opts);
                            }

                            return repository.blob(filename, opts);
                          });
              
              Promise
                .all([
                    blob
                  , container.build()
                ])
                .spread((blob, build) => {
                  return container
                          .write(req.__obj.doc.filename, blob.content)
                          .then(() => {
                            req.__obj.doc.manual = blob.manual;

                            delete req.__obj.doc.blob;
                          });
                })
                .then(() => container.await())
                .then(() => container.handle(req, res))
                .catch((err) => {
                  // if an error is caught, we need to kill the container OBJ and restart
                  this.release(container, err);
                  // winston.error(err);
                  // todo [akamel] release would end the request anyway... should we seperate build from handle errors?
                  // req.__obj.decline(err, req, res);
                });
            });
  }

  static get(req, res) {
    return Promise.try(() => {
      let { id, remote, branch } = req.__obj;

      let can_cohost = req.__obj.canCoHost();

      let key = `${remote}#${branch}`;

      if (!can_cohost) {
        key = `${key}+${id}`;
      }
            
      if (!store[key]) {
        store[key] = new Worker(key, remote, { 
            'keep-alive'  : can_cohost
          , 'branch'      : branch
        });
      }

      return store[key];
    });
  }

  static handle(req, res) {
    req.__obj = new Request(req, res);

    return Worker
            .get(req, res)
            .then((worker) => worker.handle(req, res))
            .catch((err) => {
              winston.error(err);

              res.statusCode = 500;
              res.write(err.toString());
              res.end();
            });
  }

  static stats() {
    return _.map(store, (worker) => {
      return {
          id    : worker.id
        , stats : _.get(worker, '__container.stats')
      }
    });
  }
}

var store = {};

module.exports = Worker;