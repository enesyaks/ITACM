/**
 * Portal policy helpers — which paths a self-service employee login may reach.
 *
 * A Portal account is an untrusted, employee-held login whose only business is
 * its own zimmet. This is an allowlist, not a blocklist: a route added anywhere
 * in the app is closed to Portal accounts until it is named here, so forgetting
 * to think about them fails safe.
 *
 * Kept dependency-free (like mfaPolicy / passwordPolicy) so the confinement
 * rules can be unit-tested without a database — see tests/portal-confinement.
 */
'use strict';

// Self-service auth actions a Portal account needs to manage its own session.
const PORTAL_AUTH_PATHS = new Set([
  '/api/auth/logout',
  '/api/auth/password',
  '/api/auth/verify-token',
  '/api/auth/my-permissions',
  '/api/auth/mfa',
  '/api/auth/mfa/setup',
  '/api/auth/mfa/enable',
  '/api/auth/mfa/disable',
]);

/** True when a Portal account may reach this URL: its own zimmet, or the set above. */
function isPortalAllowedPath(originalUrl) {
  const path = String(originalUrl || '').split('?')[0].replace(/\/+$/, '') || '/';
  if (path === '/api/me' || path.startsWith('/api/me/')) return true;
  return PORTAL_AUTH_PATHS.has(path);
}

module.exports = { PORTAL_AUTH_PATHS, isPortalAllowedPath };
