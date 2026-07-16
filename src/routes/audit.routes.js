const express = require('express');
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const { auditService } = require('../providers');

const router = express.Router();

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
