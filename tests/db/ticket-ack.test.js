/**
 * The receipt is actually wired to ticket creation — the half tests/ticket-ack
 * cannot see. ackTarget is pure and pinned there; here the question is whether
 * createTicket reaches it at all, on every path a ticket is raised from.
 *
 * sendTicketAck is stubbed: what matters is who it was called for, not SMTP.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

/** The ack is fire-and-forget, so wait for it rather than assuming it landed. */
async function settle(pred, ms = 1500) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return pred();
}

test('ticket acknowledgement', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
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

  const setAckUnknown = (on) => query(
    `UPDATE app_settings SET notify_json = COALESCE(notify_json, '{}'::jsonb) || $1::jsonb WHERE id = 1`,
    [JSON.stringify({ ackUnknownSenders: on })]
  );

  // makeEmployee returns only identity columns; the address is the whole point here.
  const withEmail = async (overrides) => {
    const emp = await db.makeEmployee(overrides);
    const { rows } = await query('SELECT email FROM employees WHERE id = $1', [emp.id]);
    return { ...emp, email: rows[0].email };
  };

  const open = (extra, opts) => ticketService.createTicket(
    { subject: `Yazici ${Date.now()}${Math.random()}`, ...extra }, ACTOR, opts
  );

  await t.test('a requester with an employee record is acknowledged', async () => {
    sent.length = 0;
    const emp = await withEmail();
    const tk = await open({ requesterEmployeeId: emp.id });
    assert.ok(await settle(() => sent.length === 1), 'the receipt was never attempted');
    assert.equal(sent[0].to, emp.email);
    assert.equal(sent[0].ticketId, tk.id);
    assert.equal(sent[0].ticketNumber, tk.number);
    assert.equal(sent[0].priority, tk.priority, 'the priority quoted is the one the ticket ended up with');
  });

  await t.test('mail from an address nobody owns is not answered by default', async () => {
    sent.length = 0;
    await setAckUnknown(false);
    await open({}, { source: 'email', senderEmail: 'outsider@example.com' });
    await new Promise((r) => setTimeout(r, 250));
    assert.deepEqual(sent, []);
  });

  await t.test('…and is answered once the desk switches that on', async () => {
    sent.length = 0;
    await setAckUnknown(true);
    await open({}, { source: 'email', senderEmail: 'outsider@example.com' });
    assert.ok(await settle(() => sent.length === 1), 'the opt-in did not take effect');
    assert.equal(sent[0].to, 'outsider@example.com');
  });

  await t.test('a matched sender is acknowledged at their employee address, not the raw From', async () => {
    sent.length = 0;
    await setAckUnknown(false);
    const emp = await withEmail();
    await open({}, { asEmployee: emp, source: 'email', senderEmail: emp.email });
    assert.ok(await settle(() => sent.length === 1));
    assert.equal(sent[0].to, emp.email);
  });
});
