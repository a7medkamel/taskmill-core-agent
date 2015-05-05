var Promise     = require('bluebird')
  , _           = require('underscore')
  , request     = require('request')
  , spy         = require('through2-spy')
  , dev_null    = require('dev-null')
  , url         = require('url')
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
  // this.time_start = process.hrtime();

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
    .nodeify(cb)
    ;
    ;
    // .createContainerAsync({
    // })
    // .then(function(create_res){
    //   this.container = this.docker.getContainer(create_res.id);

    //   console.log('+++ container', me.id, create_res.id);

    //   // this.container.attach({stream: true, stdout: true, stderr: true, tty : false}, function (err, stream) {
    //   //   var stdout = spy(function(chunk, enc){})
    //   //     , stderr = spy(function(chunk, enc){})
    //   //     ;

    //   //   // this.stdout = stdout.pipe(log_spy());
    //   //   // this.stderr = stderr.pipe(log_spy());
    //   //   stdout.pipe(process.stdout);
    //   //   stderr.pipe(process.stderr);

    //   //   this.container.modem.demuxStream(stream, stdout, stderr);
    //   // }.bind(this));

    //   Promise.promisifyAll(this.container);

    //   // this._state = 'created';
    // }.bind(this))
    // .nodeify(cb)
    // ;
};

DockerAgent.prototype.end = function(cb) {}

DockerAgent.prototype.start = function(cb) {
  if (!this.container) {
    cb(new Error('cannot boot container. container not initialized.'));
  }

  Promise
    .promisify(this.container.start, this.container)({
        'Binds':[
            // todo [akamel] akamel is hard coded here...
            '/home/akamel/sdk:/home/sdk:ro'
          // , '/usr/bin:/usr/bin:ro'
          // , '/home/akamel/sdk/node_modules/casperjs:/usr/lib/node_modules/casperjs:ro'
        ]
      , 'PortBindings':{ '80/tcp': [{ 'HostPort': this.port.toString() }] },

    })
    .then(function(res){
      var resolve = undefined;

      this.socket = io(this.url);

      this.socket.on('connect', function(){
        // this._state = 'ready';
        console.log('connected container', this.id);
        resolve();
      }.bind(this));

      this.socket.on('disconnect', function(){
        // this._state = 'created';
        console.log('disconnect container', this.id);
      }.bind(this));

      return new Promise(function(){
        resolve = arguments[0];
      });
    }.bind(this))
    .nodeify(cb)
    ;
};

// DockerAgent.prototype.req = undefined;

// todo [akamel] could we pipe to wrong request stdout/err if error happens way after res is done?
DockerAgent.prototype.handle = function(req, res, next) {
  // this._state = 'running';

  var me = this;

  // todo [akamel] we are double assining listeners for every run
  this.socket.emit('execution', req.task);
      this.socket.on('stdout', function(){
        if (!_.isUndefined(arguments[0])) {
          res.stdout.write(arguments[0]);
        }
      });

      this.socket.on('stderr', function(){
        if (!_.isUndefined(arguments[0])) {
          res.stderr.write(arguments[0]);
        }
      });

  req.headers = req.headers || {};

  req.headers['$originalurl'] = req.url;
  req.headers['$execution-id'] = req.task.metadata.execution.id;
  // req.headers['$req-hostname'] = req.hostname;
  // req.headers['$req-port'] = req.hostname;

  req
    // .pipe(log_spy())
    .pipe(request({ url : me.url + '/execute', q: req.query, method: req.method, headers: req.headers }))
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