/**
 * What the poller looks at, and what it refuses to consume without a trace.
 *
 * Two bugs are pinned here, both of which made mail silently produce nothing:
 *
 *  1. The fetch was "every unseen message in the folder". Pointed at a mailbox
 *     with history — a person's own inbox, a shared address in use for years —
 *     the first poll tried to ticket thousands of old messages oldest-first,
 *     never reached today's mail, and started the same crawl on every tick.
 *  2. \Seen was applied unconditionally, so a message whose parse threw before
 *     it could produce a de-dup key was consumed with no row anywhere: no
 *     ticket, no trace, no retry.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

/** Stand-in for the IMAP server: yields the messages, records flags and ranges. */
function fakeImap(messages, box = {}) {
  const seen = [];
  const ranges = [];
  class ImapFlow {
    on() {}
    async connect() {}
    async getMailboxLock() {
      this.mailbox = {
        exists: box.exists != null ? box.exists : messages.length,
        uidNext: box.uidNext != null ? box.uidNext : 1,
        uidValidity: box.uidValidity != null ? box.uidValidity : '900',
      };
      return { release() {} };
    }
    // Deliberately ignores the range: the poller's own guard against a server
    // answering "N:*" with the last message is part of what is under test.
    async *fetch(range) { ranges.push(range); for (const m of messages) yield m; }
    async messageFlagsAdd(uid) { seen.push(uid); return true; }
    async logout() {}
    async close() {}
  }
  return { ImapFlow, seen, ranges };
}

/** Replace a real dependency for the duration of a subtest. */
function stub(name, exports) {
  const id = require.resolve(name);
  const prev = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
  return () => { if (prev) require.cache[id] = prev; else delete require.cache[id]; };
}

const parserThatWorks = {
  simpleParser: async (src) => {
    if (String(src) === 'BAD') throw new Error('unexpected end of headers');
    return {
      messageId: `<${String(src)}@test.local>`, subject: `Konu ${String(src)}`,
      from: { text: 'a@test.local', value: [{ address: 'a@test.local' }] },
      date: new Date(), text: 'Ariza var',
    };
  },
};

test('inbound mail poll', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  // A literal private IP keeps assertImapHostSafe off DNS entirely.
  process.env.SMTP_ALLOW_PRIVATE = '1';
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const inbound = require('../../src/providers/postgres/inboundMailService');

  const configure = (extra = {}) => query(
    'UPDATE app_settings SET imap_json = $1::jsonb WHERE id = 1',
    [JSON.stringify({
      enabled: true, host: '10.0.0.5', user: 'help@test.local', folder: 'INBOX', ...extra,
    })]
  );
  const watchAt = (uid) => configure({ watch: { folder: 'INBOX', uidValidity: '900', uid } });
  const logRows = () => query('SELECT * FROM inbound_mail_log ORDER BY imap_uid').then((r) => r.rows);
  const savedWatch = async () => (await query("SELECT imap_json->'watch' AS w FROM app_settings WHERE id = 1")).rows[0].w;

  const msg = (uid, src) => ({ uid, source: Buffer.from(src || `m${uid}`) });

  await t.test('a mailbox with history is adopted, not ticketed', async () => {
    await query('DELETE FROM inbound_mail_log');
    await configure();
    const imap = fakeImap([msg(9001), msg(9002)], { exists: 7352, uidNext: 42048 });
    const undo = [stub('imapflow', imap), stub('mailparser', parserThatWorks)];
    try {
      const res = await inbound.poll();
      assert.deepEqual(res.adopted, { folder: 'INBOX', fromUid: 42047, existing: 7352 });
      assert.equal(res.created, 0);
      assert.deepEqual(await logRows(), [], 'not one of the 7352 existing messages was touched');
      assert.deepEqual(imap.ranges, [], 'and nothing was even fetched');
      assert.equal(Number((await savedWatch()).uid), 42047);
    } finally { undo.forEach((f) => f()); }
  });

  await t.test('the next poll reads only above the mark', async () => {
    await query('DELETE FROM inbound_mail_log');
    await watchAt(42047);
    // The server answers the range with an old message as well as the new one —
    // "42048:*" matches the last message even when nothing is that new.
    const imap = fakeImap([msg(9002), msg(42048)], { exists: 7353, uidNext: 42049 });
    const undo = [stub('imapflow', imap), stub('mailparser', parserThatWorks)];
    try {
      const res = await inbound.poll();
      assert.deepEqual(imap.ranges, [{ uid: '42048:*' }], 'the fetch is scoped to what is new');
      assert.equal(res.created, 1);
      const rows = await logRows();
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0].imap_uid), 42048, 'the message below the mark was left alone');
      assert.deepEqual(imap.seen, [42048]);
      assert.equal(Number((await savedWatch()).uid), 42048, 'the mark advanced');
    } finally { undo.forEach((f) => f()); }
  });

  await t.test('one tick cannot run away: the rest waits for the next', async () => {
    await query('DELETE FROM inbound_mail_log');
    await watchAt(100);
    const many = Array.from({ length: 40 }, (_, i) => msg(101 + i));
    const imap = fakeImap(many, { exists: 40, uidNext: 141 });
    const undo = [stub('imapflow', imap), stub('mailparser', parserThatWorks)];
    try {
      const res = await inbound.poll();
      assert.equal(res.capped, true);
      assert.equal(res.created, 25, 'capped at MAX_PER_POLL');
      assert.equal(Number((await savedWatch()).uid), 125, 'the mark stops where the work stopped');
    } finally { undo.forEach((f) => f()); }
  });

  await t.test('a message whose parse throws is logged, not swallowed', async () => {
    await query('DELETE FROM inbound_mail_log');
    await watchAt(40);
    const imap = fakeImap([msg(41), msg(42, 'BAD')], { exists: 2, uidNext: 43 });
    const undo = [stub('imapflow', imap), stub('mailparser', parserThatWorks)];
    try {
      const res = await inbound.poll();
      assert.equal(res.failed, 1);
      const rows = await logRows();
      assert.equal(rows.length, 2, 'both messages left a row');
      const bad = rows.find((r) => Number(r.imap_uid) === 42);
      assert.equal(bad.status, 'failed');
      assert.equal(bad.message_id, 'uid:INBOX:42', 'keyed by the mailbox UID when the mail could not identify itself');
      assert.match(bad.reason, /unexpected end of headers/, "the parser's own words are kept");
      assert.deepEqual(imap.seen, [41, 42], 'and both are marked seen, so neither is re-read forever');
      assert.equal(Number((await savedWatch()).uid), 42);
    } finally { undo.forEach((f) => f()); }
  });

  await t.test('a message that could not be logged at all stays put', async () => {
    await query('DELETE FROM inbound_mail_log');
    await watchAt(0);
    // A UID no BIGINT column can hold: every write about this message fails, so
    // the poll has nothing to point at — it must leave the mail for the next
    // tick instead of marking it seen and stepping the mark over it.
    const imap = fakeImap([msg(1e30, 'BAD')], { exists: 1, uidNext: 2 });
    const undo = [stub('imapflow', imap), stub('mailparser', parserThatWorks)];
    try {
      const res = await inbound.poll();
      assert.equal(res.failed, 1);
      assert.deepEqual(await logRows(), [], 'nothing was written');
      assert.deepEqual(imap.seen, [], 'so nothing was consumed either');
      assert.equal(Number((await savedWatch()).uid), 0, 'and the mark did not move past it');
    } finally { undo.forEach((f) => f()); }
  });

  await t.test('a renumbered mailbox is re-adopted rather than replayed', async () => {
    await query('DELETE FROM inbound_mail_log');
    await watchAt(42047);
    // UIDVALIDITY changed: those UIDs now mean different messages.
    const imap = fakeImap([msg(3), msg(4)], { exists: 12, uidNext: 13, uidValidity: '901' });
    const undo = [stub('imapflow', imap), stub('mailparser', parserThatWorks)];
    try {
      const res = await inbound.poll();
      assert.equal(res.adopted.fromUid, 12);
      assert.deepEqual(await logRows(), []);
      assert.equal(Number((await savedWatch()).uid), 12);
    } finally { undo.forEach((f) => f()); }
  });

  await t.test('saving the connection form does not reset the mark', async () => {
    await watchAt(500);
    await inbound.saveConfig({
      enabled: true, host: '10.0.0.5', user: 'help@test.local', folder: 'INBOX', authMethod: 'password',
    });
    assert.equal(Number((await savedWatch()).uid), 500);
  });

  await t.test('but switching folders starts clean', async () => {
    await query('DELETE FROM inbound_mail_log');
    await watchAt(500);
    await inbound.saveConfig({
      enabled: true, host: '10.0.0.5', user: 'help@test.local', folder: 'Support', authMethod: 'password',
    });
    const imap = fakeImap([msg(7)], { exists: 300, uidNext: 301 });
    const undo = [stub('imapflow', imap), stub('mailparser', parserThatWorks)];
    try {
      const res = await inbound.poll();
      assert.equal(res.adopted.folder, 'Support');
      assert.equal(res.adopted.fromUid, 300);
      assert.deepEqual(await logRows(), [], 'the new folder\'s history is history too');
    } finally { undo.forEach((f) => f()); }
  });
});
