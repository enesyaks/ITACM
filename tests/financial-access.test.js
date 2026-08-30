/**
 * Confidential cost fields (`view_confidential`) must be stripped for users who
 * lack the permission — on EVERY resource that carries them, assets included.
 *
 * Regression guard: assets exposed `cost` / `bookValue` / `salvageValue` to a
 * read-only Viewer because the asset routes never called redactCosts, unlike the
 * contract/license/line/maintenance routes. These assert the shared helper strips
 * the whole derived-money set for a role that has no view_confidential, keeps it
 * for a role that does, and refuses a cost WRITE from an unprivileged caller.
 *
 * Run with `npm test` (node --test). Role-only users take the no-group fast path
 * in permissionService, so no database is touched.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { redactCosts, gateCostWrite } = require('../src/utils/financialAccess');

const OWNER = { role: 'Owner', uid: '00000000-0000-0000-0000-000000000001' };
const VIEWER = { role: 'Viewer', uid: '00000000-0000-0000-0000-000000000004' };

const sampleAsset = () => ({
  id: 'a1', assetTag: 'TST-1', brand: 'Dell',
  cost: 42999, purchaseCost: 42999, bookValue: 21000, salvageValue: 5000,
});

test('Owner keeps every asset money field', async () => {
  const out = await redactCosts(OWNER, 'asset', sampleAsset());
  assert.equal(out.cost, 42999);
  assert.equal(out.bookValue, 21000);
  assert.equal(out.salvageValue, 5000);
  assert.notEqual(out.financialRedacted, true);
});

test('Viewer has cost AND its derived money fields stripped', async () => {
  const out = await redactCosts(VIEWER, 'asset', sampleAsset());
  assert.equal(out.cost, null);
  assert.equal(out.purchaseCost, null);
  assert.equal(out.bookValue, null, 'bookValue must not leak the cost back out');
  assert.equal(out.salvageValue, null);
  assert.equal(out.financialRedacted, true);
  assert.equal(out.assetTag, 'TST-1', 'non-money fields stay intact');
});

test('Viewer redaction also applies across a list', async () => {
  const out = await redactCosts(VIEWER, 'asset', [sampleAsset(), sampleAsset()]);
  assert.equal(out.length, 2);
  for (const a of out) { assert.equal(a.cost, null); assert.equal(a.bookValue, null); }
});

test('a Viewer cannot write a cost field (gateCostWrite throws 403)', async () => {
  await assert.rejects(
    () => gateCostWrite(VIEWER, 'asset', { assetTag: 'X', cost: 999 }),
    (err) => err && (err.status === 403 || err.statusCode === 403 || /permission|confidential|forbidden/i.test(err.message)),
  );
});

test('Owner may write a cost field', async () => {
  // Should not throw.
  await gateCostWrite(OWNER, 'asset', { assetTag: 'X', cost: 999 });
});
