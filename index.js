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
      var t_ip = config.tunnel.dns_lookup
                    ? Promise.promisify(dns.lookup)(config.tunnel.hostname)
                    : config.tunnel.hostname;

      var s_ip = config.services.dns_lookup
                    ? Promise.promisify(dns.lookup)(config.services.hostname)
                    : config.services.hostname;

      return Promise
              .all([ t_ip, s_ip ])
              .spread((t_ip, s_ip) => {
                config.tunnel.hostname = t_ip;
                config.services.hostname = s_ip;
              });
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