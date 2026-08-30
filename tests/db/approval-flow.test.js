/**
 * The approval engine, held to a real database. These guard two logic fixes:
 *
 *  1. An unresolvable step in the MIDDLE (or front) of a chain — e.g. 'department'
 *     when no department manager is on file — must be SKIPPED, not treated as the
 *     end of the chain. Before the fix, a chain like [manager, department, emp:CFO]
 *     finalized (auto-approved) at the manager step the moment 'department' failed
 *     to resolve, silently bypassing the mandatory finance approver.
 *
 *  2. No org shape may resolve an approver to the requester themselves (self-
 *     approval) — including a 'manager2' skip-level that loops back through a
 *     reporting cycle.
 *
 * Run: npm run test:db
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/db');

test('approval chain resolution', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const approvalService = require('../../src/providers/postgres/approvalService');

  // Turn the (passive-by-default) engine on for this scratch DB.
  await query(`UPDATE app_settings SET approvals = '{"enabled":true}'::jsonb WHERE id = 1`);

  const setManager = (empId, mgrId) =>
    query('UPDATE employees SET manager_employee_id = $2 WHERE id = $1', [empId, mgrId]);

  await t.test('an unresolvable middle step does not skip a later fixed approver', async () => {
    const mgr = await db.makeEmployee({ fullName: 'Manager A', department: 'Sales' });
    const cfo = await db.makeEmployee({ fullName: 'CFO A', department: 'Finance' });
    // 'Sales' has no department manager on file → the 'department' step is unresolvable.
    const requester = await db.makeEmployee({ fullName: 'Requester A', department: 'Sales' });
    await setManager(requester.id, mgr.id);

    const { required, request } = await approvalService.createRequest({
      type: 'ticket_request',
      requesterEmployeeId: requester.id,
      requesterName: requester.full_name,
      levels: ['manager', 'department', `emp:${cfo.id}`],
    });
    assert.equal(required, true, 'an approval must be required');
    // Step 0 is the manager.
    assert.equal(request.approverEmployeeId, mgr.id);

    // Manager approves → the chain must advance PAST the unresolvable 'department'
    // step to the CFO, not finalize.
    const afterMgr = await approvalService.decide(request.id, {
      decision: 'approved', deciderEmployeeId: mgr.id, deciderName: mgr.full_name,
    });
    assert.equal(afterMgr.status, 'pending', 'still pending — CFO must weigh in');
    assert.equal(afterMgr.approverEmployeeId, cfo.id, 'advanced to the CFO, not auto-approved');
    assert.equal(afterMgr.currentLevel, 2, 'landed on the CFO step index');

    // CFO approves → now it finalizes.
    const done = await approvalService.decide(request.id, {
      decision: 'approved', deciderEmployeeId: cfo.id, deciderName: cfo.full_name,
    });
    assert.equal(done.status, 'approved');
  });

  await t.test('a front step that is unresolvable still opens the request at the next resolvable step', async () => {
    const cfo = await db.makeEmployee({ fullName: 'CFO B', department: 'Finance' });
    const requester = await db.makeEmployee({ fullName: 'Requester B', department: 'Sales' }); // no dept manager
    const { required, request } = await approvalService.createRequest({
      type: 'ticket_request',
      requesterEmployeeId: requester.id,
      levels: ['department', `emp:${cfo.id}`],
    });
    assert.equal(required, true, 'the CFO step keeps the request alive');
    assert.equal(request.approverEmployeeId, cfo.id);
    assert.equal(request.currentLevel, 1, 'opened at the CFO step, skipping the unresolvable front step');
  });

  await t.test('manager2 never resolves to the requester (no self-approval on a reporting cycle)', async () => {
    // A genuine two-person mutual-management shape at the DB level (the API guards
    // against it, but the resolver must be safe regardless of how the rows got there).
    const x = await db.makeEmployee({ fullName: 'X Person', department: 'Ops' });
    const y = await db.makeEmployee({ fullName: 'Y Person', department: 'Ops' });
    await setManager(x.id, y.id);
    await setManager(y.id, x.id);
    // manager2 of X = manager of (manager of X) = manager of Y = X → must be dropped.
    const { required } = await approvalService.createRequest({
      type: 'ticket_request',
      requesterEmployeeId: x.id,
      levels: ['manager2'],
    });
    assert.equal(required, false, 'a self-resolving chain yields no approval, never a self-approval');
  });

  await t.test('a genuine skip-level resolves to the grand-manager', async () => {
    const grand = await db.makeEmployee({ fullName: 'Grand', department: 'Eng' });
    const mid = await db.makeEmployee({ fullName: 'Mid', department: 'Eng' });
    const low = await db.makeEmployee({ fullName: 'Low', department: 'Eng' });
    await setManager(mid.id, grand.id);
    await setManager(low.id, mid.id);
    const { required, request } = await approvalService.createRequest({
      type: 'ticket_request', requesterEmployeeId: low.id, levels: ['manager2'],
    });
    assert.equal(required, true);
    assert.equal(request.approverEmployeeId, grand.id);
  });
});
