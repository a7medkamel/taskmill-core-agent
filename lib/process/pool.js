"use strict";

var Promise         = require('bluebird')
  , _               = require('lodash')
  , ps              = require('ps-node')
  , config          = require('config')
  , spawn           = require('child_process').spawn
  , Pool            = require('../core/pool')
  ;

class ProcessPool extends Pool {
  constructor(agent, task) {
    super();
  }

  run(worker, cb) {
    var log = config.get('worker.log-stdout')
      , cfg = _.defaults({ "port" : 0 }, worker.config)
      ;

    cfg['tunnel']['hostname'] = config.get('tunnel.hostname');
    // todo [akamel] read from worker.code-module
    cfg['code-module'] = config.get('worker.code-module');

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
      cb(code);
    });

    worker.resolve(proc);
  }

  kill_worker(worker, cb) {
    worker
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