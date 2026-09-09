/**
 * Who a ticket mail reaches, and where their answer comes back to.
 *
 * Two bugs, both of which made the mail loop look broken to the person using it:
 *
 *  1. A staff member who is also the requester — they raise a ticket for their
 *     own laptop and then work it — got their own reply back as email. A mail
 *     that quotes you to yourself reads as a bug, because it is one.
 *  2. Outbound and inbound need not be the same mailbox, and in production they
 *     were not: mail went out from an iCloud account while the poller read a
 *     Gmail one. The requester's reply went to the sending account, which
 *     nothing polls, so from the desk's side the requester never answered.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

test('ticket notifications', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  // A literal private IP keeps assertImapHostSafe off DNS entirely.
  process.env.SMTP_ALLOW_PRIVATE = '1';
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const svc = require('../../src/providers/postgres/ticketService');
  const notify = require('../../src/providers/postgres/notificationService');
  const inbound = require('../../src/providers/postgres/inboundMailService');

  const { rows: [owner] } = await query('SELECT id, username, email FROM users ORDER BY created_at LIMIT 1');
  const ACTOR = { uid: owner.id, id: owner.id, username: owner.username, email: owner.email, role: 'Owner' };

  const replies = [];
  const realReply = notify.sendTicketReply;
  notify.sendTicketReply = async (o) => { replies.push(o); return { ok: true }; };
  t.after(() => { notify.sendTicketReply = realReply; });

  await t.test('nobody is mailed their own reply', async () => {
    replies.length = 0;
    // The requester IS the person writing: same address on the employee row.
    const emp = await db.makeEmployee();
    await query('UPDATE employees SET email = $2 WHERE id = $1', [emp.id, owner.email.toUpperCase()]);
    const tk = await svc.createTicket({ subject: 'Kendi laptopum', requesterEmployeeId: emp.id }, ACTOR);

    await svc.addComment(tk.id, { body: 'Kendime not düşüyorum' }, ACTOR);
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(replies, [], 'case does not matter either — it is the same person');
  });

  await t.test('a reply to someone else still goes out', async () => {
    replies.length = 0;
    const emp = await db.makeEmployee();
    const tk = await svc.createTicket({ subject: 'Yazici calismiyor', requesterEmployeeId: emp.id }, ACTOR);
    await svc.addComment(tk.id, { body: 'Toner yolda' }, ACTOR);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(replies.length, 1);
    assert.equal(replies[0].ticketId, tk.id);
  });

  await t.test('an internal note never leaves the building', async () => {
    replies.length = 0;
    const emp = await db.makeEmployee();
    const tk = await svc.createTicket({ subject: 'Sunucu', requesterEmployeeId: emp.id }, ACTOR);
    await svc.addComment(tk.id, { body: 'Sadece ekip icin', internal: true }, ACTOR);
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(replies, []);
  });

  await t.test('the reply waits for the files the client is still uploading', async () => {
    replies.length = 0;
    const emp = await db.makeEmployee();
    const tk = await svc.createTicket({ subject: 'Fatura', requesterEmployeeId: emp.id }, ACTOR);
    // The client posts the comment first and links its files afterwards — it
    // needs the comment's id — so the file lands a moment later.
    setTimeout(() => {
      query(
        `INSERT INTO ticket_documents (ticket_id, comment_id, filename, mime, byte_size, storage_path, internal, staff_only)
         SELECT $1, c.id, 'rapor.pdf', 'application/pdf', 1024, 'x/y.pdf', false, false
           FROM ticket_comments c WHERE c.ticket_id = $1 ORDER BY c.created_at DESC LIMIT 1`, [tk.id]
      ).catch(() => {});
    }, 300);

    await svc.addComment(tk.id, { body: 'Ekte gonderiyorum', attachmentCount: 1 }, ACTOR);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(replies.length, 1);
    assert.deepEqual((replies[0].files || []).map((f) => f.filename), ['rapor.pdf'],
      'otherwise the mail goes out before the file exists and never mentions it');
  });

  await t.test('a staff-only file never travels with a reply to the requester', async () => {
    replies.length = 0;
    const emp = await db.makeEmployee();
    const tk = await svc.createTicket({ subject: 'Gizli', requesterEmployeeId: emp.id }, ACTOR);
    setTimeout(() => {
      query(
        `INSERT INTO ticket_documents (ticket_id, comment_id, filename, mime, byte_size, storage_path, internal, staff_only)
         SELECT $1, c.id, 'ic-not.pdf', 'application/pdf', 1024, 'x/z.pdf', true, true
           FROM ticket_comments c WHERE c.ticket_id = $1 ORDER BY c.created_at DESC LIMIT 1`, [tk.id]
      ).catch(() => {});
    }, 200);
    await svc.addComment(tk.id, { body: 'Bakiyoruz', attachmentCount: 1 }, ACTOR);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(replies.length, 1);
    assert.deepEqual(replies[0].files || [], [], 'it is not the requester\'s to receive');
  });

  await t.test('replies are pointed at the mailbox the poller actually reads', async () => {
    await query('UPDATE app_settings SET imap_json = $1::jsonb WHERE id = 1', [JSON.stringify({
      enabled: true, host: '10.0.0.5', user: 'destek@sirket.com', folder: 'INBOX', authMethod: 'password',
    })]);
    assert.equal(await notify.intakeAddress(), 'destek@sirket.com',
      'without this the answer goes to whatever account sent the mail, and nothing polls that');

    await inbound.saveConfig({ enabled: false, host: '10.0.0.5', user: 'destek@sirket.com', authMethod: 'password' });
    assert.equal(await notify.intakeAddress(), '',
      'no intake, no Reply-To: a header pointing at an unread mailbox is worse than none');
  });
});
