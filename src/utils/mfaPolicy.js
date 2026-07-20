/**
 * MFA policy helpers — which roles must have TOTP enabled.
 *
 * OWNER_MFA_REQUIRED defaults to on. Set to 0/false/off/no to let Owners
 * use the app without enrolling MFA (local/dev recovery).
 */
'use strict';

function ownerMfaRequiredByEnv() {
  const v = String(process.env.OWNER_MFA_REQUIRED || '').trim().toLowerCase();
  if (!v) return true;
  return !['0', 'false', 'off', 'no'].includes(v);
}

function roleRequiresMfa(role) {
  return role === 'Owner' && ownerMfaRequiredByEnv();
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
