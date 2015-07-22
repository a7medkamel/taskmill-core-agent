var request   = require('request')
  , url       = require('url')
  , config    = require('config')
  , _         = require('lodash')
  , ss        = require('socket.io-stream')
  ;


function handle(ss$req, ss$res, data) {
  // todo [akamel] we no longer need to smuggle task in req; we should make handle take task seperatly...
  // note [akamel] this also copies header, url, ...
  _.extend(ss$req, data);

  return {
      req : ss$req
    , res : ss$res
  }
}

function listen() {
  var sockets = [];

  for(var i = 1; i <= 10; i++) {
    var uri = url.format({
        protocol  : config.get('relay.protocol')
      , hostname  : config.get('relay.host')
      , port      : config.get('relay.port') + i
    });
    var socket = require('socket.io-client')(uri);

    ss(socket).on('request', function(){
      var streams = handle.apply(this, _.toArray(arguments));

      this.handle(streams.req, streams.res, function(){
        console.log(arguments);
      });
    }.bind(this));

    sockets.push(socket);
  }

  ss(this.socket).on('request', function(){
    var streams = handle.apply(this, _.toArray(arguments));

    this.handle(streams.req, streams.res, function(){
      console.log(arguments);
    });
  }.bind(this));

  this.socket.on('ack', function(data){
    _.each(sockets, function(socket){
      socket.emit('route', data.id);
    });
  }.bind(this));
}

module.exports = {
    handle : handle
  , listen : listen
};