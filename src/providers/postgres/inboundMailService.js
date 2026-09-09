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
const { sniffType, safeFilename, MAX_BYTES } = require('../../utils/uploadGuard');

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

/**
 * Record how a claimed message turned out (created / appended / skipped / failed).
 * @returns {Promise<boolean>} whether a row was actually written — the caller
 *   uses that to decide if the message may be marked \Seen.
 */
async function finalizeMail(key, result) {
  const status = (result && result.action) || 'failed';
  const res = await query(
    `UPDATE inbound_mail_log
        SET status = $2, reason = $3, ticket_id = $4, ticket_number = $5, processed_at = now()
      WHERE message_id = $1`,
    [key, status, (result && (result.reason || result.detail)) || null,
      (result && result.ticketId) || null, (result && result.number) || null]
  );
  return res.rowCount > 0;
}

/**
 * How far the poller has read, and why that has to exist.
 *
 * The fetch used to be "every unseen message in the folder", which quietly
 * assumes the mailbox was created for the desk. Point it at a mailbox that has
 * been in use — a person's own inbox, a shared address with history — and the
 * first poll tries to turn thousands of old messages into tickets, oldest
 * first. It never gets far enough to reach today's mail, so the one thing the
 * operator is watching for (the test they just sent) never happens, and every
 * tick starts the same doomed crawl again.
 *
 * So the poller records a high-water mark and only ever looks above it. The
 * first sight of a mailbox sets the mark to what is already there — the past is
 * the past — and each poll advances it. UIDVALIDITY is stored with it: a server
 * that renumbers the mailbox invalidates the mark rather than replaying it
 * against different messages. So is the folder, so switching folders starts
 * clean.
 */
const MAX_PER_POLL = 25;

function watchOf(cfg, folder, uidValidity) {
  const w = cfg && cfg.watch;
  if (!w || w.folder !== folder || String(w.uidValidity || '') !== String(uidValidity || '')) return null;
  const uid = Number(w.uid);
  return Number.isFinite(uid) && uid >= 0 ? uid : null;
}

async function saveWatch(folder, uidValidity, uid) {
  await query(
    `UPDATE app_settings
        SET imap_json = COALESCE(imap_json, '{}'::jsonb) || jsonb_build_object('watch', $1::jsonb)
      WHERE id = 1`,
    [JSON.stringify({ folder, uidValidity: String(uidValidity || ''), uid, at: new Date().toISOString() })]
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
  let oauthSecret = '';
  try { oauthSecret = j.oauthClientSecret ? decryptSecret(j.oauthClientSecret) : ''; } catch { oauthSecret = ''; }
  return {
    enabled: !!j.enabled,
    host: j.host || '',
    port: clampPort(j.port),
    secure: j.secure != null ? !!j.secure : true,
    user: j.user || '',
    pass,
    // How the mailbox authenticates:
    //   'password'        basic auth (the default),
    //   'oauth2_ms'       Microsoft 365 app-only (tenant/client here),
    //   'oauth2_delegated' the "Connect mailbox" flow — credentials live in the
    //                      shared mail-OAuth connection, not in this config.
    authMethod: ['oauth2_ms', 'oauth2_delegated'].includes(j.authMethod) ? j.authMethod : 'password',
    oauthTenant: j.oauthTenant || '',
    oauthClientId: j.oauthClientId || '',
    oauthClientSecret: oauthSecret,
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
    // Where the poller has read up to: { folder, uidValidity, uid }. Server-set,
    // never accepted from the client. See adoptWatch().
    watch: (j.watch && typeof j.watch === 'object') ? j.watch : null,
  };
}

/** Masked view for the UI — password replaced with a marker, never the value. */
async function getConfig() {
  const c = await getConfigRaw();
  return {
    ...c,
    pass: c.pass ? '********' : '', hasPass: !!c.pass,
    oauthClientSecret: c.oauthClientSecret ? '********' : '', hasOauthSecret: !!c.oauthClientSecret,
    authServId: c.authServId || '',
    // Where the poller has read up to, so the screen can say what "no new mail"
    // means rather than leaving the operator to guess.
    watch: c.watch ? { folder: c.watch.folder, uid: Number(c.watch.uid), at: c.watch.at || null } : null,
  };
}

function isBlankOrMasked(p) { return !p || /^\*+$/.test(String(p)); }

async function saveConfig(input = {}) {
  const cur = await getConfigRaw();
  const host = String(input.host || '').trim().slice(0, 200);
  const authMethod = ['oauth2_ms', 'oauth2_delegated'].includes(input.authMethod) ? input.authMethod : 'password';
  // Password auth needs a host; OAuth2 defaults the host to the provider's, so a
  // host is optional there and validated fields are the tenant/client instead.
  if (input.enabled && authMethod === 'password' && !host) {
    throw HttpError.badRequest('IMAP host is required to enable email-to-ticket');
  }
  if (host) await assertImapHostSafe(host);
  // Keep the existing secrets when their field is left blank/masked.
  const nextPass = isBlankOrMasked(input.pass) ? (cur.pass || '') : String(input.pass);
  const nextOauthSecret = isBlankOrMasked(input.oauthClientSecret)
    ? (cur.oauthClientSecret || '') : String(input.oauthClientSecret);
  if (input.enabled && authMethod === 'oauth2_ms') {
    const tenant = String(input.oauthTenant || '').trim();
    const clientId = String(input.oauthClientId || '').trim();
    if (!tenant || !clientId || !nextOauthSecret) {
      throw HttpError.badRequest('Microsoft OAuth2 needs tenant, client ID and client secret');
    }
  }
  const stored = {
    enabled: !!input.enabled,
    host,
    port: clampPort(input.port),
    secure: input.secure != null ? !!input.secure : true,
    user: String(input.user || '').trim().slice(0, 200),
    authMethod,
    oauthTenant: String(input.oauthTenant || '').trim().slice(0, 200),
    oauthClientId: String(input.oauthClientId || '').trim().slice(0, 200),
    oauthClientSecret: nextOauthSecret ? encryptSecret(nextOauthSecret) : null,
    folder: String(input.folder || 'INBOX').trim().slice(0, 120) || 'INBOX',
    defaultType: input.defaultType === 'request' ? 'request' : 'incident',
    defaultCategory: input.defaultCategory ? String(input.defaultCategory).trim().slice(0, 120) : null,
    authServId: input.authServId != null ? String(input.authServId).trim().slice(0, 200) : (cur.authServId || ''),
    // The blocklist has its own endpoint; a save of the connection form must not
    // wipe it just because the form doesn't carry it.
    blocklist: input.blocklist != null ? parseBlocklist(input.blocklist) : cur.blocklist,
    blockBulk: input.blockBulk != null ? !!input.blockBulk : cur.blockBulk,
    // Server-managed, like the blocklist: saving the connection form must not
    // reset where the poller has read up to. A different folder invalidates it
    // on its own — the watermark records which folder it belongs to.
    watch: cur.watch || null,
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
async function buildImapClient(cfg) {
  const { ImapFlow } = require('imapflow');
  const base = {
    logger: false,
    // A short timeout so a bad host fails fast instead of hanging the scheduler.
    socketTimeout: 20000, greetingTimeout: 12000, connectionTimeout: 12000,
  };
  if (cfg.authMethod === 'oauth2_delegated') {
    // The "Connect mailbox" flow — token, host and address come from the shared
    // mail-OAuth connection, not from this config.
    const tok = await require('./mailOAuthService').getDelegatedToken();
    return new ImapFlow({
      ...base, host: tok.imapHost, port: tok.imapPort, secure: true,
      auth: { user: tok.user, accessToken: tok.accessToken },
    });
  }
  if (cfg.authMethod === 'oauth2_ms') {
    const { getMailToken, PROVIDERS } = require('../../utils/mailOAuth');
    const accessToken = await getMailToken({
      provider: 'microsoft', tenant: cfg.oauthTenant,
      clientId: cfg.oauthClientId, clientSecret: cfg.oauthClientSecret,
    });
    return new ImapFlow({
      ...base,
      host: cfg.host || PROVIDERS.microsoft.imapHost,
      port: cfg.port || PROVIDERS.microsoft.imapPort,
      secure: cfg.secure != null ? cfg.secure : true,
      auth: { user: cfg.user, accessToken },
    });
  }
  return new ImapFlow({
    ...base,
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

/**
 * Resolve the config a probe (test / folder listing) should connect with.
 *
 * Shared by both so the guards below cannot drift apart in one copy: the caller
 * may only influence a whitelisted set of fields, OAuth secrets always come from
 * storage, and a stored password is reused ONLY when the destination is
 * unchanged — otherwise the secret could be aimed at a server of the caller's
 * choosing.
 */
async function resolveProbeConfig(overrides = {}) {
  const stored = await getConfigRaw();
  // Whitelist the fields a caller may override — never spread the raw body, and
  // never let a caller-specified destination inherit the stored password.
  const o = overrides || {};
  const reqMethod = o.authMethod != null ? o.authMethod : stored.authMethod;
  const authMethod = ['oauth2_ms', 'oauth2_delegated'].includes(reqMethod) ? reqMethod : 'password';
  const user = o.user != null ? String(o.user).trim() : stored.user;
  const folder = o.folder != null ? String(o.folder).trim().slice(0, 120) || 'INBOX' : stored.folder;

  let cfg;
  if (authMethod === 'oauth2_delegated') {
    // Nothing to gather — the connection supplies the token, host and address.
    cfg = { authMethod, folder };
  } else if (authMethod === 'oauth2_ms') {
    // OAuth2 secrets are never taken from the caller for a test — they always come
    // from what is stored, so a client secret can't be probed against an
    // attacker-chosen tenant. The token is minted by Microsoft, not sent to any
    // caller-specified host, so there's no host-exfiltration concern here.
    cfg = {
      authMethod, user, folder,
      host: o.host != null ? String(o.host).trim() : stored.host,
      port: clampPort(o.port != null ? o.port : stored.port),
      secure: o.secure != null ? !!o.secure : stored.secure,
      oauthTenant: stored.oauthTenant,
      oauthClientId: stored.oauthClientId,
      oauthClientSecret: stored.oauthClientSecret,
    };
    if (cfg.host) await assertImapHostSafe(cfg.host);
    if (!cfg.oauthTenant || !cfg.oauthClientId || !cfg.oauthClientSecret) {
      throw HttpError.badRequest('Save the Microsoft OAuth2 tenant, client ID and secret before testing');
    }
  } else {
    const host = o.host != null ? String(o.host).trim() : stored.host;
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
    cfg = {
      authMethod, host, user, folder, pass,
      port: clampPort(o.port != null ? o.port : stored.port),
      secure: o.secure != null ? !!o.secure : stored.secure,
    };
  }
  return cfg;
}

/** One line describing what a failed probe was aimed at — never any secret. */
function probeTarget(cfg) {
  return [
    `auth: ${cfg.authMethod || 'password'}`,
    `host: ${cfg.host || (cfg.authMethod === 'oauth2_delegated' ? '(connected mailbox)' : '(unset)')}`,
    `user: ${cfg.user || '(from connection)'}`,
    `folder: ${cfg.folder || 'INBOX'}`,
  ].join(' | ');
}

/**
 * The mailbox's own folder list, so the folder can be PICKED rather than typed.
 *
 * Typing it blind is how a working connection still fails: the server rejects an
 * unknown mailbox with the same "Command failed" as a bad credential, and there
 * is nothing on screen to tell the operator which of the two happened.
 */
async function listFolders(overrides = {}) {
  const cfg = await resolveProbeConfig(overrides);
  const client = await buildImapClient(cfg);
  client.on('error', () => {});
  try {
    await client.connect();
    const boxes = await client.list();
    await client.logout();
    // Only what the picker needs. `path` is the value IMAP wants; Gmail's is
    // "[Gmail]/All Mail" while its display name is just "All Mail", so both are
    // carried and the caller decides which to show.
    return {
      folders: (boxes || [])
        .filter((b) => !(b.flags && b.flags.has && b.flags.has('\\Noselect')))
        .map((b) => ({
          path: b.path,
          name: b.name || b.path,
          specialUse: b.specialUse || null,
        })),
    };
  } catch (err) {
    try { await client.close(); } catch { /* ignore */ }
    if (err && err.message) {
      console.warn('[inbound-mail] folder list failed:', err.message, '|', probeTarget(cfg),
        err.responseText ? `| server said: ${err.responseText}` : '');
    }
    throw HttpError.badRequest('Could not read the mailbox folder list');
  }
}

/** Verify the mailbox is reachable and the credentials work. */
async function testConnection(overrides = {}) {
  const cfg = await resolveProbeConfig(overrides);
  const client = await buildImapClient(cfg);
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
    // "Command failed" on its own says nothing: it is what ImapFlow reports for
    // any server-side rejection, and the log did not record which auth method or
    // host produced it — so a token refused by Gmail looked identical to a wrong
    // password against a hand-typed server. None of these are secrets (the
    // password and token are never touched here), and the CALLER still gets the
    // generic message so the endpoint stays useless as a network oracle.
    if (err && err.message) {
      console.warn('[inbound-mail] test failed:', err.message, '|', probeTarget(cfg),
        err.responseText ? `| server said: ${err.responseText}` : '');
    }
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

  // A referenced ticket in the subject ([REQ-1234]/[INC-1234]) — a reply to an
  // existing ticket. Looked up regardless of authentication so we can check who
  // sent it; what we DO with it depends on that check.
  const m = subjectRaw.match(REF_RE);
  let related = null;
  if (m) {
    const number = m[1].toUpperCase();
    related = (await query(
      `SELECT t.id, t.number, e.email AS requester_email, t.assignee_user_id AS assignee_user_id
         FROM tickets t LEFT JOIN employees e ON e.id = t.requester_employee_id
        WHERE upper(t.number) = $1 LIMIT 1`,
      [number]
    )).rows[0] || null;
  }

  // If the message replies to a ticket, append it there instead of opening a new
  // one — but only when the sender can be trusted to be that ticket's requester:
  // the message is DMARC-authenticated, or its From matches the requester's own
  // address. Without that gate anyone could post into any ticket by guessing its
  // number, so an unmatched sender falls through to a new ticket below.
  if (related) {
    const senderIsRequester = !!fromAddr && !!related.requester_email
      && fromAddr.toLowerCase() === String(related.requester_email).toLowerCase();
    if (authenticated || senderIsRequester) {
      return appendEmailReply(related, parsed, { fromName, fromAddr, bodyText, authenticated });
    }
  }

  // Match the sender to a real employee by From: address so ticket notifications
  // reach the person who wrote in — an unmatched ticket notifies nobody, which is
  // what left every inbound request silent.
  //
  // Matching does NOT imply the identity was proven. When the sender is not
  // DMARC-authenticated the From: could be spoofed, so the ticket keeps a visible
  // flag: the desk sees the address was matched, not verified. The attribution
  // only routes notifications; it grants no trust.
  const asEmployee = await employeeByEmail(fromAddr);
  const unverifiedNote = authenticated ? '' : `\n\n— ⚠ Gönderen kimliği doğrulanamadı (${fromAddr}); talep eden e-posta adresiyle eşlendi, doğrulanmadı.`;
  const description = `${related ? `${bodyText}\n\n— İlgili ticket: ${related.number}`.trim() : bodyText}${unverifiedNote}`.trim();
  const created = await ticketService.createTicket(
    { type: conf.defaultType, subject, description, category: conf.defaultCategory || undefined },
    sysUser,
    { asEmployee, source: 'email', senderEmail: fromAddr }
  );
  // Cross-link the referenced ticket only for an authenticated sender: this writes
  // a staff-only note into an enumerable ticket number, so an unauthenticated
  // sender must not be able to drive it.
  if (related && authenticated) {
    await query(
      'INSERT INTO ticket_comments (ticket_id, author_user_id, author_name, body, internal, staff_only) VALUES ($1, NULL, $2, $3, true, true)',
      [related.id, 'E-posta girişi', `${fromName} tarafından ilgili yeni ticket açıldı: ${created.number}`]
    );
    await query('UPDATE tickets SET updated_at = now() WHERE id = $1', [related.id]);
  }
  return { action: 'created', ticketId: created.id, number: created.number, senderAuthenticated: authenticated, requesterMatched: !!asEmployee, relatedTo: related ? related.number : null };
}

/**
 * Append an inbound email as a public reply on an existing ticket, carrying any
 * attachments across. The comment is attributed to the sender (no app user), and
 * only the file types the app accepts anywhere else (PDF/PNG/JPEG/WebP, ≤8MB,
 * verified by magic bytes) are attached — anything else is dropped, never stored.
 */
async function appendEmailReply(ticket, parsed, { fromName, fromAddr, bodyText, authenticated }) {
  const documentService = require('./documentService');
  const note = authenticated ? '' : `\n\n— ⚠ Gönderen doğrulanmadı (${fromAddr}).`;
  const body = `${String(bodyText || '').trim()}${note}`.trim() || '(boş yanıt)';
  const ins = await query(
    'INSERT INTO ticket_comments (ticket_id, author_user_id, author_name, body, internal, staff_only) VALUES ($1, NULL, $2, $3, false, false) RETURNING id',
    [ticket.id, String(fromName || fromAddr || 'E-posta').slice(0, 200), body]
  );
  const commentId = ins.rows[0].id;

  let attached = 0;
  const atts = Array.isArray(parsed && parsed.attachments) ? parsed.attachments : [];
  for (const a of atts) {
    try {
      // Skip inline/related parts — these are signature logos and embedded
      // images, not files the sender meant to attach.
      if (a && (a.related || a.contentDisposition === 'inline')) continue;
      const buf = a && a.content;
      if (!Buffer.isBuffer(buf) || !buf.length || buf.length > MAX_BYTES) continue;
      const mime = sniffType(buf);
      if (!mime) continue; // not an allowed type — drop it, keep the reply
      await documentService.saveTicketDoc({
        ticketId: ticket.id, filename: safeFilename(a.filename, mime.split('/')[1] || 'bin'),
        mime, buffer: buf, uploadedByName: String(fromName || fromAddr || 'E-posta').slice(0, 200),
        internal: false, staffOnly: false, commentId,
      });
      attached++;
    } catch { /* a bad attachment must not lose the reply */ }
  }

  // A requester reply does not satisfy the response SLA, so first_response_at is
  // deliberately left alone — only the ticket's activity time moves.
  await query('UPDATE tickets SET updated_at = now() WHERE id = $1', [ticket.id]);

  // Tell the assignee their requester replied (best-effort, never throws).
  if (ticket.assignee_user_id) {
    try {
      const { rows } = await query('SELECT email FROM users WHERE id = $1', [ticket.assignee_user_id]);
      const to = rows[0] && rows[0].email;
      if (to) {
        require('./notificationService').sendTicketNotification({
          to, ticketNumber: ticket.number, subject: '', event: 'the requester replied',
          actorName: fromName || fromAddr || 'The requester', snippet: body.slice(0, 200),
        }).catch(() => {});
      }
    } catch { /* ignore */ }
  }
  return { action: 'appended', ticketId: ticket.id, number: ticket.number, attached };
}

/**
 * Connect, process what has arrived since the last poll, mark it seen. Bounded
 * by MAX_PER_POLL so one tick cannot run for an hour; anything left over is
 * picked up by the next one. Returns a summary.
 */
async function poll() {
  const cfg = await getConfigRaw();
  // Delegated auth carries host + account in the shared connection, not here.
  // App-only defaults its host to the provider's. Only password auth needs both
  // host and user set locally.
  if (!cfg.enabled) return { skipped: true, reason: 'disabled' };
  if (cfg.authMethod === 'password' && (!cfg.host || !cfg.user)) return { skipped: true, reason: 'disabled' };
  if (cfg.authMethod === 'oauth2_ms' && !cfg.user) return { skipped: true, reason: 'disabled' };
  try { await assertImapHostSafe(cfg.host); }
  catch (err) { return { skipped: true, reason: 'unsafe host: ' + (err.message || 'blocked') }; }
  const { simpleParser } = require('mailparser');
  const client = await buildImapClient(cfg);
  client.on('error', () => {}); // never let an async 'error' event crash the scheduler tick
  const folder = cfg.folder || 'INBOX';
  let created = 0; let appended = 0; let failed = 0; let filtered = 0; let duplicate = 0;
  let handled = 0; let highest = 0; let capped = false;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const box = client.mailbox || {};
      const uidValidity = String(box.uidValidity || '');
      const mark = watchOf(cfg, folder, uidValidity);
      if (mark === null) {
        // First sight of this mailbox. Adopt what is in it as history and start
        // watching from here, rather than ticketing a backlog nobody asked for.
        const from = Math.max(0, Number(box.uidNext || 1) - 1);
        await saveWatch(folder, uidValidity, from);
        await client.logout();
        console.log('[inbound-mail] now watching', folder, `from uid ${from};`,
          `${box.exists || 0} existing message(s) left alone. New mail from now on becomes a ticket.`);
        return { created: 0, appended: 0, failed: 0, filtered: 0, duplicate: 0, adopted: { folder, fromUid: from, existing: box.exists || 0 } };
      }
      // `mark+1:*` and NOT "unseen": above the mark every message is new to the
      // desk whether or not somebody has opened it in the mail client, and the
      // log still guarantees each becomes a ticket at most once. A mail read in
      // Gmail before the tick ran used to vanish silently; it no longer can.
      for await (const msg of client.fetch({ uid: `${mark + 1}:*` }, { uid: true, source: true })) {
        // A UID range whose start is past the end of the mailbox comes back as
        // the LAST message — `*` is the highest UID, and servers normalise the
        // range — so an empty mailbox would re-deliver the newest message on
        // every tick. Anything at or below the mark is not new.
        if (!Number.isFinite(msg.uid) || msg.uid <= mark) continue;
        if (handled >= MAX_PER_POLL) { capped = true; break; }
        handled += 1;
        let key = null;
        // Nothing is consumed until it is recorded. Both the \Seen flag and the
        // high-water mark move only for a message that left a row in
        // inbound_mail_log saying what happened to it — a parse that throws
        // before a key exists, or a database that is down, leaves the mail where
        // it is for the next tick rather than stepping over it silently.
        let recorded = false;
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
            recorded = true;
          } else {
            const r = await createFromEmail(parsed, cfg);
            await finalizeMail(key, r);
            recorded = true;
            if (r.action === 'created') created++;
            else if (r.action === 'appended') appended++;
            else if (r.action === 'skipped' && (r.reason === 'blocked' || r.reason === 'bulk')) filtered++;
          }
        } catch (err) {
          failed++;
          const reason = ('failed: ' + (err && err.message ? err.message : 'parse or create failed')).slice(0, 500);
          console.error('[inbound-mail] message failed:', `uid=${msg.uid}`, reason);
          try {
            // A parse can die before the message is able to identify itself, and
            // the claim itself can fail. Either way fall back to the mailbox's own
            // identifier, so the operator still gets a row to point at — a message
            // that disappears without a trace is the one nobody can debug.
            const logKey = key || `uid:${cfg.folder || 'INBOX'}:${msg.uid}`;
            await claimMail(logKey, msg.uid, '', ''); // no-op when already claimed
            recorded = await finalizeMail(logKey, { action: 'failed', reason });
          } catch { /* leave it unread so the next tick retries it */ }
        }
        if (recorded) {
          // The mark only advances over messages that left a record, so a message
          // the database refused is retried on the next tick instead of being
          // stepped over and lost.
          if (msg.uid > highest) highest = msg.uid;
          try { await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true }); } catch { /* best-effort */ }
        }
      }
      if (highest > mark) await saveWatch(folder, uidValidity, highest);
    } finally { lock.release(); }
    await client.logout();
  } catch (err) {
    // The poll's own failure used to be the one thing it never said out loud:
    // it returned {skipped} and the operator saw a request that succeeded and
    // did nothing.
    console.error('[inbound-mail] poll failed:', err.message,
      `| folder: ${folder} | auth: ${cfg.authMethod}`);
    try { await client.close(); } catch { /* ignore */ }
    return { skipped: true, reason: err.message };
  }
  // A poll that opens nothing is the normal case and the confusing one: it only
  // looks above the high-water mark, and a message is claimed durably the first
  // time it is seen, so "nothing happened" can mean no new mail arrived, it was
  // filtered, or it was handled on an earlier tick. The counters distinguish
  // those and were previously visible nowhere.
  const scanned = created + appended + failed + filtered + duplicate;
  console.log('[inbound-mail] poll:', `scanned=${scanned}`, `created=${created}`,
    `appended=${appended}`, `filtered=${filtered}`, `duplicate=${duplicate}`, `failed=${failed}`,
    `| folder: ${folder} | up to uid ${highest || 'unchanged'}${capped ? ` (capped at ${MAX_PER_POLL}, more waiting)` : ''}`);
  return { created, appended, failed, filtered, duplicate, capped };
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
  const configured = cfg.enabled && (
    cfg.authMethod === 'oauth2_delegated'
    || (cfg.authMethod === 'oauth2_ms' && cfg.user)
    || (cfg.authMethod === 'password' && cfg.host && cfg.user)
  );
  if (!configured) throw HttpError.badRequest('Email-to-ticket is not configured');
  await assertImapHostSafe(cfg.host);
  const { simpleParser } = require('mailparser');
  const client = await buildImapClient(cfg);
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
  getConfig, getConfigRaw, saveConfig, clearConfig, testConnection, listFolders, createFromEmail, poll,
  getBlocklist, saveBlocklist, recentSkips, release, mailKey,
};
