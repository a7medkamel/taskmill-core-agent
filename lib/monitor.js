"use strict";

var _                     = require('lodash')
  , Promise               = require('bluebird')
  , winston               = require('winston')
  , config                = require('config')
  , make_sdk              = require('taskmill-core-make-sdk')
  , { Producer }          = require('tailf.io-sdk')
  ;

const MAX_TTL             = 10 * 60 * 1000
  ,   MAX_TTL_SINGLE_USE  =  1 * 30 * 1000
  ;

function track(container, data = {}) {
  let { tailf, single_use } = data
    , ttl                   = single_use? MAX_TTL_SINGLE_USE : MAX_TTL
    , { boottime }          = data.stats
    ;

  let kill = (options = {}) => {
    let { reason } = options;

    winston.info(`kill - ${reason}`, container.remote);

    return container.sigkill();
  };

  // todo [akamel] print out something better than container.remote
  let monitor = (stats) => {
    let max_usage = config.get('worker.max-memory') * 1024 * 1024;
    if (stats.memory_stats.usage > max_usage) {
      return kill({ reason : 'memory limit' });
    }

    let max_idle = config.get('worker.max-idle') * 1000;
    if (stats.idle > max_idle) {
      return kill({ reason : 'idle limit' });
    }

    let uptime = new Date().getTime() - boottime;
    if (uptime > ttl) {
      return kill({ reason : 'ttl' });
    }

    make_sdk
      .set(data, { ttl : 5 })
      .catch((err) => {
        winston.error('lock:extend', err, data);
      });
  };

  if (tailf) {
    Promise
      .try(() => {
        let { stdout, stderr } = (new Producer({ uri : tailf, meta : data })).streams();

        container.once('die', () => {
          winston.info('stdio - end');
          stdout.end();
          stderr.end();
        });

        container.stdout.pipe(stdout);
        container.stderr.pipe(stderr);
      })
      .catch((err) => {
        winston.error(err, tailf);
      })
  }

  container.on('stats', monitor);

  container.once('die', () => {
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
