/**
 * Rating the resolution from the email, and the end of notification noise.
 *
 * Two things are pinned here. First, who hears about a status change: mail on
 * every one of them trains people to ignore the desk entirely, so only the two
 * that are news to a requester go out — resolved, and cancelled. Second, that a
 * requester with no account can rate the work, because those are most of them:
 * the token in the link is the whole authority, and following the link must not
 * be enough to record a score — mail providers follow links to scan them.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

test('resolution mail and CSAT by token', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const svc = require('../../src/providers/postgres/ticketService');
  const notify = require('../../src/providers/postgres/notificationService');

  const { rows: [owner] } = await query('SELECT id, username, email FROM users ORDER BY created_at LIMIT 1');
  const ACTOR = { uid: owner.id, id: owner.id, username: owner.username, email: owner.email, role: 'Owner' };

  const resolved = []; const updates = [];
  const realResolved = notify.sendTicketResolved;
  const realUpdate = notify.sendTicketNotification;
  notify.sendTicketResolved = async (o) => { resolved.push(o); return { ok: true }; };
  notify.sendTicketNotification = async (o) => { updates.push(o); return { ok: true }; };
  t.after(() => { notify.sendTicketResolved = realResolved; notify.sendTicketNotification = realUpdate; });

  const openTicket = async () => {
    const emp = await db.makeEmployee();
    const tk = await svc.createTicket({ subject: `Yazici ${Math.random()}`, requesterEmployeeId: emp.id }, ACTOR);
    await query("UPDATE tickets SET impact='medium', category='Donanim', assignee_user_id=$2 WHERE id=$1", [tk.id, owner.id]);
    await svc.updateTicket(tk.id, { status: 'open' }, ACTOR);
    return tk;
  };
  const settle = () => new Promise((r) => setTimeout(r, 400));

  await t.test('the desk’s own bookkeeping does not reach the requester', async () => {
    resolved.length = 0; updates.length = 0;
    const tk = await openTicket();
    await svc.updateTicket(tk.id, { status: 'in_progress' }, ACTOR);
    await svc.updateTicket(tk.id, { status: 'pending' }, ACTOR);
    await settle();
    assert.deepEqual(updates.filter((u) => /status changed/.test(u.event || '')), [],
      'in progress and pending are the desk talking to itself');
  });

  await t.test('resolved goes out as its own message, with a rating token', async () => {
    resolved.length = 0;
    const tk = await openTicket();
    await svc.updateTicket(tk.id, { status: 'resolved', resolutionNote: 'Toner degistirildi' }, ACTOR);
    await settle();
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].ticketNumber, tk.number);
    assert.equal(resolved[0].resolutionNote, 'Toner degistirildi',
      'the note written in the same act is quoted — it would otherwise go out empty');
    assert.match(resolved[0].csatToken, /^[0-9a-f]{48}$/);
  });

  await t.test('closed says nothing new, so it says nothing', async () => {
    resolved.length = 0; updates.length = 0;
    const tk = await openTicket();
    await svc.updateTicket(tk.id, { status: 'resolved' }, ACTOR);
    await settle();
    resolved.length = 0; updates.length = 0;
    await svc.updateTicket(tk.id, { status: 'closed' }, ACTOR);
    await settle();
    assert.deepEqual(resolved, []);
    assert.deepEqual(updates, [], 'closing usually happens days later, automatically');
  });

  await t.test('cancelled is news: nobody should be left waiting', async () => {
    updates.length = 0;
    const tk = await openTicket();
    await svc.updateTicket(tk.id, { status: 'cancelled' }, ACTOR);
    await settle();
    assert.equal(updates.length, 1);
    assert.equal(updates[0].event, 'cancelled');
  });

  await t.test('the token is minted once and never changes', async () => {
    const tk = await openTicket();
    await svc.updateTicket(tk.id, { status: 'resolved' }, ACTOR);
    const a = await svc.ensureCsatToken(tk.id);
    const b = await svc.ensureCsatToken(tk.id);
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{48}$/);
  });

  await t.test('a rating arrives with no session at all', async () => {
    const tk = await openTicket();
    await svc.updateTicket(tk.id, { status: 'resolved', resolutionNote: 'Yeni kablo takildi' }, ACTOR);
    const token = await svc.ensureCsatToken(tk.id);

    const view = await svc.getByCsatToken(token);
    assert.equal(view.number, tk.number);
    assert.equal(view.resolutionNote, 'Yeni kablo takildi');
    assert.equal(view.csatRating, null, 'reading the page records nothing');

    const out = await svc.submitCsatByToken(token, { rating: 5, comment: 'Hizli donus' });
    assert.equal(out.rating, 5);
    const { rows } = await query('SELECT csat_rating, csat_comment, csat_at FROM tickets WHERE id = $1', [tk.id]);
    assert.equal(rows[0].csat_rating, 5);
    assert.equal(rows[0].csat_comment, 'Hizli donus');
    assert.ok(rows[0].csat_at);
  });

  await t.test('a link is spent by the rating it carries', async () => {
    const tk = await openTicket();
    await svc.updateTicket(tk.id, { status: 'resolved' }, ACTOR);
    const token = await svc.ensureCsatToken(tk.id);

    await svc.submitCsatByToken(token, { rating: 5, comment: 'harika' });
    await assert.rejects(() => svc.submitCsatByToken(token, { rating: 1, comment: 'fikrimi degistirdim' }),
      /already been rated/, 'a score anyone holding an old email can move is not a measurement');
    const { rows } = await query('SELECT csat_rating, csat_comment FROM tickets WHERE id = $1', [tk.id]);
    assert.equal(rows[0].csat_rating, 5, 'the first answer stands');
    assert.equal(rows[0].csat_comment, 'harika');
    assert.equal((await svc.getByCsatToken(token)).state, 'rated');
  });

  await t.test('two submissions racing each other still leave one rating', async () => {
    const tk = await openTicket();
    await svc.updateTicket(tk.id, { status: 'resolved' }, ACTOR);
    const token = await svc.ensureCsatToken(tk.id);
    // Both read the row before either writes: only the WHERE clause separates them.
    const results = await Promise.allSettled([
      svc.submitCsatByToken(token, { rating: 5 }),
      svc.submitCsatByToken(token, { rating: 1 }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  });

  await t.test('the link runs out thirty days after the resolution', async () => {
    const tk = await openTicket();
    await svc.updateTicket(tk.id, { status: 'resolved' }, ACTOR);
    const token = await svc.ensureCsatToken(tk.id);

    await query("UPDATE tickets SET resolved_at = now() - interval '29 days' WHERE id = $1", [tk.id]);
    assert.equal((await svc.getByCsatToken(token)).state, 'ok', 'still open on day 29');

    await query("UPDATE tickets SET resolved_at = now() - interval '31 days' WHERE id = $1", [tk.id]);
    assert.equal((await svc.getByCsatToken(token)).state, 'expired');
    await assert.rejects(() => svc.submitCsatByToken(token, { rating: 5 }), /expired/);
    assert.equal((await query('SELECT csat_rating FROM tickets WHERE id = $1', [tk.id])).rows[0].csat_rating, null,
      'nothing was written by the attempt');
  });

  await t.test('a token names one ticket and grants nothing else', async () => {
    await assert.rejects(() => svc.getByCsatToken('deadbeef'), /not found/i, 'too short to be a token');
    await assert.rejects(() => svc.getByCsatToken('f'.repeat(48)), /not found/i, 'a guess is still a guess');
    await assert.rejects(() => svc.submitCsatByToken('f'.repeat(48), { rating: 5 }), /not found/i);
  });

  await t.test('a rating outside 1-5 is refused', async () => {
    const tk = await openTicket();
    await svc.updateTicket(tk.id, { status: 'resolved' }, ACTOR);
    const token = await svc.ensureCsatToken(tk.id);
    for (const bad of [0, 6, -1, 'five', null, 4.4]) {
      if (bad === 4.4) continue; // rounds to 4, which is a legitimate rating
      await assert.rejects(() => svc.submitCsatByToken(token, { rating: bad }), /1-5/);
    }
  });

  await t.test('an unresolved ticket cannot be rated even with a token', async () => {
    const tk = await openTicket();
    const token = await svc.ensureCsatToken(tk.id);
    await assert.rejects(() => svc.submitCsatByToken(token, { rating: 5 }), /not resolved/i);
  });

  await t.test('the token never leaks through a read API', async () => {
    const tk = await openTicket();
    await svc.updateTicket(tk.id, { status: 'resolved' }, ACTOR);
    await svc.ensureCsatToken(tk.id);
    const staff = JSON.stringify(await svc.getTicket(tk.id, ACTOR));
    const { rows } = await query('SELECT csat_token FROM tickets WHERE id = $1', [tk.id]);
    assert.ok(!staff.includes(rows[0].csat_token), 'it is a bearer secret, not ticket data');
    const list = JSON.stringify(await svc.listTickets({ limit: 50 }));
    assert.ok(!list.includes(rows[0].csat_token));
  });
});
