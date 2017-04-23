"use strict";

var _                     = require('lodash')
  , Promise               = require('bluebird')
  , EventEmitter          = require('events').EventEmitter
  , winston               = require('winston')
  , crypto                = require('crypto')
  , urljoin               = require('url-join')
  , config                = require('config')
  , filenamifyUrl         = require('filenamify-url')
  , codedb_sdk            = require('taskmill-core-codedb-sdk')
  , Request               = require('./Request')
  , MultiUseContainer     = require('./MultiUseContainer')
  , SingleUseContainer    = require('./SingleUseContainer')
  ;

class Worker extends EventEmitter {
  constructor(remote, sha, options = {}) {
    super();

    this.id = Worker.id(remote, sha, options);

    this.remote = remote;
    this.sha = sha;

    this.single_use = options.single_use;

    // todo [akamel] what is this for?
    // - when does this worker ever get deleted?
    // - maybe on idle?
    this.once('finish', () => delete store[id]);
  }

  container() {
    if (!this.__container) {

      let ContainerType = this.single_use? SingleUseContainer : MultiUseContainer;

      let container = new ContainerType(this.remote, this.sha);

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
  
  handle(req, res, options = {}) {
    let { bearer } = options;

    return req.__obj
            .acl()
            .then(() => this.acquire(req))
            .then((container) => {
              let blob = container
                          .repository()
                          .then((repository) => {
                            let content   = req.__obj.doc.blob
                              , filename  = req.__obj.doc.filename
                              // , branch    = req.__obj.doc.branch
                              , opts      = {
                                                branch : this.sha
                                              , bearer
                                              , populate  : {
                                                  manual : true
                                              }
                                            }
                              ;

                            if (content) {
                              return repository
                                      .hotreload(filename, content, opts)
                                      .then((blob) => {
                                        return container
                                                .hotreload(filename, blob.content)
                                                .then(() => {
                                                  req.__obj.doc.manual = blob.manual;

                                                  delete req.__obj.doc.blob;
                                                });
                                      })
                                      ;
                            }

                            return repository.blob(filename, opts);
                          });
              
              Promise
                .all([
                    blob
                  , container.build({ bearer })
                ])
                .spread((blob, build) => {
                  let { sha } = build;

                  // todo [akamel] release is called multiple times because we mount /run
                  return container
                          .mount(build.path, '/mnt/src/', () => {
                            return container
                                    .repository()
                                    .then((repository) => {
                                      return repository.release({ sha })
                                    });
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

  static id(remote, sha, options = {}) {
    let { id, single_use } = options;

    let key = `${remote}#${sha}`;

    if (single_use) {
      key = `${key}+${id}`;
    } 

    return key;
  }

  static get(req_obj = {}, options = {}) {
    let { id, remote, branch } = req_obj;

    let { bearer } = options;

    return codedb_sdk
            .sha(remote, { branch, bearer })
            .then(({ sha }) => {
              let single_use = !req_obj.canCoHost();
              
              let key = Worker.id(remote, sha, { id, single_use });
                    
              if (!store[key]) {
                store[key] = new Worker(remote, sha, { id, single_use, bearer });
              }

              return store[key];
              
            });
  }

  static handle(req, res) {
    req.__obj = new Request(req, res);

    // todo [akamel] we extract bearer all the way here, when it was in req all along
    let bearer = req.headers['authorization'];

    return Worker
            .get(req.__obj, { bearer })
            .then((worker) => worker.handle(req, res, { bearer }))
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