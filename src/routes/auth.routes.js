const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { authProvider } = require('../services');
const { HttpError } = require('../utils/httpError');
const { rateLimitIp } = require('../utils/setupAccess');

// Brute-force protection: max 20 *failed* login attempts per IP per 15 minutes.
// Uses rateLimitIp (TCP peer unless TRUST_PROXY) so X-Forwarded-For cannot rotate buckets.
const loginAttempts = new Map();
function loginLimiter(req, res, next) {
  const now = Date.now();
  const ipKey = rateLimitIp(req);
  req._loginIpKey = ipKey;
  let entry = loginAttempts.get(ipKey);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 15 * 60 * 1000 };
    loginAttempts.set(ipKey, entry);
  }
  if (entry.count >= 20) {
    return next(HttpError.tooMany('Too many login attempts — wait 15 minutes and try again'));
  }
  req._loginLimitEntry = entry;
  if (loginAttempts.size > 10000) loginAttempts.clear();
  next();
}
function bumpLoginFail(req) {
  if (req._loginLimitEntry) req._loginLimitEntry.count += 1;
}
function clearLoginFail(req) {
  if (req._loginIpKey) loginAttempts.delete(req._loginIpKey);
}

/**
 * POST /api/auth/login — { email, password }
 * → session token, or { mfaRequired, mfaToken } when MFA is enabled.
 */
router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const meta = { ip: rateLimitIp(req), userAgent: req.headers['user-agent'] || null };
  try {
    const data = await authProvider.login(req.body || {}, meta);
    if (!data.mfaRequired) clearLoginFail(req);
    res.json({ success: true, data });
  } catch (err) {
    bumpLoginFail(req);
    throw err;
  }
}));

/**
 * POST /api/auth/mfa/verify — { mfaToken, code } or { mfaToken, backupCode }
 */
router.post('/mfa/verify', loginLimiter, asyncHandler(async (req, res) => {
  const meta = { ip: rateLimitIp(req), userAgent: req.headers['user-agent'] || null };
  try {
    const data = await authProvider.verifyMfaLogin(req.body || {}, meta);
    clearLoginFail(req);
    res.json({ success: true, data });
  } catch (err) {
    bumpLoginFail(req);
    throw err;
  }
}));

router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.logout(req.user) });
}));

router.post('/password', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.changePassword(req.user, req.body || {}) });
}));

router.get('/mfa', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.mfaStatus(req.user) });
}));

router.post('/mfa/setup', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.mfaSetupStart(req.user) });
}));

router.post('/mfa/enable', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.mfaSetupConfirm(req.user, req.body || {}) });
}));

router.post('/mfa/disable', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.mfaDisable(req.user, req.body || {}) });
}));

/**
 * POST /api/auth/verify-token — Authorization: Bearer <TOKEN>
 */
router.post('/verify-token', authenticate, asyncHandler(async (req, res) => {
  await authProvider.recordLogin(req.user, {
    ip: rateLimitIp(req),
    userAgent: req.headers['user-agent'] || null,
  });
  res.json({ success: true, data: await authProvider.getVerifiedProfile(req.user) });
}));

/** Only Owner may assign Owner or Admin; Admin may create/promote Helpdesk & Viewer. */
function guardPrivilegedRoleAssignment(req) {
  const role = req.body && req.body.role;
  if (role === 'Owner' || role === 'Admin') {
    if (req.user.role !== 'Owner') {
      throw HttpError.forbidden('Only an Owner can assign the Owner or Admin role');
    }
  }
}

router.get('/users', authenticate, requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.listUsers() });
}));

router.post('/users', authenticate, requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  guardPrivilegedRoleAssignment(req);
  res.status(201).json({ success: true, data: await authProvider.createItUser(req.body, req.user) });
}));

router.put('/users/:uid/role', authenticate, requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  guardPrivilegedRoleAssignment(req);
  res.json({ success: true, data: await authProvider.setUserRole(req.params.uid, req.body.role, req.user) });
}));

router.get('/users/admin-logs', authenticate, requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.getAdminLogs(String(req.query.email || ''), req.query.limit) });
}));

router.put('/users/:uid/status', authenticate, requireRole('Owner'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.setUserStatus(req.params.uid, req.body.status, req.user) });
}));

router.delete('/users/:uid', authenticate, requireRole('Owner'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.deleteUser(req.params.uid, req.user) });
}));

router.get('/users/:uid/logins', authenticate, requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.getLoginLogs(req.params.uid, req.query.limit) });
}));

module.exports = router;
