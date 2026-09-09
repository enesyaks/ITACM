/**
 * Advanced reporting: the cross-cutting figures the summary report only hints at.
 *
 * The service-desk report answers "how many, and did we hit target". This
 * assembles the breakdowns that let a number be argued with — compliance per
 * priority and per agent, where the backlog is growing, which categories draw
 * the low CSAT scores, and how the fleet is aging underneath all of it.
 *
 * Every section is optional and gated by its own permission, because the
 * inventory half belongs to a different module than the service-desk half: a
 * user with ticket:report but no asset:read gets the desk sections and nothing
 * else, rather than an error.
 */
const { query } = require('./pool');

/** Clamp a caller-supplied day to YYYY-MM-DD, falling back to the given default. */
function day(v, fallback) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : fallback;
}

function range({ from, to } = {}) {
  const toD = day(to, new Date().toISOString().slice(0, 10));
  const fromD = day(from, new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  return { fromD, toD, params: [fromD, `${toD} 23:59:59`] };
}

const pct = (met, measurable) => (Number(measurable)
  ? Math.round((Number(met) || 0) / Number(measurable) * 100)
  : null);

/* ------------------------------- SLA depth ------------------------------- */

/**
 * Compliance sliced three ways. `measurable` is carried alongside every
 * percentage: 100% of two tickets and 100% of two hundred are not the same
 * claim, and a bare percentage hides which one you are looking at.
 */
async function slaBreakdown(params) {
  const met = `COUNT(*) FILTER (WHERE t.resolve_due_at IS NOT NULL AND t.resolved_at <= t.resolve_due_at)::int`;
  const meas = `COUNT(*) FILTER (WHERE t.resolve_due_at IS NOT NULL)::int`;
  const over = `ROUND(AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.resolve_due_at))/60)
                  FILTER (WHERE t.resolve_due_at IS NOT NULL AND t.resolved_at > t.resolve_due_at))::int`;
  const shape = (rows, key) => rows.map((r) => ({
    key: r[key] || '—',
    resolved: Number(r.resolved) || 0,
    measurable: Number(r.measurable) || 0,
    met: Number(r.met) || 0,
    compliance: pct(r.met, r.measurable),
    avgOverMinutes: r.avg_over_minutes == null ? null : Number(r.avg_over_minutes),
  }));

  const sel = (groupCol, joinSql = '') => `
    SELECT ${groupCol} AS k, COUNT(*)::int AS resolved, ${meas} AS measurable,
           ${met} AS met, ${over} AS avg_over_minutes
      FROM tickets t ${joinSql}
     WHERE t.resolved_at BETWEEN $1 AND $2
     GROUP BY 1 ORDER BY resolved DESC`;

  const [byPriority, byCategory, byAgent] = await Promise.all([
    query(sel('t.priority'), params),
    query(sel("COALESCE(t.category, '—')"), params),
    query(sel('COALESCE(au.username, \'—\')', 'LEFT JOIN users au ON au.id = t.assignee_user_id'), params),
  ]);

  // The tickets that blew the target hardest — the ones worth reading, not just
  // counting. Capped: this feeds a table, not an export.
  const { rows: worst } = await query(`
    SELECT t.number, t.subject, t.priority, COALESCE(t.category,'—') AS category,
           re.full_name AS requester, COALESCE(au.username,'—') AS assignee,
           ROUND(EXTRACT(EPOCH FROM (t.resolved_at - t.resolve_due_at))/60)::int AS over_minutes,
           ROUND(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))/3600, 1) AS resolution_hours
      FROM tickets t
      LEFT JOIN employees re ON re.id = t.requester_employee_id
      LEFT JOIN users au ON au.id = t.assignee_user_id
     WHERE t.resolved_at BETWEEN $1 AND $2
       AND t.resolve_due_at IS NOT NULL AND t.resolved_at > t.resolve_due_at
     ORDER BY over_minutes DESC LIMIT 20`, params);

  return {
    byPriority: shape(byPriority.rows, 'k'),
    byCategory: shape(byCategory.rows, 'k'),
    byAgent: shape(byAgent.rows, 'k'),
    worst: worst.map((r) => ({
      number: r.number, subject: r.subject, priority: r.priority, category: r.category,
      requester: r.requester, assignee: r.assignee,
      overMinutes: Number(r.over_minutes), resolutionHours: Number(r.resolution_hours),
    })),
  };
}

/* ---------------------------- Trend & workload ---------------------------- */

/**
 * Opened vs resolved per day, plus the running backlog.
 *
 * The daily counts alone never show the thing that matters: whether the queue is
 * growing. `backlog` accumulates (opened - resolved) across the window, so a
 * team that closes ten a day while twelve arrive can see the line climb.
 */
async function workload({ fromD, toD, params }) {
  const { rows } = await query(`
    SELECT to_char(gs::date,'YYYY-MM-DD') AS date,
           COUNT(t.*) FILTER (WHERE t.created_at::date = gs::date)::int  AS opened,
           COUNT(t2.*) FILTER (WHERE t2.resolved_at::date = gs::date)::int AS resolved
      FROM generate_series($1::date, $2::date, '1 day') gs
      LEFT JOIN tickets t  ON t.created_at::date = gs::date
      LEFT JOIN tickets t2 ON t2.resolved_at::date = gs::date
     GROUP BY gs::date ORDER BY gs::date`, [fromD, toD]);

  let running = 0;
  const daily = rows.map((r) => {
    running += (r.opened - r.resolved);
    return { date: r.date, opened: r.opened, resolved: r.resolved, backlog: running };
  });

  // When the desk is actually busy. Hour is read in the server's zone, which is
  // the zone the desk works in.
  const { rows: byHour } = await query(`
    SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS n
      FROM tickets WHERE created_at BETWEEN $1 AND $2
     GROUP BY 1 ORDER BY 1`, params);
  const { rows: byDow } = await query(`
    SELECT EXTRACT(ISODOW FROM created_at)::int AS dow, COUNT(*)::int AS n
      FROM tickets WHERE created_at BETWEEN $1 AND $2
     GROUP BY 1 ORDER BY 1`, params);

  return {
    daily,
    byHour: byHour.map((r) => ({ hour: r.hour, n: r.n })),
    byWeekday: byDow.map((r) => ({ weekday: r.dow, n: r.n })),
    netBacklog: running,
  };
}

/* --------------------------------- CSAT ---------------------------------- */

async function satisfaction(params) {
  const shape = (rows) => rows.map((r) => ({
    key: r.k || '—',
    votes: Number(r.votes) || 0,
    avg: r.avg == null ? null : Number(r.avg),
    low: Number(r.low) || 0,
  }));
  const sel = (groupCol, joinSql = '') => `
    SELECT ${groupCol} AS k, COUNT(*)::int AS votes,
           ROUND(AVG(t.csat_rating), 2) AS avg,
           COUNT(*) FILTER (WHERE t.csat_rating <= 2)::int AS low
      FROM tickets t ${joinSql}
     WHERE t.csat_rating IS NOT NULL AND t.resolved_at BETWEEN $1 AND $2
     GROUP BY 1 ORDER BY votes DESC`;

  const [byAgent, byCategory, dist, lows] = await Promise.all([
    query(sel('COALESCE(au.username, \'—\')', 'LEFT JOIN users au ON au.id = t.assignee_user_id'), params),
    query(sel("COALESCE(t.category, '—')"), params),
    query(`SELECT csat_rating AS rating, COUNT(*)::int AS n FROM tickets
            WHERE csat_rating IS NOT NULL AND resolved_at BETWEEN $1 AND $2
            GROUP BY 1 ORDER BY 1`, params),
    // The comment is the report: a 1-star with a sentence attached is the only
    // CSAT row anyone acts on.
    query(`SELECT t.number, t.subject, t.csat_rating AS rating, t.csat_comment AS comment,
                  COALESCE(au.username,'—') AS assignee, COALESCE(t.category,'—') AS category
             FROM tickets t LEFT JOIN users au ON au.id = t.assignee_user_id
            WHERE t.csat_rating IS NOT NULL AND t.csat_rating <= 2
              AND t.resolved_at BETWEEN $1 AND $2
            ORDER BY t.csat_rating, t.resolved_at DESC LIMIT 20`, params),
  ]);

  return {
    byAgent: shape(byAgent.rows),
    byCategory: shape(byCategory.rows),
    distribution: dist.rows.map((r) => ({ rating: r.rating, n: r.n })),
    lowScores: lows.rows.map((r) => ({
      number: r.number, subject: r.subject, rating: r.rating,
      comment: r.comment || '', assignee: r.assignee, category: r.category,
    })),
  };
}

/* -------------------------- Inventory & handovers ------------------------- */

async function inventory({ params }) {
  const [byStatus, byCategory, byLocation, byCompany, aging, handovers] = await Promise.all([
    query(`SELECT status AS k, COUNT(*)::int AS n FROM assets GROUP BY 1 ORDER BY n DESC`),
    query(`SELECT category AS k, COUNT(*)::int AS n FROM assets GROUP BY 1 ORDER BY n DESC`),
    query(`SELECT COALESCE(location,'—') AS k, COUNT(*)::int AS n FROM assets GROUP BY 1 ORDER BY n DESC`),
    query(`SELECT COALESCE(c.name,'—') AS k, COUNT(a.*)::int AS n
             FROM assets a LEFT JOIN companies c ON c.id = a.company_id
            GROUP BY 1 ORDER BY n DESC`),
    // Age buckets from purchase date. Undated assets are their own bucket rather
    // than silently counted as new.
    query(`
      SELECT CASE
               WHEN purchase_date IS NULL THEN 'bilinmiyor'
               WHEN purchase_date > now() - interval '1 year'  THEN '0-1'
               WHEN purchase_date > now() - interval '2 years' THEN '1-2'
               WHEN purchase_date > now() - interval '3 years' THEN '2-3'
               WHEN purchase_date > now() - interval '4 years' THEN '3-4'
               ELSE '4+' END AS k,
             COUNT(*)::int AS n
        FROM assets WHERE status <> 'Scrap' GROUP BY 1 ORDER BY 1`),
    query(`SELECT to_char(transaction_date::date,'YYYY-MM-DD') AS date, COUNT(*)::int AS n
             FROM handovers WHERE transaction_date BETWEEN $1 AND $2
            GROUP BY 1 ORDER BY 1`, params),
  ]);
  const m = (rows) => rows.map((r) => ({ key: r.k, n: r.n }));
  return {
    byStatus: m(byStatus.rows),
    byCategory: m(byCategory.rows),
    byLocation: m(byLocation.rows),
    byCompany: m(byCompany.rows),
    ageBuckets: m(aging.rows),
    handoversDaily: handovers.rows.map((r) => ({ date: r.date, n: r.n })),
  };
}

/**
 * Assemble the sections the caller is allowed to see.
 * `sections` mirrors the permissions resolved by the route.
 */
async function advancedReport({ from, to, sections = {} } = {}) {
  const r = range({ from, to });
  const out = { from: r.fromD, to: r.toD, sections: [] };

  if (sections.serviceDesk) {
    const [sla, work, csat] = await Promise.all([
      slaBreakdown(r.params), workload(r), satisfaction(r.params),
    ]);
    out.sla = sla; out.workload = work; out.csat = csat;
    out.sections.push('sla', 'workload', 'csat');
  }
  if (sections.inventory) {
    out.inventory = await inventory(r);
    out.sections.push('inventory');
  }
  return out;
}

module.exports = { advancedReport };
