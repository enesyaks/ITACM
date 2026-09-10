/**
 * Devices that are away at a repair shop.
 *
 * The page showed a DATE where the only question is a DURATION: "sent
 * 30 August" makes the reader subtract from today, sixteen times over. So the
 * elapsed day count is the subject now, and it is set as one — a large tabular
 * figure at the head of every row, read down the left edge in a single pass,
 * longest wait first.
 *
 * They are grouped by service company, because chasing a repair is done by
 * telephone, to a company — not to a device. The company holding the longest
 * outstanding job comes first, which makes the page a call list in order.
 */
Views.maintenance = async function (el, params = {}) {
  const openOnly = params.open !== 'false';
  const canEdit = Auth.canIam('maintenance', 'update') || Auth.canIam('maintenance', 'manage');
  const canViewCosts = Auth.canIam('maintenance', 'view_confidential') || Auth.can('canViewMaintenanceCosts');
  const logs = await api('/maintenance' + (openOnly ? '?open=true' : ''));

  const DAY = 86400000;
  const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / DAY));
  const daysOut = (m) => daysBetween(m.sentDate, m.returnDate || Date.now());

  const noteCount = (m) => (m.progressNotes || []).length;

  const openRow = (m) => {
    const days = daysOut(m);
    return `<div class="mnt-row" data-find=""${esc(((m.assetTag || '') + ' ' + (m.serviceCompany || '') + ' ' + (m.issueDescription || '')).toLowerCase())}">
      <span class="mnt-age"><b>${days}</b><i>${esc(t('mnt.daysUnit'))}</i></span>
      <span class="mnt-main">
        <span class="mnt-issue">${esc(m.issueDescription || '—')}</span>
        <span class="mnt-meta"><span class="mono">${esc(m.assetTag || '—')}</span></span>
      </span>
      ${canViewCosts ? `<span class="mnt-cost">${m.cost != null ? esc(fmtMoney(m.cost)) : ''}</span>` : ''}
      <span class="mnt-act">
        <button type="button" class="mnt-icon${noteCount(m) ? '' : ' is-quiet'}" data-notes="${esc(m.id)}" title="${esc(t('mnt.notes'))}" aria-label="${esc(t('mnt.notes'))}${noteCount(m) ? ` (${noteCount(m)})` : ''}"><span class="ms ms-sm">chat</span>${noteCount(m) ? `<span class="mnt-n">${noteCount(m)}</span>` : ''}</button>
        ${canEdit ? `<button type="button" class="btn btn-outline btn-sm mnt-back" data-closelog="${esc(m.id)}">${esc(t('mnt.backLabel'))}</button>` : ''}
      </span>
    </div>`;
  };

  const doneRow = (m) => `<div class="mnt-row is-done" data-find="${esc(((m.assetTag || '') + ' ' + (m.serviceCompany || '') + ' ' + (m.issueDescription || '')).toLowerCase())}">
      <span class="mnt-age is-past"><b>${daysBetween(m.sentDate, m.returnDate)}</b><i>${esc(t('mnt.daysUnit'))}</i></span>
      <span class="mnt-main">
        <span class="mnt-issue">${esc(m.issueDescription || '—')}</span>
        <span class="mnt-meta"><span class="mono">${esc(m.assetTag || '—')}</span><span>${esc(m.serviceCompany || '—')}</span></span>
      </span>
      ${canViewCosts ? `<span class="mnt-cost">${m.cost != null ? esc(fmtMoney(m.cost)) : ''}</span>` : ''}
      <span class="mnt-act">${noteCount(m) ? `<button type="button" class="mnt-icon" data-notes="${esc(m.id)}" aria-label="${esc(t('mnt.notes'))} (${noteCount(m)})"><span class="ms ms-sm">chat</span><span class="mnt-n">${noteCount(m)}</span></button>` : ''}</span>
    </div>`;

  const open = logs.filter((m) => !m.returnDate);
  const done = logs.filter((m) => m.returnDate).sort((a, b) => new Date(b.returnDate) - new Date(a.returnDate));

  // Companies ordered by their worst outstanding job: the one to ring first.
  const companies = [...new Set(open.map((m) => m.serviceCompany || '—'))]
    .map((name) => ({
      name,
      jobs: open.filter((m) => (m.serviceCompany || '—') === name).sort((a, b) => daysOut(b) - daysOut(a)),
    }))
    .sort((a, b) => daysOut(b.jobs[0]) - daysOut(a.jobs[0]));

  const outCost = open.reduce((n, m) => n + (Number(m.cost) || 0), 0);

  el.innerHTML = `
    ${pageHead('mnt.pageTitle', 'mnt.pageSub', `
      <input type="search" id="mnt-find" class="mnt-find" placeholder="${esc(t('mnt.findPh'))}" aria-label="${esc(t('mnt.findPh'))}">
      <select id="mn-filter" class="mnt-filter">
        <option value="true" ${openOnly ? 'selected' : ''}>${esc(t('mnt.openRepairs'))}</option>
        <option value="false" ${!openOnly ? 'selected' : ''}>${esc(t('mnt.allLogs'))}</option>
      </select>`)}
    ${open.length === 0 && done.length === 0 ? `
      <div class="card card-pad mnt-empty">
        <p>${esc(t('mnt.noLogs'))}</p>
        <p class="cell-sub">${esc(t('mnt.sendHint'))}</p>
      </div>` : `
      ${open.length ? `<section class="mnt-block">
        <h2 class="mnt-h">${esc(t('mnt.outTitle').replace('{n}', open.length))}</h2>
        <p class="mnt-h-sub">${esc(t('mnt.outSub'))}${canViewCosts && outCost > 0 ? ` · ${esc(t('mnt.outCost').replace('{v}', fmtMoney(outCost)))}` : ''}</p>
        ${companies.map((c) => `<div class="mnt-co-block">
          <div class="mnt-co-head">
            <h3>${esc(c.name)}</h3>
            <span class="mnt-co-n">${esc(t('mnt.jobsN').replace('{n}', c.jobs.length))}</span>
          </div>
          <div class="mnt-list">${c.jobs.map(openRow).join('')}</div>
        </div>`).join('')}
      </section>` : `<p class="mnt-allback">${esc(t('mnt.allBack'))}</p>`}
      ${done.length ? `<section class="mnt-block">
        <h2 class="mnt-h">${esc(t('mnt.doneTitle'))}</h2>
        <p class="mnt-h-sub">${esc(t('mnt.doneSub'))}</p>
        <div class="mnt-list">${done.map(doneRow).join('')}</div>
      </section>` : ''}
      <p class="mnt-nohits" id="mnt-nohits" hidden>${esc(t('mnt.noHits'))}</p>`}`;

  const find = $('#mnt-find', el);
  find?.addEventListener('input', () => {
    const q = find.value.trim().toLowerCase();
    let hits = 0;
    el.querySelectorAll('.mnt-row').forEach((r) => {
      const on = !q || r.dataset.find.includes(q);
      r.hidden = !on;
      if (on) hits += 1;
    });
    el.querySelectorAll('.mnt-co-block, .mnt-block').forEach((b) => {
      b.hidden = ![...b.querySelectorAll('.mnt-row')].some((r) => !r.hidden);
    });
    const none = $('#mnt-nohits', el);
    if (none) none.hidden = hits > 0;
  });

  $('#mn-filter', el).addEventListener('change', (e) => Views.maintenance(el, { open: e.target.value }));
  bindView(el, (e) => {
    const nb = e.target.closest('[data-notes]');
    if (nb) {
      showMaintNotes(logs.find((x) => x.id === nb.dataset.notes), () => Views.maintenance(el, params));
      return;
    }
    const b = e.target.closest('button[data-closelog]'); if (!b) return;
    const m = logs.find((x) => x.id === b.dataset.closelog);
    formModal({
      title: (t('mnt.closeTitle') || 'Close repair — {tag}').replace('{tag}', m.assetTag),
      fields: [
        { name: 'cost', label: (t('mnt.finalCost') || 'Final cost ({cur})').replace('{cur}', appCurrency()), type: 'number', step: '0.01', value: m.cost },
        { name: 'scrap', label: t('mnt.outcome'), type: 'select', value: 'repaired',
          options: [{ value: 'repaired', label: t('mnt.repairedRestore') }, { value: 'scrap', label: t('mnt.beyondScrap') }] },
        { name: 'resolutionNote', label: t('mnt.resolutionNote'), type: 'textarea', full: true },
      ],
      submitLabel: t('mnt.closeRepair'),
      async onSubmit(d) {
        await api(`/maintenance/${m.id}/close`, {
          method: 'PUT',
          body: { cost: d.cost, resolutionNote: d.resolutionNote, scrap: d.scrap === 'scrap' },
        });
        toast((t('mnt.closedToast') || 'Repair closed for {tag}').replace('{tag}', m.assetTag), 'success');
        Views.maintenance(el, params);
      },
    });
  });
};

/* =============================== LICENSES ================================ */
