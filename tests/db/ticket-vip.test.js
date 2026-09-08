/**
 * VIP requesters raise a ticket's urgency — but never over an operator's head.
 *
 * The rule has two halves that are easy to get backwards: automated paths (the
 * self-service portal, inbound email, the API) get the raise because nobody
 * chose an urgency there, while a request that arrives WITH an urgency is a
 * human's decision and must survive untouched. These tests pin both.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

test('VIP requester urgency', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const ticketService = require('../../src/providers/postgres/ticketService');

  // createTicket stamps the actor onto requester_user_id / created_by, both FKs
  // to users — so the actor has to be a row that exists, not a synthetic uid.
  const { rows: [owner] } = await query("SELECT id, username, email FROM users ORDER BY created_at LIMIT 1");
  const ACTOR = { uid: owner.id, id: owner.id, username: owner.username, email: owner.email, role: 'Owner' };

  const makeVip = async () => {
    const emp = await db.makeEmployee();
    await query('UPDATE employees SET vip = TRUE WHERE id = $1', [emp.id]);
    return emp;
  };

  const open = (requester, extra = {}) => ticketService.createTicket(
    { subject: `Test ${Date.now()}${Math.random()}`, requesterEmployeeId: requester.id, ...extra },
    ACTOR
  );

  await t.test('an ordinary requester keeps the medium default', async () => {
    const emp = await db.makeEmployee();
    const tk = await open(emp);
    assert.equal(tk.priority, 'medium');
    assert.equal(tk.requesterVip, false);
  });

  await t.test('a VIP with no urgency chosen starts a step higher', async () => {
    const vip = await makeVip();
    const tk = await open(vip);
    assert.equal(tk.urgency, 'high', 'urgency is raised, not the priority directly');
    assert.equal(tk.priority, 'high', 'and the Impact × Urgency matrix carries it through');
    assert.equal(tk.requesterVip, true);
  });

  await t.test('the SLA clock follows the raised priority', async () => {
    // The whole point of raising urgency rather than just badging: a tighter
    // clock. Read the stored due date, not the create response — the clock that
    // the breach sweep actually runs on is the one in the row.
    const vip = await makeVip();
    const plain = await db.makeEmployee();
    const a = await open(vip);
    const b = await open(plain);
    const dueOf = async (id) => {
      const { rows } = await query('SELECT resolve_due_at FROM tickets WHERE id = $1', [id]);
      return rows[0].resolve_due_at;
    };
    const [dueVip, duePlain] = [await dueOf(a.id), await dueOf(b.id)];
    assert.ok(dueVip && duePlain, 'both tickets carry a resolution clock');
    assert.ok(
      new Date(dueVip) < new Date(duePlain),
      `a VIP ticket must be due before an ordinary one (${dueVip} vs ${duePlain})`
    );
  });

  await t.test('an explicitly chosen urgency is never overridden', async () => {
    // The operator dialled a VIP's request down on purpose. Raising it here would
    // silently undo them.
    const vip = await makeVip();
    const tk = await open(vip, { impact: 'low', urgency: 'low' });
    assert.equal(tk.urgency, 'low');
    assert.equal(tk.priority, 'low');
  });

  await t.test('a VIP already at high urgency is not pushed past the ceiling', async () => {
    const vip = await makeVip();
    const tk = await open(vip, { impact: 'high', urgency: 'high' });
    assert.equal(tk.urgency, 'high');
    assert.equal(tk.priority, 'urgent');
  });

  await t.test('clearing the flag stops raising new tickets', async () => {
    const vip = await makeVip();
    await query('UPDATE employees SET vip = FALSE WHERE id = $1', [vip.id]);
    const tk = await open(vip);
    assert.equal(tk.priority, 'medium');
    assert.equal(tk.requesterVip, false);
  });
});
