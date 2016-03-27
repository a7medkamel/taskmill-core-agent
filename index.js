var Promise   = require('bluebird')
  , config    = require('config')
  , dns       = require('dns')
  , Agent     = require('./lib/core/agent')
  ;

process.on('uncaughtException', function (err) {
  console.error(new Date().toUTCString(), 'uncaughtException', err.message);
  console.error(err.stack);
});

function main() {

  function PoolFactory() {
    switch(config.get('worker.type')) {
      case 'docker':
      return new (require('./lib/docker/pool'))();
      case 'proc':
      default:
      return new (require('./lib/process/pool'))();
    }
  }

  return Promise
          .try(() => {
            return new Agent(PoolFactory);
          })
          .tap((agent) => {
            return agent.initialize();
          })
          .then((agent) => {
            agent.listen();
          });
}

if (require.main === module) {
  main();
}

module.exports = {
    main  : main
};