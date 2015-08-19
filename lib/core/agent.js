var Promise         = require('bluebird')
  , _               = require('lodash')
  , os              = require('os')
  , url             = require('url')
  , uuid            = require('node-uuid')
  , config          = require('config')
  , request         = require('request')
  , http            = require('http')
  ;

// var request = request.defaults({
//   pool: {maxSockets: Infinity}
// });

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
      var agent = this
        , pool  = this.pool
        , acts  = []
        ;

      _.times(config.get('worker.count'), function(){
        acts.push(Promise.promisify(pool.create_worker, pool)(agent));
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

  this.socket.on('request', function(data){
    var id  = data.task.id
      , req = me.createReqStream({ id : id })
      ;

    _.extend(req, data);

    // req.__taskmill_agent = me;

    me.handle(req, undefined, function(err){
      if (err) {
        var res = me.createResStream({ id : id, headers : {
          'Content-Type': 'application/json'
        }});
        // todo [akamel] run throw the error serializer
        res.end(JSON.stringify(err));
      } else {
        var res = me.createResStream({ id : id });
        res.end();
      }
    });
  });
};

Agent.prototype.handle = function(req, res, next) {
  var worker = this.pool.get_worker(req);

  if (worker) {
    worker.handle(req, res, next);
  } else {
    next && next(new Error('no workers available'));
  }
};

Agent.prototype.createReqStream = function(options) {
  var u = url.format({
      hostname  : config.get('relay.host')
    , port      : config.get('relay.streams_port')
    , protocol  : 'http'
    , pathname  : '/req/' + options.id
  });

  return request.get(u);
};

Agent.prototype.createResStream = function(options) {
  var headers = _.extend({}, options.headers);

  if (options.statusCode) {
    headers['x-tm-statusCode'] = options.statusCode;
  }

  return http.request({
      hostname  : config.get('relay.host')
    , port      : config.get('relay.streams_port')
    , protocol  : 'http' + ':'
    , method    : 'post'
    , headers   : headers
    , path      : '/res/' + options.id
    , keepAlive : true
  });
};

Agent.prototype.start_heartbeat = function() {
  this.end_heartbeat();

  var me = this;

  function ping(socket) {
    socket.emit('ping', {
        name          : os.hostname()
      , id            : me.id
      , group         : me.group
      // , worker_count  : me.pool.size()
      , uptime        : process.uptime()
      , workers       : _.map(me.pool, function(i){ return _.pick(i, 'id', 'port', 'dir', 'isConnected', 'protocol', 'hostname'); })
    });
  }

  this.heartbeat_timer_token = setInterval(ping, 10 * 1000, this.socket);
  ping(this.socket);
};

Agent.prototype.end_heartbeat = function() {
  if (this.heartbeat_timer_token) {
    clearInterval(this.heartbeat_timer_token);
  }
};

module.exports = Agent;