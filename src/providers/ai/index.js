/** AI assistant facade — providers, tools, agent loop. */
module.exports = {
  ...require('./providers'),
  ...require('./tools'),
  ...require('./agent'),
  ...require('./http'),
};
