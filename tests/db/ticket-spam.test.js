/**
 * An advert that got past the filter, closed in one action.
 *
 * The bulk test reads headers only and deliberately so — guessing from words
 * would drop a real request from a supplier — so marketing that bothers to look
 * like a person gets through. What matters here is that closing it leaves NO
 * trace in the response-time figures: the SLA is removed, not met, in either
 * direction. And that blocking the sender is a separate, asked decision, since a
 * wrongly blocked address has its future requests dropped in silence.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

test('closing a ticket as an advert', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  process.env.SMTP_ALLOW_PRIVATE = '1';
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const svc = require('../../src/providers/postgres/ticketService');
  const inbound = require('../../src/providers/postgres/inboundMailService');

  const { rows: [owner] } = await query('SELECT id, username, email FROM users ORDER BY created_at LIMIT 1');
  const ACTOR = { uid: owner.id, id: owner.id, username: owner.username, email: owner.email, role: 'Owner' };

  const fromMail = (addr) => svc.createTicket(
    { subject: `Kampanya ${Date.now()}${Math.random()}`, description: 'Buyuk indirim' },
    ACTOR, { source: 'email', senderEmail: addr }
  );
  const row = async (id) => (await query(
    `SELECT status, resolution_code, category, response_due_at, resolve_due_at,
            response_breached_at, resolve_breached_at, closed_at
       FROM tickets WHERE id = $1`, [id]
  )).rows[0];

  await t.test('the SLA is removed, not met', async () => {
    const tk = await fromMail('campaign@ads.example');
    const before = await row(tk.id);
    assert.ok(before.resolve_due_at, 'it started life as an ordinary ticket with a clock');
    // Pretend the clock had already been breached before anyone looked at it.
    await query('UPDATE tickets SET response_breached_at = now(), resolve_breached_at = now() WHERE id = $1', [tk.id]);

    const out = await svc.markSpam(tk.id, { block: false, category: 'Reklam / toplu posta' }, ACTOR);
    assert.equal(out.status, 'closed');
    const after = await row(tk.id);
    assert.equal(after.resolution_code, 'spam');
    assert.equal(after.category, 'Reklam / toplu posta',
      'the category is replaced, not filled in — junk filed under "Hardware" hides from every report');
    assert.equal(after.response_due_at, null);
    assert.equal(after.resolve_due_at, null);
    assert.equal(after.response_breached_at, null, 'a breach on an advert must not survive into the figures');
    assert.equal(after.resolve_breached_at, null);
    assert.ok(after.closed_at);
  });

  await t.test('a category somebody already chose is replaced, not kept', async () => {
    const tk = await fromMail('five@ads.example');
    await query("UPDATE tickets SET category='Donanim' WHERE id=$1", [tk.id]);
    await svc.markSpam(tk.id, { block: false, category: 'Reklam / toplu posta' }, ACTOR);
    assert.equal((await row(tk.id)).category, 'Reklam / toplu posta');
  });

  await t.test('the sender is only blocked when asked', async () => {
    const a = await fromMail('one@ads.example');
    const out1 = await svc.markSpam(a.id, { block: false }, ACTOR);
    assert.equal(out1.blockedSender, null);
    assert.deepEqual((await inbound.getBlocklist()).blocklist, []);

    const b = await fromMail('Two@Ads.Example');
    const out2 = await svc.markSpam(b.id, { block: true }, ACTOR);
    assert.equal(out2.blockedSender, 'two@ads.example', 'stored lower-case, the way the filter compares');
    assert.deepEqual((await inbound.getBlocklist()).blocklist, ['two@ads.example']);
  });

  await t.test('blocking twice does not double the list', async () => {
    const c = await fromMail('two@ads.example');
    await svc.markSpam(c.id, { block: true }, ACTOR);
    assert.deepEqual((await inbound.getBlocklist()).blocklist, ['two@ads.example']);
  });

  await t.test('a ticket that did not come by email has no sender to block', async () => {
    const emp = await db.makeEmployee();
    const tk = await svc.createTicket({ subject: 'Yazici', requesterEmployeeId: emp.id }, ACTOR);
    const out = await svc.markSpam(tk.id, { block: true }, ACTOR);
    assert.equal(out.blockedSender, null, 'asking to block nothing is not an error');
    assert.equal(out.status, 'closed');
  });

  await t.test('duplicates of an advert go with it', async () => {
    const master = await fromMail('three@ads.example');
    const dup = await fromMail('three@ads.example');
    await svc.linkTickets(master.id, [dup.id], ACTOR);
    await svc.markSpam(master.id, { block: false }, ACTOR);
    assert.equal((await row(dup.id)).status, 'closed');
  });

  await t.test('a ticket that is already finished is refused', async () => {
    const tk = await fromMail('four@ads.example');
    await svc.markSpam(tk.id, { block: false }, ACTOR);
    await assert.rejects(() => svc.markSpam(tk.id, { block: false }, ACTOR), /already closed/);
  });
});
