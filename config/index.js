var _ = require('lodash');

var env = process.env.ENV_VARIABLE || 'development';

var objs = [
  require('./docker'),
  require('./dispatcher'),
  require('./group'),
  require('./worker'),
  require('./dispatcher'),
  require('./env/' + env)
];

module.exports = _.merge.apply(this, [{}].concat(objs));