var request   = require('request')
  , _         = require('lodash')
  ;


function handle(data) {
  // todo [akamel] we no longer need to smuggle task in req; we should make handle take task seperatly...
  // note [akamel] this also copies header, url, ...
  var req = request.get('http://localhost:8989/req/' + data.task.id);
  var res = request.post('http://localhost:8989/res/' + data.task.id);

  _.extend(req, data);

  return {
      req : req
    , res : res
  }
}

function listen() {
  this.socket.on('request', function(){
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