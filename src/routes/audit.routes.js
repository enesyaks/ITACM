const express = require('express');
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { auditService } = require('../providers');

const router = express.Router();

/**
 * Refused sign-ins, newest first. Kept 7 days, then dropped by the scheduler.
 *
 * Separate from the audit trail above because that one is permanent and records
 * only what succeeded — the middleware feeding it skips any request that
 * answered 4xx, which is every refusal. İzin: audit:read
 */
router.get('/login-failures', authenticate, requirePermission('audit', 'read'), async (req, res, next) => {
  try {
    const { authProvider } = require('../providers');
    res.json({
      success: true,
      data: await authProvider.listLoginFailures({
        limit: req.query.limit,
        email: req.query.email || null,
      }),
      retentionDays: authProvider.LOGIN_FAILURE_RETENTION_DAYS,
    });
  } catch (err) { next(err); }
});

/** Audit trail. İzin: audit:read */
router.get('/', authenticate, requirePermission('audit', 'read'), async (req, res, next) => {
  try {
    const data = await auditService.listEvents({
      limit: req.query.limit,
      offset: req.query.offset,
      source: req.query.source || '',
      q: req.query.q || '',
      from: req.query.from || '',
      to: req.query.to || '',
      actor: req.query.actor || '',
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/:bucket/:id', authenticate, requirePermission('audit', 'read'), async (req, res, next) => {
  try {
    const event = await auditService.getEvent(req.params.bucket, req.params.id);
    if (!event) return res.status(404).json({ success: false, error: 'Audit event not found' });
    res.json({ success: true, data: event });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
