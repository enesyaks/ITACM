/**
 * Bulk zimmet import: the commit step, against a real database.
 *
 * commit() claims the batch with a single conditional UPDATE precisely so a
 * double-clicked "Attach" — or two open tabs — cannot run the attach loop twice
 * and file every document in duplicate. That claim is a race, so it can only be
 * tested with concurrent transactions.
 *
 * Also covers the staged bytes: a batch holds real PDF content, and every path
 * out of it (attached, skipped, failed) has to clear that content or the
 * database keeps the documents forever.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

// Smallest thing pdf-lib and the archive will both accept as a file body.
const FAKE_PDF = Buffer.from('%PDF-1.4\n% test fixture\n');

test('zimmet import commit', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const zimmet = require('../../src/providers/postgres/zimmetImportService');

  /** Stage a batch the way analyze() would, without going through PDF parsing. */
  async function stageBatch(items) {
    const { rows: [batch] } = await query(
      `INSERT INTO zimmet_import_batches (status, created_by, created_by_name, source_files, item_count)
       VALUES ('pending', $1, $2, '["test.pdf"]'::jsonb, $3) RETURNING id`,
      [db.IT_USER.uid, db.IT_USER.username, items.length]
    );
    for (const [i, it] of items.entries()) {
      await query(
        `INSERT INTO zimmet_import_items
           (batch_id, source_filename, page_from, page_to, page_count, extracted_name,
            matched_employee_id, matched_employee_name, confidence, filename, byte_size, content)
         VALUES ($1,'test.pdf',$2,$2,1,$3,$4,$5,$6,$7,$8,$9)`,
        [batch.id, i, it.name || null, it.employeeId || null, it.name || null,
          it.employeeId ? 'high' : 'none', `form_${i}.pdf`, FAKE_PDF.length, FAKE_PDF]
      );
    }
    return batch.id;
  }

  await t.test('two simultaneous commits attach each form exactly once', async () => {
    const emp = await db.makeEmployee();
    const batchId = await stageBatch([{ employeeId: emp.id, name: emp.full_name }]);

    const { ok, failed } = await db.race([
      () => zimmet.commit(batchId, [], db.IT_USER),
      () => zimmet.commit(batchId, [], db.IT_USER),
    ]);

    assert.equal(ok.length, 1, `only one commit may run the attach loop, got ${ok.length}`);
    assert.equal(failed.length, 1, 'the second must be refused');
    assert.equal(ok[0].attached, 1);

    const { rows: [d] } = await query(
      "SELECT count(*)::int AS c FROM handover_documents WHERE employee_id = $1 AND kind = 'legacy_zimmet'",
      [emp.id]
    );
    assert.equal(d.c, 1, 'a duplicate commit must not file the document twice');
  });

  await t.test('a committed batch cannot be committed again later', async () => {
    const emp = await db.makeEmployee();
    const batchId = await stageBatch([{ employeeId: emp.id, name: emp.full_name }]);

    await zimmet.commit(batchId, [], db.IT_USER);
    await assert.rejects(
      () => zimmet.commit(batchId, [], db.IT_USER),
      (err) => (err.status || err.statusCode) === 409
    );
  });

  await t.test('staged PDF bytes are cleared on every exit path', async () => {
    const emp = await db.makeEmployee();
    // One attaches, one is skipped (no employee chosen), one fails (bad id).
    const batchId = await stageBatch([
      { employeeId: emp.id, name: emp.full_name },
      { employeeId: null, name: 'Nobody Matched' },
      { employeeId: null, name: 'Broken' },
    ]);
    const { rows: items } = await query(
      'SELECT id FROM zimmet_import_items WHERE batch_id = $1 ORDER BY page_from', [batchId]
    );
    const res = await zimmet.commit(batchId, [
      { itemId: items[2].id, employeeId: '00000000-0000-0000-0000-000000000abc' }, // no such employee
    ], db.IT_USER);

    assert.equal(res.attached, 1);
    assert.equal(res.skipped, 1);
    assert.equal(res.failed, 1);

    const { rows } = await query(
      'SELECT status, content FROM zimmet_import_items WHERE batch_id = $1 ORDER BY page_from', [batchId]
    );
    assert.deepEqual(rows.map((r) => r.status), ['attached', 'skipped', 'failed']);
    for (const r of rows) {
      assert.equal(r.content, null, `status "${r.status}" must not keep the staged PDF`);
    }
  });

  await t.test('discard deletes the staged forms outright', async () => {
    const batchId = await stageBatch([{ employeeId: null, name: 'X' }]);
    await zimmet.discard(batchId, db.IT_USER);

    const { rows: [c] } = await query(
      'SELECT count(*)::int AS c FROM zimmet_import_items WHERE batch_id = $1', [batchId]
    );
    assert.equal(c.c, 0);
    const { rows: [b] } = await query('SELECT status FROM zimmet_import_batches WHERE id = $1', [batchId]);
    assert.equal(b.status, 'discarded');
  });

  await t.test('another user cannot read or commit someone else\'s batch', async () => {
    const batchId = await stageBatch([{ employeeId: null, name: 'X' }]);
    const other = { ...db.IT_USER, uid: '00000000-0000-0000-0000-0000000000aa' };

    await assert.rejects(() => zimmet.getBatch(batchId, other), (e) => (e.status || e.statusCode) === 404);
    await assert.rejects(() => zimmet.commit(batchId, [], other), (e) => (e.status || e.statusCode) === 404);
    await assert.rejects(() => zimmet.discard(batchId, other), (e) => (e.status || e.statusCode) === 404);
  });

  await t.test('purgeStale drops abandoned batches but keeps recent ones', async () => {
    const fresh = await stageBatch([{ employeeId: null, name: 'fresh' }]);
    const old = await stageBatch([{ employeeId: null, name: 'old' }]);
    await query("UPDATE zimmet_import_batches SET created_at = now() - interval '48 hours' WHERE id = $1", [old]);

    const res = await zimmet.purgeStale(24);
    assert.ok(res.purgedItems >= 1, 'the 48h-old batch must be swept');

    const { rows: [o] } = await query('SELECT status FROM zimmet_import_batches WHERE id = $1', [old]);
    assert.equal(o.status, 'discarded');
    const { rows: [f] } = await query(
      'SELECT count(*)::int AS c FROM zimmet_import_items WHERE batch_id = $1', [fresh]
    );
    assert.equal(f.c, 1, 'a batch still under review must survive the purge');
  });
});
