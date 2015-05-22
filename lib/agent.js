var Promise         = require('bluebird')
  , async           = require('async')
  , _               = require('lodash')
  , fs              = require('fs')
  , url             = require('url')
  , request         = require('request')
  , os              = require('os')
  , upnode          = require('upnode')
  , dnode_stream    = require('dnode-http-stream')
  , http            = require('http')
  , dev_null        = require('dev-null')
  , DockerWorker    = require('./docker-worker')
  , DockerManager   = require('./docker-manager')
  ;

// need to increase from default of 4 to be able to init more than 4 containers via rest api
// todo [akamel] we might not need this in node 0.12
http.globalAgent.maxSockets = Infinity;

request.defaults({
  pool : { maxSockets: Infinity }
});

Promise.longStackTraces();

function Agent(options) {
  this.options = options;

  this.docker = new DockerManager({
      protocol  : this.options.docker.protocol
    , host      : this.options.docker.host
    , port      : this.options.docker.port
  });
}

Agent.prototype._next_id = 0;
Agent.prototype._containers = {};

Agent.prototype.initialize = function(cb) {
  var me = this;

  var time = process.hrtime();

  this.docker
    .removeAllAsync()
    .then(function(){
      var fcts = _.times(this.options.docker.capacity, function(n){
        return function(cb) { me.add(cb); };
      });

      return Promise.promisify(async.parallelLimit)(fcts, 10);
    }.bind(this))
    .then(function(){
      var diff = process.hrtime(time);

      console.log('all containers ready: ', diff[0] + diff[1] / 1e9);
    })
    .nodeify(cb)
    ;
};

Agent.prototype.add = function(cb) {
  var id    = this._next_id ++
    , worker = new DockerWorker(this.docker, {
          base_port   : 49153
        , worker_dir   : this.options.worker.path
        , id          : id
        , protocol    : this.options.docker.protocol
        , host        : this.options.docker.host
        , port        : this.options.docker.port
      })
    ;

  this._containers[id] = worker;

  worker.initialize(cb);
};

Agent.prototype.listen = function() {
  var me = this;

  console.log('connecting to:', this.options.dispatcher.host, this.options.dispatcher.port);
  this.up = upnode(function(remote, conn){
              // this.heartbeat = me.heartbeat.bind(me);
              this.handle = me.handle.bind(me);
              this.write = dnode_stream.readable.write;

              conn.on('error', function(err){
                console.log('upnode err', err.stack);
              })
              .on('end', function(){
                console.log('upnode end', arguments);
              })
              .on('fail', function(){
                console.log('upnode fail', arguments);
              })
              .on('close', function(){
                console.log('upnode close', arguments);
              });
            })
            .connect({ host : this.options.dispatcher.host, port : this.options.dispatcher.port });

  this.ensure_heartbeat();
};

Agent.prototype.ensure_heartbeat = function() {
  var me = this;

  this.up(function(remote){
    if (this.heartbeat_timer_token) {
      clearInterval(me.heartbeat_timer_token);
    }

    me.heartbeat_timer_token = setInterval(function(){
      remote.heartbeat({
          name          : os.hostname()
        , group_id      : me.options.group.id
        , worker_count  : _.size(me._containers)
        , uptime        : process.uptime()
      });
    }, 1000);
  });
};

Agent.prototype.handle = function(req, res, next) {
  var worker = _.sample(this._containers);

  if (worker) {
    this.up(function(remote){
      var dnode_req         = dnode_stream.readable(req.uuid)
        , dnode_res         = dnode_stream.writable(remote, res.uuid)
        ;

      if (res.stdout.uuid) {
        dnode_res.stdout  = dnode_stream.writable(remote, res.stdout.uuid);
      }

      if (res.stderr.uuid) {
        dnode_res.stderr  = dnode_stream.writable(remote, res.stderr.uuid);
      }

      _.extend(dnode_req, _.pick(req, 'query', 'method', 'headers', 'url', 'protocol'));

      dnode_req.task = req.task;

      dnode_res
        .on('end', function(){
          dnode_res.stdout.end();
          dnode_res.stderr.end();
        })
        // the on'end' handler needs to be before the pipe to dev_null
        .pipe(dev_null())
        ;

      worker.handle(dnode_req, dnode_res, next);
    });
  } else {
    next && next(new Error('no container available for execution'));
  }
};

module.exports = Agent;