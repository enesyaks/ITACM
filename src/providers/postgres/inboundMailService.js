/**
 * Email-to-ticket (inbound). Polls an IMAP mailbox on a schedule; each unseen
 * message becomes a new ticket, or — when its subject carries an existing ticket
 * number like [REQ-1234] — a reply appended to that ticket. The sender is matched
 * to an employee by email so the ticket is raised on their behalf.
 *
 * Config (app_settings.imap_json) mirrors the SMTP pattern: the password is stored
 * encrypted and never returned to the client. Off unless `enabled` + host are set.
 */
const crypto = require('crypto');
const { query } = require('./pool');
const { encryptSecret, decryptSecret } = require('../../utils/secretCrypto');
const { HttpError } = require('../../utils/httpError');
const { resolveAndAssertPublicHost, smtpAllowsPrivate } = require('../../utils/safeOutbound');
const { parseBlocklist, isBlockedSender, bulkReason } = require('../../utils/mailFilter');

const REF_RE = /\[((?:REQ|INC)-\d+)\]/i;
const SKIP_LOG_MAX = 25;

/**
 * A stable identity for a message, so it is turned into a ticket at most once
 * however the mailbox treats the \Seen flag. The RFC Message-ID is used when
 * present; a message without one (rare, but some scripts omit it) falls back to
 * a hash of the fields that make it unique in practice, so two genuinely
 * different mails never collide and a re-read of the same one always matches.
 */
function mailKey(parsed, uid) {
  const mid = String((parsed && parsed.messageId) || '').trim();
  if (mid) return mid.slice(0, 512);
  const from = (parsed && parsed.from && parsed.from.text) || '';
  const subj = (parsed && parsed.subject) || '';
  const date = (parsed && parsed.date && parsed.date.toISOString && parsed.date.toISOString()) || '';
  const body = String((parsed && parsed.text) || '').slice(0, 400);
  const h = crypto.createHash('sha256').update(`${from}\n${subj}\n${date}\n${body}`).digest('hex');
  return `sha256:${h}:${uid == null ? '' : uid}`;
}

/**
 * Claim a message before processing it. The INSERT ... ON CONFLICT DO NOTHING is
 * atomic, so if two poll ticks ever race the same message only one gets the row
 * back and only that one opens a ticket. A returned row means "you are the first
 * to handle this"; no row means it was already handled and must be left alone.
 */
async function claimMail(key, uid, fromAddr, subject) {
  const { rows } = await query(
    `INSERT INTO inbound_mail_log (message_id, imap_uid, from_addr, subject, status)
     VALUES ($1, $2, $3, $4, 'processing')
     ON CONFLICT (message_id) DO NOTHING
     RETURNING message_id`,
    [key, Number.isFinite(uid) ? uid : null, String(fromAddr || '').slice(0, 320), String(subject || '').slice(0, 500)]
  );
  return rows.length > 0;
}

/** Record how a claimed message turned out (created / appended / skipped / failed). */
async function finalizeMail(key, result) {
  const status = (result && result.action) || 'failed';
  await query(
    `UPDATE inbound_mail_log
        SET status = $2, reason = $3, ticket_id = $4, ticket_number = $5, processed_at = now()
      WHERE message_id = $1`,
    [key, status, (result && (result.reason || result.detail)) || null,
      (result && result.ticketId) || null, (result && result.number) || null]
  );
}

/** Most recent refusals, newest first — for the operator to see why mail was skipped. */
async function recentSkips() {
  const { rows } = await query(
    `SELECT message_id, imap_uid, from_addr, subject, reason, processed_at
       FROM inbound_mail_log
      WHERE status = 'skipped'
      ORDER BY processed_at DESC
      LIMIT $1`,
    [SKIP_LOG_MAX]
  );
  return rows.map((r) => ({
    messageId: r.message_id, uid: r.imap_uid == null ? null : Number(r.imap_uid),
    from: r.from_addr || '', subject: r.subject || '', reason: r.reason || 'skipped',
    at: r.processed_at instanceof Date ? r.processed_at.toISOString() : r.processed_at,
  }));
}

function clampPort(p) { return Math.min(65535, Math.max(1, Number(p) || 993)); }

// Same SSRF guard SMTP uses — an Owner-configured host must not resolve to a
// private/reserved/loopback address (metadata endpoints, internal services).
async function assertImapHostSafe(host) {
  if (!host) return;
  await resolveAndAssertPublicHost(host, { field: 'IMAP host', allowPrivate: smtpAllowsPrivate() });
}

/** Full config with the password decrypted — internal use only. */
async function getConfigRaw() {
  const { rows } = await query('SELECT imap_json FROM app_settings WHERE id = 1');
  const j = (rows[0] && rows[0].imap_json) || {};
  let pass = '';
  try { pass = j.pass ? decryptSecret(j.pass) : ''; } catch { pass = ''; }
  return {
    enabled: !!j.enabled,
    host: j.host || '',
    port: clampPort(j.port),
    secure: j.secure != null ? !!j.secure : true,
    user: j.user || '',
    pass,
    folder: j.folder || 'INBOX',
    defaultType: j.defaultType === 'request' ? 'request' : 'incident',
    defaultCategory: j.defaultCategory || null,
    // Trusted authserv-id (the receiving MTA's identity). Only an
    // Authentication-Results header stamped by THIS id is believed; blank ⇒ no
    // inbound message is ever treated as authenticated (fail-closed).
    authServId: j.authServId || '',
    // Senders whose mail never becomes a ticket: 'a@b.com' or a whole 'b.com'.
    blocklist: parseBlocklist(j.blocklist),
    // Opt-in: also skip newsletters/automated mail, judged by headers alone.
    // Off by default — a support inbox fed by a mailing list would trip it.
    blockBulk: !!j.blockBulk,
  };
}

/** Masked view for the UI — password replaced with a marker, never the value. */
async function getConfig() {
  const c = await getConfigRaw();
  return { ...c, pass: c.pass ? '********' : '', hasPass: !!c.pass, authServId: c.authServId || '' };
}

function isBlankOrMasked(p) { return !p || /^\*+$/.test(String(p)); }

async function saveConfig(input = {}) {
  const cur = await getConfigRaw();
  const host = String(input.host || '').trim().slice(0, 200);
  if (input.enabled && !host) throw HttpError.badRequest('IMAP host is required to enable email-to-ticket');
  if (host) await assertImapHostSafe(host);
  // Keep the existing password when the field is left blank/masked.
  const nextPass = isBlankOrMasked(input.pass) ? (cur.pass || '') : String(input.pass);
  const stored = {
    enabled: !!input.enabled,
    host,
    port: clampPort(input.port),
    secure: input.secure != null ? !!input.secure : true,
    user: String(input.user || '').trim().slice(0, 200),
    folder: String(input.folder || 'INBOX').trim().slice(0, 120) || 'INBOX',
    defaultType: input.defaultType === 'request' ? 'request' : 'incident',
    defaultCategory: input.defaultCategory ? String(input.defaultCategory).trim().slice(0, 120) : null,
    authServId: input.authServId != null ? String(input.authServId).trim().slice(0, 200) : (cur.authServId || ''),
    // The blocklist has its own endpoint; a save of the connection form must not
    // wipe it just because the form doesn't carry it.
    blocklist: input.blocklist != null ? parseBlocklist(input.blocklist) : cur.blocklist,
    blockBulk: input.blockBulk != null ? !!input.blockBulk : cur.blockBulk,
    pass: nextPass ? encryptSecret(nextPass) : null,
  };
  await query('UPDATE app_settings SET imap_json = $1::jsonb WHERE id = 1', [JSON.stringify(stored)]);
  return getConfig();
}

/** Just the filtering rules — read/written on their own, connection untouched. */
async function getBlocklist() {
  const c = await getConfigRaw();
  return { blocklist: c.blocklist, blockBulk: c.blockBulk, recentSkips: await recentSkips() };
}

async function saveBlocklist(input = {}) {
  const cur = await getConfigRaw();
  const { rows } = await query('SELECT imap_json FROM app_settings WHERE id = 1');
  const stored = (rows[0] && rows[0].imap_json) || {};
  stored.blocklist = input.blocklist != null ? parseBlocklist(input.blocklist) : cur.blocklist;
  stored.blockBulk = input.blockBulk != null ? !!input.blockBulk : cur.blockBulk;
  await query('UPDATE app_settings SET imap_json = $1::jsonb WHERE id = 1', [JSON.stringify(stored)]);
  return getBlocklist();
}

async function clearConfig() {
  await query('UPDATE app_settings SET imap_json = NULL WHERE id = 1');
  return getConfig();
}

// Lazily required so the IMAP libs never load unless the feature is used.
function imapClient(cfg) {
  const { ImapFlow } = require('imapflow');
  return new ImapFlow({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass }, logger: false,
    // A short timeout so a bad host fails fast instead of hanging the scheduler.
    socketTimeout: 20000, greetingTimeout: 12000, connectionTimeout: 12000,
  });
}

/** Verify the mailbox is reachable and the credentials work. */
async function testConnection(overrides = {}) {
  const stored = await getConfigRaw();
  // Whitelist the fields a caller may override — never spread the raw body, and
  // never let a caller-specified destination inherit the stored password.
  const o = overrides || {};
  const host = o.host != null ? String(o.host).trim() : stored.host;
  const user = o.user != null ? String(o.user).trim() : stored.user;
  if (!host) throw HttpError.badRequest('Enter IMAP host first');
  await assertImapHostSafe(host);
  // The stored (decrypted) password is reused ONLY when the destination is
  // unchanged. Point the test at a different host or account and you must supply
  // the password in plaintext — otherwise the secret can't be exfiltrated to a
  // server the caller chose.
  const sameTarget = host === stored.host && user === stored.user;
  let pass;
  if (!isBlankOrMasked(o.pass)) pass = String(o.pass);
  else if (sameTarget) pass = stored.pass;
  else throw HttpError.badRequest('Enter the IMAP password to test a different host or account');
  const cfg = {
    host,
    port: clampPort(o.port != null ? o.port : stored.port),
    secure: o.secure != null ? !!o.secure : stored.secure,
    user,
    pass,
    folder: o.folder != null ? String(o.folder).trim().slice(0, 120) || 'INBOX' : stored.folder,
  };
  const client = imapClient(cfg);
  // ImapFlow emits 'error' asynchronously; without a listener an unhandled
  // 'error' event crashes the whole process. Swallow it — connect() rejects too.
  client.on('error', () => {});
  try {
    await client.connect();
    const lock = await client.getMailboxLock(cfg.folder || 'INBOX');
    lock.release();
    await client.logout();
    return { ok: true };
  } catch (err) {
    try { await client.close(); } catch { /* ignore */ }
    // Generic message to the caller — don't turn the endpoint into a network
    // oracle; the detail stays in the server log.
    if (err && err.message) console.warn('[inbound-mail] test failed:', err.message);
    throw HttpError.badRequest('IMAP connection failed');
  }
}

/** Match a From-address to an active employee (raises the ticket on their behalf). */
async function employeeByEmail(email) {
  if (!email) return null;
  const { rows } = await query(
    "SELECT id, full_name FROM employees WHERE lower(email) = lower($1) AND status = 'Active' LIMIT 1",
    [String(email).trim()]
  );
  return rows[0] ? { id: rows[0].id, fullName: rows[0].full_name } : null;
}

/**
 * Is the sender's From address cryptographically authenticated? We trust only
 * what the receiving mail provider stamped in `Authentication-Results`: a
 * `dmarc=pass` proves the visible From domain is aligned and not spoofed. SPF or
 * DKIM alone don't guarantee From-alignment, so they don't count. No header (or
 * no dmarc=pass) ⇒ treated as unauthenticated. This gates whether we attribute a
 * ticket to a real employee and whether we cross-link into an existing ticket,
 * so a forged `From: ceo@company.com` can't open a ticket "as the CEO" or inject
 * a note into an arbitrary (enumerable) ticket number.
 */
function domainOf(addr) {
  const at = String(addr || '').toLowerCase().trim().split('@');
  return at.length === 2 ? at[1].replace(/[>\s]+$/, '') : '';
}

function senderIsAuthenticated(parsed, cfg) {
  // Fail closed unless an Owner has pinned the receiving MTA's authserv-id. Without
  // it we cannot tell the trusted verdict from one the sender forged into the body.
  const authServId = String((cfg && cfg.authServId) || '').toLowerCase().trim();
  if (!authServId) return false;

  const arLines = ((parsed && parsed.headerLines) || [])
    .filter((h) => h && h.key === 'authentication-results')
    .map((h) => String(h.line || ''));
  if (!arLines.length) return false;

  // Only headers actually stamped by our trusted authserv-id count. RFC 7601: the
  // receiving ADMD deletes pre-existing headers bearing ITS id, so any surviving
  // header with our id was written by us — a forged one carries a different id.
  const trusted = arLines.filter((line) => {
    const body = line.replace(/^authentication-results:\s*/i, '');
    const servId = body.split(';', 1)[0].trim().split(/\s+/)[0].toLowerCase();
    return servId === authServId;
  });
  if (!trusted.length) return false;

  const joined = trusted.join(' ; ').toLowerCase();
  if (/\bdmarc=fail\b/.test(joined)) return false;        // a real fail is a hard veto
  const pass = joined.match(/\bdmarc=pass\b/);
  if (!pass) return false;

  // Bind the verdict to the visible From: the AR header.from must equal the From
  // domain exactly (never endsWith — victim.com.attacker.ru must not match).
  const hf = joined.match(/header\.from\s*=\s*"?([^\s;"]+)/);
  const fromAddr = parsed && parsed.from && ((parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) || parsed.from.address || '');
  const fromDomain = domainOf(fromAddr);
  if (!hf || !fromDomain) return false;
  return hf[1].replace(/[>\s]+$/, '') === fromDomain;
}

/**
 * Turn one parsed email into a ticket action. Pure of IMAP — fully unit-testable.
 * `parsed`: { from, subject, text, headerLines }. Returns { action, ticketId, number }.
 *
 * `opts.force` skips the blocklist and bulk filters — used by release(), where an
 * operator has decided a refused message should become a ticket after all.
 */
async function createFromEmail(parsed, cfg, opts = {}) {
  const ticketService = require('./ticketService');
  const conf = cfg || (await getConfigRaw());
  const fromAddr = (parsed && parsed.from && ((parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) || parsed.from.address || parsed.from.text)) || '';
  const fromName = (parsed && parsed.from && ((parsed.from.value && parsed.from.value[0] && parsed.from.value[0].name) || '')) || fromAddr || 'E-posta';
  const subjectRaw = String((parsed && parsed.subject) || '').trim();
  const subject = subjectRaw.replace(/^\s*(re|fwd?|aw|ynt|iletme?):\s*/gi, '').trim() || '(konusuz)';
  const bodyText = String((parsed && parsed.text) || '').trim().slice(0, 8000)
    || (parsed && parsed.html ? '(HTML e-posta)' : '');

  // Filtering, before anything is written. The explicit list wins first — it is
  // a person's stated intent — and the bulk test only runs when switched on.
  // Both merely decline to open a ticket; the reason is returned so the poller
  // can record why. `force` bypasses both, for a deliberate release.
  if (!opts.force && isBlockedSender(fromAddr, conf.blocklist)) {
    return { action: 'skipped', reason: 'blocked', from: fromAddr };
  }
  if (!opts.force && conf.blockBulk) {
    const bulk = bulkReason(parsed);
    if (bulk) {
      return { action: 'skipped', reason: 'bulk', detail: bulk, from: fromAddr };
    }
  }

  // Anti-spoofing gate: only a DMARC-authenticated From (verified against the
  // Owner-pinned authserv-id) is trusted for identity.
  const authenticated = senderIsAuthenticated(parsed, conf);

  // A designated system actor for created_by (the email intake, an Owner/Admin).
  const sys = (await query("SELECT id, username, email FROM users WHERE role IN ('Owner','Admin') ORDER BY role LIMIT 1")).rows[0];
  if (!sys) return { action: 'skipped', reason: 'no system user' };
  const sysUser = { uid: sys.id, username: 'E-posta', email: sys.email };

  // A referenced ticket in the subject ([REQ-1234]/[INC-1234]) → still open a NEW
  // ticket, but cross-reference the two so the link is visible from both sides.
  // Cross-linking is identity-sensitive (writes a staff-only note into ticket N),
  // so it is gated on an authenticated sender to prevent injection into arbitrary
  // enumerable ticket numbers.
  const m = authenticated ? subjectRaw.match(REF_RE) : null;
  let related = null;
  if (m) {
    const number = m[1].toUpperCase();
    const tk = (await query('SELECT id, number FROM tickets WHERE upper(number) = $1 LIMIT 1', [number])).rows[0];
    if (tk) related = tk;
  }

  // Match the sender to a real employee by From: address so ticket notifications
  // reach the person who wrote in — an unmatched ticket notifies nobody, which is
  // what left every inbound request silent.
  //
  // Matching does NOT imply the identity was proven. When the sender is not
  // DMARC-authenticated the From: could be spoofed, so the ticket keeps a visible
  // flag: the desk sees the address was matched, not verified. The attribution
  // only routes notifications; it grants no trust. The identity-sensitive path —
  // cross-linking a note into another ticket — stays gated on `authenticated`
  // above, because that one writes into an enumerable ticket number.
  const asEmployee = await employeeByEmail(fromAddr);
  const unverifiedNote = authenticated ? '' : `\n\n— ⚠ Gönderen kimliği doğrulanamadı (${fromAddr}); talep eden e-posta adresiyle eşlendi, doğrulanmadı.`;
  const description = `${related ? `${bodyText}\n\n— İlgili ticket: ${related.number}`.trim() : bodyText}${unverifiedNote}`.trim();
  const created = await ticketService.createTicket(
    { type: conf.defaultType, subject, description, category: conf.defaultCategory || undefined },
    sysUser,
    { asEmployee, source: 'email', senderEmail: fromAddr }
  );
  if (related) {
    // Note on the referenced ticket pointing at the new one (staff-only), so IT
    // sees they're connected without exposing it to the requester as a comment.
    await query(
      'INSERT INTO ticket_comments (ticket_id, author_user_id, author_name, body, internal, staff_only) VALUES ($1, NULL, $2, $3, true, true)',
      [related.id, 'E-posta girişi', `${fromName} tarafından ilgili yeni ticket açıldı: ${created.number}`]
    );
    await query('UPDATE tickets SET updated_at = now() WHERE id = $1', [related.id]);
  }
  return { action: 'created', ticketId: created.id, number: created.number, senderAuthenticated: authenticated, requesterMatched: !!asEmployee, relatedTo: related ? related.number : null };
}

/** Connect, process every unseen message, mark them seen. Returns a summary. */
async function poll() {
  const cfg = await getConfigRaw();
  if (!cfg.enabled || !cfg.host || !cfg.user) return { skipped: true, reason: 'disabled' };
  try { await assertImapHostSafe(cfg.host); }
  catch (err) { return { skipped: true, reason: 'unsafe host: ' + (err.message || 'blocked') }; }
  const { simpleParser } = require('mailparser');
  const client = imapClient(cfg);
  client.on('error', () => {}); // never let an async 'error' event crash the scheduler tick
  let created = 0; let appended = 0; let failed = 0; let filtered = 0; let duplicate = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(cfg.folder || 'INBOX');
    try {
      for await (const msg of client.fetch({ seen: false }, { uid: true, source: true })) {
        let key = null;
        try {
          const parsed = await simpleParser(msg.source);
          const fromAddr = (parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) || (parsed.from && parsed.from.text) || '';
          key = mailKey(parsed, msg.uid);
          // Durable de-dup: claim the message first. If we do not win the claim it
          // was already handled on an earlier tick — the \Seen flag failing to
          // stick can no longer make it re-open the same ticket.
          const first = await claimMail(key, msg.uid, fromAddr, parsed.subject || '');
          if (!first) {
            duplicate++;
          } else {
            const r = await createFromEmail(parsed, cfg);
            await finalizeMail(key, r);
            if (r.action === 'created') created++;
            else if (r.action === 'appended') appended++;
            else if (r.action === 'skipped' && (r.reason === 'blocked' || r.reason === 'bulk')) filtered++;
          }
        } catch {
          failed++;
          if (key) { try { await finalizeMail(key, { action: 'failed', reason: 'parse or create failed' }); } catch { /* ignore */ } }
        }
        try { await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true }); } catch { /* best-effort */ }
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (err) {
    try { await client.close(); } catch { /* ignore */ }
    return { skipped: true, reason: err.message };
  }
  return { created, appended, failed, filtered, duplicate };
}

/**
 * Turn a previously-skipped message into a ticket after all. Re-fetches it from
 * the mailbox by the UID recorded when it was skipped, then processes it with the
 * filters bypassed. Fails cleanly if the message is gone (UID reused after a
 * UIDVALIDITY change, or the mail deleted) rather than opening a wrong ticket.
 */
async function release(messageId) {
  const id = String(messageId || '').trim();
  if (!id) throw HttpError.badRequest('messageId is required');
  const { rows } = await query(
    "SELECT imap_uid, status FROM inbound_mail_log WHERE message_id = $1", [id]
  );
  const row = rows[0];
  if (!row) throw HttpError.notFound('No such message');
  if (row.status !== 'skipped') throw HttpError.badRequest('This message was not skipped, so there is nothing to release');
  if (row.imap_uid == null) throw HttpError.badRequest('This message has no stored mailbox id and cannot be re-fetched');

  const cfg = await getConfigRaw();
  if (!cfg.enabled || !cfg.host || !cfg.user) throw HttpError.badRequest('Email-to-ticket is not configured');
  await assertImapHostSafe(cfg.host);
  const { simpleParser } = require('mailparser');
  const client = imapClient(cfg);
  client.on('error', () => {});
  let parsed = null;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(cfg.folder || 'INBOX');
    try {
      for await (const msg of client.fetch({ uid: String(row.imap_uid) }, { uid: true, source: true })) {
        parsed = await simpleParser(msg.source);
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (err) {
    try { await client.close(); } catch { /* ignore */ }
    throw HttpError.badGateway('Could not reach the mailbox: ' + (err.message || 'error'));
  }
  if (!parsed) throw HttpError.notFound('The message is no longer in the mailbox');

  const r = await createFromEmail(parsed, cfg, { force: true });
  await finalizeMail(id, r);
  return r;
}

module.exports = {
  getConfig, getConfigRaw, saveConfig, clearConfig, testConnection, createFromEmail, poll,
  getBlocklist, saveBlocklist, recentSkips, release, mailKey,
};
