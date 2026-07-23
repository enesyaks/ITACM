/* =============================== SYSTEM AUDIT LOG =============================== */

const AUDIT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIT_VERB_KEY = {
  post: 'audit.verb.post', put: 'audit.verb.put', patch: 'audit.verb.patch',
  delete: 'audit.verb.delete', get: 'audit.verb.get',
};

/** Drop the record ids baked into HTTP-derived actions so a lookup can match:
 *  "put.auth.users.32e7cbd7-….permission-group" → "put.auth.users.permission-group" */
function auditActionSegments(action) {
  return String(action || '')
    .split('.')
    .map((s) => s.trim())
    .filter((s) => s && !AUDIT_UUID_RE.test(s) && !/^\d+$/.test(s));
}

function auditLookup(prefix, action) {
  const tryKey = (a) => {
    const key = prefix + String(a).replace(/\./g, '_');
    const v = t(key);
    return v !== key ? v : null;
  };
  return tryKey(action) || tryKey(auditActionSegments(action).join('.'));
}

/**
 * Last-resort title for actions nobody wrote a translation for. Reads the
 * remaining path segments as words and appends the verb, so
 * "put.auth.users.<id>.permission-group" becomes
 * "Auth · Users · Permission group — updated" instead of the raw string.
 */
function auditFallbackTitle(action) {
  const segs = auditActionSegments(action);
  if (!segs.length) return t('audit.x.generic').replace('{action}', action || '—');
  const verbKey = AUDIT_VERB_KEY[segs[0].toLowerCase()];
  const verb = verbKey ? t(verbKey) : '';
  const words = (verbKey ? segs.slice(1) : segs).map(auditPrettyField);
  if (!words.length) return verb || t('audit.x.generic').replace('{action}', action || '—');
  const what = words.join(' · ');
  return verb ? `${what} — ${verb}` : what;
}

function auditExplain(action) {
  const hit = auditLookup('audit.x.', action);
  if (hit) return hit;
  // Fallback for raw HTTP-derived actions like post.auth.verify-token
  if (/verify.?token/i.test(String(action || ''))) {
    const v2 = t('audit.x.auth_verify_token');
    if (v2 !== 'audit.x.auth_verify_token') return v2;
  }
  return auditFallbackTitle(action);
}

function auditLooksTechnical(text) {
  const s = String(text || '');
  return /^[A-Z]+\s+\//.test(s) || /^\/api\//.test(s);
}

function auditHeadline(ev) {
  const summary = String(ev.summary || '').trim();
  const explain = auditExplain(ev.action);
  if (!summary || auditLooksTechnical(summary) || summary === ev.action) {
    // Prefer a short friendly title over the long explanation sentence when possible.
    const short = auditLookup('audit.title.', ev.action);
    if (short) return short;
    if (/verify.?token/i.test(String(ev.action || '')) || /verify.?token/i.test(summary)) {
      const s2 = t('audit.title.auth_verify_token');
      if (s2 !== 'audit.title.auth_verify_token') return s2;
    }
    return explain;
  }
  return summary;
}

function auditHttpTone(status) {
  const n = Number(status);
  if (!Number.isFinite(n)) return 'slate';
  if (n >= 200 && n < 300) return 'ok';
  if (n >= 400 && n < 500) return 'warn';
  if (n >= 500) return 'bad';
  return 'slate';
}

function auditFact(icon, label, value, hint, opts = {}) {
  if (value == null || value === '') return '';
  const tone = opts.tone || '';
  return `
    <div class="audit-fact${tone ? ` tone-${tone}` : ''}">
      <span class="audit-fact-icon"><span class="ms">${esc(icon)}</span></span>
      <div class="audit-fact-body">
        <div class="audit-fact-label">${esc(label)}</div>
        <div class="audit-fact-value${opts.mono ? ' mono' : ''}">${opts.html ? value : esc(value)}</div>
        ${hint ? `<div class="audit-fact-hint">${esc(hint)}</div>` : ''}
      </div>
    </div>`;
}

function auditBucketMeta(b) {
  const map = {
    system: { pill: 'pill-indigo', icon: 'tune' },
    asset_history: { pill: 'pill-blue', icon: 'devices' },
    line_history: { pill: 'pill-blue', icon: 'sim_card' },
    login: { pill: 'pill-emerald', icon: 'login' },
    user_admin: { pill: 'pill-amber', icon: 'manage_accounts' },
    handover: { pill: 'pill-indigo', icon: 'assignment_turned_in' },
    license: { pill: 'pill-blue', icon: 'workspace_premium' },
    documents: { pill: 'pill-amber', icon: 'description' },
  };
  return map[b] || { pill: 'pill-slate', icon: 'history' };
}

function auditBucketPill(b) {
  const m = auditBucketMeta(b);
  return `<span class="pill ${m.pill}">${esc(b || '—')}</span>`;
}

function auditRelatedSection(ev) {
  const rel = ev.related || {};
  const employees = rel.employees || [];
  const assets = rel.assets || [];
  const lines = rel.lines || [];
  if (!employees.length && !assets.length && !lines.length) return '';

  const rows = [];
  employees.forEach((e) => {
    rows.push(`
      <button type="button" class="audit-link-row" data-open-emp="${esc(e.id)}">
        <span class="avatar">${esc(initials(e.fullName || '?'))}</span>
        <span class="grow">
          <strong>${esc(e.fullName || '—')}</strong>
          <span class="cell-sub">${esc([e.email, e.department, e.title].filter(Boolean).join(' · '))}</span>
        </span>
        ${badge(e.status || '—')}
        <span class="ms audit-link-chev">chevron_right</span>
      </button>`);
  });
  assets.forEach((a) => {
    rows.push(`
      <button type="button" class="audit-link-row" data-open-asset="${esc(a.id)}">
        <span class="icon-chip chip-indigo"><span class="ms">devices</span></span>
        <span class="grow">
          <strong class="mono">${esc(a.assetTag || '—')}</strong>
          <span class="cell-sub">${esc([a.brand, a.model, a.category].filter(Boolean).join(' · '))}${a.serialNumber ? ' · ' + esc(a.serialNumber) : ''}</span>
        </span>
        ${badge(a.status || '—')}
        <span class="ms audit-link-chev">chevron_right</span>
      </button>`);
  });
  lines.forEach((l) => {
    rows.push(`
      <button type="button" class="audit-link-row" data-open-line="${esc(l.id)}">
        <span class="icon-chip chip-indigo"><span class="ms">sim_card</span></span>
        <span class="grow">
          <strong class="mono">${esc(l.phoneNumber || '—')}</strong>
          <span class="cell-sub">${esc([l.operator, l.plan].filter(Boolean).join(' · ') || t('nav.lines'))}</span>
        </span>
        ${badge(l.status || '—')}
        <span class="ms audit-link-chev">chevron_right</span>
      </button>`);
  });

  return `
    <section class="audit-sec">
      <div class="audit-sec-head"><strong>${esc(t('audit.involved'))}</strong></div>
      <div class="audit-link-list">${rows.join('')}</div>
    </section>`;
}

function auditContextRows(ev) {
  const hasRelated = !!(ev.related && (
    (ev.related.employees && ev.related.employees.length)
    || (ev.related.assets && ev.related.assets.length)
    || (ev.related.lines && ev.related.lines.length)
  ));
  const rows = [];
  if (!hasRelated && (ev.entityLabel || ev.entityType)) {
    const label = ev.entityLabel && ev.entityLabel !== ev.entityType
      ? `${ev.entityType || ''} · ${ev.entityLabel}`.replace(/^ · /, '')
      : (ev.entityLabel || ev.entityType || '—');
    rows.push({
      icon: 'sell',
      label: t('audit.entity'),
      value: label,
      hint: t('audit.hint.entity'),
    });
  }

  const d = ev.details || {};
  if (d.notes) rows.push({ icon: 'sticky_note_2', label: t('audit.notes'), value: d.notes, hint: t('audit.hint.notes') });
  if (d.softwareName) rows.push({ icon: 'workspace_premium', label: t('audit.software'), value: d.softwareName, hint: t('audit.hint.software') });
  if (d.targetEmail) {
    rows.push({
      icon: 'person_search',
      label: t('audit.target'),
      value: d.targetEmail + (d.targetName ? ` (${d.targetName})` : ''),
      hint: t('audit.hint.target'),
    });
  }
  if (d.detail) rows.push({ icon: 'notes', label: t('audit.detailNote'), value: d.detail, hint: t('audit.hint.detail') });
  if (d.documentType) rows.push({ icon: 'description', label: t('audit.docType'), value: d.documentType, hint: t('audit.hint.docType') });
  if (d.templateId) rows.push({ icon: 'article', label: t('audit.template'), value: d.templateId, hint: t('audit.hint.template') });
  if (d.filename) rows.push({ icon: 'attach_file', label: t('audit.filename'), value: d.filename, hint: t('audit.hint.filename'), mono: true });
  if (d.itemCount != null) rows.push({ icon: 'tag', label: t('audit.itemCount'), value: String(d.itemCount), hint: t('audit.hint.itemCount') });
  return rows;
}

/* --------------------------- what actually changed --------------------------- */

/** "serial_number" / "serialNumber" → "Serial number" (field names aren't localized). */
function auditPrettyField(key) {
  const s = String(key || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '—';
}

/** Human-readable one-liner for any value found in a request body. */
function auditFormatValue(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no');
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return '—';
    const primitives = v.every((x) => x == null || typeof x !== 'object');
    if (primitives) {
      const head = v.slice(0, 5).map((x) => String(x)).join(', ');
      return v.length > 5 ? `${head} +${v.length - 5}` : head;
    }
    return `${v.length} × ${t('audit.itemCount')}`;
  }
  if (typeof v === 'object') {
    const json = JSON.stringify(v);
    return json.length > 120 ? `${json.slice(0, 120)}…` : json;
  }
  const s = String(v);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

/**
 * History notes are the only place a *previous* value survives. Services write
 * them as " · "-joined fragments in three shapes:
 *   "brand: Dell → HP"  (labelled change)
 *   "In Stock → Sold"   (status change, label implied)
 *   "Price: 250"        (labelled value, no previous side)
 * Anything else is prose that already shows as the headline — skipped.
 */
function auditParseDiffNote(text) {
  return String(text || '')
    .split(' · ')
    .map((raw) => {
      const part = raw.trim();
      if (!part) return null;
      const labelled = /^([^:]{1,48}):\s*(.*?)\s*(?:→|->)\s*(.+)$/.exec(part);
      if (labelled) return { field: labelled[1].trim(), from: labelled[2].trim(), to: labelled[3].trim() };
      const bare = /^(.{1,60}?)\s*(?:→|->)\s*(.{1,60})$/.exec(part);
      if (bare) return { field: t('common.status'), from: bare[1].trim(), to: bare[2].trim() };
      const value = /^([^:]{1,48}):\s*(.+)$/.exec(part);
      if (value) return { field: value[1].trim(), to: value[2].trim() };
      return null;
    })
    .filter(Boolean);
}

/** Keys that are plumbing, not a change the reader cares about. */
const AUDIT_BODY_SKIP = new Set(['id', 'ids', 'password', 'token', 'csrf', 'dryrun', 'confirm']);

function auditChangeRows(ev) {
  const details = ev.details || {};
  // Prefer the diff note — it carries both sides of the change.
  const diffs = auditParseDiffNote(details.notes || ev.summary || '');
  if (diffs.length) return diffs;

  const body = ev.meta && ev.meta.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  return Object.entries(body)
    .filter(([k, v]) => !AUDIT_BODY_SKIP.has(k.toLowerCase()) && v !== undefined)
    .map(([field, v]) => ({ field, to: auditFormatValue(v) }));
}

function auditChangesSection(ev) {
  const rows = auditChangeRows(ev);
  if (!rows.length) return '';
  const hasBefore = rows.some((r) => r.from != null);
  return `
    <section class="audit-sec">
      <div class="audit-sec-head">
        <strong>${esc(t('audit.changes'))}</strong>
        <span>${esc(hasBefore ? t('audit.changesSub') : t('audit.changesSubNew'))}</span>
      </div>
      <div class="audit-diff">
        ${rows.map((r) => `
          <div class="audit-diff-row">
            <div class="audit-diff-field">${esc(auditPrettyField(r.field))}</div>
            <div class="audit-diff-values">
              ${r.from != null ? `<span class="audit-diff-old">${esc(r.from || '—')}</span>
                <span class="ms audit-diff-arrow">arrow_forward</span>` : ''}
              <span class="audit-diff-new">${esc(r.to || '—')}</span>
            </div>
          </div>`).join('')}
      </div>
    </section>`;
}

async function showAuditDetail(bucket, id) {
  openModal({
    title: t('audit.detailTitle'),
    wide: true,
    body: `<div class="table-empty" style="padding:24px">${esc(t('common.loading'))}</div>`,
    foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>`,
  });
  try {
    const ev = await api(`/audit/${encodeURIComponent(bucket)}/${encodeURIComponent(id)}`);
    const contextRows = auditContextRows(ev);
    const bodyPayload = ev.meta && ev.meta.body != null ? ev.meta.body : null;
    const legacyItems = (ev.details && Array.isArray(ev.details.items)) ? ev.details.items : null;
    const showRaw = bodyPayload != null || (legacyItems && legacyItems.length);
    const extraJson = showRaw
      ? { ...(bodyPayload != null ? { requestBody: bodyPayload } : {}), ...(legacyItems && legacyItems.length ? { items: legacyItems } : {}) }
      : null;

    const overlay = $('#modal-root .modal-overlay');
    if (!overlay) return;
    const headline = auditHeadline(ev);
    const explain = auditExplain(ev.action);
    const head = overlay.querySelector('.modal-head h3');
    if (head) head.textContent = headline;
    const bodyEl = overlay.querySelector('.modal-body');
    if (!bodyEl) return;
    const bm = auditBucketMeta(ev.bucket);
    const meta = ev.meta || {};
    const httpStatus = meta.status;
    const httpTone = auditHttpTone(httpStatus);
    const pathLine = meta.method && meta.path
      ? `${meta.method} ${meta.path}`
      : (meta.path || '');
    const resultLabel = httpStatus != null
      ? (httpTone === 'ok' ? t('audit.resultOk') : httpTone === 'warn' ? t('audit.resultClientErr') : httpTone === 'bad' ? t('audit.resultServerErr') : t('audit.httpStatus'))
      : t('audit.source');
    const resultValue = httpStatus != null
      ? `${httpStatus}${httpTone === 'ok' ? ' · OK' : ''}`
      : (ev.source || ev.bucket || '—');

    const factsHtml = [
      auditFact('schedule', t('audit.when'), fmtDateTime(ev.timestamp), t('audit.hint.when')),
      auditFact(
        'person',
        t('audit.actor'),
        ev.actorName || ev.actorEmail || '—',
        ev.actorEmail && ev.actorEmail !== ev.actorName
          ? `${t('audit.hint.actor')} · ${ev.actorEmail}`
          : t('audit.hint.actor')
      ),
      auditFact(
        httpTone === 'ok' ? 'check_circle' : httpTone === 'warn' ? 'warning' : httpTone === 'bad' ? 'error' : 'hub',
        resultLabel,
        resultValue,
        t('audit.hint.result'),
        { tone: httpTone === 'slate' ? '' : httpTone }
      ),
      ev.ip ? auditFact('language', t('audit.ip'), ev.ip, t('audit.hint.ip'), { mono: true }) : '',
    ].join('');

    const contextHtml = contextRows.length
      ? `<section class="audit-sec">
          <div class="audit-sec-head"><strong>${esc(t('audit.context'))}</strong><span>${esc(t('audit.contextSub'))}</span></div>
          <div class="audit-facts">${contextRows.map((r) =>
            auditFact(r.icon, r.label, r.value, r.hint, { mono: !!r.mono })).join('')}</div>
        </section>`
      : '';

    const techBits = [];
    if (ev.action) techBits.push(`<div class="audit-tech-row"><span>${esc(t('audit.action'))}</span><code>${esc(ev.action)}</code></div>`);
    if (ev.source || ev.bucket) techBits.push(`<div class="audit-tech-row"><span>${esc(t('audit.source'))}</span><code>${esc(ev.source || ev.bucket)}</code></div>`);
    if (pathLine) techBits.push(`<div class="audit-tech-row"><span>${esc(t('audit.path'))}</span><code>${esc(pathLine)}</code></div>`);
    if (httpStatus != null) techBits.push(`<div class="audit-tech-row"><span>${esc(t('audit.httpStatus'))}</span><code>${esc(String(httpStatus))}</code></div>`);
    if (ev.userAgent) techBits.push(`<div class="audit-tech-row full"><span>${esc(t('audit.userAgent'))}</span><code class="audit-ua">${esc(ev.userAgent)}</code></div>`);
    if (extraJson) {
      techBits.push(`<pre class="audit-json">${esc(JSON.stringify(extraJson, null, 2))}</pre>`);
    }

    bodyEl.innerHTML = `
      <div class="audit-detail">
        <header class="audit-hero">
          <span class="audit-hero-icon"><span class="ms">${esc(bm.icon)}</span></span>
          <div class="audit-hero-main">
            <div class="audit-hero-title">${esc(headline)}</div>
            <p class="audit-lede">${esc(explain)}</p>
            <div class="audit-hero-meta">
              ${auditBucketPill(ev.bucket)}
              <span>${esc(fmtDateTime(ev.timestamp))}</span>
              <span>·</span>
              <span>${esc(ev.actorName || ev.actorEmail || '—')}</span>
            </div>
          </div>
        </header>
        ${auditChangesSection(ev)}
        <section class="audit-sec">
          <div class="audit-sec-head"><strong>${esc(t('audit.snapshot'))}</strong><span>${esc(t('audit.snapshotSub'))}</span></div>
          <div class="audit-facts">${factsHtml}</div>
        </section>
        ${auditRelatedSection(ev)}
        ${contextHtml}
        ${techBits.length ? `
          <details class="audit-tech">
            <summary><span class="ms">terminal</span> ${esc(t('audit.technical'))}</summary>
            <p class="audit-tech-lead">${esc(t('audit.technicalHint'))}</p>
            <div class="audit-tech-grid">${techBits.join('')}</div>
          </details>` : ''}
      </div>`;

    bodyEl.querySelectorAll('[data-open-emp]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        closeModal();
        try {
          const full = await api(`/employees/${encodeURIComponent(btn.dataset.openEmp)}`);
          if (typeof showEmployeeDetail === 'function') showEmployeeDetail(full);
          else location.hash = '#/employees';
        } catch {
          location.hash = '#/employees';
        }
      });
    });
    bodyEl.querySelectorAll('[data-open-asset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeModal();
        if (typeof showAssetDetail === 'function') showAssetDetail(btn.dataset.openAsset);
        else location.hash = '#/assets';
      });
    });
    bodyEl.querySelectorAll('[data-open-line]').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeModal();
        location.hash = '#/lines';
      });
    });
  } catch (err) {
    const overlay = $('#modal-root .modal-overlay');
    const bodyEl = overlay && overlay.querySelector('.modal-body');
    if (bodyEl) {
      bodyEl.innerHTML = `<div class="form-error">${esc(err.message || t('audit.notFound'))}</div>`;
    }
  }
}

Views.audit = async function (el, params = {}) {
  if (isStaleView(el)) return;
  if (!Auth.can('canViewAudit')) {
    el.innerHTML = `<div class="card card-pad"><p class="cell-sub">${esc(t('audit.forbidden'))}</p></div>`;
    return;
  }

  const PAGE = 50;
  const page = Math.max(1, Number(params.page) || 1);
  const q = new URLSearchParams();
  if (params.source) q.set('source', params.source);
  if (params.search) q.set('q', params.search);
  if (params.actor) q.set('actor', params.actor);
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  q.set('limit', String(PAGE));
  q.set('offset', String((page - 1) * PAGE));

  const data = await api('/audit?' + q.toString());
  if (isStaleView(el)) return;
  const items = (data && data.items) || [];
  const total = (data && data.total) || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const SOURCES = [
    { v: '', label: t('audit.allSources') },
    { v: 'assets', label: t('nav.hardware') },
    { v: 'employees', label: t('nav.employees') },
    { v: 'handover', label: t('nav.handover') },
    { v: 'users', label: t('nav.users') },
    { v: 'auth', label: t('audit.srcAuth') },
    { v: 'documents', label: t('audit.srcDocuments') },
    { v: 'licenses', label: t('nav.software') },
    { v: 'lines', label: t('nav.lines') },
    { v: 'maintenance', label: t('nav.maintenance') },
    { v: 'stockcount', label: t('nav.stockcount') },
    { v: 'catalog', label: t('nav.catalog') },
    { v: 'import', label: t('audit.srcImport') },
    { v: 'settings', label: t('common.settings') },
    { v: 'asset_history', label: t('audit.srcAssetHistory') },
    { v: 'login', label: t('audit.srcLogin') },
  ];

  const hasFilters = !!(params.search || params.source || params.actor || params.from || params.to);

  el.innerHTML = `
    ${pageHead(t('audit.title'), t('audit.subtitle'), '')}

    <div class="card audit-filters">
      <div class="card-pad audit-filters-inner">
        <div class="search-box audit-search">
          <span class="ms">search</span>
          <input type="search" id="audit-q" placeholder="${esc(t('audit.searchPh'))}" value="${esc(params.search || '')}">
        </div>
        <select id="audit-source" class="audit-filter-select" title="${esc(t('audit.allSources'))}">
          ${SOURCES.map((s) => `<option value="${esc(s.v)}" ${params.source === s.v ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>
        <input type="search" id="audit-actor" class="audit-filter-input" placeholder="${esc(t('audit.actorPh'))}" value="${esc(params.actor || '')}">
        <div class="audit-date-range">
          <input type="date" id="audit-from" value="${esc(params.from || '')}" title="${esc(t('audit.from'))}">
          <span class="audit-date-sep">–</span>
          <input type="date" id="audit-to" value="${esc(params.to || '')}" title="${esc(t('audit.to'))}">
        </div>
        <button class="btn btn-outline" id="audit-apply"><span class="ms">filter_list</span> ${esc(t('audit.apply'))}</button>
        ${hasFilters ? `<button type="button" class="btn btn-outline" id="audit-clear" title="Clear filters"><span class="ms">close</span></button>` : ''}
      </div>
    </div>

    <div class="card audit-list-card">
      <div class="m-audit-list">
        ${items.length === 0 ? `<div class="table-empty" style="padding:28px">${esc(t('audit.empty'))}</div>` :
          items.map((x) => {
            const bm = auditBucketMeta(x.bucket);
            const title = auditHeadline(x);
            return `
            <div class="m-audit-card audit-row" role="button" tabindex="0" data-bucket="${esc(x.bucket)}" data-id="${esc(x.id)}">
              <div class="m-audit-top">
                ${auditBucketPill(x.bucket)}
                <span class="mono cell-sub">${esc(fmtDateTime(x.timestamp))}</span>
              </div>
              <div class="cell-title">${esc(title)}</div>
              <div class="cell-sub">${esc(auditExplain(x.action))}</div>
              <div class="m-audit-meta">
                <span><span class="ms ms-sm">person</span> ${esc(x.actorName || '—')}</span>
                ${x.entityLabel ? `<span><span class="ms ms-sm">${esc(bm.icon)}</span> ${esc(x.entityLabel)}</span>` : ''}
              </div>
            </div>`;
          }).join('')}
      </div>
      <div class="table-wrap"><table class="data audit-table">
        <thead><tr>
          <th>${esc(t('audit.when'))}</th>
          <th>${esc(t('audit.summary'))}</th>
          <th>${esc(t('audit.source'))}</th>
          <th>${esc(t('audit.actor'))}</th>
          <th>${esc(t('audit.entity'))}</th>
          <th class="audit-col-go"></th>
        </tr></thead>
        <tbody>
          ${items.length === 0 ? `<tr><td colspan="6" class="table-empty">${esc(t('audit.empty'))}</td></tr>` :
            items.map((x) => {
              const title = auditHeadline(x);
              const explain = auditExplain(x.action);
              return `
              <tr class="audit-row" role="button" tabindex="0" data-bucket="${esc(x.bucket)}" data-id="${esc(x.id)}">
                <td class="audit-when">
                  <span class="audit-when-main">${esc(fmtDateTime(x.timestamp))}</span>
                </td>
                <td class="audit-event">
                  <div class="audit-event-title">${esc(title)}</div>
                  <div class="audit-event-sub">${esc(explain)}</div>
                </td>
                <td>${auditBucketPill(x.bucket)}</td>
                <td>
                  <div class="audit-actor">
                    <span class="avatar avatar-sm">${esc(initials(x.actorName || x.actorEmail || '?'))}</span>
                    <span class="audit-actor-name">${esc(x.actorName || '—')}</span>
                  </div>
                </td>
                <td class="audit-entity">${esc(x.entityLabel || x.entityType || '—')}</td>
                <td class="audit-go"><span class="ms">chevron_right</span></td>
              </tr>`;
            }).join('')}
        </tbody>
      </table></div>
      <div class="table-foot">
        ${esc(t('common.showingOf')
          .replace('{from}', String(total ? (page - 1) * PAGE + 1 : 0))
          .replace('{to}', String(Math.min(page * PAGE, total)))
          .replace('{total}', total.toLocaleString()))}
        <span class="spacer"></span>
        <div class="pager">
          <button data-pg="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${esc(t('common.prev'))}</button>
          <button class="on" disabled>${page} / ${pages}</button>
          <button data-pg="${page + 1}" ${page >= pages ? 'disabled' : ''}>${esc(t('common.next'))}</button>
        </div>
      </div>
    </div>`;

  const go = (p) => {
    if (isStaleView(el)) return;
    const next = { ...params, ...p };
    Object.keys(next).forEach((k) => { if (!next[k]) delete next[k]; });
    location.hash = '#/audit' + (Object.keys(next).length ? '?' + new URLSearchParams(next).toString() : '');
  };

  $('#audit-apply', el).addEventListener('click', () => go({
    search: $('#audit-q', el).value.trim(),
    source: $('#audit-source', el).value,
    actor: $('#audit-actor', el).value.trim(),
    from: $('#audit-from', el).value,
    to: $('#audit-to', el).value,
    page: 1,
  }));
  const clearBtn = $('#audit-clear', el);
  if (clearBtn) clearBtn.addEventListener('click', () => { location.hash = '#/audit'; });
  $('#audit-q', el).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#audit-apply', el).click();
  });
  el.querySelectorAll('[data-pg]').forEach((b) => {
    b.addEventListener('click', () => go({ page: b.dataset.pg }));
  });

  const openFromEl = (node) => {
    const row = node.closest('[data-bucket][data-id]');
    if (!row) return;
    showAuditDetail(row.dataset.bucket, row.dataset.id);
  };
  el.addEventListener('click', (e) => openFromEl(e.target));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const row = e.target.closest('[data-bucket][data-id]');
      if (row) { e.preventDefault(); showAuditDetail(row.dataset.bucket, row.dataset.id); }
    }
  });
};
