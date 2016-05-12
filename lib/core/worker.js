"use strict";

var _             = require('lodash')
  , dns           = require('dns')
  , config        = require('config-url')
  , codedb_sdk    = require('taskmill-core-codedb-sdk')
  , man           = require('taskmill-core-man')
  , Promise       = require('bluebird')
  , EventEmitter  = require('events').EventEmitter
  ;

// todo [akamel] decode chunk to utf-8?
function socket_stream(chunk, type){
  this.agent.socket.emit('/worker-stdio', {
      id    : this.id
    , text  : chunk.toString('utf8')
    , type  : type
  });
};

class Worker extends EventEmitter {
  constructor(agent, task) {
    // console.log('worker created at', task.id, (new Date()).getTime());
    super();

    this.task         = task;
    this.id           = task.id;
    this.agent        = agent;
    this.pool         = agent.pool;

    let _c = new Promise((res, rej) => { 
              this.resolve = res;
              this.reject = rej;
            });

    this.runInfoAsync = () => _c;
  }

  getConfig() {
    let tunnel    = config.getUrlObject('tunnel')
      , services  = config.getUrlObject('services')
      ;

    // todo [akamel] we shouldn't have to do this per _new_ worker... or is this once per app?
    let waits = [
        !tunnel.force_dns_lookup
          ? Promise.resolve(tunnel)
          : Promise.promisify(dns.lookup)(tunnel.hostname)
                  .then((ip) => { 
                    tunnel.hostname = ip;
                    return tunnel
                  })
      , !services.force_dns_lookup
          ? Promise.resolve(services)
          : Promise.promisify(dns.lookup)(services.hostname)
                  .then((ip) => { 
                    services.hostname = ip;
                    return services
                  })
    ];

    return Promise
            .all(waits)
            .spread((tunnel, services) => {
              // todo [akamel] move to less_verbose config using config-url
              let ret = {
                "req"       : this.task,
                "tunnel"    : _.pick(tunnel, 'hostname', 'port', 'protocol'),
                "services"  : _.pick(services, 'hostname', 'port', 'protocol')
              }

              return ret;
            });
  }

  info() {
    return _.pick(this, 'id');
  }

  stdout(chunk) {
    socket_stream.call(this, chunk, 'stdout');
  }

  stderr(chunk) {
    socket_stream.call(this, chunk, 'stderr');
  }

  kill() {
    this.pool.kill(this);
  }

  run() {
    // todo [akamel] get oauth token
    let p$code  = undefined
      , doc     = this.task
      ;

    return Promise
              .try(() => {
                if (doc.remote && !doc.content) {
                  return codedb_sdk.blob(doc.remote, doc.filename, { branch : doc.branch, token : undefined /*token*/, url : doc.codedb_url });
                } else {
                  if (!config.get('agent.allow-foreign-code')) {
                    throw new Error('running foreign code is not allowed');
                  }

                  return {
                    content : doc.content
                  };
                }
              })
              .then((result) => {
                this.task.content = result.content;
                this.task.manual = man.get(result.content);

                return this.pool.run(this);
              });
  }
}

module.exports = Worker;