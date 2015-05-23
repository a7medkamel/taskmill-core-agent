var argv      = require('minimist')(process.argv.slice(2))
  , Promise   = require('bluebird')
  , Agent     = require('./lib/agent')
  , config    = require('./config')
  ;

process.on('uncaughtException', function (err) {
  console.error('uncaughtException', err.stack || err.toString());
});

function main(Agent, options) {

  var agent = new Agent(options);

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
  main(Agent, config);
}

module.exports = {
    main  : main
  , Agent : Agent
};