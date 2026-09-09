/**
 * Duplicate tickets linked to one master.
 *
 * The same problem arrives twice constantly — someone writes in again after
 * hearing nothing, four people report one dead printer, a mail thread forks.
 * Each was a separate ticket with its own clock, and closing the one that was
 * actually worked left the rest open.
 *
 * What is pinned here: who is offered as a duplicate, the rules that keep the
 * link one hop deep, and the cascade — a follower must close WITH its master,
 * without being dragged through the workflow rules that exist to hold a person
 * to a process.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

test('linked duplicate tickets', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const svc = require('../../src/providers/postgres/ticketService');

  const { rows: [owner] } = await query('SELECT id, username, email FROM users ORDER BY created_at LIMIT 1');
  const ACTOR = { uid: owner.id, id: owner.id, username: owner.username, email: owner.email, role: 'Owner' };

  const open = (extra = {}, opts = {}) => svc.createTicket(
    { subject: `Yazici ${Date.now()}${Math.random()}`, ...extra }, ACTOR, opts
  );
  // Resolving demands a classified, owned ticket — that rule is for people, and
  // the point of the cascade is that followers are exempt from it.
  const classify = (id) => query(
    "UPDATE tickets SET impact='medium', category='Donanim', assignee_user_id=$2 WHERE id=$1",
    [id, owner.id]
  );
  const statusOf = async (id) => (await query('SELECT status FROM tickets WHERE id = $1', [id])).rows[0].status;

  await t.test('the same person writing twice is offered as a duplicate', async () => {
    const emp = await db.makeEmployee();
    const first = await open({ requesterEmployeeId: emp.id });
    const second = await open({ requesterEmployeeId: emp.id });
    const other = await open({ requesterEmployeeId: (await db.makeEmployee()).id });

    const view = await svc.getTicket(first.id, ACTOR);
    const ids = view.duplicateCandidates.map((c) => c.id);
    assert.ok(ids.includes(second.id), "the person's other open ticket is offered");
    assert.ok(!ids.includes(first.id), 'and never the ticket being looked at');
    assert.ok(!ids.includes(other.id), 'nor somebody else’s');
  });

  await t.test('an outsider with no employee record is matched on the address they wrote from', async () => {
    const a = await open({}, { source: 'email', senderEmail: 'Customer@Example.com' });
    const b = await open({}, { source: 'email', senderEmail: 'customer@example.com' });
    await open({}, { source: 'email', senderEmail: 'somebody.else@example.com' });

    const view = await svc.getTicket(a.id, ACTOR);
    assert.deepEqual(view.duplicateCandidates.map((c) => c.id), [b.id],
      'case does not matter, and a different sender is not the same person');
  });

  await t.test('linking leaves both tickets alone apart from the link itself', async () => {
    const emp = await db.makeEmployee();
    const master = await open({ requesterEmployeeId: emp.id });
    const dup = await open({ requesterEmployeeId: emp.id });

    const res = await svc.linkTickets(master.id, [dup.id], ACTOR);
    assert.deepEqual(res.linked.map((x) => x.number), [dup.number]);
    assert.equal(await statusOf(dup.id), 'new', 'a follower is not closed by being linked');

    const child = await svc.getTicket(dup.id, ACTOR);
    assert.equal(child.linkedToNumber, master.number);
    assert.deepEqual(child.duplicateCandidates, [], 'a follower offers no duplicates of its own');
  });

  await t.test('the link stays one hop deep', async () => {
    const emp = await db.makeEmployee();
    const master = await open({ requesterEmployeeId: emp.id });
    const dup = await open({ requesterEmployeeId: emp.id });
    const third = await open({ requesterEmployeeId: emp.id });
    await svc.linkTickets(master.id, [dup.id], ACTOR);

    await assert.rejects(() => svc.linkTickets(dup.id, [third.id], ACTOR),
      /itself linked/, 'a follower cannot become a master');
    await assert.rejects(() => svc.linkTickets(third.id, [master.id], ACTOR),
      /linked to it already/, 'and a master cannot become a follower');
    await assert.rejects(() => svc.linkTickets(master.id, [master.id], ACTOR),
      /cannot be linked to itself/);
  });

  await t.test('closing the master closes what follows it', async () => {
    const emp = await db.makeEmployee();
    const master = await open({ requesterEmployeeId: emp.id });
    const one = await open({ requesterEmployeeId: emp.id });
    const two = await open({ requesterEmployeeId: emp.id });
    await svc.linkTickets(master.id, [one.id, two.id], ACTOR);

    await classify(master.id);
    await svc.updateTicket(master.id, { status: 'open' }, ACTOR);
    await svc.updateTicket(master.id, { status: 'resolved', resolutionNote: 'Toner degistirildi' }, ACTOR);

    assert.equal(await statusOf(one.id), 'resolved');
    assert.equal(await statusOf(two.id), 'resolved');
    const { rows } = await query('SELECT resolution_note, resolved_at FROM tickets WHERE id = $1', [one.id]);
    assert.equal(rows[0].resolution_note, 'Toner degistirildi', "the master's answer is carried down");
    assert.ok(rows[0].resolved_at, 'and the follower is stamped, not just relabelled');
  });

  await t.test('a follower that was already dealt with is left as it is', async () => {
    const emp = await db.makeEmployee();
    const master = await open({ requesterEmployeeId: emp.id });
    const done = await open({ requesterEmployeeId: emp.id });
    await svc.linkTickets(master.id, [done.id], ACTOR);
    await query("UPDATE tickets SET status='cancelled' WHERE id=$1", [done.id]);

    await classify(master.id);
    await svc.updateTicket(master.id, { status: 'open' }, ACTOR);
    await svc.updateTicket(master.id, { status: 'cancelled' }, ACTOR);
    assert.equal(await statusOf(done.id), 'cancelled');
  });

  await t.test('unlinking detaches without touching the ticket', async () => {
    const emp = await db.makeEmployee();
    const master = await open({ requesterEmployeeId: emp.id });
    const dup = await open({ requesterEmployeeId: emp.id });
    await svc.linkTickets(master.id, [dup.id], ACTOR);
    const res = await svc.unlinkTicket(master.id, dup.id, ACTOR);
    assert.deepEqual(res.linked, []);
    assert.equal(await statusOf(dup.id), 'new');
    await assert.rejects(() => svc.unlinkTicket(master.id, dup.id, ACTOR), /not linked/);
  });

  await t.test('a ticket that is already finished cannot be made to follow one', async () => {
    const emp = await db.makeEmployee();
    const master = await open({ requesterEmployeeId: emp.id });
    const done = await open({ requesterEmployeeId: emp.id });
    await query("UPDATE tickets SET status='closed' WHERE id=$1", [done.id]);
    await assert.rejects(() => svc.linkTickets(master.id, [done.id], ACTOR), /nothing left to link/);
  });
});
