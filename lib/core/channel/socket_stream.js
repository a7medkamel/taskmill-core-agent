var request   = require('request')
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
  ss(this.socket).on('request', function(){
    var streams = handle.apply(this, _.toArray(arguments));

    this.handle(streams.req, streams.res, function(){
      console.log(arguments);
    });
  }.bind(this));
}

module.exports = {
    handle : handle
  , listen : listen
};