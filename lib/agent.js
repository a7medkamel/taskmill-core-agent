var Promise         = require('bluebird')
  , _               = require('lodash')
  , os              = require('os')
  , upnode          = require('upnode')
  , dnode_stream    = require('dnode-http-stream')
  , dev_null        = require('dev-null')
  ;

Promise.longStackTraces();

function Agent(options) {
  this.options = options;
}

Agent.prototype.initialize = function(cb) {
  cb(new Error('Not Implemented'));
};

Agent.prototype.kill_worker = function() {
  throw new Error('Not Implemented');
}

Agent.prototype.create_worker = function() {
  throw new Error('Not Implemented');
}

Agent.prototype.get_worker = function(req) {
  throw new Error('Not Implemented');
}

Agent.prototype.handle = function(req, res, next) {
  var worker = get_worker(req);

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
    next && next(new Error('no workers available'));
  }
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

module.exports = Agent;