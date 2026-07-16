/**
 * MFA policy helpers — which roles must have TOTP enabled.
 */
'use strict';

function roleRequiresMfa(role) {
  return role === 'Owner';
}

function isServiceActor(user) {
  if (!user) return false;
  if (user.actorType === 'service') return true;
  const uid = String(user.uid || '');
  return uid.startsWith('apikey:');
}

/** True when this interactive user must enroll MFA before normal API use. */
function needsMfaEnrollment(user) {
  if (!user || isServiceActor(user)) return false;
  return roleRequiresMfa(user.role) && !user.mfaEnabled;
}

/**
 * Paths Owners may hit while MFA is still off (relative to host, with /api prefix).
 * Anything else returns 403 MFA_ENROLLMENT_REQUIRED.
 */
function isMfaEnrollmentAllowedPath(originalUrl) {
  const path = String(originalUrl || '').split('?')[0];
  return (
    path === '/api/auth/mfa'
    || path === '/api/auth/mfa/setup'
    || path === '/api/auth/mfa/enable'
    || path === '/api/auth/logout'
    || path === '/api/auth/verify-token'
    || path === '/api/config'
  );
}

module.exports = {
  roleRequiresMfa,
  isServiceActor,
  needsMfaEnrollment,
  isMfaEnrollmentAllowedPath,
};
