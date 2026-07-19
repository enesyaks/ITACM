/*
 * "Zimmetlerim" — self-service view of the signed-in user's own zimmet
 * (assets, licenses, mobile lines). Backed by GET /api/me/zimmet.
 *
 * XSS: innerHTML only ever gets static markup + esc()-encoded API values.
 */
'use strict';

(function () {
  const H = (title, sub) => pageHead(title, sub);

  function metricTile(tint, icon, value, label) {
    return `<div class="card metric2 tint-${tint}">
      <span class="ms">${icon}</span>
      <div><div class="m2-value">${esc(String(value))}</div>
      <div class="m2-label">${esc(t(label))}</div></div>
    </div>`;
  }

  function assetsCard(assets) {
    const rows = assets.length
      ? assets.map((a) => `<tr>
          <td class="mono">${esc(a.assetTag || '—')}</td>
          <td><span class="ms" style="vertical-align:-4px;font-size:18px">${catIcon(a.category)}</span> ${esc(a.category || '—')}</td>
          <td>${esc([a.brand, a.model].filter(Boolean).join(' ') || '—')}</td>
          <td class="mono">${esc(a.serialNumber || '—')}</td>
          <td>${esc(a.status || '—')}</td>
          <td>${a.warrantyEndDate ? esc(fmtDate(a.warrantyEndDate)) : '—'}</td>
        </tr>`).join('')
      : `<tr><td colspan="6" class="table-empty">${esc(t('myz.none'))}</td></tr>`;
    return `<div class="card" style="margin-bottom:20px">
      <div class="card-head"><h3>${esc(t('myz.assets'))}</h3></div>
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th>${esc(t('Asset Tag'))}</th><th>${esc(t('Category'))}</th>
          <th>${esc(t('Model'))}</th><th>${esc(t('Serial'))}</th>
          <th>${esc(t('Status'))}</th><th>${esc(t('Warranty'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  }

  function licensesCard(licenses) {
    const rows = licenses.length
      ? licenses.map((l) => `<tr>
          <td>${esc(l.softwareName || '—')}</td>
          <td>${l.assignedAt ? esc(fmtDate(l.assignedAt)) : '—'}</td>
        </tr>`).join('')
      : `<tr><td colspan="2" class="table-empty">${esc(t('myz.none'))}</td></tr>`;
    return `<div class="card" style="margin-bottom:20px">
      <div class="card-head"><h3>${esc(t('myz.licenses'))}</h3></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>${esc(t('Software'))}</th><th>${esc(t('Assigned'))}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  }

  function linesCard(lines) {
    const rows = lines.length
      ? lines.map((m) => `<tr>
          <td class="mono">${esc(m.phoneNumber || '—')}</td>
          <td>${esc(m.operator || '—')}</td>
          <td>${esc(m.plan || '—')}</td>
          <td>${esc(m.status || '—')}</td>
        </tr>`).join('')
      : `<tr><td colspan="4" class="table-empty">${esc(t('myz.none'))}</td></tr>`;
    return `<div class="card">
      <div class="card-head"><h3>${esc(t('myz.lines'))}</h3></div>
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th>${esc(t('Number'))}</th><th>${esc(t('Operator'))}</th>
          <th>${esc(t('Plan'))}</th><th>${esc(t('Status'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  }

  Views.myZimmet = async (el) => {
    const d = await api('/me/zimmet');

    if (!d.linked) {
      el.innerHTML = H('nav.myZimmet', 'myz.sub')
        + `<div class="card card-pad"><div class="table-empty">${esc(t('myz.unlinked'))}</div></div>`;
      return;
    }

    const emp = d.employee || {};
    const who = [emp.fullName, emp.department].filter(Boolean).join(' · ');
    el.innerHTML = H('nav.myZimmet', 'myz.sub')
      + (who ? `<div class="card card-pad" style="margin-bottom:16px"><strong>${esc(emp.fullName || '')}</strong>${emp.department ? ` — ${esc(emp.department)}` : ''}${emp.title ? `<div class="sub">${esc(emp.title)}</div>` : ''}</div>` : '')
      + `<div class="grid-metrics" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:20px">
          ${metricTile('indigo', 'devices', d.counts.assets, 'myz.assets')}
          ${metricTile('blue', 'workspace_premium', d.counts.licenses, 'myz.licenses')}
          ${metricTile('amber', 'sim_card', d.counts.lines, 'myz.lines')}
        </div>`
      + assetsCard(d.assets || [])
      + licensesCard(d.licenses || [])
      + linesCard(d.lines || []);
  };
})();
