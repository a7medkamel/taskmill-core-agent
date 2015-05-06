var Promise         = require('bluebird')
  , async           = require('async')
  , _               = require('underscore')
  , fs              = require('fs')
  , url             = require('url')
  , request         = require('request')
  , os              = require('os')
  , upnode          = require('upnode')
  , dnode_stream    = require('dnode-http-stream')
  , http            = require('http')
  , dev_null        = require('dev-null')
  , DockerAgent     = require('./docker-agent')
  , DockerManager   = require('./docker-manager')
  ;

// need to increase from default of 4 to be able to init more than 4 containers via rest api
http.globalAgent.maxSockets = Infinity;

request.defaults({
  pool : { maxSockets: Infinity }
});

Promise.longStackTraces();

function Cluster(options) {
  this.options = options;

  this.docker = new DockerManager({
      protocol  : this.options.docker.protocol
    , host      : this.options.docker.host
    , port      : this.options.docker.port
  });
}

Cluster.prototype._next_id = 0;
Cluster.prototype._containers = {};

Cluster.prototype.initialize = function(cb) {
  var me = this;

  var time = process.hrtime();

  this.docker
    .removeAllAsync()
    .then(function(){
      var fcts = _.times(this.options.capacity, function(n){
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

Cluster.prototype.add = function(cb) {
  var id    = this._next_id ++
    , agent = new DockerAgent(this.docker, {
          base_port : 49153
        , id        : id
        , protocol  : this.options.protocol
        , host      : this.options.host
        , port      : this.options.port
      })
    ;

  this._containers[id] = agent;

  agent.initialize(cb);
};

Cluster.prototype.listen = function() {
  var cluster = this;

  this.up = upnode(function(remote, conn){
              this.heartbeat = cluster.heartbeat.bind(cluster);
              this.handle = cluster.handle.bind(cluster);
              this.write = dnode_stream.readable.write;

              setInterval(function(){ cluster.heartbeat_cluster(); }, 1000);

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
            .connect({ host : this.options.host, port : this.options.port });
};

Cluster.prototype.heartbeat_cluster = function() {
  var me = this;
  this.up(function(remote){
    remote.heartbeat({
        name        : os.hostname()
      , containers  : _.countBy(me._containers, function(i){ return i._state; })
    });
  });
};

Cluster.prototype.heartbeat = function(cb) {
  cb(undefined, { name : 'agent', time : new Date().toString() });
};

Cluster.prototype.handle = function(req, res, next) {
  var me  = this;
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

    // dnode_req.code = req.task.content;
    // dnode_req.metadata = req.task.metadata;
    dnode_req.task = req.task;

    dnode_res
      .pipe(dev_null())
      .on('end', function(){
        // todo [akamel] verify that the container is reset
      });

    var agent = _.sample(me._containers);

    if (agent) {
      agent.handle(dnode_req, dnode_res, next);

      dnode_res.on('end', function(){
        agent.end();

        // sometimes console.log is still in progress when res is ended
        // todo [akamel] consider moving this to a better place
        setTimeout(function(){
          dnode_res.stdout.end();
          dnode_res.stderr.end();
        }, 200);
      });
    } else {
      next && next(new Error('no container available for execution'));
    }

  });
};

module.exports = Cluster;