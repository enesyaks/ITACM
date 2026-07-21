const express = require('express');
const router = express.Router();
const { authenticate, requirePermission, requireAnyPermission, requireAllPermissions } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  employeeService, documentService, offboardService, permissionService,
  authProvider, notificationService,
} = require('../services');
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

/** GET /api/employees — Employee Directory. İzin: employee:read (+ optional department constraint)
 *  Query: sort=name|department|assets|status  order=asc|desc
 */
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

/**
 * POST /api/employees/:id/grant-access — provision (or re-provision) a
 * self-service Portal login for this employee and deliver the credentials.
 * İzin: user_management:create (creating a login account is privileged).
 *
 * SMTP on  → email the sign-in details, temp password never returned.
 * SMTP off → return the temp password so the admin can hand it over.
 */
router.post('/:id/grant-access',
  requirePermission('user_management', 'create'),
  asyncHandler(async (req, res) => {
    const employee = await employeeService.getEmployee(req.params.id);
    const { user, tempPassword, created } = await authProvider.grantPortalAccess({ employee }, req.user);

    const { smtp } = await notificationService.getMailConfig();
    const smtpOn = !!(smtp && smtp.host);
    let emailStatus = 'skipped';
    let emailError = null;
    if (smtpOn) {
      try {
        await notificationService.sendPortalAccessEmail({
          to: user.email,
          username: user.username,
          tempPassword,
        });
        emailStatus = 'sent';
      } catch (err) {
        console.warn('[notify] portal access email failed:', err.message);
        emailStatus = 'failed';
        emailError = err.message || 'Email send failed';
      }
    }
    // Reveal the temp password only when it wasn't (successfully) emailed.
    const reveal = !smtpOn || emailStatus === 'failed';
    res.json({
      success: true,
      data: {
        user,
        created,
        smtpUsed: smtpOn,
        emailStatus,
        emailError: emailError || undefined,
        tempPassword: reveal ? tempPassword : undefined,
      },
    });
  }));

/**
 * DELETE /api/employees/:id/revoke-access — remove the employee's Portal
 * login (sessions revoked + user deleted). Staff accounts are not touched.
 * İzin: user_management:delete (mirrors deleting a login).
 */
router.delete('/:id/revoke-access',
  requirePermission('user_management', 'delete'),
  asyncHandler(async (req, res) => {
    const employee = await employeeService.getEmployee(req.params.id);
    const result = await authProvider.revokePortalAccess({ employee }, req.user);
    res.json({ success: true, data: result });
  }));

/* ---- Per-employee handover document archive ---- */

/** GET /api/employees/:id/documents — zimmet / scan archive.
 * İzin: handover_document:read AND employee:view_handover
 */
router.get('/:id/documents',
  requireAllPermissions([['handover_document', 'read'], ['employee', 'view_handover']], getEmployeeContext),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await documentService.listByEmployee(req.params.id) });
  }));

/**
 * POST /api/employees/:id/documents — upload signed scan.
 * İzin: handover_document:upload AND employee:view_handover
 */
router.post('/:id/documents',
  requireAllPermissions([['handover_document', 'upload'], ['employee', 'view_handover']], getEmployeeContext),
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
