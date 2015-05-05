var Promise  = require('bluebird')
  , Cluster  = require('./lib/cluster')
  ;

process.on('uncaughtException', function (err) {
  console.error('uncaughtException', err.stack || err.toString());
});

function main(options) {

  var cluster = new Cluster({
      port        : 8080
    , capacity    : 1
    , docker      : {
        host      : '192.168.1.10'
      , protocol  : 'http'
      , port      : 4243
    }
  });

  Promise
    .promisify(cluster.initialize, cluster)()
    .then(function(){
      cluster.listen();
    })
    .catch(function(err){
      console.error('error starting sandbox-manager', err.stack || err);
    })
    ;
}

if (require.main === module) {
  main({ });
}

module.exports = {
  main : main
};