"use strict";

var _                     = require('lodash')
  , Promise               = require('bluebird')
  , winston               = require('winston')
  , config                = require('config')
  , make_sdk              = require('taskmill-core-make-sdk')
  , { Producer }          = require('taskmill-core-tailf')
  ;

const MAX_TTL             = 10 * 60 * 1000
  ,   MAX_TTL_SINGLE_USE  =  1 * 60 * 1000
  ;

function track(container, data = {}) {
  let { tailf, single_use } = data
    , ttl                   = single_use? MAX_TTL_SINGLE_USE : MAX_TTL
    ;

  let kill = () => { return container.sigkill(); };

  // todo [akamel] print out something better than container.remote
  let monitor = (stats) => {
    let max_usage = config.get('worker.max-memory') * 1024 * 1024;
    if (stats.memory_stats.usage > max_usage) {
      winston.info('kill - memory limit', container.remote);
      return kill();
    }

    let max_idle = config.get('worker.max-idle') * 1000;
    if (stats.idle > max_idle) {
      winston.info('kill - idle limit', container.remote);
      return kill();
    }

    let uptime = new Date().getTime() - data.stats.boottime;
    if (uptime > ttl) {
      winston.info('kill - ttl', container.remote);
      return kill();
    }

    make_sdk
      .set(data, { ttl : 5 })
      .catch((err) => {
        winston.error('lock:extend', err, data);
      });
  };

  let stdio = undefined;

  if (tailf) {
    Promise
      .try(() => {
        return (new Producer(tailf)).stream(data);
      })
      .then((stream) => {
        // using closure
        stdio = stream;

        container.on('stdout', (chunk) => stream.write({ chunk, meta : { type : 'stdout' }}));
        container.on('stderr', (chunk) => stream.write({ chunk, meta : { type : 'stderr' }}));
      })
      .catch((err) => {
        winston.error(tailf, err);
      })
  }

  // container.on('stdout', (chunk) => console.log(chunk.toString('utf-8')));
  // container.on('stderr', (chunk) => console.error(chunk.toString('utf-8')));

  container.on('stats', monitor);

  container.once('die', () => {
    if (stdio) {
      stdio.end();
    }

    make_sdk
      .del(data.hash)
      .catch((err) => {
        winston.error('unset:die', err, data);
      });
  });

  return make_sdk.set(data, { ttl : 5 });
}

module.exports = {
  monitor : track
};
