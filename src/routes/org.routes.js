const router = require('express').Router();
const { authenticate, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { orgService } = require('../services');

router.use(authenticate);

/** GET /api/org/tree — full department → team → member tree. İzin: employee:read */
router.get('/tree', requirePermission('employee', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await orgService.getOrgTree() });
}));

/* ------------------------------- Departments ------------------------------- */

/** PATCH /api/org/departments/:id — set (or clear) the department manager. İzin: employee:manage */
router.patch('/departments/:id', requirePermission('employee', 'manage'), asyncHandler(async (req, res) => {
  const { managerEmployeeId } = req.body || {};
  const data = await orgService.setDepartmentManager(req.params.id, managerEmployeeId ?? null);
  res.json({ success: true, data });
}));

/* ---------------------------------- Teams ---------------------------------- */

/** POST /api/org/teams — create a team under a department. İzin: employee:manage */
router.post('/teams', requirePermission('employee', 'manage'), asyncHandler(async (req, res) => {
  const { name, departmentId } = req.body || {};
  const data = await orgService.createTeam({ name, departmentId });
  res.status(201).json({ success: true, data });
}));

/** PATCH /api/org/teams/:id — rename a team or set its lead. İzin: employee:manage */
router.patch('/teams/:id', requirePermission('employee', 'manage'), asyncHandler(async (req, res) => {
  const { name, leadEmployeeId } = req.body || {};
  const data = await orgService.updateTeam(req.params.id, { name, leadEmployeeId });
  res.json({ success: true, data });
}));

/** DELETE /api/org/teams/:id — remove a team (members fall back to team-less). İzin: employee:manage */
router.delete('/teams/:id', requirePermission('employee', 'manage'), asyncHandler(async (req, res) => {
  const data = await orgService.deleteTeam(req.params.id);
  res.json({ success: true, data });
}));

/* --------------------------- Employee membership --------------------------- */

/** PATCH /api/org/employees/:id/team — move an employee into a team (or clear). İzin: employee:manage */
router.patch('/employees/:id/team', requirePermission('employee', 'manage'), asyncHandler(async (req, res) => {
  const { teamId } = req.body || {};
  const data = await orgService.assignEmployeeToTeam(req.params.id, teamId ?? null);
  res.json({ success: true, data });
}));

module.exports = router;
