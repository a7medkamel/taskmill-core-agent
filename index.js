var Promise     = require('bluebird')
  , config      = require('config')
  , Agent       = require('./lib/Agent')
  , DockerPool  = require('./lib/pool/DockerPool')
  ;

process.on('uncaughtException', function (err) {
  console.error(new Date().toUTCString(), 'uncaughtException', err.message);
  console.error(err.stack);
});

function main() {
  return Promise
          .try(() => {
            return new Agent(new DockerPool());
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