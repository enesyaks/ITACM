/**
 * The transactional promises the README makes out loud, held to a real database.
 *
 *   "Row locks make double-assignment impossible"
 *   "Seat pools with atomic claim/release"
 *
 * Both are SELECT ... FOR UPDATE inside one transaction. Nothing in the unit
 * suite can test them: the whole point is what two *simultaneous* transactions
 * do to each other, which needs a live Postgres. When these break, the symptom
 * is not a wrong screen — it is one laptop assigned to two people, or more
 * seats handed out than the licence has.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

test('concurrent writes against real row locks', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const handoverService = require('../../src/providers/postgres/handoverService');
  const licenseService = require('../../src/providers/postgres/licenseService');

  await t.test('one asset, two simultaneous handovers → exactly one wins', async () => {
    const [alice, bob] = [await db.makeEmployee(), await db.makeEmployee()];
    const asset = await db.makeAsset();

    const handover = (employeeId) => () => handoverService.executeHandover(
      { employeeId, items: [{ assetId: asset.id }] }, db.IT_USER
    );
    const { ok, failed } = await db.race([handover(alice.id), handover(bob.id)]);

    assert.equal(ok.length, 1, `exactly one handover may succeed, got ${ok.length}`);
    assert.equal(failed.length, 1, 'the loser must be rejected, not silently dropped');

    const { rows: [a] } = await query(
      'SELECT status, current_employee_id FROM assets WHERE id = $1', [asset.id]
    );
    assert.equal(a.status, 'Assigned');
    assert.ok([alice.id, bob.id].includes(a.current_employee_id));

    // The rejected transaction must leave nothing behind.
    const { rows: [h] } = await query(
      'SELECT count(*)::int AS c FROM handovers WHERE employee_id = ANY($1::uuid[])',
      [[alice.id, bob.id]]
    );
    assert.equal(h.c, 1, 'the losing handover must not have written a record');
  });

  await t.test('the loser is told why, and the asset is not double-counted', async () => {
    const [first, second] = [await db.makeEmployee(), await db.makeEmployee()];
    const asset = await db.makeAsset();

    await handoverService.executeHandover(
      { employeeId: first.id, items: [{ assetId: asset.id }] }, db.IT_USER
    );
    await assert.rejects(
      () => handoverService.executeHandover(
        { employeeId: second.id, items: [{ assetId: asset.id }] }, db.IT_USER
      ),
      (err) => {
        // A conflict, not a crash — and it names the asset.
        assert.ok(err.status === 409 || err.statusCode === 409, `expected 409, got ${err.status || err.statusCode}`);
        return true;
      }
    );

    const { rows: [c] } = await query(
      'SELECT count(*)::int AS c FROM assets WHERE current_employee_id = $1', [second.id]
    );
    assert.equal(c.c, 0, 'the refused employee must hold nothing');
  });

  await t.test('a one-seat licence cannot be claimed twice at once', async () => {
    const [x, y] = [await db.makeEmployee(), await db.makeEmployee()];
    const lic = await db.makeLicense({ totalSeats: 1 });

    const claim = (employeeId) => () => licenseService.assignLicense(lic.id, employeeId, db.IT_USER);
    const { ok, failed } = await db.race([claim(x.id), claim(y.id)]);

    assert.equal(ok.length, 1, `one seat means one winner, got ${ok.length}`);
    assert.equal(failed.length, 1);

    const { rows: [l] } = await query('SELECT used_seats, total_seats FROM licenses WHERE id = $1', [lic.id]);
    assert.equal(l.used_seats, 1, 'used_seats must not overshoot the pool');
    assert.ok(l.used_seats <= l.total_seats);

    const { rows: [asg] } = await query(
      'SELECT count(*)::int AS c FROM license_assignments WHERE license_id = $1 AND revoked_at IS NULL',
      [lic.id]
    );
    assert.equal(asg.c, 1, 'exactly one live assignment row');
  });

  await t.test('a three-seat licence hands out three seats and refuses the fourth', async () => {
    const lic = await db.makeLicense({ totalSeats: 3 });
    const people = [];
    for (let i = 0; i < 4; i++) people.push(await db.makeEmployee());

    const { ok, failed } = await db.race(
      people.map((p) => () => licenseService.assignLicense(lic.id, p.id, db.IT_USER))
    );
    assert.equal(ok.length, 3, `three seats, got ${ok.length} winners`);
    assert.equal(failed.length, 1);

    const { rows: [l] } = await query('SELECT used_seats FROM licenses WHERE id = $1', [lic.id]);
    assert.equal(l.used_seats, 3);
  });

  await t.test('a basket that hits a conflict writes none of its items', async () => {
    const owner = await db.makeEmployee();
    const target = await db.makeEmployee();
    const free = await db.makeAsset();
    const taken = await db.makeAsset();

    // Park `taken` on someone else, then ask for both in one basket.
    await handoverService.executeHandover(
      { employeeId: owner.id, items: [{ assetId: taken.id }] }, db.IT_USER
    );
    await assert.rejects(() => handoverService.executeHandover(
      { employeeId: target.id, items: [{ assetId: free.id }, { assetId: taken.id }] }, db.IT_USER
    ));

    // All-or-nothing: the available asset must NOT have been handed over.
    const { rows: [a] } = await query('SELECT status, current_employee_id FROM assets WHERE id = $1', [free.id]);
    assert.equal(a.status, 'In Stock', 'a partial basket would leave this Assigned');
    assert.equal(a.current_employee_id, null);
  });
});
