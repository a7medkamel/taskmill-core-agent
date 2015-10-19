var Promise       = require('bluebird')
  , _             = require('lodash')
  , http          = require('http')
  , url           = require('url')
  , config        = require('config')
  , util          = require('util')
  , io            = require('socket.io-client')
  , error         = require('taskmill-core-worker').error
  , STATUS_CODES  = require('http').STATUS_CODES
  , EventEmitter  = require('events').EventEmitter
  ;

var restart_after = config.get("worker.restart_after") || Infinity;

function Worker(options) {
  EventEmitter.call(this);

  this.options      = options;

  this.agent        = this.options.agent;
  this.id           = this.options.id;
  this.port         = this.options.port;
  this.dir          = this.options.dir;

  this.protocol     = this.options.protocol || 'http';
  this.hostname     = this.options.host     || 'localhost';
}

util.inherits(Worker, EventEmitter);

Worker.prototype.info = function() {
  var info = _.pick(this, 'id', 'port', 'dir', 'protocol', 'hostname', 'reqs_active', 'reqs_total', 'reqs_draining');

  if (this.connectedAt) {
    var diff = process.hrtime(this.connectedAt);

    info.uptime = diff[0] + diff[1] / 1e9;
  }

  return info;
};

Worker.prototype.at = function(port) {
  this.port = port;

  // todo [akamel] do we still need this
  this.url = url.format({
      protocol  : this.protocol
    , hostname  : this.hostname
    , port      : this.port
  });

  this.socket = io(this.url);

  this.socket
    .on('connect', this.on_connect.bind(this))
    .on('disconnect', this.on_disconnect.bind(this))
    .on('stdout', this.on_stdout.bind(this))
    .on('stderr', this.on_stderr.bind(this))
    ;
};

Worker.prototype.reqs = {};
Worker.prototype.reqs_active = 0;
Worker.prototype.reqs_total = 0;
Worker.prototype.reqs_draining = false;

Worker.prototype.add_req = function(msg){
  this.reqs[msg.id] = msg;

  this.reqs_active++;
  this.reqs_total++;

  if (this.reqs_total >= restart_after) {
    this.reqs_draining = true;
    this.emit('draining');
  }
};

Worker.prototype.remove_req = function(id){
  // console.log('removing req', id);
  if (_.has(this.reqs, id)) {
    delete this.reqs[id];
    this.reqs_active--;

    if (this.reqs_draining && this.reqs_active === 0) {
      // todo [akamel] move this to call from pool worker.reset()
      this.reqs_total = 0;
      this.reqs_draining = false;

      this.emit('drained');
    }
  }
};

Worker.prototype.on_connect = function(){
  this.connectedAt = process.hrtime();

  this.emit('connected');
  console.log('worker connected at', this.url);
};

Worker.prototype.on_disconnect = function(){
  this.connectedAt = undefined;

  console.log('worker disconnected', this.id);

  this.emit('disconnected');

  this.agent.pool.restart_worker(this);

  var worker = this;
  _.each(this.reqs, function(item){
    item.next({
      '#system' : {
          type    : 'exception'
        , error   : 'worker missed heartbeats'
        , details : {
            id          : worker.id
          , port        : worker.port
          , protocol    : worker.protocol
          , hostname    : worker.hostname
        }
      }
    });
  });
  // todo [akamel] should we delete all?
};

Worker.prototype.on_stdout = function(id, arg){
  this.agent.socket.emit('worker', {
      id    : id
    , text  : arg
    , type  : 'stdout'
  });
};

Worker.prototype.on_stderr = function(id, arg){
  this.agent.socket.emit('worker', {
      id    : id
    , text  : arg
    , type  : 'stderr'
  });
};

// todo [akamel] could we pipe to wrong request stdout/err if error happens way after res is done?
Worker.prototype.handle = function(data, next) {
  var id      = data.task.id
    , startAt = process.hrtime()
    , agent   = this.agent
    ;

  Promise
    .promisify(this.socket.emit, this.socket)('request', data.task)
    .bind(this)
    .then(function(){
      var worker = this;

      return new Promise(function(resolve, reject){
        var req  = agent.createReqStream({ id : id })
          , res  = undefined
          ;

        worker.add_req({
            id    : id
          , req   : req
          , res   : res
          , next  : next
        });

        var options = {
            hostname  : worker.hostname
          , port      : worker.port
          , protocol  : worker.protocol + ':'
          , method    : req.method
          , headers   : req.headers || {}
          , path      : '/execute'
        };

        req
          .on('error', reject)
          .pipe(http.request(options))
          .on('response', function(w$res) {
            var diff  = process.hrtime(startAt)
              , ms    = (diff[0] * 1e9 + diff[1]) / 1e6
              ;

            var headers = _.extend({
              'x-response-time' : ms
            }, w$res.headers);

            var res = agent.createResStream({
                id          : id
              , headers     : headers
              , statusCode  : w$res.statusCode
            });

            w$res
              .on('error', reject)
              .pipe(res)
              .on('finish', resolve)
              .on('error', reject)
              ;
          })
          .on('error', reject);
      });
    })
    .catch(function(err){
      next(err);
    })
    .finally(function() {
      this.remove_req(id);
    });
};

module.exports = Worker;