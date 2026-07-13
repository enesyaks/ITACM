const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { employeeService, documentService, offboardService } = require('../services');
const { validateUpload } = require('../utils/uploadGuard');

router.use(authenticate);

/** GET /api/employees — Employee Directory + Handover Employee Selector (all roles). */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await employeeService.listEmployees(req.query) });
}));

/** POST /api/employees — add an employee (Admin/Helpdesk). */
router.post('/', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await employeeService.createEmployee(req.body) });
}));

/** GET /api/employees/:id — one employee (all roles). */
router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await employeeService.getEmployee(req.params.id) });
}));

/** GET /api/employees/:id/history — full device history of one employee (all roles). */
router.get('/:id/history', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await employeeService.getEmployeeHistory(req.params.id, req.query.limit) });
}));

/** GET /api/employees/:id/offboarding — checklist of holdings to dispose before Inactive. */
router.get('/:id/offboarding', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await offboardService.getOffboardingChecklist(req.params.id) });
}));

/** POST /api/employees/:id/offboard — dispose holdings + optionally deactivate. */
router.post('/:id/offboard', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await offboardService.executeOffboard(req.params.id, req.body, req.user) });
}));

/** PUT /api/employees/:id — edit / deactivate (blocked while assets are held) (Admin/Helpdesk). */
router.put('/:id', requireRole('Owner', 'Admin', 'Helpdesk'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await employeeService.updateEmployee(req.params.id, req.body) });
}));

/* ---- Per-employee handover document archive ---- */

/** GET /api/employees/:id/documents — list archived forms + scans (all roles). */
router.get('/:id/documents', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await documentService.listByEmployee(req.params.id) });
}));

/**
 * POST /api/employees/:id/documents — upload a signed/scanned form (Owner/Admin/Helpdesk).
 * Body: { filename, mime, base64, handoverId? }. 12MB JSON limit for scans.
 */
router.post('/:id/documents',
  requireRole('Owner', 'Admin', 'Helpdesk'),
  express.json({ limit: '12mb' }),
  asyncHandler(async (req, res) => {
    // The real type is detected from the bytes and the filename is sanitised —
    // the client-declared MIME is ignored (it can be spoofed).
    const { buffer, mime, filename } = validateUpload(req.body || {});
    const saved = await documentService.saveDocument({
      handoverId: (req.body && req.body.handoverId) || null, employeeId: req.params.id,
      employeeName: (req.body && req.body.employeeName) || null,
      kind: 'scan', filename, mime, buffer,
      uploadedBy: req.user.uid, uploadedByName: req.user.username || req.user.email,
    });
    res.status(201).json({ success: true, data: saved });
  }));

module.exports = router;
