const express = require('express');
const router = express.Router();
const { authenticate, requirePermission, requireAnyPermission, requireAllPermissions } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { employeeService, documentService, offboardService, permissionService } = require('../services');
const { validateUpload } = require('../utils/uploadGuard');
const { HttpError } = require('../utils/httpError');

router.use(authenticate);

/**
 * Context helper: employee id'den departman bilgisini çıkarır.
 */
async function getEmployeeContext(req) {
  const id = req.params.id || req.body?.id;
  if (!id) return {};
  try {
    const emp = await employeeService.getEmployee(id);
    return { department: emp.department };
  } catch {
    return {};
  }
}

function getEmployeeBodyContext(req) {
  const body = req.body || {};
  return { department: body.department };
}

/** Intersect client department filter with IAM department scope. */
async function applyDepartmentScope(user, query) {
  const scope = await permissionService.getConstraintScope(user, 'employee', 'read', 'department');
  if (scope === null) return query; // unrestricted
  if (!scope.length) {
    throw HttpError.forbidden('Access denied: no department scope for employee:read');
  }
  const client = String(query.department || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = client.length
    ? client.filter((d) => scope.some((s) => s.toLowerCase() === d.toLowerCase()))
    : scope;
  if (!allowed.length) {
    return { ...query, department: '__none__' };
  }
  return { ...query, department: allowed.join(',') };
}

/** GET /api/employees — Employee Directory. İzin: employee:read (+ optional department constraint) */
router.get('/', requirePermission('employee', 'read'), asyncHandler(async (req, res) => {
  const query = await applyDepartmentScope(req.user, { ...req.query });
  if (query.department === '__none__') {
    return res.json({
      success: true,
      data: { items: [], total: 0, summary: { withAssets: 0, inactive: 0, active: 0 } },
    });
  }
  res.json({ success: true, data: await employeeService.listEmployees(query) });
}));

/** POST /api/employees — add an employee. İzin: employee:create */
router.post('/', requirePermission('employee', 'create', getEmployeeBodyContext), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await employeeService.createEmployee(req.body) });
}));

/** GET /api/employees/:id — one employee. İzin: employee:read */
router.get('/:id', requirePermission('employee', 'read', getEmployeeContext), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await employeeService.getEmployee(req.params.id) });
}));

/** GET /api/employees/:id/history — device/software timeline. İzin: employee:view_history only */
router.get('/:id/history',
  requirePermission('employee', 'view_history', getEmployeeContext),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await employeeService.getEmployeeHistory(req.params.id, req.query.limit) });
  }));

/** GET /api/employees/:id/offboarding — checklist. İzin: employee:update | manage */
router.get('/:id/offboarding',
  requireAnyPermission([['employee', 'update'], ['employee', 'manage']], getEmployeeContext),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await offboardService.getOffboardingChecklist(req.params.id) });
  }));

/** POST /api/employees/:id/offboard — dispose holdings. İzin: employee:update | manage */
router.post('/:id/offboard',
  requireAnyPermission([['employee', 'update'], ['employee', 'manage']], getEmployeeContext),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await offboardService.executeOffboard(req.params.id, req.body, req.user) });
  }));

/** PUT /api/employees/:id — edit / deactivate. İzin: employee:update | manage */
router.put('/:id',
  requireAnyPermission([['employee', 'update'], ['employee', 'manage']], getEmployeeContext),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await employeeService.updateEmployee(req.params.id, req.body) });
  }));

/* ---- Per-employee handover document archive ---- */

/** GET /api/employees/:id/documents — zimmet / scan archive.
 * İzin: document:read AND employee:view_handover
 */
router.get('/:id/documents',
  requireAllPermissions([['document', 'read'], ['employee', 'view_handover']], getEmployeeContext),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await documentService.listByEmployee(req.params.id) });
  }));

/**
 * POST /api/employees/:id/documents — upload signed scan.
 * İzin: document:upload AND employee:view_handover
 */
router.post('/:id/documents',
  requireAllPermissions([['document', 'upload'], ['employee', 'view_handover']], getEmployeeContext),
  express.json({ limit: '12mb' }),
  asyncHandler(async (req, res) => {
    await employeeService.getEmployee(req.params.id);
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
