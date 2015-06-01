var argv      = require('minimist')(process.argv.slice(2))
  , Promise   = require('bluebird')
  , config    = require('config')
  , Agent     = require('./lib/core/agent')
  ;

Promise.longStackTraces();

process.on('uncaughtException', function (err) {
  console.error(err.stack || err.toString());
});

function main() {

  var pool = undefined;

  switch(argv.type) {
    case 'docker':
    pool = new (require('./lib/docker/pool'))();
    break;
    case 'proc':
    default:
    pool = new (require('./lib/process/pool'))();
    break;
  }

  if (!pool) {
    throw new Error('"type" param not defined or recognized');
  }

  var agent = new Agent(pool);

  Promise
    .promisify(agent.initialize, agent)()
    .then(function(){
      agent.listen();
    })
    .catch(function(err){
      console.error('error starting agent', err.stack || err);
    })
    ;
}

if (require.main === module) {
  main();
}

module.exports = {
    main  : main
};