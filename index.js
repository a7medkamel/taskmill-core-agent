var argv      = require('minimist')(process.argv.slice(2))
  , Promise   = require('bluebird')
  , Agent     = require('./lib/agent')
  ;

process.on('uncaughtException', function (err) {
  console.error('uncaughtException', err.stack || err.toString());
});

function main(options) {

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
  main({
      port        : 8124
    , host        : argv.host || 'taskmill.io'
    , capacity    : argv.capacity || 4
    , worker_dir  : argv.worker_dir
    , cluster     : {
        id        : argv.cluster_id
    }
    , docker      : {
        host      : argv.docker_host || 'localhost'
      , protocol  : 'http'
      , port      : 4243
    }
  });
}

module.exports = {
  main : main
};