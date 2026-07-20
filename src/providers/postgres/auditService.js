/*
 * System-wide audit log: append-only writer + unified timeline reader.
 * Reader merges system_audit_log with legacy domain history tables.
 */
const { query } = require('./pool');

const SENSITIVE_KEYS = new Set([
  'password', 'adminpassword', 'token', 'setuptoken', 'authorization',
  'licensekey', 'secret', 'apikey', 'key',
]);

// Any key whose name contains one of these is redacted, so variants like
// currentPassword / newPassword / mfaSecret / backupCode never hit the log.
const SENSITIVE_KEY_RE = /(pass(word|wd)?|secret|token|api[-_]?key|authorization|licensekey|backupcode|totp|otp|mfa)/i;

function isSensitiveKey(k) {
  const s = String(k).toLowerCase();
  return SENSITIVE_KEYS.has(s) || SENSITIVE_KEY_RE.test(s);
}

function scrub(value, depth = 0) {
  if (value == null || depth > 3) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 240) return `${value.slice(0, 240)}…`;
    return value;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

function describeRequest(req) {
  const method = req.method;
  const path = (req.originalUrl || req.url || '').split('?')[0];
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  const rules = [
    { m: 'POST', re: /^\/api\/auth\/login$/, action: 'auth.login', source: 'auth', summary: () => `Sign-in: ${body.email || '—'}` },
    { m: 'POST', re: /^\/api\/auth\/verify-token$/, action: 'auth.verify_token', source: 'auth',
      summary: () => 'Session verified' },
    { m: 'POST', re: /^\/api\/auth\/users$/, action: 'user.create', source: 'users', summary: () => `Created IT user ${body.email || body.username || ''}`.trim() },
    { m: 'PATCH', re: /^\/api\/auth\/users\/[^/]+\/role$/, action: 'user.role_change', source: 'users', summary: () => `Role → ${body.role || '—'}` },
    { m: 'PATCH', re: /^\/api\/auth\/users\/[^/]+\/status$/, action: 'user.status', source: 'users', summary: () => `User status changed` },
    { m: 'DELETE', re: /^\/api\/auth\/users\/[^/]+$/, action: 'user.delete', source: 'users', summary: () => 'Deleted IT user' },
    { m: 'POST', re: /^\/api\/assets$/, action: 'asset.create', source: 'assets',
      summary: () => `Created asset ${body.assetTag || ''}`.trim(),
      entityType: 'asset', entityLabel: () => body.assetTag || null },
    { m: 'PUT', re: /^\/api\/assets\/[^/]+$/, action: 'asset.update', source: 'assets',
      summary: () => {
        if (body.location != null || body.responsibleEmployeeId != null) {
          return `Updated placement ${body.assetTag || ''}`.trim();
        }
        if (body.status === 'Scrap') return `Scrapped asset ${body.assetTag || ''}`.trim();
        return `Updated asset ${body.assetTag || ''}`.trim();
      },
      entityType: 'asset',
      entityId: () => {
        const m = path.match(/^\/api\/assets\/([^/]+)$/);
        return m ? m[1] : null;
      },
      entityLabel: () => body.assetTag || null },
    { m: 'DELETE', re: /^\/api\/assets\/[^/]+$/, action: 'asset.delete', source: 'assets', summary: () => 'Deleted / scrapped asset',
      entityType: 'asset',
      entityId: () => {
        const m = path.match(/^\/api\/assets\/([^/]+)$/);
        return m ? m[1] : null;
      } },
    { m: 'POST', re: /^\/api\/assets\/[^/]+\/return$/, action: 'asset.return', source: 'assets', summary: () => 'Returned asset to stock',
      entityType: 'asset',
      entityId: () => {
        const m = path.match(/^\/api\/assets\/([^/]+)\/return$/);
        return m ? m[1] : null;
      } },
    { m: 'POST', re: /^\/api\/employees$/, action: 'employee.create', source: 'employees', summary: () => `Created employee ${body.fullName || body.email || ''}`.trim() },
    { m: 'PUT', re: /^\/api\/employees\/[^/]+$/, action: 'employee.update', source: 'employees', summary: () => `Updated employee ${body.fullName || ''}`.trim() },
    { m: 'POST', re: /^\/api\/employees\/[^/]+\/offboard$/, action: 'employee.offboard', source: 'employees',
      summary: () => 'Completed employee offboarding',
      entityType: 'employee',
      entityId: () => {
        const m = path.match(/^\/api\/employees\/([^/]+)\/offboard$/);
        return m ? m[1] : null;
      } },
    { m: 'POST', re: /^\/api\/onboardings$/, action: 'employee.onboard.schedule', source: 'employees',
      summary: () => `Scheduled onboarding${body.fullName ? ` for ${body.fullName}` : ''}`.trim(),
      entityType: 'employee', entityId: () => body.employeeId || null },
    { m: 'POST', re: /^\/api\/onboardings\/[^/]+\/complete$/, action: 'employee.onboard.complete', source: 'employees',
      summary: () => 'Completed onboarding zimmet',
      entityType: 'onboarding',
      entityId: () => {
        const m = path.match(/^\/api\/onboardings\/([^/]+)\/complete$/);
        return m ? m[1] : null;
      } },
    { m: 'POST', re: /^\/api\/onboardings\/[^/]+\/cancel$/, action: 'employee.onboard.cancel', source: 'employees',
      summary: () => 'Cancelled onboarding',
      entityType: 'onboarding',
      entityId: () => {
        const m = path.match(/^\/api\/onboardings\/([^/]+)\/cancel$/);
        return m ? m[1] : null;
      } },
    { m: 'POST', re: /^\/api\/employees\/[^/]+\/documents$/, action: 'document.upload', source: 'documents', summary: () => 'Uploaded employee document' },
    { m: 'DELETE', re: /^\/api\/employees\/[^/]+\/documents\/[^/]+$/, action: 'document.delete', source: 'documents', summary: () => 'Deleted employee document' },
    { m: 'POST', re: /^\/api\/handovers$/, action: 'handover.create', source: 'handover',
      summary: () => 'Executed handover (zimmet)',
      entityType: 'employee', entityId: () => body.employeeId || null },
    { m: 'POST', re: /^\/api\/maintenance$/, action: 'maintenance.create', source: 'maintenance', summary: () => `Sent to repair: ${body.serviceCompany || ''}`.trim() },
    { m: 'POST', re: /^\/api\/maintenance\/[^/]+\/close$/, action: 'maintenance.close', source: 'maintenance', summary: () => 'Closed repair' },
    { m: 'POST', re: /^\/api\/maintenance\/[^/]+\/notes$/, action: 'maintenance.note', source: 'maintenance', summary: () => 'Added repair note' },
    { m: 'POST', re: /^\/api\/maintenance\/[^/]+\/documents$/, action: 'document.upload', source: 'documents', summary: () => 'Uploaded repair document' },
    { m: 'POST', re: /^\/api\/licenses$/, action: 'license.create', source: 'licenses', summary: () => `Created license ${body.softwareName || body.name || ''}`.trim() },
    { m: 'PUT', re: /^\/api\/licenses\/[^/]+$/, action: 'license.update', source: 'licenses', summary: () => 'Updated license' },
    { m: 'POST', re: /^\/api\/licenses\/[^/]+\/assign$/, action: 'license.assign', source: 'licenses', summary: () => 'Assigned software license' },
    { m: 'POST', re: /^\/api\/licenses\/[^/]+\/revoke$/, action: 'license.revoke', source: 'licenses', summary: () => 'Revoked software license' },
    { m: 'POST', re: /^\/api\/licenses\/[^/]+\/renew$/, action: 'license.renew', source: 'licenses',
      summary: () => `Renewed license to ${body.expirationDate || 'new date'}` },
    { m: 'POST', re: /^\/api\/licenses\/[^/]+\/cancel$/, action: 'license.cancel', source: 'licenses',
      summary: () => 'Cancelled license' },
    { m: 'PATCH', re: /^\/api\/licenses\/[^/]+$/, action: 'license.update', source: 'licenses',
      summary: () => 'Updated license / purchase link' },
    { m: 'POST', re: /^\/api\/licenses\/[^/]+\/documents$/, action: 'license.document', source: 'licenses',
      summary: () => `Uploaded license document ${body.filename || ''}`.trim() },
    { m: 'POST', re: /^\/api\/lines$/, action: 'line.create', source: 'lines', summary: () => `Created line ${body.phoneNumber || ''}`.trim() },
    { m: 'POST', re: /^\/api\/lines\/[^/]+\/assign$/, action: 'line.assign', source: 'lines', summary: () => 'Assigned mobile line' },
    { m: 'POST', re: /^\/api\/lines\/[^/]+\/unassign$/, action: 'line.unassign', source: 'lines', summary: () => 'Unassigned mobile line' },
    { m: 'POST', re: /^\/api\/consumables$/, action: 'consumable.create', source: 'consumables', summary: () => `Created consumable ${body.name || ''}`.trim() },
    { m: 'POST', re: /^\/api\/consumables\/[^/]+\/adjust$/, action: 'consumable.adjust', source: 'consumables', summary: () => 'Adjusted consumable stock' },
    { m: 'POST', re: /^\/api\/catalog\//, action: 'catalog.update', source: 'catalog', summary: () => `Catalog: ${path.replace('/api/catalog/', '')}` },
    { m: 'PUT', re: /^\/api\/catalog\//, action: 'catalog.update', source: 'catalog', summary: () => `Catalog: ${path.replace('/api/catalog/', '')}` },
    { m: 'DELETE', re: /^\/api\/catalog\//, action: 'catalog.delete', source: 'catalog', summary: () => `Catalog delete: ${path.replace('/api/catalog/', '')}` },
    { m: 'POST', re: /^\/api\/counts$/, action: 'stockcount.create', source: 'stockcount', summary: () => 'Opened stock count session' },
    { m: 'POST', re: /^\/api\/counts\/[^/]+\/scan$/, action: 'stockcount.scan', source: 'stockcount', summary: () => `Scanned ${body.code || body.tag || 'item'}` },
    { m: 'POST', re: /^\/api\/counts\/[^/]+\/close$/, action: 'stockcount.close', source: 'stockcount', summary: () => 'Closed stock count' },
    { m: 'POST', re: /^\/api\/import\/inventory$/, action: 'import.inventory', source: 'import',
      summary: () => {
        const n = Array.isArray(body.rows) ? body.rows.length : 0;
        return `Imported inventory from Excel/CSV (${n} row(s) submitted)`;
      } },
    { m: 'PUT', re: /^\/api\/settings/, action: 'settings.update', source: 'settings', summary: () => 'Updated settings / branding' },
    { m: 'PATCH', re: /^\/api\/settings/, action: 'settings.update', source: 'settings', summary: () => 'Updated settings / branding' },
    { m: 'POST', re: /^\/api\/setup/, action: 'setup', source: 'setup', summary: () => 'Completed workspace setup' },
  ];

  for (const rule of rules) {
    if (rule.m === method && rule.re.test(path)) {
      return {
        action: rule.action,
        source: rule.source,
        summary: rule.summary(),
        entityType: rule.entityType || rule.source,
        entityId: typeof rule.entityId === 'function' ? rule.entityId() : (rule.entityId || null),
        entityLabel: typeof rule.entityLabel === 'function' ? rule.entityLabel() : (rule.entityLabel || null),
      };
    }
  }
  return {
    action: `${method.toLowerCase()}.${path.replace(/^\/api\//, '').replace(/\//g, '.') || 'api'}`,
    source: 'api',
    summary: `${method} ${path}`,
    entityType: null,
  };
}

async function logEvent({
  action, source = 'system', summary = '',
  actorId = null, actorEmail = null, actorName = null,
  entityType = null, entityId = null, entityLabel = null,
  meta = null, ip = null, userAgent = null,
} = {}) {
  if (!action) return null;
  try {
    const { rows } = await query(
      `INSERT INTO system_audit_log
         (action, source, summary, actor_id, actor_email, actor_name,
          entity_type, entity_id, entity_label, meta, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
       RETURNING id, created_at`,
      [
        String(action).slice(0, 120),
        String(source || 'system').slice(0, 40),
        String(summary || '').slice(0, 500),
        actorId || null,
        actorEmail ? String(actorEmail).slice(0, 200) : null,
        actorName ? String(actorName).slice(0, 200) : null,
        entityType ? String(entityType).slice(0, 40) : null,
        entityId ? String(entityId).slice(0, 80) : null,
        entityLabel ? String(entityLabel).slice(0, 200) : null,
        meta != null ? JSON.stringify(scrub(meta)) : null,
        ip ? String(ip).slice(0, 80) : null,
        userAgent ? String(userAgent).slice(0, 300) : null,
      ]
    );
    return rows[0] || null;
  } catch (err) {
    console.warn('[audit] write failed:', err.message);
    return null;
  }
}

async function logFromRequest(req, res) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  if (res.statusCode >= 400) return;
  const path = (req.originalUrl || req.url || '').split('?')[0];
  if (!path.startsWith('/api/')) return;
  if (path === '/api/health' || path === '/api/config') return;
  // Dry-run import is read-only validation — do not pollute the audit trail.
  if (path === '/api/import/inventory' && req.body && req.body.dryRun) return;

  const described = req.audit || describeRequest(req);
  const user = req.user || {};
  const actorEmail = user.email || (req.body && req.body.email) || null;
  const actorName = user.username || user.name || actorEmail || null;

  await logEvent({
    action: described.action,
    source: described.source,
    summary: described.summary,
    actorId: user.uid || user.id || null,
    actorEmail,
    actorName,
    entityType: described.entityType || null,
    entityId: described.entityId || null,
    entityLabel: described.entityLabel || null,
    meta: { method: req.method, path, status: res.statusCode, body: scrub(req.body) },
    ip: req.ip || null,
    userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
  });
}

function buildUnion({ source = '', q = '', from = '', to = '', actor = '', limit, offset }) {
  const params = [];
  const push = (v) => { params.push(v); return `$${params.length}`; };
  const timeFilter = (col) => {
    let sql = '';
    if (from) sql += ` AND ${col} >= ${push(from)}`;
    if (to) sql += ` AND ${col} <= ${push(to)}`;
    return sql;
  };
  const qFilter = (cols) => {
    if (!q) return '';
    const p = push(`%${q}%`);
    return ` AND (${cols.map((c) => `${c} ILIKE ${p}`).join(' OR ')})`;
  };
  const actorFilter = (cols) => {
    if (!actor) return '';
    const p = push(`%${actor}%`);
    return ` AND (${cols.map((c) => `${c} ILIKE ${p}`).join(' OR ')})`;
  };
  const want = (...keys) => !source || source === 'all' || keys.includes(source);
  const branches = [];

  if (want('all', 'system', 'assets', 'employees', 'users', 'auth', 'handover', 'maintenance',
    'licenses', 'lines', 'consumables', 'catalog', 'documents', 'stockcount', 'import', 'settings', 'setup', 'api')) {
    let srcSql = '';
    // Filters that only exist as legacy tables (no matching system_audit_log.source).
    const legacyOnly = ['asset_history', 'line_history', 'login', 'user_admin', 'license'];
    if (source && source !== 'all' && source !== 'system') {
      if (legacyOnly.includes(source)) srcSql = ' AND false';
      else srcSql = ` AND source = ${push(source)}`;
    }
    if (srcSql !== ' AND false') {
      branches.push(`
        SELECT id::text AS id, 'system'::text AS bucket, source, action, summary,
          COALESCE(actor_name, actor_email, '—') AS actor_name,
          entity_type, entity_id, entity_label, created_at AS ts
        FROM system_audit_log
        WHERE 1=1 ${srcSql}
          ${timeFilter('created_at')}
          ${qFilter(['summary', 'action', 'actor_name', 'actor_email', 'entity_label'])}
          ${actorFilter(['actor_name', 'actor_email'])}`);
    }
  }

  if (want('all', 'asset_history', 'assets')) {
    branches.push(`
      SELECT id::text AS id, 'asset_history'::text AS bucket, 'assets'::text AS source, action_type AS action,
        TRIM(BOTH ' · ' FROM CONCAT_WS(' · ', NULLIF(notes,''), asset_tag)) AS summary,
        COALESCE(changed_by_name, changed_by, '—') AS actor_name,
        'asset'::text AS entity_type, asset_id::text AS entity_id, asset_tag AS entity_label, "timestamp" AS ts
      FROM asset_history WHERE 1=1
        ${timeFilter('"timestamp"')}
        ${qFilter(['notes', 'action_type', 'asset_tag', 'changed_by_name', 'employee_name'])}
        ${actorFilter(['changed_by_name', 'changed_by'])}`);
  }

  if (want('all', 'line_history', 'lines')) {
    branches.push(`
      SELECT id::text AS id, 'line_history'::text AS bucket, 'lines'::text AS source, action_type AS action,
        TRIM(BOTH ' · ' FROM CONCAT_WS(' · ', NULLIF(notes,''), phone_number)) AS summary,
        COALESCE(changed_by_name, changed_by, '—') AS actor_name,
        'line'::text AS entity_type, line_id::text AS entity_id, phone_number AS entity_label, "timestamp" AS ts
      FROM mobile_line_history WHERE 1=1
        ${timeFilter('"timestamp"')}
        ${qFilter(['notes', 'action_type', 'phone_number', 'changed_by_name', 'employee_name'])}
        ${actorFilter(['changed_by_name', 'changed_by'])}`);
  }

  if (want('all', 'login', 'auth')) {
    branches.push(`
      SELECT id::text AS id, 'login'::text AS bucket, 'auth'::text AS source, 'auth.login'::text AS action,
        CONCAT('Sign-in · ', email, COALESCE(' · ' || ip, '')) AS summary,
        email AS actor_name, 'user'::text AS entity_type, user_id::text AS entity_id, email AS entity_label, "timestamp" AS ts
      FROM login_logs WHERE 1=1
        ${timeFilter('"timestamp"')}
        ${qFilter(['email', 'ip'])}
        ${actorFilter(['email'])}`);
  }

  if (want('all', 'user_admin', 'users')) {
    branches.push(`
      SELECT id::text AS id, 'user_admin'::text AS bucket, 'users'::text AS source, action,
        TRIM(BOTH ' · ' FROM CONCAT_WS(' · ', COALESCE(detail, action), target_email)) AS summary,
        by_name AS actor_name, 'user'::text AS entity_type, NULL::text AS entity_id, target_email AS entity_label, "timestamp" AS ts
      FROM user_admin_logs WHERE 1=1
        ${timeFilter('"timestamp"')}
        ${qFilter(['detail', 'action', 'target_email', 'target_name', 'by_name'])}
        ${actorFilter(['by_name'])}`);
  }

  if (want('all', 'handover')) {
    branches.push(`
      SELECT id::text AS id, 'handover'::text AS bucket, 'handover'::text AS source, 'handover.create'::text AS action,
        CONCAT('Handover · ', COALESCE(employee_name, 'employee')) AS summary,
        COALESCE(it_user_name, '—') AS actor_name,
        'handover'::text AS entity_type, id::text AS entity_id, employee_name AS entity_label, transaction_date AS ts
      FROM handovers WHERE 1=1
        ${timeFilter('transaction_date')}
        ${qFilter(['employee_name', 'it_user_name'])}
        ${actorFilter(['it_user_name'])}`);
  }

  if (want('all', 'license', 'licenses')) {
    branches.push(`
      SELECT id::text || ':a' AS id, 'license'::text AS bucket, 'licenses'::text AS source, 'license.assign'::text AS action,
        CONCAT('Assigned ', software_name) AS summary, COALESCE(assigned_by_name, assigned_by, '—') AS actor_name,
        'license'::text AS entity_type, license_id::text AS entity_id, software_name AS entity_label, assigned_at AS ts
      FROM license_assignments WHERE 1=1
        ${timeFilter('assigned_at')}
        ${qFilter(['software_name', 'assigned_by', 'assigned_by_name', 'employee_name'])}
        ${actorFilter(['assigned_by', 'assigned_by_name'])}`);
    branches.push(`
      SELECT id::text || ':r' AS id, 'license'::text AS bucket, 'licenses'::text AS source, 'license.revoke'::text AS action,
        CONCAT('Revoked ', software_name) AS summary, COALESCE(revoked_by, '—') AS actor_name,
        'license'::text AS entity_type, license_id::text AS entity_id, software_name AS entity_label, revoked_at AS ts
      FROM license_assignments WHERE revoked_at IS NOT NULL
        ${timeFilter('revoked_at')}
        ${qFilter(['software_name', 'revoked_by', 'employee_name'])}
        ${actorFilter(['revoked_by'])}`);
  }

  if (want('all', 'documents')) {
    branches.push(`
      SELECT id::text AS id, 'documents'::text AS bucket, 'documents'::text AS source, 'document.upload'::text AS action,
        CONCAT('Document · ', COALESCE(filename, 'file')) AS summary,
        COALESCE(uploaded_by_name, uploaded_by, '—') AS actor_name,
        'document'::text AS entity_type, id::text AS entity_id, filename AS entity_label, created_at AS ts
      FROM handover_documents WHERE 1=1
        ${timeFilter('created_at')}
        ${qFilter(['filename', 'uploaded_by_name', 'employee_name'])}
        ${actorFilter(['uploaded_by_name', 'uploaded_by'])}`);
    branches.push(`
      SELECT id::text AS id, 'documents'::text AS bucket, 'documents'::text AS source, 'document.upload'::text AS action,
        CONCAT('Repair doc · ', COALESCE(filename, 'file')) AS summary,
        COALESCE(uploaded_by_name, uploaded_by, '—') AS actor_name,
        'document'::text AS entity_type, id::text AS entity_id, filename AS entity_label, created_at AS ts
      FROM maintenance_documents WHERE 1=1
        ${timeFilter('created_at')}
        ${qFilter(['filename', 'uploaded_by_name', 'asset_tag'])}
        ${actorFilter(['uploaded_by_name', 'uploaded_by'])}`);
  }

  if (!branches.length) {
    return { countSql: 'SELECT 0::int AS n', listSql: 'SELECT NULL WHERE false', params };
  }
  const unionSql = branches.join('\nUNION ALL\n');
  const countSql = `SELECT COUNT(*)::int AS n FROM (${unionSql}) u`;
  let listSql = `SELECT * FROM (${unionSql}) u ORDER BY ts DESC`;
  if (limit != null) listSql += ` LIMIT ${push(limit)}`;
  if (offset != null) listSql += ` OFFSET ${push(offset)}`;
  return { countSql, listSql, params };
}

async function listEvents(opts = {}) {
  const lim = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const off = Math.max(0, Number(opts.offset) || 0);
  const base = {
    source: opts.source || '',
    q: opts.q || '',
    from: opts.from || '',
    to: opts.to || '',
    actor: opts.actor || '',
  };
  const countQ = buildUnion(base);
  const listQ = buildUnion({ ...base, limit: lim, offset: off });
  const [countRes, listRes] = await Promise.all([
    query(countQ.countSql, countQ.params),
    query(listQ.listSql, listQ.params),
  ]);
  return {
    items: listRes.rows.map((r) => ({
      id: r.id,
      bucket: r.bucket,
      source: r.source,
      action: r.action,
      summary: r.summary,
      actorName: r.actor_name,
      entityType: r.entity_type,
      entityId: r.entity_id,
      entityLabel: r.entity_label,
      timestamp: r.ts,
    })),
    total: countRes.rows[0] ? countRes.rows[0].n : 0,
  };
}

/** Full detail for one timeline row (by bucket + id from listEvents). */
async function getEvent(bucket, rawId) {
  const ev = await loadEvent(bucket, rawId);
  return enrichEvent(ev);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pushUuid(set, v) {
  if (v && UUID_RE.test(String(v))) set.add(String(v));
}

function collectRelatedIds(ev) {
  const employeeIds = new Set();
  const assetIds = new Set();
  const lineIds = new Set();

  const walk = (obj, depth = 0) => {
    if (!obj || depth > 5) return;
    if (Array.isArray(obj)) {
      obj.forEach((x) => walk(x, depth + 1));
      return;
    }
    if (typeof obj !== 'object') return;
    pushUuid(employeeIds, obj.employeeId);
    pushUuid(assetIds, obj.assetId);
    pushUuid(lineIds, obj.lineId);
    if (obj.kind === 'asset') pushUuid(assetIds, obj.assetId || obj.id);
    if (obj.kind === 'line') pushUuid(lineIds, obj.lineId || obj.id);
    if (obj.items) walk(obj.items, depth + 1);
    if (obj.lines) walk(obj.lines, depth + 1);
    if (obj.body) walk(obj.body, depth + 1);
  };

  walk(ev.meta);
  walk(ev.details);
  if (ev.entityType === 'employee') pushUuid(employeeIds, ev.entityId);
  if (ev.entityType === 'asset') pushUuid(assetIds, ev.entityId);
  if (ev.entityType === 'line') pushUuid(lineIds, ev.entityId);
  if (ev.details && ev.details.employeeId) pushUuid(employeeIds, ev.details.employeeId);

  return {
    employeeIds: [...employeeIds].slice(0, 40),
    assetIds: [...assetIds].slice(0, 40),
    lineIds: [...lineIds].slice(0, 40),
  };
}

async function loadRelated(ids) {
  const related = { employees: [], assets: [], lines: [] };
  const jobs = [];
  if (ids.employeeIds.length) {
    jobs.push(query(
      `SELECT id::text, full_name AS "fullName", email, department, title, status
       FROM employees WHERE id = ANY($1::uuid[])`,
      [ids.employeeIds]
    ).then(({ rows }) => { related.employees = rows; }));
  }
  if (ids.assetIds.length) {
    jobs.push(query(
      `SELECT id::text, asset_tag AS "assetTag", brand, model, category, status,
              serial_number AS "serialNumber", location,
              current_employee_name AS "currentEmployeeName"
       FROM assets WHERE id = ANY($1::uuid[])`,
      [ids.assetIds]
    ).then(({ rows }) => { related.assets = rows; }));
  }
  if (ids.lineIds.length) {
    jobs.push(query(
      `SELECT id::text, phone_number AS "phoneNumber", operator, plan, status,
              sim_serial AS "simSerial",
              current_employee_name AS "currentEmployeeName"
       FROM mobile_lines WHERE id = ANY($1::uuid[])`,
      [ids.lineIds]
    ).then(({ rows }) => { related.lines = rows; }));
  }
  await Promise.all(jobs);
  return related;
}

async function enrichEvent(ev) {
  if (!ev) return null;
  ev.related = await loadRelated(collectRelatedIds(ev));

  const emp = (ev.related.employees && ev.related.employees[0]) || null;
  if (emp && (ev.action === 'handover.create' || ev.source === 'handover')) {
    if (!ev.entityLabel || ev.entityLabel === 'handover' || /Executed handover/i.test(ev.summary || '')) {
      ev.summary = `Handover · ${emp.fullName}`;
      ev.entityType = 'employee';
      ev.entityId = emp.id;
      ev.entityLabel = emp.fullName;
    }
    ev.details = { ...(ev.details || {}), employeeName: emp.fullName, employeeId: emp.id };
  }

  if (ev.related.assets && ev.related.assets[0] && ev.entityType === 'asset' && !ev.entityLabel) {
    ev.entityLabel = ev.related.assets[0].assetTag;
  }
  return ev;
}

async function loadEvent(bucket, rawId) {
  const id = String(rawId || '').trim();
  if (!bucket || !id) return null;

  if (bucket === 'system') {
    const { rows } = await query(
      `SELECT id::text, 'system' AS bucket, source, action, summary,
              actor_id::text AS actor_id, actor_email, actor_name,
              entity_type, entity_id, entity_label, meta, ip, user_agent, created_at AS ts
       FROM system_audit_log WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      bucket: r.bucket,
      source: r.source,
      action: r.action,
      summary: r.summary,
      actorId: r.actor_id,
      actorEmail: r.actor_email,
      actorName: r.actor_name || r.actor_email || '—',
      entityType: r.entity_type,
      entityId: r.entity_id,
      entityLabel: r.entity_label,
      timestamp: r.ts,
      ip: r.ip,
      userAgent: r.user_agent,
      meta: r.meta || null,
      details: {},
    };
  }

  if (bucket === 'asset_history') {
    const { rows } = await query(
      `SELECT id::text, asset_id::text, asset_tag, employee_id::text, employee_name,
              action_type, notes, changed_by, changed_by_name, "timestamp" AS ts
       FROM asset_history WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      bucket: 'asset_history',
      source: 'assets',
      action: r.action_type,
      summary: [r.notes, r.asset_tag].filter(Boolean).join(' · ') || r.action_type,
      actorName: r.changed_by_name || r.changed_by || '—',
      entityType: 'asset',
      entityId: r.asset_id,
      entityLabel: r.asset_tag,
      timestamp: r.ts,
      details: {
        assetTag: r.asset_tag,
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        notes: r.notes,
        changedBy: r.changed_by,
      },
    };
  }

  if (bucket === 'line_history') {
    const { rows } = await query(
      `SELECT id::text, line_id::text, phone_number, employee_id::text, employee_name,
              action_type, notes, changed_by, changed_by_name, "timestamp" AS ts
       FROM mobile_line_history WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      bucket: 'line_history',
      source: 'lines',
      action: r.action_type,
      summary: [r.notes, r.phone_number].filter(Boolean).join(' · ') || r.action_type,
      actorName: r.changed_by_name || r.changed_by || '—',
      entityType: 'line',
      entityId: r.line_id,
      entityLabel: r.phone_number,
      timestamp: r.ts,
      details: {
        phoneNumber: r.phone_number,
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        notes: r.notes,
      },
    };
  }

  if (bucket === 'login') {
    const { rows } = await query(
      `SELECT id::text, user_id::text, email, ip, user_agent, "timestamp" AS ts
       FROM login_logs WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      bucket: 'login',
      source: 'auth',
      action: 'auth.login',
      summary: `Sign-in · ${r.email}${r.ip ? ` · ${r.ip}` : ''}`,
      actorName: r.email,
      entityType: 'user',
      entityId: r.user_id,
      entityLabel: r.email,
      timestamp: r.ts,
      ip: r.ip,
      userAgent: r.user_agent,
      details: { email: r.email },
    };
  }

  if (bucket === 'user_admin') {
    const { rows } = await query(
      `SELECT id::text, target_email, target_name, action, detail, by_name, "timestamp" AS ts
       FROM user_admin_logs WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      bucket: 'user_admin',
      source: 'users',
      action: r.action,
      summary: [r.detail || r.action, r.target_email].filter(Boolean).join(' · '),
      actorName: r.by_name,
      entityType: 'user',
      entityId: null,
      entityLabel: r.target_email,
      timestamp: r.ts,
      details: {
        targetEmail: r.target_email,
        targetName: r.target_name,
        detail: r.detail,
      },
    };
  }

  if (bucket === 'handover') {
    const { rows } = await query(
      `SELECT id::text, employee_id::text, employee_name, it_user_id, it_user_name,
              transaction_date AS ts, document_type, items, template_id
       FROM handovers WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    const items = Array.isArray(r.items) ? r.items : (r.items || []);
    return {
      id: r.id,
      bucket: 'handover',
      source: 'handover',
      action: 'handover.create',
      summary: `Handover · ${r.employee_name || 'employee'}`,
      actorName: r.it_user_name || '—',
      entityType: 'handover',
      entityId: r.id,
      entityLabel: r.employee_name,
      timestamp: r.ts,
      details: {
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        documentType: r.document_type,
        templateId: r.template_id,
        itemCount: Array.isArray(items) ? items.length : 0,
        items: scrub(items),
      },
    };
  }

  if (bucket === 'license') {
    const kind = id.endsWith(':r') ? 'revoke' : 'assign';
    const realId = id.replace(/:[ar]$/, '');
    const { rows } = await query(
      `SELECT id::text, license_id::text, software_name, employee_id::text, employee_name,
              assigned_by, assigned_by_name, assigned_at, revoked_at, revoked_by
       FROM license_assignments WHERE id = $1`,
      [realId]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    const isRevoke = kind === 'revoke' && r.revoked_at;
    return {
      id: isRevoke ? `${r.id}:r` : `${r.id}:a`,
      bucket: 'license',
      source: 'licenses',
      action: isRevoke ? 'license.revoke' : 'license.assign',
      summary: `${isRevoke ? 'Revoked' : 'Assigned'} ${r.software_name}`,
      actorName: isRevoke ? (r.revoked_by || '—') : (r.assigned_by_name || r.assigned_by || '—'),
      entityType: 'license',
      entityId: r.license_id,
      entityLabel: r.software_name,
      timestamp: isRevoke ? r.revoked_at : r.assigned_at,
      details: {
        softwareName: r.software_name,
        employeeName: r.employee_name,
        assignedAt: r.assigned_at,
        revokedAt: r.revoked_at,
      },
    };
  }

  if (bucket === 'documents') {
    let { rows } = await query(
      `SELECT id::text, 'handover_doc' AS kind, filename, mime, byte_size,
              employee_name, uploaded_by, uploaded_by_name, created_at AS ts
       FROM handover_documents WHERE id = $1`,
      [id]
    );
    if (!rows[0]) {
      ({ rows } = await query(
        `SELECT id::text, 'repair_doc' AS kind, filename, mime, byte_size,
                asset_tag AS employee_name, uploaded_by, uploaded_by_name, created_at AS ts
         FROM maintenance_documents WHERE id = $1`,
        [id]
      ));
    }
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      bucket: 'documents',
      source: 'documents',
      action: 'document.upload',
      summary: `${r.kind === 'repair_doc' ? 'Repair doc' : 'Document'} · ${r.filename}`,
      actorName: r.uploaded_by_name || r.uploaded_by || '—',
      entityType: 'document',
      entityId: r.id,
      entityLabel: r.filename,
      timestamp: r.ts,
      details: {
        filename: r.filename,
        mime: r.mime,
        byteSize: r.byte_size,
        related: r.employee_name,
        docKind: r.kind,
      },
    };
  }

  return null;
}

module.exports = { logEvent, logFromRequest, describeRequest, listEvents, getEvent, scrub };
