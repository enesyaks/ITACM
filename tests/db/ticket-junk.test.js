/**
 * Junk mail is recorded without ever becoming work.
 *
 * Bulk mail reaching a support address had two fates: skipped, leaving nothing
 * to look at, or a normal ticket with a normal SLA clock — so a newsletter
 * counted against the desk's response time and somebody closed it by hand. The
 * third way is a ticket that is shut in the same act that records it.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

test('junk mail', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const ticketService = require('../../src/providers/postgres/ticketService');
  const notify = require('../../src/providers/postgres/notificationService');

  const { rows: [owner] } = await query('SELECT id, username, email FROM users ORDER BY created_at LIMIT 1');
  const ACTOR = { uid: owner.id, id: owner.id, username: owner.username, email: owner.email, role: 'Owner' };

  const sent = [];
  const real = notify.sendTicketAck;
  notify.sendTicketAck = async (opts) => { sent.push(opts); return { ok: true }; };
  t.after(() => { notify.sendTicketAck = real; });

  const tk = await ticketService.createTicket(
    { subject: 'Kampanya: %50 indirim', description: 'Bültenimize abonesiniz' },
    ACTOR,
    { source: 'email', senderEmail: 'campaign@newsletter.example', junk: { reason: 'List-Unsubscribe' } }
  );

  assert.equal(tk.status, 'closed', 'shut in the same act that recorded it');
  assert.equal(tk.resolutionCode, 'spam');
  assert.match(tk.resolutionNote, /List-Unsubscribe/, 'and it says which header gave it away');
  assert.equal(tk.priority, 'low');

  const { rows } = await query(
    'SELECT response_due_at, resolve_due_at, closed_at FROM tickets WHERE id = $1', [tk.id]
  );
  assert.equal(rows[0].response_due_at, null, 'no SLA clock: a newsletter cannot breach');
  assert.equal(rows[0].resolve_due_at, null);
  assert.ok(rows[0].closed_at);

  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(sent, [], 'and nothing is sent back — answering an advert invites more');
});
