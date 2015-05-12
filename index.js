var argv     = require('minimist')(process.argv.slice(2))
  , Promise  = require('bluebird')
  , Cluster  = require('./lib/cluster')
  ;

process.on('uncaughtException', function (err) {
  console.error('uncaughtException', err.stack || err.toString());
});

function main(options) {

  var cluster = new Cluster(options);

  Promise
    .promisify(cluster.initialize, cluster)()
    .then(function(){
      cluster.listen();
    })
    .catch(function(err){
      console.error('error starting cluster', err.stack || err);
    })
    ;
}

if (require.main === module) {
  main({
      port        : 8124
    , host        : argv.host || 'taskmill.io'
    , capacity    : argv.capacity || 4
    , agent_dir   : argv.agent_dir
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