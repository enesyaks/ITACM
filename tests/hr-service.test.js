/**
 * HR request service — pure policy/validation logic.
 *
 * These cover the decisions that silently corrupt data when they regress:
 * checklist normalisation, date validation, and the row-ownership scope that
 * keeps one HR officer from reading another's tickets. No database is touched
 * (pg.Pool is lazy), so this runs anywhere.
 *
 * Run: node --test tests/hr-service.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const hr = require('../src/providers/postgres/hrRequestService');

const UID_A = '11111111-1111-1111-1111-111111111111';
const UID_B = '22222222-2222-2222-2222-222222222222';

test('normalizeItems sums repeated categories instead of dropping them', () => {
  const out = hr.normalizeItems([
    { category: 'Monitor', qty: 1 },
    { category: 'Laptop', qty: 1 },
    { category: 'Monitor', qty: 2 },
  ]);
  const byCat = Object.fromEntries(out.map((i) => [i.category, i.qty]));
  assert.equal(byCat.Monitor, 3, 'two Monitor lines must become qty 3, not 1');
  assert.equal(byCat.Laptop, 1);
  assert.equal(out.length, 2, 'each category appears once');
});

test('normalizeItems clamps, floors and defaults quantities', () => {
  assert.equal(hr.normalizeItems([{ category: 'Dock', qty: 500 }])[0].qty, 99);
  assert.equal(hr.normalizeItems([{ category: 'Dock', qty: 2.9 }])[0].qty, 2);
  assert.equal(hr.normalizeItems([{ category: 'Dock', qty: 0 }])[0].qty, 1);
  assert.equal(hr.normalizeItems([{ category: 'Dock', qty: -5 }])[0].qty, 1);
  assert.equal(hr.normalizeItems([{ category: 'Dock', qty: 'abc' }])[0].qty, 1);
  assert.equal(hr.normalizeItems([{ category: 'Dock' }])[0].qty, 1);
  // Clamp applies to the summed total, not just a single line.
  assert.equal(
    hr.normalizeItems([{ category: 'Dock', qty: 80 }, { category: 'Dock', qty: 80 }])[0].qty,
    99
  );
});

test('normalizeItems rejects categories outside the allowlist', () => {
  assert.throws(() => hr.normalizeItems([{ category: 'Server' }]), /Invalid equipment category/);
  assert.throws(() => hr.normalizeItems([{ category: '' }]), /Invalid equipment category/);
  assert.throws(() => hr.normalizeItems([{ category: 'laptop' }]), /Invalid equipment category/);
  assert.deepEqual(hr.normalizeItems([]), []);
  assert.deepEqual(hr.normalizeItems(null), []);
});

test('parseDateOnly accepts real calendar dates only', () => {
  assert.equal(hr.parseDateOnly('2026-08-01'), '2026-08-01');
  assert.equal(hr.parseDateOnly('2026-08-01T09:30:00Z'), '2026-08-01', 'timestamps truncate to the date');
  assert.equal(hr.parseDateOnly('2024-02-29'), '2024-02-29', 'leap day is valid');
  for (const bad of ['2026-02-31', '2026-13-01', '2026-00-10', '01-08-2026', 'tomorrow', '', null, undefined]) {
    assert.equal(hr.parseDateOnly(bad), null, 'should reject ' + String(bad));
  }
});

test('toDateString reads a pg DATE without slipping a day west', () => {
  // node-postgres builds DATE as a Date at LOCAL midnight. Constructed the same
  // way here, so this asserts the real shape regardless of the machine's TZ.
  const local = new Date(2026, 7, 1); // 2026-08-01 00:00 local
  assert.equal(hr.toDateString(local), '2026-08-01');
  // The naive implementation this replaced returned the previous day at UTC+3.
  const offsetMin = local.getTimezoneOffset();
  if (offsetMin < 0) {
    assert.equal(local.toISOString().slice(0, 10), '2026-07-31',
      'sanity: toISOString is the buggy path east of UTC');
  }
  assert.equal(hr.toDateString('2026-08-01'), '2026-08-01', 'plain strings pass through');
  assert.equal(hr.toDateString('2026-08-01T00:00:00Z'), '2026-08-01');
  assert.equal(hr.toDateString(null), null);
  assert.equal(hr.toDateString(''), null);
  assert.equal(hr.toDateString(new Date('nope')), null);
});

test('listScopeForUser: IT sees everything, everyone else only their own rows', () => {
  for (const role of ['Owner', 'Admin', 'Helpdesk']) {
    assert.deepEqual(hr.listScopeForUser({ uid: UID_A, role }), {}, role + ' must be unscoped');
  }
  assert.deepEqual(hr.listScopeForUser({ uid: UID_A, role: 'HR' }), { createdBy: UID_A });
  assert.deepEqual(hr.listScopeForUser({ uid: UID_A, role: 'Viewer' }), { createdBy: UID_A });
});

test('listScopeForUser fails closed for an identity with no user id', () => {
  const scope = hr.listScopeForUser({ role: 'HR' });
  assert.ok(scope.createdBy, 'must still carry a scope');
  assert.notEqual(scope.createdBy, UID_A);
  assert.equal(scope.createdBy, '00000000-0000-0000-0000-000000000000');
  // An empty scope would mean "see everything" — the exact failure to avoid.
  assert.notDeepEqual(hr.listScopeForUser({ role: 'HR' }), {});
  assert.notDeepEqual(hr.listScopeForUser(null), {});
  assert.notDeepEqual(hr.listScopeForUser({}), {});
});

test('assertCanSeeRequest blocks cross-tenant ticket reads', () => {
  const mine = { id: 'r1', createdBy: UID_A };
  const theirs = { id: 'r2', createdBy: UID_B };

  assert.doesNotThrow(() => hr.assertCanSeeRequest(mine, { uid: UID_A, role: 'HR' }));
  assert.throws(
    () => hr.assertCanSeeRequest(theirs, { uid: UID_A, role: 'HR' }),
    /Not allowed to view this request/
  );
  // IT reads any ticket.
  assert.doesNotThrow(() => hr.assertCanSeeRequest(theirs, { uid: UID_A, role: 'Helpdesk' }));
  // Unidentified caller reads none.
  assert.throws(() => hr.assertCanSeeRequest(theirs, { role: 'HR' }), /Not allowed/);
  assert.throws(() => hr.assertCanSeeRequest({ id: 'r3', createdBy: null }, { role: 'HR' }), /Not allowed/);
});

test('isStaff only recognises the IT roles', () => {
  assert.equal(hr.isStaff({ role: 'Owner' }), true);
  assert.equal(hr.isStaff({ role: 'Admin' }), true);
  assert.equal(hr.isStaff({ role: 'Helpdesk' }), true);
  assert.equal(hr.isStaff({ role: 'HR' }), false);
  assert.equal(hr.isStaff({ role: 'Viewer' }), false);
  assert.equal(hr.isStaff({ role: 'Portal' }), false);
  assert.equal(hr.isStaff(null), false);
});

test('the equipment allowlist is frozen and free of Network/Server categories', () => {
  assert.ok(Object.isFrozen(hr.EQUIPMENT_CATEGORIES));
  assert.ok(!hr.EQUIPMENT_CATEGORIES.includes('Network'));
  assert.ok(!hr.EQUIPMENT_CATEGORIES.includes('Server'));
});
