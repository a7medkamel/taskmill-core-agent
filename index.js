var Promise     = require('bluebird')
  , config      = require('config')
  , Agent       = require('./lib/agent')
  ;

require('http').globalAgent.keepAlive = true;

Promise.config({
  longStackTraces: true
})

process.on('uncaughtException', function (err) {
  console.error(new Date().toUTCString(), 'uncaughtException', err.message);
  console.error(err.stack);
});

function main() {
  let agent = new Agent();

  return Promise
          .all([ agent.clean(), agent.pull() ])
          .then(() => {
            return agent.connect();
          });
}

if (require.main === module) {
  main();
}

module.exports = {
    main  : main
};
