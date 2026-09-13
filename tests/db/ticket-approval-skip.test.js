/**
 * A template's approval chain that does not open must say why, on the ticket.
 *
 * In production a desk filed five requests from a template with a manager step
 * and none of them asked anybody: request approvals had been switched off. The
 * tickets looked exactly like tickets that needed no sign-off, and nothing —
 * not the ticket, not the log — said otherwise. The manual "send to approval"
 * path always refused loudly; creation just returned.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

test('ticket approval skip reasons', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const svc = require('../../src/providers/postgres/ticketService');
  const settings = require('../../src/providers/postgres/settingsService');

  const { rows: [owner] } = await query('SELECT id, username, email FROM users ORDER BY created_at LIMIT 1');
  const ACTOR = { uid: owner.id, id: owner.id, username: owner.username, email: owner.email, role: 'Owner' };

  const { rows: [tpl] } = await query(
    `INSERT INTO request_templates (name, approval_levels, enabled)
     VALUES ('Yeni cihaz', '["manager"]'::jsonb, true) RETURNING id`
  );
  const skipsOf = async (id) => (await query(
    "SELECT detail FROM ticket_activity WHERE ticket_id = $1 AND action = 'approval_skipped'", [id]
  )).rows.map((r) => r.detail);

  await t.test('approvals switched off: the ticket says so instead of saying nothing', async () => {
    await settings.saveSettings({ approvals: { enabled: false } });
    const boss = await db.makeEmployee();
    const emp = await db.makeEmployee();
    await query('UPDATE employees SET manager_employee_id = $2 WHERE id = $1', [emp.id, boss.id]);

    const tk = await svc.createTicket({ type: 'request', subject: 'Laptop', templateId: tpl.id, requesterEmployeeId: emp.id }, ACTOR);

    const { rows: [row] } = await query('SELECT approval_request_id FROM tickets WHERE id = $1', [tk.id]);
    assert.equal(row.approval_request_id, null, 'no chain opens while the module is off');
    const skips = await skipsOf(tk.id);
    assert.equal(skips.length, 1, 'but the ticket records that one was not asked for');
    assert.match(skips[0], /switched off/);
  });

  await t.test('approvals on but nobody to ask: the ticket names what is missing', async () => {
    await settings.saveSettings({ approvals: { enabled: true } });
    const orphan = await db.makeEmployee({ department: `Yok-${Date.now()}` }); // no manager, no dept manager
    const tk = await svc.createTicket({ type: 'request', subject: 'Monitor', templateId: tpl.id, requesterEmployeeId: orphan.id }, ACTOR);
    const skips = await skipsOf(tk.id);
    assert.equal(skips.length, 1);
    assert.match(skips[0], /nobody could be resolved/);
  });

  await t.test('approvals on and a manager to ask: a chain opens and nothing is logged as skipped', async () => {
    await settings.saveSettings({ approvals: { enabled: true } });
    const boss = await db.makeEmployee();
    const emp = await db.makeEmployee();
    await query('UPDATE employees SET manager_employee_id = $2 WHERE id = $1', [emp.id, boss.id]);
    const tk = await svc.createTicket({ type: 'request', subject: 'Klavye', templateId: tpl.id, requesterEmployeeId: emp.id }, ACTOR);

    const { rows: [row] } = await query('SELECT approval_request_id FROM tickets WHERE id = $1', [tk.id]);
    assert.ok(row.approval_request_id, 'the chain opened');
    assert.deepEqual(await skipsOf(tk.id), [], 'a working chain leaves no skip note');
  });
});
