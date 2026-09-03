'use strict';

/**
 * Active Directory / LDAP directory integration.
 *
 * Two independent halves, each switchable on its own:
 *   1. **Sign-in** — an existing ITACM account authenticates against the
 *      directory instead of its local password.
 *   2. **Sync** — employees (and optionally IT user accounts) are created and
 *      kept up to date from the directory, on a schedule or on demand.
 *
 * Identity is keyed on the directory's immutable object id (objectGUID on AD,
 * entryUUID on OpenLDAP), never on the DN — a person who moves OU or is renamed
 * keeps the same row instead of coming back as a duplicate.
 *
 * Security posture, deliberate choices:
 * - Sign-in is INVITE-ONLY, like OIDC: the directory can verify a password, but
 *   it can never conjure an ITACM account at the login screen. Accounts come
 *   from a sync run (group-mapped) or from an admin, both of which are audited.
 * - Group→role mapping can never grant `Owner`. An Owner is the account that can
 *   hand out Owner; a compromised or mis-scoped AD group must not reach it.
 * - The bind password is encrypted at rest and never returned to the client.
 * - Login names are escaped into the filter (ldapClient.renderFilter), so a
 *   crafted username cannot widen the search.
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('./pool');
const { HttpError } = require('../../utils/httpError');
const { encryptSecret, decryptSecret } = require('../../utils/secretCrypto');
const ldap = require('../../utils/ldapClient');

/* --------------------------------- config --------------------------------- */

// Defaults target Active Directory, which is what most installs point at.
// `userAccountControl:1.2.840.113556.1.4.803:=2` is AD's "account disabled" bit,
// so the default sync filter already skips disabled staff.
const DEFAULTS = Object.freeze({
  enabled: false,
  url: '',
  tlsRejectUnauthorized: true,
  bindDn: '',
  baseDn: '',
  userFilter: '(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))',
  // ITACM signs people in by email, so the default sign-in filter accepts the
  // address in any of the three places AD keeps it, plus the bare login name.
  loginFilter: '(&(objectCategory=person)(objectClass=user)(|(userPrincipalName={{username}})(mail={{username}})(sAMAccountName={{username}})))',
  attrs: Object.freeze({
    guid: 'objectGUID',
    username: 'sAMAccountName',
    email: 'mail',
    displayName: 'displayName',
    department: 'department',
    title: 'title',
    manager: 'manager',
  }),
  loginEnabled: false,
  syncEmployees: true,
  createUsers: false,
  createPortalUsers: false,
  deactivateMissing: false,
  groupRoleMap: Object.freeze([]),
  syncSchedule: 'off', // off | hourly | daily
  syncHour: 3,
});

// Roles a directory group may confer. `Owner` is intentionally absent — see the
// file header. `Portal` is absent too: it is an employee self-service login
// provisioned from the employee record, not an IT operator account.
const MAPPABLE_ROLES = Object.freeze(['Admin', 'Helpdesk', 'Viewer', 'HR']);
const SCHEDULES = Object.freeze(['off', 'hourly', 'daily']);

async function readRaw() {
  try {
    const { rows } = await query('SELECT ldap_json FROM app_settings WHERE id = 1');
    return (rows[0] && rows[0].ldap_json) || {};
  } catch {
    return {};
  }
}

function mergeAttrs(stored) {
  const a = (stored && typeof stored === 'object') ? stored : {};
  const out = {};
  for (const k of Object.keys(DEFAULTS.attrs)) {
    out[k] = String(a[k] || DEFAULTS.attrs[k]).trim() || DEFAULTS.attrs[k];
  }
  return out;
}

function normalizeGroupMap(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  for (const row of list.slice(0, 50)) {
    if (!row || typeof row !== 'object') continue;
    const group = String(row.group || '').trim().slice(0, 400);
    const role = String(row.role || '').trim();
    if (!group) continue;
    if (!MAPPABLE_ROLES.includes(role)) {
      throw HttpError.badRequest(`A directory group can only map to: ${MAPPABLE_ROLES.join(', ')}`);
    }
    out.push({ group, role });
  }
  return out;
}

/** Effective config with the bind password decrypted. Server-side only. */
async function getConfig() {
  const db = await readRaw();
  const cfg = {
    ...DEFAULTS,
    ...db,
    attrs: mergeAttrs(db.attrs),
    groupRoleMap: Array.isArray(db.groupRoleMap) ? db.groupRoleMap : [],
    bindPassword: decryptSecret(db.bindPassword || ''),
  };
  cfg.passwordConfigured = !!cfg.bindPassword;
  cfg.ready = !!(cfg.enabled && cfg.url && cfg.bindDn && cfg.bindPassword && cfg.baseDn);
  return cfg;
}

/** Admin view for the Integrations screen — never carries the bind password. */
async function getForUi() {
  const c = await getConfig();
  const { bindPassword, ...safe } = c;
  return { ...safe, bindPassword: c.passwordConfigured ? '••••••••' : '', lastRun: await lastRun() };
}

function isBlankOrMasked(s) {
  const t = String(s == null ? '' : s).trim();
  return t === '' || /^[•*]+$/.test(t);
}

/**
 * Two sync switches reach past `integration:manage` into other people's
 * resources, so they carry their own permission gate:
 *
 * - `createUsers` provisions IT operator ACCOUNTS. Without this check, a user
 *   holding only `integration:manage` (the group you would hand someone to look
 *   after SMTP and webhooks) could point the integration at a directory they
 *   control, map one of its groups to `Admin`, and sign in as the account the
 *   sync creates — a straight path from "manages integrations" to "is an Admin",
 *   bypassing the 403 they get on POST /api/auth/users.
 * - `deactivateMissing` turns employees off, which is an `employee` write.
 * - `loginEnabled` decides WHO CAN SIGN IN. Whoever can turn it on, while also
 *   choosing the server, can stand up a directory of their own that answers
 *   "yes" to any bind for `owner@company.com` and walk in as that user. That is
 *   an authentication decision, not an integration setting, so it needs the
 *   user-management right as well.
 *
 * The gate is on the value being SAVED, not on the transition, so someone
 * without the right cannot keep an enabled switch while re-pointing the
 * directory underneath it.
 */
async function assertSyncWriteRights(payload, user) {
  if (!user) return; // internal callers (scheduler, tests) act as the system
  const perms = require('./permissionService');
  if (payload.createUsers || payload.createPortalUsers) {
    const ok = await perms.checkPermission(user, 'user_management', 'create')
      || await perms.checkPermission(user, 'user_management', 'manage');
    if (!ok) {
      throw HttpError.forbidden('Creating accounts from the directory needs the user-management permission');
    }
  }
  if (payload.syncEmployees || payload.deactivateMissing) {
    // A sync writes employee rows — names, departments, titles, the manager link
    // the approval chain routes on, and (with deactivateMissing) their status.
    // Pointing the integration at a directory of your own is therefore an
    // employee write, and needs the employee right rather than just the
    // integration one.
    const ok = await perms.checkPermission(user, 'employee', 'update')
      || await perms.checkPermission(user, 'employee', 'manage');
    if (!ok) {
      throw HttpError.forbidden('Syncing employees from the directory needs the employee-update permission');
    }
  }
  if (payload.loginEnabled) {
    const ok = await perms.checkPermission(user, 'user_management', 'manage')
      || await perms.checkPermission(user, 'user_management', 'update');
    if (!ok) {
      throw HttpError.forbidden('Turning on directory sign-in needs the user-management permission');
    }
  }
}

async function saveConfig(input, user = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw HttpError.badRequest('ldap must be an object');
  }
  const cur = await readRaw();
  // Blank / masked password = keep what is already stored, so re-saving the form
  // without retyping the password does not wipe it.
  const curPassword = decryptSecret(cur.bindPassword || '');
  const nextPassword = isBlankOrMasked(input.bindPassword) ? curPassword : String(input.bindPassword).slice(0, 400);

  const url = String(input.url || '').trim().slice(0, 300);
  const bindDn = String(input.bindDn || '').trim().slice(0, 400);
  const baseDn = String(input.baseDn || '').trim().slice(0, 400);
  const enabled = !!input.enabled;
  const schedule = SCHEDULES.includes(input.syncSchedule) ? input.syncSchedule : 'off';

  if (enabled) {
    ldap.assertUrl(url);
    if (!bindDn) throw HttpError.badRequest('A bind DN (service account) is required');
    if (!baseDn) throw HttpError.badRequest('A search base DN is required');
    if (!nextPassword) throw HttpError.badRequest('A bind password is required');
  }
  for (const key of ['userFilter', 'loginFilter']) {
    const f = String(input[key] || '').trim();
    // A filter must be parenthesised; an unbalanced one fails at the server with
    // an opaque error, so catch the obvious case while the admin is still here.
    if (f && !(f.startsWith('(') && f.endsWith(')'))) {
      throw HttpError.badRequest(`${key} must be a parenthesised LDAP filter, e.g. (sAMAccountName={{username}})`);
    }
  }
  const loginFilter = String(input.loginFilter || DEFAULTS.loginFilter).trim();
  if (input.loginEnabled && !/\{\{\s*username\s*\}\}/.test(loginFilter)) {
    throw HttpError.badRequest('The sign-in filter must contain the {{username}} placeholder');
  }

  const payload = {
    enabled,
    url,
    tlsRejectUnauthorized: input.tlsRejectUnauthorized !== false,
    bindDn,
    bindPassword: encryptSecret(nextPassword),
    baseDn,
    userFilter: String(input.userFilter || DEFAULTS.userFilter).trim().slice(0, 600),
    loginFilter: loginFilter.slice(0, 600),
    attrs: mergeAttrs(input.attrs),
    loginEnabled: !!input.loginEnabled,
    syncEmployees: input.syncEmployees !== false,
    createUsers: !!input.createUsers,
    createPortalUsers: !!input.createPortalUsers,
    deactivateMissing: !!input.deactivateMissing,
    groupRoleMap: normalizeGroupMap(input.groupRoleMap),
    syncSchedule: schedule,
    syncHour: Math.max(0, Math.min(23, Math.floor(Number(input.syncHour)) || 0)),
  };
  await assertSyncWriteRights(payload, user);
  await query('UPDATE app_settings SET ldap_json = $1::jsonb WHERE id = 1', [JSON.stringify(payload)]);
  return getForUi();
}

/* ------------------------------ directory reads ---------------------------- */

function personFrom(entry, cfg) {
  const a = cfg.attrs;
  return {
    dn: String(entry.dn || ''),
    guid: ldap.normalizeGuid(entry[a.guid]),
    username: ldap.attr(entry, a.username),
    email: ldap.attr(entry, a.email).trim().toLowerCase(),
    fullName: ldap.attr(entry, a.displayName) || ldap.attr(entry, 'cn'),
    department: ldap.attr(entry, a.department),
    title: ldap.attr(entry, a.title),
    managerDn: ldap.attr(entry, a.manager),
    memberOf: [].concat(entry.memberOf || []).map((d) => String(d)),
  };
}

function personAttributes(cfg) {
  const a = cfg.attrs;
  return [a.guid, a.username, a.email, a.displayName, a.department, a.title, a.manager, 'cn', 'memberOf'];
}

/** Verify the service account can bind and see people. Never writes anything. */
async function testConnection() {
  const cfg = await getConfig();
  if (!cfg.url || !cfg.bindDn || !cfg.bindPassword || !cfg.baseDn) {
    throw HttpError.badRequest('Fill in the URL, bind DN, password and search base first');
  }
  let client = null;
  try {
    client = await ldap.connect(cfg);
    const entries = await ldap.search(client, cfg.baseDn, {
      filter: cfg.userFilter,
      attributes: personAttributes(cfg),
      sizeLimit: 5,
      paged: false,
    });
    const sample = entries.slice(0, 3).map((e) => {
      const p = personFrom(e, cfg);
      return { name: p.fullName, email: p.email, username: p.username, hasGuid: !!p.guid };
    });
    const noEmail = sample.filter((s) => !s.email).length;
    return {
      ok: true,
      bound: true,
      sampleCount: entries.length,
      sample,
      // The two mis-mappings that make a sync quietly do nothing, called out
      // while the admin still has the form open.
      warnings: [
        ...(sample.length && sample.every((s) => !s.hasGuid)
          ? ['No object id came back — check the "unique id" attribute (objectGUID on AD, entryUUID on OpenLDAP).'] : []),
        ...(noEmail === sample.length && sample.length
          ? ['None of the sampled people have an email address — check the email attribute; people without one are skipped.'] : []),
      ],
    };
  } catch (err) {
    throw HttpError.badRequest(ldap.describeError(err));
  } finally {
    await ldap.close(client);
  }
}

/**
 * Verify a username + password against the directory.
 * Returns the directory person on success, or null when the credentials are
 * wrong / the account is not found. Throws only on configuration problems.
 */
async function authenticate(username, password) {
  const cfg = await getConfig();
  if (!cfg.ready || !cfg.loginEnabled) return null;
  const login = String(username || '').trim();
  if (!login || !String(password || '')) return null;

  let client = null;
  try {
    client = await ldap.connect(cfg);
    const entries = await ldap.search(client, cfg.baseDn, {
      filter: ldap.renderFilter(cfg.loginFilter, login),
      attributes: personAttributes(cfg),
      sizeLimit: 2,
      paged: false,
    });
    // More than one hit means the filter is ambiguous; binding as "the first
    // one" would be a coin flip over whose password is being checked.
    if (entries.length !== 1) return null;
    const person = personFrom(entries[0], cfg);
    if (!person.dn) return null;
    await ldap.close(client);
    client = null;
    // Re-bind AS THE USER: this is the actual password check.
    const userClient = await ldap.connect(cfg, { dn: person.dn, password: String(password) });
    await ldap.close(userClient);
    return person;
  } catch (err) {
    // LDAP result 49 (invalidCredentials) covers a wrong password and, on AD,
    // the disabled / locked / expired variants that arrive as `data 52e`,
    // `data 533`, … inside that same code. All of those are a failed login, not
    // a broken integration, so they come back as null rather than a 500.
    // Match on the numeric code, not the message: ldapts renders it as
    // "Code: 0x31 InvalidCredentialsError", which no prose regex catches.
    if (isInvalidCredentials(err)) return null;
    throw err;
  } finally {
    await ldap.close(client);
  }
}

/**
 * A short, stable fingerprint of "which directory is this": the server URL plus
 * the search base, hashed. Stamped on every row a sync touches so deactivation
 * can be scoped to the directory that actually reported the absence — pointing
 * the integration at a second directory must never sweep the first one's people.
 */
function sourceKey(cfg) {
  return crypto.createHash('sha256')
    .update(`${String(cfg.url || '').trim().toLowerCase()}|${String(cfg.baseDn || '').trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

/** True for LDAP result 49 — the family of "your credentials are wrong" answers. */
function isInvalidCredentials(err) {
  if (!err) return false;
  const code = err.code != null ? err.code : err.resultCode;
  if (Number(code) === 49) return true;
  return err.name === 'InvalidCredentialsError';
}

/**
 * Read the mapped groups and collect their members, keyed by member DN.
 *
 * This exists because `memberOf` is not universal: Active Directory always
 * populates it, but OpenLDAP only does when the memberof overlay is enabled,
 * which many installs never turn on. Reading the group objects themselves works
 * on both, and costs one search per mapped group.
 *
 * Caveat worth knowing: `member` is direct membership only, so a person who is
 * in a mapped group *via a nested group* is found through AD's memberOf but not
 * through this fallback.
 */
async function loadGroupMembers(client, cfg) {
  const byDn = new Map(); // lowercased member DN → role
  for (const row of cfg.groupRoleMap) {
    const g = String(row.group || '').trim();
    if (!g || !MAPPABLE_ROLES.includes(row.role)) continue;
    const looksLikeDn = g.includes('=');
    let entries = [];
    try {
      entries = await ldap.search(client, looksLikeDn ? g : cfg.baseDn, {
        scope: looksLikeDn ? 'base' : 'sub',
        filter: looksLikeDn
          ? '(objectClass=*)'
          : `(&(|(objectClass=group)(objectClass=groupOfNames)(objectClass=groupOfUniqueNames))(cn=${ldap.escapeFilter(g)}))`,
        attributes: ['member', 'uniqueMember', 'cn'],
        paged: false,
      });
    } catch { entries = []; } // a missing group must not fail the whole run
    for (const e of entries) {
      const members = [].concat(e.member || [], e.uniqueMember || []).map((m) => String(m).toLowerCase());
      // First mapping in the list wins, so the admin's ordering is the priority.
      for (const m of members) if (!byDn.has(m)) byDn.set(m, row.role);
    }
  }
  return byDn;
}

/**
 * The role a person's group memberships confer, or null for none.
 * `groupMembers` is the fallback index from loadGroupMembers(); memberOf is
 * preferred when the directory supplies it.
 */
function roleForPerson(person, cfg, groupMembers = null) {
  const map = Array.isArray(cfg.groupRoleMap) ? cfg.groupRoleMap : [];
  if (!map.length) return null;
  const groups = (person.memberOf || []).map((g) => g.toLowerCase());
  for (const row of map) {
    const want = String(row.group || '').toLowerCase();
    if (!want) continue;
    // Match either the full DN or just the CN, so an admin can write
    // "IT-Helpdesk" instead of the whole "CN=IT-Helpdesk,OU=Groups,DC=…".
    const hit = groups.some((g) => g === want || g.startsWith(`cn=${want},`));
    if (hit && MAPPABLE_ROLES.includes(row.role)) return row.role;
  }
  if (groupMembers && person.dn) {
    const role = groupMembers.get(String(person.dn).toLowerCase());
    if (role && MAPPABLE_ROLES.includes(role)) return role;
  }
  return null;
}

/* ---------------------------------- sync ----------------------------------- */

/**
 * Guard against the catastrophic case: a filter typo or a half-returned search
 * makes the directory look nearly empty, and "deactivate people who are gone"
 * deactivates the company. Deactivation is skipped (and reported) whenever more
 * than this share of the previously-synced population would be turned off.
 */
const DEACTIVATE_SAFETY_RATIO = 0.3;

async function runSync({ dryRun = false, trigger = 'manual', actorName = null, user = null } = {}) {
  const cfg = await getConfig();
  if (!cfg.ready) throw HttpError.badRequest('The directory integration is not configured or not enabled');
  // Triggering a run performs the same writes as saving the switches, so the
  // person pressing the button is held to the same rights.
  await assertSyncWriteRights(cfg, user);
  if (!cfg.syncEmployees && !cfg.createUsers && !cfg.createPortalUsers) {
    throw HttpError.badRequest('Nothing to sync — enable employee sync or account provisioning');
  }

  const started = new Date();
  const source = sourceKey(cfg);
  const result = {
    dryRun, trigger, created: 0, updated: 0, deactivated: 0, skipped: 0,
    skippedReasons: {}, users: { created: 0, roleChanged: 0, portalCreated: 0, portalDisabled: 0 }, samples: [], warnings: [],
  };
  const skip = (reason) => {
    result.skipped += 1;
    result.skippedReasons[reason] = (result.skippedReasons[reason] || 0) + 1;
  };

  let client = null;
  let people = [];
  try {
    client = await ldap.connect(cfg);
    const entries = await ldap.search(client, cfg.baseDn, {
      filter: cfg.userFilter,
      attributes: personAttributes(cfg),
    });
    people = entries.map((e) => personFrom(e, cfg));
  } catch (err) {
    await recordRun(started, { ...result, error: ldap.describeError(err) }, actorName);
    throw HttpError.badRequest(ldap.describeError(err));
  } finally {
    await ldap.close(client);
  }

  // An empty directory result is never a legitimate reason to change anything.
  if (!people.length) {
    const msg = 'The directory returned no people — check the search base and the sync filter';
    await recordRun(started, { ...result, error: msg }, actorName);
    throw HttpError.badRequest(msg);
  }

  const seenGuids = [];
  const dnToEmployee = new Map(); // directory DN → employee id, for the manager pass

  for (const p of people) {
    if (!p.guid) { skip('noObjectId'); continue; }
    if (!p.email) { skip('noEmail'); continue; }
    if (!p.fullName) { skip('noName'); continue; }
    seenGuids.push(p.guid);

    // Match on the immutable object id first, then adopt an existing row by
    // email — that is how an install with hand-entered employees gets linked up
    // on the first run instead of growing a duplicate of everyone.
    const existing = (await query(
      'SELECT id, full_name, email, department, title, status, ldap_guid FROM employees WHERE ldap_guid = $1 OR (ldap_guid IS NULL AND lower(email) = $2) LIMIT 1',
      [p.guid, p.email]
    )).rows[0];

    if (!existing) {
      if (dryRun) { result.created += 1; if (result.samples.length < 8) result.samples.push({ action: 'create', name: p.fullName, email: p.email }); continue; }
      const ins = await query(
        `INSERT INTO employees (full_name, email, department, title, status, ldap_guid, ldap_dn, ldap_source, ldap_synced_at)
         VALUES ($1,$2,$3,$4,'Active',$5,$6,$7, now()) RETURNING id`,
        [p.fullName, p.email, p.department || null, p.title || null, p.guid, p.dn, source]
      ).catch((err) => {
        // A duplicate email belongs to somebody already linked to a different
        // directory object; report it rather than fail the whole run.
        if (String(err.message || '').includes('employees_email_key')) return null;
        throw err;
      });
      if (!ins || !ins.rows[0]) { skip('emailTaken'); continue; }
      result.created += 1;
      dnToEmployee.set(p.dn.toLowerCase(), ins.rows[0].id);
      if (result.samples.length < 8) result.samples.push({ action: 'create', name: p.fullName, email: p.email });
      continue;
    }

    dnToEmployee.set(p.dn.toLowerCase(), existing.id);
    const changes = [];
    if (existing.full_name !== p.fullName) changes.push('name');
    if (String(existing.department || '') !== String(p.department || '')) changes.push('department');
    if (String(existing.title || '') !== String(p.title || '')) changes.push('title');
    if (!existing.ldap_guid) changes.push('linked');
    // Someone who is back in the directory is no longer a leaver.
    if (existing.status !== 'Active') changes.push('reactivated');

    if (!changes.length) {
      if (!dryRun) await query('UPDATE employees SET ldap_synced_at = now(), ldap_dn = $2, ldap_source = $3 WHERE id = $1', [existing.id, p.dn, source]);
      continue;
    }
    result.updated += 1;
    if (result.samples.length < 8) result.samples.push({ action: 'update', name: p.fullName, email: p.email, changes });
    if (dryRun) continue;
    await query(
      `UPDATE employees SET full_name = $2, department = $3, title = $4, status = 'Active',
              ldap_guid = $5, ldap_dn = $6, ldap_source = $7, ldap_synced_at = now()
         WHERE id = $1`,
      [existing.id, p.fullName, p.department || null, p.title || null, p.guid, p.dn, source]
    );
  }

  // Manager pass — runs second because a manager may have been created in the
  // same run. Feeds the approval chain, which routes on manager_employee_id.
  if (!dryRun) {
    for (const p of people) {
      if (!p.managerDn || !p.guid) continue;
      const selfId = dnToEmployee.get(p.dn.toLowerCase());
      const mgrId = dnToEmployee.get(p.managerDn.toLowerCase());
      if (!selfId || !mgrId || selfId === mgrId) continue;
      await query('UPDATE employees SET manager_employee_id = $2 WHERE id = $1 AND (manager_employee_id IS DISTINCT FROM $2)', [selfId, mgrId]);
    }
  }

  // Rows linked before the source fingerprint existed carry none. When this
  // install has never recorded a fingerprint — or has only ever recorded this
  // one — those rows can only have come from the directory configured now, so
  // stamp them. Without this a person who left before the upgrade is invisible
  // to deactivation forever: they are gone from the directory, so no run can
  // ever reach them to fill the fingerprint in.
  //
  // If a DIFFERENT fingerprint is already on file, the install has talked to
  // more than one directory and a NULL is genuinely ambiguous — those rows stay
  // untouched, which is the whole point of scoping.
  const { rows: knownSources } = await query(
    'SELECT DISTINCT ldap_source AS s FROM employees WHERE ldap_guid IS NOT NULL AND ldap_source IS NOT NULL'
  );
  const claimsUnstamped = knownSources.every((r) => r.s === source);
  if (claimsUnstamped && !dryRun) {
    const { rowCount } = await query(
      'UPDATE employees SET ldap_source = $1 WHERE ldap_guid IS NOT NULL AND ldap_source IS NULL',
      [source]
    );
    if (rowCount) console.log(`[ldap] stamped ${rowCount} pre-existing employee row(s) with this directory's source`);
  }

  // Leavers: previously synced, absent from this run.
  if (cfg.deactivateMissing && seenGuids.length) {
    const { rows: goneRows } = await query(
      `SELECT id, full_name, email FROM employees
        WHERE ldap_guid IS NOT NULL AND status = 'Active'
          AND (ldap_source = $2 OR (ldap_source IS NULL AND $3))
          AND ldap_guid <> ALL($1::text[])`,
      [seenGuids, source, claimsUnstamped]
    );
    const { rows: totalRows } = await query(
      `SELECT count(*)::int AS n FROM employees
        WHERE ldap_guid IS NOT NULL AND status = 'Active'
          AND (ldap_source = $1 OR (ldap_source IS NULL AND $2))`,
      [source, claimsUnstamped]
    );
    const total = (totalRows[0] && totalRows[0].n) || 0;
    const ratio = total ? goneRows.length / total : 0;
    if (goneRows.length && ratio > DEACTIVATE_SAFETY_RATIO) {
      result.warnings.push(
        `Deactivation skipped: ${goneRows.length} of ${total} synced employees are missing from this run (over the ${Math.round(DEACTIVATE_SAFETY_RATIO * 100)}% safety limit). Check the sync filter, then run again.`
      );
    } else if (goneRows.length) {
      result.deactivated = goneRows.length;
      if (!dryRun) {
        await query("UPDATE employees SET status = 'Inactive' WHERE id = ANY($1::uuid[])", [goneRows.map((r) => r.id)]);
        // The portal login goes with the person. Sign-in already fails for them
        // — the directory no longer vouches for the account — but an Active row
        // is a loose end: switch directory sign-in off later, or set a local
        // password on it, and a leaver has a live login again. Staff accounts
        // sharing the address are untouched, as everywhere else here.
        const emails = goneRows.map((r) => String(r.email || '').toLowerCase()).filter(Boolean);
        if (emails.length) {
          const { rowCount } = await query(
            `UPDATE users SET status = 'Disabled', sessions_revoked_at = now()
              WHERE role = 'Portal' AND status <> 'Disabled' AND lower(email) = ANY($1::text[])`,
            [emails]
          );
          if (rowCount) {
            result.users.portalDisabled = rowCount;
            // Who lost access matters more than how many: name them, capped so
            // one bad filter cannot flood the trail.
            const named = emails.slice(0, 20).join(', ');
            auditUser('ldap.portal_disabled',
              `Directory sync disabled ${rowCount} portal login(s) for people no longer in the directory`
              + (named ? ` — ${named}${emails.length > 20 ? ', …' : ''}` : ''),
              actorName);
          }
        }
      }
      for (const g of goneRows.slice(0, 5)) {
        if (result.samples.length < 12) result.samples.push({ action: 'deactivate', name: g.full_name, email: g.email });
      }
    }
  }

  // IT operator accounts from group membership.
  if (cfg.createUsers && cfg.groupRoleMap.length) {
    let groupMembers = null;
    let groupClient = null;
    try {
      groupClient = await ldap.connect(cfg);
      groupMembers = await loadGroupMembers(groupClient, cfg);
    } catch (err) {
      result.warnings.push(`Group membership could not be read: ${ldap.describeError(err)}`);
    } finally {
      await ldap.close(groupClient);
    }
    for (const p of people) {
      if (!p.email || !p.guid) continue;
      const role = roleForPerson(p, cfg, groupMembers);
      if (!role) continue;
      const existing = (await query('SELECT id, role, ldap_guid FROM users WHERE ldap_guid = $1 OR lower(email) = $2 LIMIT 1', [p.guid, p.email])).rows[0];
      if (!existing) {
        result.users.created += 1;
        if (dryRun) continue;
        // No usable local password: LDAP users sign in against the directory.
        // A random hash keeps the NOT NULL column honest and unguessable.
        const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
        const ins = await query(
          `INSERT INTO users (username, email, password_hash, role, status, ldap_guid, ldap_dn)
           VALUES ($1,$2,$3,$4,'Active',$5,$6) ON CONFLICT (email) DO NOTHING`,
          [p.fullName || p.username || p.email, p.email, hash, role, p.guid, p.dn]
        );
        // ON CONFLICT DO NOTHING: only log a row we actually inserted.
        if (ins.rowCount) {
          auditUser('ldap.user_created',
            `Directory sync created the ${role} account ${p.email}`,
            actorName, { email: p.email });
        }
        continue;
      }
      // Never touch an Owner: the directory must not be able to demote the one
      // account that can hand out Owner.
      if (existing.role === 'Owner') continue;
      if (existing.role !== role) {
        result.users.roleChanged += 1;
        if (!dryRun) {
          await query('UPDATE users SET role = $2, ldap_guid = $3, ldap_dn = $4 WHERE id = $1', [existing.id, role, p.guid, p.dn]);
          auditUser('ldap.user_role_changed',
            `Directory sync changed ${p.email} from ${existing.role} to ${role}`,
            actorName, { id: existing.id, email: p.email });
        }
      } else if (!dryRun && !existing.ldap_guid) {
        await query('UPDATE users SET ldap_guid = $2, ldap_dn = $3 WHERE id = $1', [existing.id, p.guid, p.dn]);
      }
    }
  }

  // Self-service (Portal) logins for the people just synced. This is what lets a
  // directory-provisioned employee sign in at all: directory sign-in is
  // invite-only, so without a `users` row there is nothing for it to
  // authenticate against and the person is stuck until an admin grants access
  // by hand.
  //
  // The account carries no password of its own — a random, never-disclosed hash
  // satisfies the NOT NULL column while the person signs in with their AD
  // password — and `must_change_password` stays off, which would otherwise trap
  // them on a "set a new password" screen they cannot clear with credentials
  // the app does not own.
  if (cfg.createPortalUsers) {
    if (!cfg.loginEnabled) {
      result.warnings.push('Portal logins were created, but directory sign-in is off — nobody can use them until you turn it on.');
    }
    for (const p of people) {
      if (!p.email || !p.guid) continue;
      const existing = (await query(
        'SELECT id, role, ldap_guid FROM users WHERE lower(email) = $1 LIMIT 1', [p.email]
      )).rows[0];
      if (existing) {
        // A staff account sharing the address is left alone: turning an Admin
        // into a Portal user, or resetting their password, is not this
        // feature's business. Only an existing Portal login gets its directory
        // link filled in, so it stops asking for a local password.
        if (existing.role === 'Portal' && !existing.ldap_guid && !dryRun) {
          await query(
            'UPDATE users SET ldap_guid = $2, ldap_dn = $3, must_change_password = false WHERE id = $1',
            [existing.id, p.guid, p.dn]
          ).catch(() => {});
        }
        continue;
      }
      result.users.portalCreated += 1;
      if (dryRun) continue;
      const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const portalIns = await query(
        `INSERT INTO users (username, email, password_hash, role, status, must_change_password, ldap_guid, ldap_dn)
         VALUES ($1,$2,$3,'Portal','Active',false,$4,$5) ON CONFLICT (email) DO NOTHING`,
        [p.fullName || p.email, p.email, hash, p.guid, p.dn]
      ).catch((err) => {
        console.error('[ldap] portal login could not be created for', p.email, '-', err && err.message);
        result.users.portalCreated -= 1;
        return null;
      });
      if (portalIns && portalIns.rowCount) {
        auditUser('ldap.portal_created',
          `Directory sync created the Portal login ${p.email}`,
          actorName, { email: p.email });
      }
    }
  }
  await recordRun(started, result, actorName);
  audit(dryRun ? 'ldap.sync_preview' : 'ldap.sync',
    `Directory sync${dryRun ? ' (preview)' : ''}: ${result.created} created, ${result.updated} updated, ${result.deactivated} deactivated, ${result.skipped} skipped`,
    actorName);
  return result;
}

async function recordRun(started, result, actorName) {
  await query(
    `INSERT INTO ldap_sync_runs (started_at, finished_at, trigger, dry_run, created, updated, deactivated, skipped, error, actor_name)
     VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9)`,
    [started, result.trigger || 'manual', !!result.dryRun, result.created || 0, result.updated || 0,
      result.deactivated || 0, result.skipped || 0, result.error || null, actorName]
  ).catch(() => {});
  // Keep the history bounded; nobody reads the 200th run.
  await query('DELETE FROM ldap_sync_runs WHERE id NOT IN (SELECT id FROM ldap_sync_runs ORDER BY started_at DESC LIMIT 50)').catch(() => {});
}

async function lastRun() {
  const { rows } = await query(
    `SELECT started_at AS "startedAt", finished_at AS "finishedAt", trigger, dry_run AS "dryRun",
            created, updated, deactivated, skipped, error, actor_name AS "actorName"
       FROM ldap_sync_runs ORDER BY started_at DESC LIMIT 1`
  ).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

async function listRuns(limit = 10) {
  const { rows } = await query(
    `SELECT started_at AS "startedAt", finished_at AS "finishedAt", trigger, dry_run AS "dryRun",
            created, updated, deactivated, skipped, error, actor_name AS "actorName"
       FROM ldap_sync_runs ORDER BY started_at DESC LIMIT $1`,
    [Math.max(1, Math.min(50, Number(limit) || 10))]
  ).catch(() => ({ rows: [] }));
  return rows;
}

/**
 * A user-scoped audit row. The run summary counts how many accounts a sync
 * touched; these say WHICH, for the changes that decide who can sign in and
 * with what rights. Routine field updates stay in the run counters so a large
 * directory does not bury the trail.
 */
function auditUser(action, summary, actorName, { id = null, email = null } = {}) {
  try {
    require('./auditService').logEvent({
      action, source: 'integration', summary,
      actorName: actorName || 'system',
      entityType: 'user', entityId: id, entityLabel: email,
    }).catch(() => {});
  } catch { /* never block on audit */ }
}

function audit(action, summary, actorName) {
  try {
    require('./auditService').logEvent({
      action, source: 'integration', summary,
      actorName: actorName || 'system',
      entityType: 'integration', entityLabel: 'LDAP',
    }).catch(() => {});
  } catch { /* never block on audit */ }
}

/**
 * Scheduler entry point. Returns null when nothing was due, so the caller can
 * stay quiet. Hourly runs on the hour; daily runs in the configured hour.
 */
let lastAutoRunKey = null;
async function runIfDue(now = new Date()) {
  const cfg = await getConfig().catch(() => null);
  if (!cfg || !cfg.ready || cfg.syncSchedule === 'off') return null;
  const key = cfg.syncSchedule === 'hourly'
    ? `${now.toISOString().slice(0, 13)}`
    : `${now.toISOString().slice(0, 10)}`;
  if (lastAutoRunKey === key) return null;
  if (cfg.syncSchedule === 'daily' && now.getHours() !== (cfg.syncHour || 0)) return null;
  lastAutoRunKey = key;
  return runSync({ trigger: 'schedule', actorName: 'scheduler' });
}

module.exports = {
  DEFAULTS, MAPPABLE_ROLES,
  getConfig, getForUi, saveConfig,
  testConnection, authenticate, roleForPerson,
  runSync, runIfDue, lastRun, listRuns,
};
