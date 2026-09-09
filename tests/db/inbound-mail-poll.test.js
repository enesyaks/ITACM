/**
 * A polled message is never consumed without a trace.
 *
 * Marking \Seen is what consumes a message: unseen mail comes back on the next
 * tick, seen mail never does. So the flag may only be set once the message has a
 * row in inbound_mail_log saying what happened to it. The bug this pins: a mail
 * whose parse threw before it could produce a de-dup key was counted as failed,
 * marked \Seen, and left no row anywhere — from the operator's side the mail
 * simply vanished, and it could not be retried.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

/** Stand-in for the IMAP server: yields the given messages, records the flags. */
function fakeImap(messages) {
  const seen = [];
  class ImapFlow {
    constructor() { this.seen = seen; }
    on() {}
    async connect() {}
    async getMailboxLock() { return { release() {} }; }
    async *fetch() { for (const m of messages) yield m; }
    async messageFlagsAdd(uid) { seen.push(uid); return true; }
    async logout() {}
    async close() {}
  }
  return { ImapFlow, seen };
}

/** Replace a real dependency for the duration of a subtest. */
function stub(name, exports) {
  const id = require.resolve(name);
  const prev = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
  return () => { if (prev) require.cache[id] = prev; else delete require.cache[id]; };
}

test('inbound mail poll', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  // A literal private IP keeps assertImapHostSafe off DNS entirely.
  process.env.SMTP_ALLOW_PRIVATE = '1';
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const inbound = require('../../src/providers/postgres/inboundMailService');

  await query(
    `UPDATE app_settings SET imap_json = $1::jsonb WHERE id = 1`,
    [JSON.stringify({ enabled: true, host: '10.0.0.5', user: 'help@test.local', folder: 'INBOX' })]
  );

  const logRows = () => query('SELECT * FROM inbound_mail_log ORDER BY imap_uid').then((r) => r.rows);

  await t.test('a message whose parse throws is logged, not swallowed', async () => {
    await query('DELETE FROM inbound_mail_log');
    const imap = fakeImap([{ uid: 41, source: Buffer.from('GOOD') }, { uid: 42, source: Buffer.from('BAD') }]);
    const undo = [
      stub('imapflow', imap),
      stub('mailparser', {
        simpleParser: async (src) => {
          if (String(src) === 'BAD') throw new Error('unexpected end of headers');
          return {
            messageId: '<good@test.local>', subject: 'Yazici calismiyor',
            from: { text: 'a@test.local', value: [{ address: 'a@test.local' }] },
            date: new Date(), text: 'Ariza var',
          };
        },
      }),
    ];
    try {
      const res = await inbound.poll();
      assert.equal(res.failed, 1);
      const rows = await logRows();
      assert.equal(rows.length, 2, 'both messages left a row');
      const bad = rows.find((r) => Number(r.imap_uid) === 42);
      assert.equal(bad.status, 'failed');
      assert.match(bad.message_id, /^uid:INBOX:42$/, 'keyed by the mailbox UID when the mail could not identify itself');
      assert.match(bad.reason, /unexpected end of headers/, "the parser's own words are kept");
      assert.deepEqual(imap.seen, [41, 42], 'and both are marked seen, so neither is re-read forever');
    } finally { undo.forEach((f) => f()); }
  });

  await t.test('a message that could not be logged at all stays unread', async () => {
    await query('DELETE FROM inbound_mail_log');
    // A UID no BIGINT column can hold: every write about this message fails, so
    // the poll has nothing to point at — it must leave the mail for the next tick
    // instead of marking it seen.
    const imap = fakeImap([{ uid: 1e30, source: Buffer.from('BAD') }]);
    const undo = [
      stub('imapflow', imap),
      stub('mailparser', { simpleParser: async () => { throw new Error('boom'); } }),
    ];
    try {
      const res = await inbound.poll();
      assert.equal(res.failed, 1);
      assert.deepEqual(await logRows(), [], 'nothing was written');
      assert.deepEqual(imap.seen, [], 'so nothing was consumed either');
    } finally { undo.forEach((f) => f()); }
  });
});
