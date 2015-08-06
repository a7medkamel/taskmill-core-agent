var Promise       = require('bluebird')
  , _             = require('lodash')
  , http          = require('http')
  , url           = require('url')
  , io            = require('socket.io-client')
  , STATUS_CODES  = require('http').STATUS_CODES
  ;

function Worker(options) {
  this.options = options;

  this.agent      = this.options.agent;
  this.id         = this.options.id;
  this.port       = this.options.port;
  this.dir        = this.options.dir;

  this.protocol   = this.options.protocol || 'http';
  this.hostname   = this.options.host     || 'localhost';

  // todo [akamel] do we still need this
  this.url = url.format({
      protocol  : this.protocol
    , hostname  : this.hostname
    , port      : this.port
  });
}

Worker.prototype.connect = function(cb){
  var cb = _.once(cb);

  this.socket = io(this.url);

  this.socket.once('connect', cb);

  this.socket.on('connect', this.on_connect.bind(this));

  this.socket.on('disconnect', this.on_disconnect.bind(this));

  this.socket.on('stdout', this.on_stdout.bind(this));

  this.socket.on('stderr', this.on_stderr.bind(this));
};

Worker.prototype.on_connect = function(){
  console.log('worker connected at', this.url);
};

Worker.prototype.on_disconnect = function(){
  console.log('worker disconnected', this.id);
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
Worker.prototype.handle = function(req, res, next) {
  var id      = req.task.id
    , startAt = process.hrtime()
    , agent   = this.agent
    ;

  this.socket.emit('execution', req.task);

  // var query = url.parse(req.headers['x-tm-url']).search;

  var proxy_req = http.request({
      hostname  : this.hostname
    , port      : this.port
    , protocol  : this.protocol + ':'
    , method    : req.method
    , headers   : req.headers || {}
    , path      : '/execute'
  });

  req
    .pipe(proxy_req)
    .on('response', function(proxy_res) {
      var diff  = process.hrtime(startAt)
        , ms    = (diff[0] * 1e9 + diff[1]) / 1e6
        ;

      // console.log(ms, 'ms');
      var headers = _.extend({
        'x-response-time' : ms
      }, proxy_res.headers);

      var res = agent.createResStream({
          id          : id
        , headers     : headers
        , statusCode  : proxy_res.statusCode
      });
      proxy_res.pipe(res);
    })
    .on('error', function(err) {
      var body = {
          '#system' : {
              type    : 'exception'
            , error   : 'response pipe error'
            , details : err
          }
        };

      next(body);
    });
};

module.exports = Worker;