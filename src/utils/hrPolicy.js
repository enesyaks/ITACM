/**
 * HR confinement — fail-closed allowlist for the HR role.
 *
 * HR may only manage onboarding/offboarding *requests*, search employees for
 * offboard targeting, see a filtered dashboard, and use self-service zimmet
 * (/api/me) when they have an employee twin. Everything else is 403.
 *
 * The auth-path list is spelled out rather than re-exported from portalPolicy:
 * the two roles happen to need the same session endpoints today, but they are
 * separate policies and a change to one must never silently move the other.
 */
'use strict';

// Self-service auth actions an HR account needs to manage its own session.
// Mirrors PORTAL_AUTH_PATHS today — deliberately duplicated, not imported.
const HR_AUTH_PATHS = new Set([
  '/api/auth/logout',
  '/api/auth/password',
  '/api/auth/verify-token',
  '/api/auth/my-permissions',
  '/api/auth/mfa',
  '/api/auth/mfa/setup',
  '/api/auth/mfa/enable',
  '/api/auth/mfa/disable',
]);

/** True when an HR account may reach this URL. */
function isHrAllowedPath(originalUrl) {
  const path = String(originalUrl || '').split('?')[0].replace(/\/+$/, '') || '/';
  if (path === '/api/me' || path.startsWith('/api/me/')) return true;
  if (path === '/api/hr' || path.startsWith('/api/hr/')) return true;
  if (path === '/api/dashboard/hr-stats') return true;
  if (path === '/api/config') return true;
  return HR_AUTH_PATHS.has(path);
}

module.exports = { isHrAllowedPath, HR_AUTH_PATHS };
