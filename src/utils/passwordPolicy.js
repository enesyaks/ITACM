/**
 * Forced password-change policy — after a one-time/temp password is emailed
 * (portal grant), the user must set a new password before normal API use.
 */
'use strict';

/** True when this interactive user must change password before normal API use. */
function needsPasswordChange(user) {
  return !!(user && user.mustChangePassword);
}

/**
 * Paths allowed while must_change_password is set (with /api prefix).
 * Anything else returns 403 PASSWORD_CHANGE_REQUIRED.
 */
function isPasswordChangeAllowedPath(originalUrl) {
  const path = String(originalUrl || '').split('?')[0];
  return (
    path === '/api/auth/password'
    || path === '/api/auth/logout'
    || path === '/api/auth/verify-token'
    || path === '/api/config'
  );
}

module.exports = {
  needsPasswordChange,
  isPasswordChangeAllowedPath,
};
