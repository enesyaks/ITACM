/**
 * Provider bundle — self-hosted PostgreSQL backend. Routes and middleware
 * consume this facade, so they stay storage-agnostic.
 */
const config = require('../config');

config.assertBackendConfig();

module.exports = require('./postgres');
