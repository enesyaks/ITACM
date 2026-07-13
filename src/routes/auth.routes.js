const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { authProvider } = require('../services');
const { HttpError } = require('../utils/httpError');

// Brute-force protection: max 20 login attempts per IP per 15 minutes.
const loginAttempts = new Map();
function loginLimiter(req, res, next) {
  const now = Date.now();
  let entry = loginAttempts.get(req.ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 15 * 60 * 1000 };
    loginAttempts.set(req.ip, entry);
  }
  if (entry.count >= 20) {
    return next(HttpError.tooMany('Too many login attempts — wait 15 minutes and try again'));
  }
  entry.count++;
  if (loginAttempts.size > 10000) loginAttempts.clear(); // memory guard
  next();
}

/**
 * POST /api/auth/login — body: { email, password } → { token, expiresIn, user }.
 */
router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const meta = { ip: req.ip, userAgent: req.headers['user-agent'] || null };
  res.json({ success: true, data: await authProvider.login(req.body || {}, meta) });
}));

/**
 * POST /api/auth/verify-token — send Authorization: Bearer <TOKEN>;
 * returns the verified profile + UI permissions.
 */
router.post('/verify-token', authenticate, asyncHandler(async (req, res) => {
  await authProvider.recordLogin(req.user, { ip: req.ip, userAgent: req.headers['user-agent'] || null });
  res.json({ success: true, data: await authProvider.getVerifiedProfile(req.user) });
}));

// Only an Owner may grant/assign the Owner role.
function guardOwnerAssignment(req) {
  if (req.body && req.body.role === 'Owner' && req.user.role !== 'Owner') {
    throw HttpError.forbidden('Only an Owner can assign the Owner role');
  }
}

/** GET /api/auth/users — list IT users (Owner/Admin). */
router.get('/users', authenticate, requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.listUsers() });
}));

/** POST /api/auth/users — onboard an IT user with a role (Owner/Admin). */
router.post('/users', authenticate, requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  guardOwnerAssignment(req);
  res.status(201).json({ success: true, data: await authProvider.createItUser(req.body) });
}));

/** PUT /api/auth/users/:uid/role — approve/change a role (Owner/Admin; Owner role Owner-only). */
router.put('/users/:uid/role', authenticate, requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  guardOwnerAssignment(req);
  res.json({ success: true, data: await authProvider.setUserRole(req.params.uid, req.body.role, req.user) });
}));

/** GET /api/auth/users/admin-logs?email= — disable/enable/delete/role audit trail (Owner/Admin).
 *  Registered before /users/:uid/logins so the literal path wins. */
router.get('/users/admin-logs', authenticate, requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.getAdminLogs(String(req.query.email || ''), req.query.limit) });
}));

/** PUT /api/auth/users/:uid/status — disable/enable an account (Owner only, audited). */
router.put('/users/:uid/status', authenticate, requireRole('Owner'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.setUserStatus(req.params.uid, req.body.status, req.user) });
}));

/** DELETE /api/auth/users/:uid — permanently remove an account (Owner only, audited). */
router.delete('/users/:uid', authenticate, requireRole('Owner'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.deleteUser(req.params.uid, req.user) });
}));

/** GET /api/auth/users/:uid/logins — login history for a user (Owner/Admin). */
router.get('/users/:uid/logins', authenticate, requireRole('Owner', 'Admin'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authProvider.getLoginLogs(req.params.uid, req.query.limit) });
}));

module.exports = router;
