/**
 * Role permission matrix — the fallback every account without a custom IAM
 * group is judged by. This is the authorization core: if it drifts, roles
 * silently gain or lose access with nothing else to catch it.
 *
 * Pure function, no database (pg.Pool is lazy).
 * Run: node --test tests/permission-matrix.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { checkRoleFallback, RESOURCES, ACTIONS } = require('../src/providers/postgres/permissionService');

const can = (role, resource, action) => checkRoleFallback({ role }, resource, action);

test('Owner can do everything in the schema', () => {
  for (const r of RESOURCES) {
    for (const a of ACTIONS) {
      assert.equal(can('Owner', r, a), true, `Owner should have ${r}:${a}`);
    }
  }
});

test('Admin has everything except deleting logins', () => {
  assert.equal(can('Admin', 'user_management', 'delete'), false,
    'only an Owner may delete a login');
  assert.equal(can('Admin', 'user_management', 'create'), true);
  assert.equal(can('Admin', 'asset', 'delete'), true);
  assert.equal(can('Admin', 'settings', 'manage'), true);
});

test('Helpdesk runs operations but cannot delete or reach admin surfaces', () => {
  for (const r of ['asset', 'license', 'employee', 'line', 'consumable', 'maintenance', 'onboarding']) {
    assert.equal(can('Helpdesk', r, 'create'), true, `Helpdesk should create ${r}`);
    assert.equal(can('Helpdesk', r, 'update'), true, `Helpdesk should update ${r}`);
  }
  for (const r of RESOURCES) {
    assert.equal(can('Helpdesk', r, 'delete'), false, `Helpdesk must not delete ${r}`);
  }
  for (const r of ['settings', 'user_management', 'integration', 'audit']) {
    for (const a of ACTIONS) {
      assert.equal(can('Helpdesk', r, a), false, `Helpdesk must not reach ${r}:${a}`);
    }
  }
  assert.equal(can('Helpdesk', 'document', 'read'), false, 'general documents are closed to Helpdesk');
  assert.equal(can('Helpdesk', 'provider', 'update'), false, 'providers are read-only for Helpdesk');
  assert.equal(can('Helpdesk', 'contract', 'update'), false, 'contracts are read-only for Helpdesk');
  assert.equal(can('Helpdesk', 'provider', 'read'), true);
});

test('Viewer is read-only and blind to admin surfaces', () => {
  for (const r of RESOURCES) {
    for (const a of ACTIONS) {
      if (a === 'read') continue;
      assert.equal(can('Viewer', r, a), false, `Viewer must not ${r}:${a}`);
    }
  }
  for (const r of ['settings', 'user_management', 'integration', 'audit']) {
    assert.equal(can('Viewer', r, 'read'), false, `Viewer must not read ${r}`);
  }
  assert.equal(can('Viewer', 'asset', 'read'), true);
});

test('HR reaches only its own request surface', () => {
  assert.equal(can('HR', 'hr_request', 'create'), true);
  assert.equal(can('HR', 'hr_request', 'read'), true);
  // HR must NOT approve its own tickets — that is IT's decision.
  assert.equal(can('HR', 'hr_request', 'update'), false);
  assert.equal(can('HR', 'hr_request', 'delete'), false);
  assert.equal(can('HR', 'dashboard', 'read'), true);

  for (const r of RESOURCES) {
    if (r === 'hr_request' || r === 'dashboard') continue;
    for (const a of ACTIONS) {
      assert.equal(can('HR', r, a), false, `HR must not reach ${r}:${a}`);
    }
  }
});

test('Portal and unknown roles get nothing from the fallback', () => {
  for (const role of ['Portal', 'Nonsense', '', null, undefined]) {
    for (const r of ['asset', 'employee', 'hr_request', 'dashboard']) {
      assert.equal(checkRoleFallback({ role }, r, 'read'), false,
        `${String(role)} must not read ${r}`);
    }
  }
  assert.equal(checkRoleFallback(null, 'asset', 'read'), false, 'no user → no access');
  assert.equal(checkRoleFallback({}, 'asset', 'read'), false, 'no role → no access');
});

test('IT approval of HR tickets is available to staff, not to HR', () => {
  // The dashboard approve button and POST /hr/requests/:id/acknowledge are both
  // gated on hr_request:update — these are the roles that gate admits.
  assert.equal(can('Owner', 'hr_request', 'update'), true);
  assert.equal(can('Admin', 'hr_request', 'update'), true);
  assert.equal(can('Helpdesk', 'hr_request', 'update'), true);
  assert.equal(can('HR', 'hr_request', 'update'), false);
  assert.equal(can('Viewer', 'hr_request', 'update'), false);
});

test('the schema still carries the resources these rules depend on', () => {
  for (const r of ['asset', 'employee', 'hr_request', 'user_management', 'settings', 'audit', 'dashboard']) {
    assert.ok(RESOURCES.includes(r), `RESOURCES must still contain ${r}`);
  }
  for (const a of ['read', 'create', 'update', 'delete']) {
    assert.ok(ACTIONS.includes(a), `ACTIONS must still contain ${a}`);
  }
});
