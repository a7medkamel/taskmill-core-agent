var Promise         = require('bluebird')
  , _               = require('lodash')
  , os              = require('os')
  , url             = require('url')
  // , upnode          = require('upnode')
  , uuid            = require('node-uuid')
  , config          = require('config')
  , ss              = require('socket.io-stream')
  , channel         = require('./channel')
  // , dnode_stream    = require('dnode-http-stream')
  // , dev_null        = require('dev-null')
  ;
function Agent(pool) {
  this.pool = pool;

  this.group = config.get('group.id');
  this.id = uuid.v4();

  if (!this.group) {
    throw new Error('group id is required for the agent to connect to the dispatcher. make sure that your group id is unique.');
  }
}

Agent.prototype.initialize = function(cb) {
  var time = process.hrtime();

  Promise
    .promisify(this.pool.kill_workers, this.pool)()
    .bind(this)
    .then(function(){
      var pool = this.pool
        , acts = []
        ;

      _.times(config.get('worker.count'), function(){
        acts.push(Promise.promisify(pool.create_worker, pool)());
      });

      return Promise
              .all(acts)
              .then(function(workers){
                // start workers
                var dos = _.map(workers, function(worker){
                  return Promise
                          .promisify(pool.prepare, pool)(worker)
                          .then(function(){
                            return Promise.promisify(pool.start, pool)(worker);
                          })
                          .then(function(){
                            return Promise.promisify(worker.connect, worker)();
                          })
                          ;
                });

                return Promise.all(dos);
              })
              ;
    })
    .then(function(){
      var diff = process.hrtime(time);

      console.log('all workers ready: ', diff[0] + diff[1] / 1e9);
    })
    .nodeify(cb)
    ;
};

Agent.prototype.handle = function(req, res, next) {
  var worker = this.pool.get_worker(req);

  if (worker) {
    // this.up(function(remote){
    //   var dnode_req         = dnode_stream.readable(req.uuid)
    //     , dnode_res         = dnode_stream.writable(remote, res.uuid)
    //     ;

    //   if (res.stdout.uuid) {
    //     dnode_res.stdout  = dnode_stream.writable(remote, res.stdout.uuid);
    //   }

    //   if (res.stderr.uuid) {
    //     dnode_res.stderr  = dnode_stream.writable(remote, res.stderr.uuid);
    //   }

    //   _.extend(dnode_req, _.pick(req, 'task', 'query', 'method', 'headers', 'url', 'protocol'));

    //   dnode_res
    //     .on('end', function(){
    //       dnode_res.stdout.end();
    //       dnode_res.stderr.end();
    //     })
    //     // the on'end' handler needs to be before the pipe to dev_null
    //     .pipe(dev_null())
    //     ;

    //   worker.handle(dnode_req, dnode_res, next);
    // });
    worker.handle(req, res, next);
  } else {
    next && next(new Error('no workers available'));
  }
};

Agent.prototype.listen = function() {
  var me = this;

  console.log('connecting to:', config.get('relay.host'));

  this.socket = require('socket.io-client')(url.format({
      protocol  : config.get('relay.protocol')
    , hostname  : config.get('relay.host')
    , port      : config.get('relay.port')
  }));

  this.socket.on('connect', function(){
    me.start_heartbeat();
    console.log('connected');
  });

  this.socket.on('disconnect', function(){
    me.end_heartbeat();
    console.log('disconnected');
  });

  channel.listen.call(this);

  // this.up = upnode(function(remote, conn){
  //             // this.heartbeat = me.heartbeat.bind(me);
  //             this.handle = me.handle.bind(me);
  //             this.write = dnode_stream.readable.write;

  //             conn
  //               .on('error', function(err){
  //                 console.log('upnode err', err.stack);
  //               })
  //               .on('end', function(){
  //                 me.end_heartbeat();
  //                 console.log('disconnected');
  //               })
  //               .on('fail', function(){
  //                 console.log('upnode fail', arguments);
  //               })
  //               .on('remote', function(){
  //                 me.start_heartbeat();
  //                 console.log('connected');
  //               });
  //           })
  //           .connect({ host : config.get('dispatcher.host'), port : config.get('dispatcher.port') });
};

Agent.prototype.start_heartbeat = function() {
  this.end_heartbeat();

  var me = this;

  function ping(socket) {
    socket.emit('ping', {
        name          : os.hostname()
      , id            : me.id
      , group         : me.group
      , worker_count  : me.pool.size()
      , uptime        : process.uptime()
    });
  }

  // this.up(function(remote){
    this.heartbeat_timer_token = setInterval(ping, 10 * 1000, this.socket);
    ping(this.socket);
  // });
};

Agent.prototype.end_heartbeat = function() {
  if (this.heartbeat_timer_token) {
    clearInterval(this.heartbeat_timer_token);
  }
};

module.exports = Agent;