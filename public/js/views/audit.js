/* =============================== SYSTEM AUDIT LOG =============================== */

function auditExplain(action) {
  const key = 'audit.x.' + String(action || '').replace(/\./g, '_');
  const v = t(key);
  if (v !== key) return v;
  return t('audit.x.generic').replace('{action}', action || '—');
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
      </button>`);
  });

  return `
    <div class="audit-section">
      <div class="audit-section-label">${esc(t('audit.involved'))}</div>
      <div class="audit-link-list">${rows.join('')}</div>
    </div>`;
}

function auditDetailRows(ev) {
  const hasRelated = !!(ev.related && (
    (ev.related.employees && ev.related.employees.length)
    || (ev.related.assets && ev.related.assets.length)
    || (ev.related.lines && ev.related.lines.length)
  ));
  const rows = [
    [t('audit.when'), fmtDateTime(ev.timestamp)],
    [t('audit.actor'), ev.actorName || ev.actorEmail || '—'],
  ];
  if (ev.actorEmail && ev.actorEmail !== ev.actorName) {
    rows.push([t('audit.actorEmail'), ev.actorEmail]);
  }
  if (!hasRelated && (ev.entityLabel || ev.entityType)) {
    const label = ev.entityLabel && ev.entityLabel !== ev.entityType
      ? `${ev.entityType || ''} · ${ev.entityLabel}`.replace(/^ · /, '')
      : (ev.entityLabel || ev.entityType || '—');
    rows.push([t('audit.entity'), label]);
  }

  const d = ev.details || {};
  if (d.notes) rows.push([t('audit.notes'), d.notes]);
  if (d.softwareName) rows.push([t('audit.software'), d.softwareName]);
  if (d.targetEmail) rows.push([t('audit.target'), d.targetEmail + (d.targetName ? ` (${d.targetName})` : '')]);
  if (d.detail) rows.push([t('audit.detailNote'), d.detail]);
  if (d.documentType) rows.push([t('audit.docType'), d.documentType]);
  if (d.templateId) rows.push([t('audit.template'), d.templateId]);
  if (d.filename) rows.push([t('audit.filename'), d.filename]);
  if (d.itemCount != null) rows.push([t('audit.itemCount'), String(d.itemCount)]);

  rows.push([t('audit.source'), ev.source || ev.bucket || '—']);
  rows.push([t('audit.action'), ev.action || '—']);
  if (ev.ip) rows.push([t('audit.ip'), ev.ip]);

  const meta = ev.meta || {};
  if (meta.method && meta.path) rows.push([t('audit.path'), `${meta.method} ${meta.path}`]);
  else if (meta.path) rows.push([t('audit.path'), meta.path]);
  if (meta.status != null) rows.push([t('audit.httpStatus'), String(meta.status)]);

  return rows;
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
    const rows = auditDetailRows(ev);
    const bodyPayload = ev.meta && ev.meta.body != null ? ev.meta.body : null;
    const legacyItems = (ev.details && Array.isArray(ev.details.items)) ? ev.details.items : null;
    const showRaw = bodyPayload != null || (legacyItems && legacyItems.length);
    const extraJson = showRaw
      ? { ...(bodyPayload != null ? { requestBody: bodyPayload } : {}), ...(legacyItems && legacyItems.length ? { items: legacyItems } : {}) }
      : null;

    const overlay = $('#modal-root .modal-overlay');
    if (!overlay) return;
    const head = overlay.querySelector('.modal-head h3');
    if (head) head.textContent = ev.summary || ev.action || t('audit.detailTitle');
    const bodyEl = overlay.querySelector('.modal-body');
    if (!bodyEl) return;
    bodyEl.innerHTML = `
      <div class="audit-detail">
        <p class="audit-lede">${esc(auditExplain(ev.action))}</p>
        ${auditRelatedSection(ev)}
        <div class="audit-section">
          <div class="audit-section-label">${esc(t('audit.meta'))}</div>
          <div class="form-grid audit-meta-grid">
            ${rows.map(([k, v]) => `
              <div>
                <span class="cell-sub">${esc(k)}</span>
                <div class="${String(v).length > 40 || k === t('audit.path') ? 'mono' : ''}" style="word-break:break-word;margin-top:2px">${esc(v)}</div>
              </div>`).join('')}
          </div>
        </div>
        ${ev.userAgent ? `<div class="cell-sub" style="word-break:break-word">${esc(t('audit.userAgent'))}: ${esc(ev.userAgent)}</div>` : ''}
        ${extraJson ? `
          <details class="audit-tech">
            <summary>${esc(t('audit.technical'))}</summary>
            <pre class="audit-json">${esc(JSON.stringify(extraJson, null, 2))}</pre>
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

  const bucketPill = (b) => {
    const map = {
      system: 'pill-indigo',
      asset_history: 'pill-blue',
      line_history: 'pill-blue',
      login: 'pill-emerald',
      user_admin: 'pill-amber',
      handover: 'pill-indigo',
      license: 'pill-blue',
      documents: 'pill-amber',
    };
    return `<span class="pill ${map[b] || 'pill-slate'}">${esc(b || '—')}</span>`;
  };

  el.innerHTML = `
    ${pageHead(t('audit.title'), t('audit.subtitle'), '')}

    <div class="card" style="margin-bottom:14px">
      <div class="card-pad toolbar" style="gap:8px">
        <div class="search-box" style="flex:1;min-width:160px">
          <span class="ms">search</span>
          <input type="search" id="audit-q" placeholder="${esc(t('audit.searchPh'))}" value="${esc(params.search || '')}">
        </div>
        <select id="audit-source" style="min-width:140px">
          ${SOURCES.map((s) => `<option value="${esc(s.v)}" ${params.source === s.v ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>
        <input type="search" id="audit-actor" placeholder="${esc(t('audit.actorPh'))}" value="${esc(params.actor || '')}" style="width:140px">
        <input type="date" id="audit-from" value="${esc(params.from || '')}" title="${esc(t('audit.from'))}">
        <input type="date" id="audit-to" value="${esc(params.to || '')}" title="${esc(t('audit.to'))}">
        <button class="btn btn-outline" id="audit-apply"><span class="ms">filter_list</span> ${esc(t('audit.apply'))}</button>
      </div>
    </div>

    <div class="card">
      <div class="m-audit-list">
        ${items.length === 0 ? `<div class="table-empty" style="padding:28px">${esc(t('audit.empty'))}</div>` :
          items.map((x) => `
            <div class="m-audit-card audit-row" role="button" tabindex="0" data-bucket="${esc(x.bucket)}" data-id="${esc(x.id)}">
              <div class="m-audit-top">
                ${bucketPill(x.bucket)}
                <span class="mono cell-sub">${esc(fmtDateTime(x.timestamp))}</span>
              </div>
              <div class="cell-title">${esc(x.summary || x.action)}</div>
              <div class="cell-sub">${esc(x.action)} · ${esc(x.source || '—')}</div>
              <div class="m-audit-meta">
                <span><span class="ms ms-sm">person</span> ${esc(x.actorName || '—')}</span>
                ${x.entityLabel ? `<span><span class="ms ms-sm">sell</span> ${esc(x.entityLabel)}</span>` : ''}
              </div>
            </div>`).join('')}
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th>${esc(t('audit.when'))}</th>
          <th>${esc(t('audit.source'))}</th>
          <th>${esc(t('audit.action'))}</th>
          <th>${esc(t('audit.summary'))}</th>
          <th>${esc(t('audit.actor'))}</th>
          <th>${esc(t('audit.entity'))}</th>
        </tr></thead>
        <tbody>
          ${items.length === 0 ? `<tr><td colspan="6" class="table-empty">${esc(t('audit.empty'))}</td></tr>` :
            items.map((x) => `
              <tr class="audit-row" role="button" tabindex="0" data-bucket="${esc(x.bucket)}" data-id="${esc(x.id)}">
                <td class="mono cell-sub" style="white-space:nowrap">${esc(fmtDateTime(x.timestamp))}</td>
                <td>${bucketPill(x.bucket)}</td>
                <td class="mono">${esc(x.action)}</td>
                <td>${esc(x.summary || '—')}</td>
                <td>${esc(x.actorName || '—')}</td>
                <td class="cell-sub">${esc(x.entityLabel || x.entityType || '—')}</td>
              </tr>`).join('')}
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
