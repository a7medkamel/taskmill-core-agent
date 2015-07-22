var Promise       = require('bluebird')
  , _             = require('lodash')
  , http          = require('http')
  // , querystring   = require('querystring')
  // , request       = require('request')
  // , spy           = require('through2-spy')
  // , dev_null      = require('dev-null')
  // , proxy         = require('http-proxy').createProxyServer()
  , url           = require('url')
  , io            = require('socket.io-client')
  , STATUS_CODES  = require('http').STATUS_CODES
  ;

// request.defaults({
//   pool : { maxSockets: Infinity }
// });

// todo [akamel] should not add spy in first place
// function log_spy() {
//   return spy(function(chunk, enc){
//     if (can_log_spy) {
//       console.log('spy: ', (new Buffer(chunk, enc)).toString());
//     }
//   });
// }

function Worker(options) {
  this.options = options;

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

Worker.prototype.reqs = {};

Worker.prototype.on_stdout = function(id, arg){
  var i = this.reqs[id];

  if (i && !_.isUndefined(arg)) {
    i.res.stdout.write(arg);
  }
};

Worker.prototype.on_stderr = function(id, arg){
  var i = this.reqs[id];

  if (i && !_.isUndefined(arg)) {
    i.res.stderr.write(arg);
  }
};

// todo [akamel] could we pipe to wrong request stdout/err if error happens way after res is done?
Worker.prototype.handle = function(req, res, next) {
  var id      = req.task.id
    , startAt = process.hrtime()
    ;

  this.socket.emit('execution', req.task);
  this.reqs[id] = { req : req, res : res, next : next };

  req.headers = req.headers || {};

  // todo [akamel] put these 2 back
  req.headers['$originalurl'] = req.url;
  req.headers['$execution-id'] = req.task.id;

  // req.headers['$req-hostname'] = req.hostname;
  // req.headers['$req-port'] = req.hostname;

  // res.on('end', function(){
  //   delete this.reqs[id];
  // }.bind(this));

  // proxy.web(req, out_res, {
  //     target        : this.url + '/execute'
  //   , changeOrigin  : true
  // });


  var proxy_req = http.request({
      hostname  : this.hostname
    , port      : this.port
    , protocol  : this.protocol + ':'
    , method    : req.method
    , headers   : req.headers
    , path      : '/execute' + (req.query? querystring.stringify(req.query) : '')
  });

  req
    .pipe(proxy_req)
    .on('response', function(proxy_res) {
      var res = http.request({
          hostname  : 'localhost'
        , port      : 8989
        , protocol  : 'http' + ':'
        , method    : 'post'
        , headers   : proxy_res.headers
        , path      : '/res/' + id
      });
      // res.headers = proxy_res.headers;
      proxy_res.pipe(res);

      setTimeout(function(){
        res.end();
      }, 2000);
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
    // .pipe(res);

  // req
  //   // .pipe(log_spy())
  //   .pipe(request({ url : this.url + '/execute', q: req.query, method: req.method, headers: req.headers }))
  //   // .on('response', function(response) {
      // var diff = process.hrtime(startAt)
      //   , time = diff[0] * 1e3 + diff[1] * 1e-6
      //   , val  = time.toFixed(3) + 'ms'
      //   ;

      // response.headers['x-response-time-agent_to_worker'] = val;

      // // res.writeHead(response.statusCode, response.headers);
      // function writeHead(statusCode, reason, headers) {
      //   if (arguments.length == 2 && typeof arguments[1] !== 'string') {
      //     headers = reason;
      //     reason = undefined;
      //   }

      //   var status = 'HTTP/ ' + statusCode + ' ' + (reason || STATUS_CODES[statusCode] || 'unknown') + '\r\n';

      //   this.write(status);

      //   if (headers) {
      //     for (var name in headers) {
      //       this.write(name + ': ' + headers[name] + '\r\n');
      //     }
      //   }

      //   this.write('\r\n');
      // };

      // writeHead.call(res, response.statusCode, response.headers);
    // })
    // .on('error', function(err){
    //   var body = {
    //       '#system' : {
    //           type    : 'exception'
    //         , error   : 'response pipe error'
    //         , details : err
    //       }
    //     };

    //   next(body);
    // })
    // .pipe(res)
    // ;
};

module.exports = Worker;