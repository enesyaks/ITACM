/**
 * Service-desk automation rules — "when a ticket is opened, if <conditions>
 * then <actions>".
 *
 * Design notes
 * - Matching is PURE: `evaluate()` takes a plain context object and the stored
 *   rules and returns which rules matched plus the merged action set. It never
 *   touches the tickets table. The caller (ticketService.createTicket) owns the
 *   writes, so priority/SLA re-targeting keeps living in exactly one place.
 * - Rules run at creation time only, in `position` order, and never re-run on
 *   the edits they make themselves — no cascade, no loop, no re-entrancy.
 * - Later matches win on a per-field basis: two rules setting `category` leave
 *   the lower one in charge, the same way GLPI's rule collections behave.
 * - `stopOnMatch` ends the pass, so a specific rule can shield a catch-all.
 *
 * Text comparison folds Turkish/accented characters (`foldTr`), so a rule
 * written as "yazıcı" also matches a subject typed "YAZICI" or "yazici".
 */
const { query } = require('./pool');
const { HttpError } = require('../../utils/httpError');
const { isUuid } = require('./rowMapper');
const { foldTr } = require('../../utils/nameMatch');

/** Ticket facts a condition may read. Kept deliberately small and flat. */
const FIELDS = Object.freeze([
  'subject', 'description', 'text', 'category', 'type', 'source',
  'requesterName', 'requesterEmail', 'requesterDepartment', 'templateName',
]);

/** Comparison operators. No regex on purpose — a bad pattern is a DoS. */
const OPS = Object.freeze([
  'contains', 'not_contains', 'equals', 'not_equals',
  'starts_with', 'ends_with', 'is_empty', 'is_not_empty',
]);

/** Operators that ignore the `value` box entirely. */
const VALUELESS = new Set(['is_empty', 'is_not_empty']);

const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const LEVELS = new Set(['low', 'medium', 'high']);

const MAX_RULES = 100;
const MAX_CONDITIONS = 12;

/* --------------------------------- matching -------------------------------- */

function norm(v) {
  return foldTr(String(v == null ? '' : v)).trim();
}

function testCondition(cond, ctx) {
  const field = cond.field;
  // `text` is the convenience field: subject + description in one haystack, so
  // "contains toner" catches a mail whose subject is just "Re: printer".
  const raw = field === 'text'
    ? `${ctx.subject || ''} ${ctx.description || ''}`
    : ctx[field];
  const hay = norm(raw);
  const needle = norm(cond.value);
  switch (cond.op) {
    case 'is_empty': return hay === '';
    case 'is_not_empty': return hay !== '';
    case 'contains': return needle !== '' && hay.includes(needle);
    case 'not_contains': return needle === '' || !hay.includes(needle);
    case 'equals': return hay === needle;
    case 'not_equals': return hay !== needle;
    case 'starts_with': return needle !== '' && hay.startsWith(needle);
    case 'ends_with': return needle !== '' && hay.endsWith(needle);
    default: return false;
  }
}

function ruleMatches(rule, ctx) {
  const conds = Array.isArray(rule.conditions) ? rule.conditions : [];
  // A rule with no conditions is a catch-all — useful as the last "everything
  // else goes to the queue" rule, and harmless because it still needs actions.
  if (!conds.length) return true;
  return rule.matchAll
    ? conds.every((c) => testCondition(c, ctx))
    : conds.some((c) => testCondition(c, ctx));
}

/**
 * Run the enabled rules against a ticket context.
 * @returns {{ matched: Array<{id, name}>, actions: object }}
 */
function evaluateRules(rules, ctx) {
  const matched = [];
  const actions = {};
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!ruleMatches(rule, ctx)) continue;
    matched.push({ id: rule.id, name: rule.name });
    Object.assign(actions, rule.actions || {});
    if (rule.stopOnMatch) break;
  }
  return { matched, actions };
}

/* ------------------------------- persistence ------------------------------- */

function mapRule(row) {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    position: row.position,
    matchAll: row.match_all,
    conditions: Array.isArray(row.conditions) ? row.conditions : [],
    actions: (row.actions && typeof row.actions === 'object') ? row.actions : {},
    stopOnMatch: row.stop_on_match,
    matchCount: row.match_count,
    lastMatchedAt: row.last_matched_at,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listRules() {
  const { rows } = await query(
    'SELECT * FROM ticket_rules ORDER BY position ASC, created_at ASC'
  );
  return rows.map(mapRule);
}

/** Enabled rules only, for the creation-time pass. Cheap enough to skip a cache. */
async function activeRules() {
  const { rows } = await query(
    'SELECT * FROM ticket_rules WHERE enabled = true ORDER BY position ASC, created_at ASC'
  );
  return rows.map(mapRule);
}

function sanitizeConditions(input) {
  const out = [];
  const raw = Array.isArray(input) ? input.slice(0, MAX_CONDITIONS) : [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    if (!FIELDS.includes(c.field)) throw HttpError.badRequest(`Unknown condition field: ${c.field}`);
    if (!OPS.includes(c.op)) throw HttpError.badRequest(`Unknown condition operator: ${c.op}`);
    const value = VALUELESS.has(c.op) ? '' : String(c.value == null ? '' : c.value).trim().slice(0, 200);
    if (!VALUELESS.has(c.op) && !value) throw HttpError.badRequest('A condition value is required');
    out.push({ field: c.field, op: c.op, value });
  }
  return out;
}

async function sanitizeActions(input) {
  const a = (input && typeof input === 'object') ? input : {};
  const out = {};
  if (a.setCategory != null && String(a.setCategory).trim()) {
    out.setCategory = String(a.setCategory).trim().slice(0, 120);
  }
  if (a.setPriority) {
    if (!PRIORITIES.has(a.setPriority)) throw HttpError.badRequest('Invalid setPriority');
    out.setPriority = a.setPriority;
  }
  if (a.setImpact) {
    if (!LEVELS.has(a.setImpact)) throw HttpError.badRequest('Invalid setImpact');
    out.setImpact = a.setImpact;
  }
  if (a.setUrgency) {
    if (!LEVELS.has(a.setUrgency)) throw HttpError.badRequest('Invalid setUrgency');
    out.setUrgency = a.setUrgency;
  }
  if (a.setAssigneeUserId) {
    if (!isUuid(a.setAssigneeUserId)) throw HttpError.badRequest('Invalid setAssigneeUserId');
    // Only a staff account can hold a queue. A Portal/HR user assigned by a rule
    // would own a ticket it cannot open.
    const { rows } = await query(
      "SELECT id FROM users WHERE id = $1 AND role IN ('Owner','Admin','Helpdesk')",
      [a.setAssigneeUserId]
    );
    if (!rows[0]) throw HttpError.badRequest('The assignee must be an active staff user');
    out.setAssigneeUserId = a.setAssigneeUserId;
  }
  if (a.addNote != null && String(a.addNote).trim()) {
    out.addNote = String(a.addNote).trim().slice(0, 2000);
  }
  if (!Object.keys(out).length) throw HttpError.badRequest('A rule needs at least one action');
  return out;
}

/**
 * Replace the whole rule set in one transaction-free pass. The editor sends the
 * full list (like the canned-reply and category editors do), so ordering is
 * just the array index. Rules keep their id — and therefore their match
 * counters — when the client sends one back.
 */
async function saveRules(items, actorName, user = null) {
  const raw = Array.isArray(items) ? items : [];
  if (raw.length > MAX_RULES) throw HttpError.badRequest(`At most ${MAX_RULES} rules are supported`);
  // `assign` is a distinct IAM action from `configure`: updateTicket re-checks it
  // on every assignee change, so a rule must not become a way around that.
  if (user && raw.some((r) => r && r.actions && r.actions.setAssigneeUserId)) {
    const perms = require('./permissionService');
    const ok = await perms.checkPermission(user, 'ticket', 'assign')
      || await perms.checkPermission(user, 'ticket', 'manage');
    if (!ok) throw HttpError.forbidden('A rule that assigns tickets needs the ticket-assign permission');
  }

  const prepared = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] || {};
    const name = String(r.name || '').trim().slice(0, 120);
    if (!name) throw HttpError.badRequest('Every rule needs a name');
    prepared.push({
      id: isUuid(r.id) ? r.id : null,
      name,
      enabled: r.enabled !== false,
      position: i,
      matchAll: r.matchAll !== false,
      conditions: sanitizeConditions(r.conditions),
      actions: await sanitizeActions(r.actions),
      stopOnMatch: !!r.stopOnMatch,
    });
  }

  const keep = prepared.filter((p) => p.id).map((p) => p.id);
  if (keep.length) {
    await query('DELETE FROM ticket_rules WHERE id <> ALL($1::uuid[])', [keep]);
  } else {
    await query('DELETE FROM ticket_rules');
  }
  for (const p of prepared) {
    if (p.id) {
      await query(
        `UPDATE ticket_rules SET name=$2, enabled=$3, position=$4, match_all=$5,
                conditions=$6::jsonb, actions=$7::jsonb, stop_on_match=$8, updated_at=now()
           WHERE id=$1`,
        [p.id, p.name, p.enabled, p.position, p.matchAll,
          JSON.stringify(p.conditions), JSON.stringify(p.actions), p.stopOnMatch]
      );
    } else {
      await query(
        `INSERT INTO ticket_rules (name, enabled, position, match_all, conditions, actions, stop_on_match, created_by_name)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
        [p.name, p.enabled, p.position, p.matchAll,
          JSON.stringify(p.conditions), JSON.stringify(p.actions), p.stopOnMatch, actorName || null]
      );
    }
  }
  return listRules();
}

/** Bump the bookkeeping counters for the rules that fired. Never throws. */
async function recordMatches(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  await query(
    'UPDATE ticket_rules SET match_count = match_count + 1, last_matched_at = now() WHERE id = ANY($1::uuid[])',
    [ids]
  ).catch(() => {});
}

/**
 * Dry-run: which rules would fire for this sample ticket, and what would the
 * merged outcome be? Read-only — nothing is written and no counter moves.
 */
async function testRules(sample = {}, items) {
  const rules = Array.isArray(items) && items.length
    // Test the unsaved editor state: sanitize it the same way a save would, so a
    // broken draft fails here rather than silently testing something else.
    ? await Promise.all(items.map(async (r, i) => ({
      id: isUuid(r && r.id) ? r.id : `draft-${i}`,
      name: String((r && r.name) || `#${i + 1}`).slice(0, 120),
      enabled: !(r && r.enabled === false),
      matchAll: !(r && r.matchAll === false),
      conditions: sanitizeConditions(r && r.conditions),
      actions: await sanitizeActions(r && r.actions),
      stopOnMatch: !!(r && r.stopOnMatch),
    })))
    : await activeRules();

  const ctx = {
    subject: String(sample.subject || '').slice(0, 300),
    description: String(sample.description || '').slice(0, 8000),
    category: String(sample.category || '').slice(0, 120),
    type: sample.type === 'request' ? 'request' : 'incident',
    source: ['staff', 'portal', 'email'].includes(sample.source) ? sample.source : 'staff',
    requesterName: String(sample.requesterName || '').slice(0, 200),
    requesterEmail: String(sample.requesterEmail || '').slice(0, 200),
    requesterDepartment: String(sample.requesterDepartment || '').slice(0, 200),
    templateName: String(sample.templateName || '').slice(0, 200),
  };
  return { ...evaluateRules(rules, ctx), context: ctx };
}

module.exports = {
  FIELDS, OPS, VALUELESS,
  listRules, activeRules, saveRules, recordMatches, testRules,
  evaluateRules, ruleMatches, testCondition,
};
