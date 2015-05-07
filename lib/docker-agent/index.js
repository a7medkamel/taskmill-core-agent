var Promise     = require('bluebird')
  , _           = require('underscore')
  , request     = require('request')
  , spy         = require('through2-spy')
  , dev_null    = require('dev-null')
  , url         = require('url')
  , path        = require('path')
  , io          = require('socket.io-client')
  ;


// todo [akamel] should not add spy in first place
// function log_spy() {
//   return spy(function(chunk, enc){
//     if (can_log_spy) {
//       console.log('spy: ', (new Buffer(chunk, enc)).toString());
//     }
//   });
// }

function DockerAgent(docker, options) {
  this.docker = docker;
  this.options = _.extend({}, options, _.pick(docker.options, 'protocol', 'host', 'port'));
}

DockerAgent.prototype.initialize = function(cb) {
  // HostPort = '49153'
  this.base_port  = this.options.base_port;
  this.id         = this.options.id;
  this.port       = this.base_port + this.id;

  this.url = url.format({
      protocol  : this.options.protocol
    , hostname  : this.options.host
    , port      : this.port
  });

  this
    .createAsync()
    .then(function(res){
      this.container = res;
    }.bind(this))
    .then(function(){
      return this.startAsync();
    }.bind(this))
    .nodeify(cb);
};

DockerAgent.prototype.create = function(cb) {
  this.docker
    .createContainerAsync({
        Image     : 'sdk'
      , Cmd       : ['node', '/home/sdk/index.js']
      , CpuShares : 128
      , Memory    : 16*1024*1024
      , ExposedPorts :{
         '80/tcp': {}
      }
    })
    .then(function(res){
      return this.docker.getContainer(res.id);
    }.bind(this))
    .then(function(res){
      res.attach({stream: true, stdout: true, stderr: true, tty : false}, function (err, stream) {
        res.modem.demuxStream(stream, process.stdout, process.stderr);
      }.bind(this));

      return res;
    })
    .nodeify(cb)
    ;
};

DockerAgent.prototype.start = function(cb) {
  if (!this.container) {
    cb(new Error('cannot boot container. container not initialized.'));
  }

  var agent_dir = this.options.agent_dir || '/home/nodejs/taskmill-core-dockeragent/';

  Promise
    .promisify(this.container.start, this.container)({
        'Binds':[
            agent_dir + ':/home/sdk:ro'
            // '/home/akamel/sdk:/home/sdk:ro'
          // , '/usr/bin:/usr/bin:ro'
          // , '/home/akamel/sdk/node_modules/casperjs:/usr/lib/node_modules/casperjs:ro'
        ]
      , 'PortBindings':{ '80/tcp': [{ 'HostPort': this.port.toString() }] },

    })
    .then(function(res){
      var resolve = undefined;

      this.socket = io(this.url);

      this.socket.on('connect', _.wrap(this.on_connect.bind(this), function(){ resolve(); }));

      this.socket.on('disconnect', this.on_disconnect.bind(this));

      this.socket.on('stdout', this.on_stdout.bind(this));

      this.socket.on('stderr', this.on_stderr.bind(this));

      return new Promise(function(){
        resolve = arguments[0];
      });
    }.bind(this))
    .nodeify(cb)
    ;
};

DockerAgent.prototype.on_connect = function(){
  console.log('connected container', this.id);
};

DockerAgent.prototype.on_disconnect = function(){
  console.log('disconnect container', this.id);
  // todo [akamel] should we delete all?
};

DockerAgent.prototype.on_stdout = function(id, arg){
  var i = this.reqs[id];

  if (i && !_.isUndefined(arg)) {
    i.res.stdout.write(arg);
  }
};

DockerAgent.prototype.on_stderr = function(){
  var i = this.reqs[id];

  if (i && !_.isUndefined(arg)) {
    i.res.stderr.write(arg);
  }
};

DockerAgent.prototype.reqs = {};

// todo [akamel] could we pipe to wrong request stdout/err if error happens way after res is done?
DockerAgent.prototype.handle = function(req, res, next) {
  var id = req.task.id;

  this.socket.emit('execution', req.task);
  this.reqs[id] = { req : req, res : res, next : next };

  req.headers = req.headers || {};

  req.headers['$originalurl'] = req.url;
  req.headers['$execution-id'] = req.task.metadata.execution.id;
  // req.headers['$req-hostname'] = req.hostname;
  // req.headers['$req-port'] = req.hostname;

  res.on('end', function(){
    delete this.reqs[id];
  }.bind(this));

  req
    // .pipe(log_spy())
    .pipe(request({ url : this.url + '/execute', q: req.query, method: req.method, headers: req.headers }))
    .on('response', function(response) {
      res.writeHead(response.statusCode, response.headers);
    })
    .on('error', function(err){
      var body = {
          '#system' : {
              type    : 'exception'
            , error   : 'response pipe error'
            , details : err
          }
        };

      // res.stderr.write(new Buffer());
      next(body);
    })
    // .pipe(log_spy())
    .pipe(res)
    ;
};

DockerAgent.prototype.remove = function(cb) {
  this.docker.remove(this.container.id, cb);
};

Promise.promisifyAll(DockerAgent.prototype);

module.exports = DockerAgent;