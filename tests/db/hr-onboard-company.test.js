/**
 * Which entity a new hire is filed under.
 *
 * A holding with subsidiaries hires into one of them, and the answer decides
 * whose logo heads that person's zimmet form. HR names it when the ticket is
 * filed, because the employee record does not exist yet — it is applied when IT
 * acknowledges. A single-company install is never asked and must still end up
 * with the company set rather than a silent null.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

test('hr onboarding company', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const hrSvc = require('../../src/providers/postgres/hrRequestService');

  const { rows: [owner] } = await query('SELECT id, username, email FROM users ORDER BY created_at LIMIT 1');
  const ACTOR = { uid: owner.id, id: owner.id, username: owner.username, email: owner.email, role: 'Owner' };
  const { rows: [def] } = await query('SELECT id, name FROM companies WHERE is_default LIMIT 1');

  let n = 0;
  const file = (extra = {}) => hrSvc.createOnboardRequest({
    fullName: `Yeni Personel ${(n += 1)}`,
    email: `hire${Date.now()}${n}@test.local`,
    eventDate: '2026-10-01',
    items: [{ category: 'Laptop', qty: 1 }],
    ...extra,
  }, ACTOR);

  await t.test('with nothing chosen the ticket lands on the holding company', async () => {
    const req = await file();
    assert.equal(req.companyId, def.id, 'a single-company install is never asked, and must not be left null');
    assert.equal(req.companyName, def.name, 'and the name travels with it, so a reader sees more than a uuid');
  });

  await t.test('a subsidiary can be chosen instead', async () => {
    const sub = await db.makeCompany({ name: `Alt Firma ${Date.now()}` });
    const req = await file({ companyId: sub.id });
    assert.equal(req.companyId, sub.id);
    assert.equal(req.companyName, sub.name);
  });

  await t.test('a dissolved entity cannot be hired into', async () => {
    const gone = await db.makeCompany({ name: `Kapali ${Date.now()}` });
    await query('UPDATE companies SET active = false WHERE id = $1', [gone.id]);
    await assert.rejects(() => file({ companyId: gone.id }), (e) => e.status === 400);
  });

  await t.test('a company id that is nobody is refused, and so is a non-uuid', async () => {
    await assert.rejects(() => file({ companyId: '11111111-1111-1111-1111-111111111111' }),
      (e) => e.status === 400);
    await assert.rejects(() => file({ companyId: 'not-a-uuid' }), (e) => e.status === 400);
  });

  await t.test('the entity reaches the employee record when IT acknowledges', async () => {
    const sub = await db.makeCompany({ name: `Istihdam Eden ${Date.now()}` });
    const req = await file({ companyId: sub.id });

    await hrSvc.acknowledgeRequest(req.id, ACTOR, {});

    const { rows: [emp] } = await query(
      'SELECT company_id FROM employees WHERE lower(email) = $1', [req.email]
    );
    assert.ok(emp, 'the hire became an employee');
    assert.equal(emp.company_id, sub.id, 'filed under the entity HR chose, not the default');
  });

  await t.test('an unasked ticket still leaves the employee with a company', async () => {
    const req = await file();
    await hrSvc.acknowledgeRequest(req.id, ACTOR, {});
    const { rows: [emp] } = await query(
      'SELECT company_id FROM employees WHERE lower(email) = $1', [req.email]
    );
    assert.equal(emp.company_id, def.id, 'nobody hired through HR should belong to no company at all');
  });
});
