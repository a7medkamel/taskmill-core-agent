var Docker      = require('dockerode')
  , Promise     = require('bluebird')
  , _           = require('underscore')
  , async       = require('async')
  ;

function DockerManager(options) {
  this.options = options;

  var o = this.options.host
            ? {
                  protocol  : this.options.protocol
                , host      : this.options.host
                , port      : this.options.port
              }
            : undefined;

  this.docker = new Docker(o);
}

DockerManager.prototype.remove = function(id, cb) {
  var container = this.docker.getContainer(id);
  container.remove({ force : true }, cb || function(){});
};

DockerManager.prototype.removeAll = function(cb) {
  var me = this;

  this.docker.listContainers({ all : true }, function (err, containers) {
    var fcts = _.map(containers, function(item){
      return function(cb){ me.remove(item.Id, cb); };
    });

    async.parallelLimit(fcts, 50, cb);
  });
};

DockerManager.prototype.createContainer = function(options, cb) {
  this.docker.createContainer(options, cb);
};

DockerManager.prototype.getContainer = function(id) {
  return this.docker.getContainer(id);
};

Promise.promisifyAll(DockerManager.prototype);

module.exports = DockerManager;