"use strict";

var Promise         = require('bluebird')
  , _               = require('lodash')
  , ps              = require('ps-node')
  , config          = require('config-url')
  , spawn           = require('child_process').spawn
  , Pool            = require('../core/pool')
  ;

class ProcessPool extends Pool {
  constructor(options) {
    super();
  }

  initialize() {
    return Promise.all([
                      this.kill_workers()
                  ]);
  }
  
  run(worker) {
    return Promise.fromCallback((cb) => {
      var log = config.get('worker.log-stdout');

      return worker
              .getConfig()
              .then((cfg) => {
                cfg['port'] = 0;
                cfg['code-module'] = config.has('worker.code-module')? config.get('worker.code-module') : 'taskmill-code-dummy';
                // cfg['tunnel']['hostname'] = config.getUrlObject('tunnel').hostname;

                var proc = spawn('node', [ 'index.js', '--NODE_CONFIG=' + JSON.stringify(cfg)], { cwd : config.get('worker.src') });

                proc.stdout.on('data', (chunk) => {
                  worker.stdout(chunk);
                  log && process.stdout.write(chunk);
                });

                proc.stderr.on('data', (chunk) => {
                  worker.stdout(chunk);
                  log && process.stderr.write(chunk);
                });

                proc.on('close', (code) => {
                  // todo [akamel] do we really need this?
                  worker.emit('die');
                  cb(code);
                });

                worker.resolve(proc);
              });
    });
  }

  kill_worker(worker, cb) {
    return worker
            .runInfoAsync()
            .then((proc) => {
              if (proc) {
                return Promise.promisify(ps.kill)(proc.pid)
              }
            })
            // todo [akamel] should we call remove here or let the event kill it?
            .nodeify(cb);
  }

  kill_workers(cb) {
    // todo [akamel] arguments doesn't really work here
    Promise
      .promisify(ps.lookup)({
        command: 'node'
        // arguments: 'index.js'
      })
      .then((result) => {
        // todo [akamel] ps-node is broken; doesn't list all node process
        console.log(result);
      })
      // .each(function(procs){
      //   console.log('procs', procs);
      //   // return Promise.promisify(ps.kill)(proc.pid);
      // })
      .nodeify(cb)
      ;
  }
};

module.exports = ProcessPool;