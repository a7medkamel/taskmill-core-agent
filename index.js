var Promise   = require('bluebird')
  , config    = require('config')
  , dns       = require('dns')
  , Agent     = require('./lib/core/agent')
  ;

Promise.longStackTraces();

process.on('uncaughtException', function (err) {
  console.error(err.stack || err.toString());
});

function main() {

  function PoolFactory(agent) {
    switch(config.get('worker.type')) {
      case 'docker':
      return new (require('./lib/docker/pool'))(agent);
      case 'proc':
      default:
      return new (require('./lib/process/pool'))(agent);
    }
  }

  Promise
    .try(() => {
      // if (config.has('relay.force_dns_lookup') && config.get('relay.force_dns_lookup')) {
        return Promise
                .promisify(dns.lookup)(config.get('relay.host'))
                .then((ip) => {
                  config.relay.hosts_entry = ip;
                })
      // } else {
      //   config.relay.hosts_entry = config.get('relay.host');
      // }
    })
    .then(() => {
      var agent = new Agent(PoolFactory);
      
      return Promise
              .promisify(agent.initialize, { context : agent })()
              .then(() => {
                agent.listen();
              });
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