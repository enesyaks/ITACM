/* Employee onboarding wizard + start-day due modal */
'use strict';

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function onboardModalStorageKey() {
  const uid = (Auth.profile && (Auth.profile.uid || Auth.profile.id || Auth.profile.email)) || 'anon';
  return `itacm.onboardModal.${uid}.${todayISO()}`;
}

function assetList(res) {
  if (Array.isArray(res)) return res;
  return res && res.items ? res.items : [];
}
// Asset categories are free text; known ones get a matching glyph.
const OBN_CAT_ICONS = {
  laptop: 'laptop_mac', notebook: 'laptop_mac', desktop: 'desktop_windows', pc: 'desktop_windows',
  monitor: 'monitor', phone: 'smartphone', mobile: 'smartphone', tablet: 'tablet_mac',
  headset: 'headset_mic', dock: 'dock', keyboard: 'keyboard', mouse: 'mouse', printer: 'print',
};
function obnCatIcon(c) {
  return OBN_CAT_ICONS[String(c || '').trim().toLowerCase()] || 'devices_other';
}
function lineList(res) {
  if (Array.isArray(res)) return res;
  return res && res.items ? res.items : [];
}

async function openOnboardWizard(existingEmp) {
  const canEdit = Auth.canIamOp('onboarding', 'create') || Auth.canIamOp('onboarding', 'update');
  if (!canEdit) return;

  const [stockRes, linesRes] = await Promise.all([
    api('/assets?status=In+Stock&limit=500').catch(() => ({ items: [] })),
    api('/lines?status=Active&limit=500').catch(() => []),
  ]);
  const stock = assetList(stockRes).filter((a) => a.category !== 'Network' && a.category !== 'Server');
  const freeLines = lineList(linesRes).filter((l) => !l.currentEmployeeId && !l.reservedForEmployeeId);

  let step = 1;
  let mode = existingEmp ? 'existing' : 'new';
  let selectedEmp = existingEmp || null;
  let empPicker = null;
  const pickedAssets = new Set();
  const pickedLines = new Set();
  const stash = {
    fullName: existingEmp?.fullName || '',
    email: existingEmp?.email || '',
    department: existingEmp?.department || '',
    title: existingEmp?.title || '',
    startDate: (existingEmp?.startDate ? String(existingEmp.startDate).slice(0, 10) : '') || todayISO(),
    notes: '',
  };

  openModal({
    title: t('emp.onboardTitle'),
    wide: true,
    body: `
      <div id="obn-error" class="form-error hidden" style="margin-bottom:10px"></div>
      <div id="obn-step-1">
        <p class="cell-sub" style="margin:0 0 12px">${esc(t('emp.onboardHint'))}</p>
        <div class="obn-tabs" style="display:flex;gap:8px;margin-bottom:12px">
          <button type="button" class="btn btn-sm ${mode === 'new' ? 'btn-primary' : 'btn-outline'}" data-mode="new">${esc(t('emp.onboardNew'))}</button>
          <button type="button" class="btn btn-sm ${mode === 'existing' ? 'btn-primary' : 'btn-outline'}" data-mode="existing">${esc(t('emp.onboardExisting'))}</button>
        </div>
        <div id="obn-existing" class="${mode === 'existing' ? '' : 'hidden'}">
          <label class="cell-sub">${esc(t('emp.onboardExisting'))}</label>
          <div id="obn-emp-host" class="emp-search-host" style="margin-top:6px;max-width:420px"></div>
        </div>
        <div id="obn-new" class="grid grid-2 ${mode === 'new' ? '' : 'hidden'}" style="margin-top:8px">
          <div class="form-field"><label>${esc(t('onb.fldFullName'))} *</label>
            <input name="fullName" autocomplete="name" value="${esc(stash.fullName)}"></div>
          <div class="form-field"><label>${esc(t('onb.fldEmail'))} *</label>
            <input name="email" type="email" autocomplete="email" value="${esc(stash.email)}"></div>
          <div class="form-field"><label>${esc(t('onb.fldDept'))}</label>
            <select name="department">
              <option value="">—</option>
              ${(AppConfig.departments || []).map((d) =>
                `<option value="${esc(d)}" ${stash.department === d ? 'selected' : ''}>${esc(d)}</option>`
              ).join('')}
            </select></div>
          <div class="form-field"><label>${esc(t('onb.fldTitle'))}</label>
            <input name="title" value="${esc(stash.title)}"></div>
        </div>
        <div class="form-field" style="margin-top:12px;max-width:240px">
          <label>${esc(t('emp.onboardStartDate'))}</label>
          <input type="date" name="startDate" value="${esc(stash.startDate)}">
        </div>
        <div class="form-field full" style="margin-top:10px">
          <label>${esc(t('onb.fldNotes'))}</label>
          <textarea name="notes" rows="2" maxlength="2000">${esc(stash.notes)}</textarea>
        </div>
      </div>
      <div id="obn-step-2" class="hidden">
        <p class="cell-sub" style="margin:0 0 10px">${esc(t('emp.onboardNoGearOk'))}</p>
        <div class="search-box" style="margin-bottom:10px;max-width:360px">
          <span class="ms">search</span>
          <input type="search" id="obn-gear-q" placeholder="${esc(t('onb.filterStock'))}" autocomplete="off">
        </div>
        <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:0 0 6px">${esc(t('emp.onboardPickStock'))} (${stock.length})</h3>
        <div id="obn-assets" class="obn-pick-list"></div>
        <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:14px 0 6px">${esc(t('emp.onboardPickLines'))} (${freeLines.length})</h3>
        <div id="obn-lines" class="obn-pick-list" style="max-height:160px"></div>
      </div>
      <div id="obn-step-3" class="hidden"></div>`,
    foot: `
      <button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
      <button class="btn btn-outline hidden" id="obn-back">${esc(t('common.back'))}</button>
      <button class="btn btn-primary" id="obn-next">${esc(t('common.next'))}</button>
      <button class="btn btn-primary hidden" id="obn-submit"><span class="ms">event_available</span> ${esc(t('emp.onboardSchedule'))}</button>`,
    onMount(overlay) {
      function readStep1() {
        const root = $('#obn-step-1', overlay);
        if (!root) return;
        const val = (sel) => root.querySelector(sel)?.value ?? '';
        stash.fullName = val('input[name="fullName"]').trim();
        stash.email = val('input[name="email"]').trim();
        stash.department = val('select[name="department"]').trim();
        stash.title = val('input[name="title"]').trim();
        stash.startDate = val('input[name="startDate"]').trim() || todayISO();
        stash.notes = val('textarea[name="notes"]').trim();
      }

      function setMode(next) {
        mode = next;
        overlay.querySelectorAll('[data-mode]').forEach((b) => {
          b.classList.toggle('btn-primary', b.dataset.mode === mode);
          b.classList.toggle('btn-outline', b.dataset.mode !== mode);
        });
        $('#obn-existing', overlay)?.classList.toggle('hidden', mode !== 'existing');
        $('#obn-new', overlay)?.classList.toggle('hidden', mode !== 'new');
        if (mode === 'existing' && !empPicker) {
          const host = $('#obn-emp-host', overlay);
          if (host) {
            empPicker = mountEmployeeSearchField(host, {
              name: 'obn-emp',
              selected: selectedEmp,
              placeholder: t('common.searchEmployee'),
              onChange(emp) { selectedEmp = emp; },
            });
          }
        }
      }

      function paintGear(q) {
        const term = (q || '').trim().toLowerCase();
        const matchA = (a) => !term || `${a.assetTag} ${a.brand} ${a.model} ${a.category}`.toLowerCase().includes(term);
        const matchL = (l) => !term || `${l.phoneNumber} ${l.operator || ''} ${l.plan || ''}`.toLowerCase().includes(term);
        const assetsEl = $('#obn-assets', overlay);
        const linesEl = $('#obn-lines', overlay);
        if (!assetsEl || !linesEl) return;
        assetsEl.innerHTML = stock.filter(matchA).map((a) => `
          <label class="obn-pick-row">
            <input type="checkbox" data-asset="${esc(a.id)}" ${pickedAssets.has(a.id) ? 'checked' : ''}>
            <span class="obn-pick-tag">${esc(a.assetTag)}</span>
            <span class="obn-pick-meta">${esc(a.brand)} ${esc(a.model)}
              <span class="cell-sub"> · ${esc(a.category)}</span></span>
          </label>`).join('') || `<div class="cell-sub" style="padding:12px">${esc(t('onb.noStock'))}</div>`;
        linesEl.innerHTML = freeLines.filter(matchL).map((l) => `
          <label class="obn-pick-row">
            <input type="checkbox" data-line="${esc(l.id)}" ${pickedLines.has(l.id) ? 'checked' : ''}>
            <span class="obn-pick-meta">${esc(l.phoneNumber)}
              <span class="cell-sub"> · ${esc([l.operator, l.plan].filter(Boolean).join(' · ') || '—')}</span></span>
          </label>`).join('') || `<div class="cell-sub" style="padding:12px">${esc(t('onb.noLines'))}</div>`;
        assetsEl.querySelectorAll('[data-asset]').forEach((cb) => {
          cb.addEventListener('change', () => {
            if (cb.checked) pickedAssets.add(cb.dataset.asset);
            else pickedAssets.delete(cb.dataset.asset);
          });
        });
        linesEl.querySelectorAll('[data-line]').forEach((cb) => {
          cb.addEventListener('change', () => {
            if (cb.checked) pickedLines.add(cb.dataset.line);
            else pickedLines.delete(cb.dataset.line);
          });
        });
      }

      function paintReview() {
        const empLabel = mode === 'existing'
          ? (selectedEmp?.fullName || '—')
          : (stash.fullName || '—');
        const aLabels = stock.filter((a) => pickedAssets.has(a.id))
          .map((a) => `${a.assetTag} — ${a.brand} ${a.model}`);
        const lLabels = freeLines.filter((l) => pickedLines.has(l.id))
          .map((l) => l.phoneNumber);
        $('#obn-step-3', overlay).innerHTML = `
          <div class="banner banner-amber" style="margin-bottom:12px">${esc(t('emp.onboardHint'))}</div>
          <div class="grid grid-2" style="gap:12px">
            <div><span class="cell-sub">${esc(t('onb.employee'))}</span><div class="cell-title">${esc(empLabel)}</div>
              ${mode === 'new' ? `<div class="cell-sub">${esc(stash.email)}</div>` : ''}</div>
            <div><span class="cell-sub">${esc(t('emp.onboardStartDate'))}</span>
              <div class="cell-title">${esc(stash.startDate)}</div></div>
          </div>
          ${stash.notes ? `<div style="margin-top:10px"><span class="cell-sub">${esc(t('onb.fldNotes'))}</span><div>${esc(stash.notes)}</div></div>` : ''}
          <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:16px 0 6px">${esc(t('onb.reservedAssets'))} (${aLabels.length})</h3>
          ${aLabels.length ? `<ul style="margin:0;padding-left:18px">${aLabels.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
            : `<div class="cell-sub">${esc(t('emp.onboardNoGearOk'))}</div>`}
          <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:16px 0 6px">${esc(t('onb.reservedLines'))} (${lLabels.length})</h3>
          ${lLabels.length ? `<ul style="margin:0;padding-left:18px">${lLabels.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
            : `<div class="cell-sub">—</div>`}`;
      }

      function showStep(n) {
        step = n;
        [1, 2, 3].forEach((i) => {
          $('#obn-step-' + i, overlay)?.classList.toggle('hidden', i !== step);
        });
        const titleBits = [
          t('emp.onboardTitle'),
          t(step === 1 ? 'emp.onboardStepPerson' : step === 2 ? 'emp.onboardStepGear' : 'emp.onboardStepReview'),
        ];
        const h = overlay.querySelector('.modal-title, .modal-head h3, h3');
        if (h) h.textContent = titleBits.join(' — ');
        $('#obn-back', overlay).classList.toggle('hidden', step === 1);
        $('#obn-next', overlay).classList.toggle('hidden', step === 3);
        $('#obn-submit', overlay).classList.toggle('hidden', step !== 3);
        if (step === 2) paintGear($('#obn-gear-q', overlay)?.value || '');
        if (step === 3) paintReview();
      }

      overlay.querySelectorAll('[data-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          readStep1();
          setMode(btn.dataset.mode);
        });
      });
      setMode(mode);
      $('#obn-gear-q', overlay)?.addEventListener('input', (e) => paintGear(e.target.value));

      $('#obn-back', overlay).addEventListener('click', () => {
        if (step === 2 || step === 3) readStep1();
        showStep(Math.max(1, step - 1));
      });

      $('#obn-next', overlay).addEventListener('click', () => {
        const err = $('#obn-error', overlay);
        err.classList.add('hidden');
        try {
          if (step === 1) {
            readStep1();
            if (!stash.startDate) throw new Error(t('emp.onboardStartDate'));
            if (mode === 'existing') {
              if (!selectedEmp?.id) throw new Error(t('emp.offboardPickPerson'));
            } else if (!stash.fullName || !stash.email) {
              throw new Error(t('onb.nameEmailReq'));
            }
          }
          showStep(step + 1);
        } catch (e) {
          err.textContent = e.message || String(e);
          err.classList.remove('hidden');
        }
      });

      $('#obn-submit', overlay).addEventListener('click', async () => {
        const err = $('#obn-error', overlay);
        err.classList.add('hidden');
        readStep1();
        const payload = {
          startDate: stash.startDate,
          notes: stash.notes,
          assets: [...pickedAssets].map((id) => ({ assetId: id })),
          lines: [...pickedLines].map((id) => ({ lineId: id })),
        };
        if (mode === 'existing') payload.employeeId = selectedEmp.id;
        else {
          payload.fullName = stash.fullName;
          payload.email = stash.email;
          payload.department = stash.department || null;
          payload.title = stash.title || null;
        }
        try {
          $('#obn-submit', overlay).disabled = true;
          await api('/onboardings', { method: 'POST', body: payload });
          toast(t('emp.onboardScheduled'), 'success');
          closeModal();
          if (location.hash.startsWith('#/employees')) {
            const params = Object.fromEntries(new URLSearchParams((location.hash.split('?')[1] || '')));
            const viewEl = document.getElementById('view');
            if (viewEl) Views.employees(viewEl, params);
          }
          refreshOnboardingBell().catch(() => {});
        } catch (e) {
          $('#obn-submit', overlay).disabled = false;
          err.textContent = e.message || String(e);
          err.classList.remove('hidden');
        }
      });

      showStep(1);
    },
  });
}

/**
 * "What HR asked for" panel — the preparation checklist for this onboarding.
 *
 * HR files a ticket in equipment categories; IT reserves concrete assets. This
 * matches the two so the person packing the kit sees, per category, how many are
 * still missing instead of having to remember the closed ticket.
 *
 * HR's checklist labels do not all equal the asset category names, so the few
 * that differ are aliased here.
 */
const HR_CATEGORY_ALIASES = { dock: ['docking station', 'dock'] };

function hrRequestPanel(hrRequest, reservedItems) {
  if (!hrRequest || !(hrRequest.items || []).length) return '';

  // How many reserved assets sit in each category (lower-cased for matching).
  const reservedByCategory = new Map();
  (reservedItems || []).forEach((it) => {
    if (it.kind !== 'asset' || !it.category) return;
    const key = String(it.category).toLowerCase();
    reservedByCategory.set(key, (reservedByCategory.get(key) || 0) + 1);
  });

  const rows = hrRequest.items.map((req) => {
    const wanted = Number(req.qty) || 1;
    const key = String(req.category || '').toLowerCase();
    const keys = HR_CATEGORY_ALIASES[key] || [key];
    const ready = keys.reduce((sum, k) => sum + (reservedByCategory.get(k) || 0), 0);
    const done = ready >= wanted;
    return `
      <tr>
        <td>
          <span class="ms ms-sm" style="color:${done ? 'var(--success, #12a150)' : 'var(--warning, #b8860b)'}">
            ${done ? 'check_circle' : 'radio_button_unchecked'}</span>
          ${esc(req.category)}
        </td>
        <td class="cell-sub">${ready} / ${wanted}</td>
        <td>${done
    ? `<span class="pill pill-indigo">${esc(t('onb.hrReady'))}</span>`
    : `<span class="pill pill-amber">${esc(t('onb.hrMissing'))}</span>`}</td>
      </tr>`;
  }).join('');

  const total = hrRequest.items.reduce((s, i) => s + (Number(i.qty) || 1), 0);
  const covered = hrRequest.items.reduce((s, i) => {
    const key = String(i.category || '').toLowerCase();
    const keys = HR_CATEGORY_ALIASES[key] || [key];
    const ready = keys.reduce((sum, k) => sum + (reservedByCategory.get(k) || 0), 0);
    return s + Math.min(ready, Number(i.qty) || 1);
  }, 0);

  return `
    <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:0 0 6px">
      ${esc(t('onb.hrRequested'))} (${covered}/${total})</h3>
    <div class="table-wrap" style="margin-bottom:12px"><table class="data">
      <tbody>${rows}</tbody></table></div>
    ${hrRequest.notes
    ? `<p class="cell-sub" style="margin:-4px 0 12px"><strong>${esc(t('hr.notes'))}:</strong> ${esc(hrRequest.notes)}</p>`
    : ''}
    ${hrRequest.requestedBy
    ? `<p class="cell-sub" style="margin:-4px 0 12px">${esc(t('hr.requestedBy'))}: ${esc(hrRequest.requestedBy)}</p>`
    : ''}`;
}

async function openOnboardingDueModal({ force = false, focusId = null, onDone = null } = {}) {
  if (!Auth.canIamOp('onboarding', 'read') && !Auth.canIam('handover', 'create')) return;
  const canCancelOnboard = Auth.canIamOp('onboarding', 'update');
  const key = onboardModalStorageKey();
  if (!force && localStorage.getItem(key) === '1') return;

  let list = [];
  try {
    /* Auto / "Open due": only start_date <= today. Explicit Open on a row: any scheduled. */
    const path = (force && focusId) ? '/onboardings?status=scheduled' : '/onboardings?due=1';
    list = await api(path);
    if (!Array.isArray(list)) list = list.items || list.data || [];
  } catch {
    return;
  }
  if (!list.length) {
    if (!force) localStorage.setItem(key, '1');
    return;
  }

  if (!force) localStorage.setItem(key, '1');

  let current = list.find((x) => x.id === focusId) || list[0];
  if (force && focusId && !list.find((x) => x.id === focusId)) {
    try {
      const one = await api(`/onboardings/${encodeURIComponent(focusId)}`);
      list = [one, ...list];
      current = one;
    } catch (e) {
      toast(e.message || String(e), 'error');
      return;
    }
  }
  let detail = null;

  async function loadDetail(id) {
    detail = await api(`/onboardings/${encodeURIComponent(id)}`);
    return detail;
  }

  async function renderBody(overlay) {
    const host = $('#obn-due-body', overlay);
    host.innerHTML = `<div class="cell-sub">${esc(t('common.loading'))}</div>`;
    try {
      detail = await loadDetail(current.id);
    } catch (e) {
      host.innerHTML = `<div class="form-error">${esc(e.message || String(e))}</div>`;
      return;
    }
    const items = detail.items || [];
    const emp = detail.employee || {};
    host.innerHTML = `
      <p class="cell-sub" style="margin:0 0 12px">${esc(t('emp.onboardDueHint'))}</p>
      ${list.length > 1 ? `
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
          ${list.map((o) => `
            <button type="button" class="btn btn-sm ${o.id === current.id ? 'btn-primary' : 'btn-outline'}" data-pick="${esc(o.id)}">
              ${esc(o.employee?.fullName || o.employeeName || '—')}
            </button>`).join('')}
        </div>` : ''}
      <div class="grid grid-2" style="margin-bottom:12px">
        <div><span class="cell-sub">${esc(t('onb.employee'))}</span>
          <div class="cell-title">${esc(emp.fullName || current.employeeName || '—')}</div>
          <div class="cell-sub">${esc(emp.email || '')}</div></div>
        <div><span class="cell-sub">${esc(t('emp.onboardStartDate'))}</span>
          <div class="cell-title">${esc(String(detail.startDate || current.startDate || '').slice(0, 10))}</div>
          <div>${badge(detail.status || 'scheduled')}</div></div>
      </div>
      ${hrRequestPanel(detail.hrRequest, items)}
      <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:0 0 6px">
        ${esc(t('onb.reservedTitle'))} (${items.length})</h3>
      ${items.length === 0
        ? `<div class="banner banner-amber" style="margin-bottom:10px">${esc(t('emp.onboardNoItems'))}</div>`
        : `<div class="table-wrap" style="margin-bottom:12px"><table class="data">
            <thead><tr><th>${esc(t('onb.colItem'))}</th><th>${esc(t('onb.colNote'))}</th><th></th></tr></thead>
            <tbody>
              ${items.map((it) => `
                <tr>
                  <td>${it.kind === 'asset'
                    ? `<div class="cell-title">${esc(it.assetTag)}</div>
                       <div class="cell-sub">${esc(it.brand)} ${esc(it.model)}</div>`
                    : `<div class="cell-title">${esc(it.phoneNumber)}</div>
                       <div class="cell-sub">${esc([it.operator, it.plan].filter(Boolean).join(' · ') || 'Line')}</div>`}
                  </td>
                  <td class="cell-sub">${esc(it.conditionNote || '—')}</td>
                  <td class="actions"><button type="button" class="btn btn-outline btn-sm" data-rm="${esc(it.id)}" title="${esc(t('onb.removeItem'))}" aria-label="${esc(t('onb.removeItem'))}"><span class="ms">close</span></button></td>
                </tr>`).join('')}
            </tbody></table></div>`}
      <section id="obn-add-panel" class="obn-add hidden" aria-labelledby="obn-add-title">
        <header class="obn-add-head">
          <span class="icon-chip obn-add-ic"><span class="ms">add_box</span></span>
          <div class="grow">
            <h4 id="obn-add-title">${esc(t('onb.addTitle'))}</h4>
            <p>${esc(t('onb.addHint'))}</p>
          </div>
          <button type="button" class="obn-add-x" id="obn-add-close" aria-label="${esc(t('common.close'))}"><span class="ms">close</span></button>
        </header>
        <div class="search-box obn-add-search">
          <span class="ms">search</span>
          <input type="search" id="obn-add-q" placeholder="${esc(t('onb.filterAll'))}" aria-label="${esc(t('onb.filterAll'))}" autocomplete="off">
        </div>
        <div id="obn-add-lists" class="obn-add-lists"><div class="cell-sub">${esc(t('common.loading'))}</div></div>
        <footer class="obn-add-foot">
          <span class="obn-add-count" id="obn-add-count" aria-live="polite"></span>
          <button type="button" class="obn-add-clear hidden" id="obn-add-clear">${esc(t('onb.clearSel'))}</button>
          <span class="grow"></span>
          <button type="button" class="btn btn-outline btn-sm" id="obn-add-cancel">${esc(t('common.cancel'))}</button>
          <button type="button" class="btn btn-primary btn-sm" id="obn-add-save" disabled><span class="ms">bookmark_add</span> ${esc(t('onb.reserveSelected'))}</button>
        </footer>
      </section>
      <div id="obn-due-error" class="form-error hidden" style="margin-top:10px"></div>`;

    host.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        current = list.find((x) => x.id === btn.dataset.pick) || current;
        await renderBody(overlay);
      });
    });
    host.querySelectorAll('[data-rm]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/onboardings/${encodeURIComponent(detail.id)}/items/${encodeURIComponent(btn.dataset.rm)}`, { method: 'DELETE' });
          await renderBody(overlay);
          refreshOnboardingBell().catch(() => {});
        } catch (e) {
          const el = $('#obn-due-error', host);
          el.textContent = e.message || String(e);
          el.classList.remove('hidden');
        }
      });
    });
  }

  openModal({
    title: t('emp.onboardDueTitle'),
    wide: true,
    body: `<div id="obn-due-body"></div>`,
    foot: `
      <button class="btn btn-outline" id="obn-due-later">${esc(t('emp.onboardRemindLater'))}</button>
      ${canCancelOnboard ? `<button class="btn btn-outline" id="obn-due-cancel"><span class="ms">cancel</span> ${esc(t('emp.onboardCancel'))}</button>` : ''}
      <button class="btn btn-outline" id="obn-due-email"><span class="ms">mail</span> ${esc(t('emp.onboardSendEmail'))}</button>
      <button class="btn btn-outline" id="obn-due-add"><span class="ms">add</span> ${esc(t('emp.onboardAddDevices'))}</button>
      <button class="btn btn-primary" id="obn-due-complete"><span class="ms">print</span> ${esc(t('emp.onboardComplete'))}</button>`,
    onMount(overlay) {
      renderBody(overlay);

      $('#obn-due-later', overlay).addEventListener('click', () => closeModal());


      $('#obn-due-email', overlay)?.addEventListener('click', () => {
        const emp = (detail && detail.employee) || {};
        formModal({
          title: t('emp.onboardSendEmail'),
          fields: [
            {
              name: 'to',
              label: 'emp.onboardSendEmailTo',
              type: 'email',
              required: true,
              value: emp.email || '',
              full: true,
            },
            {
              name: 'extraNote',
              label: 'emp.onboardSendEmailNote',
              type: 'textarea',
              full: true,
            },
          ],
          submitLabel: 'emp.onboardSendEmail',
          async onSubmit(d) {
            const id = (detail && detail.id) || current.id;
            const r = await api(`/onboardings/${encodeURIComponent(id)}/send-email`, {
              method: 'POST',
              body: { to: d.to, extraNote: d.extraNote },
            });
            const sentTo = (r && r.sentTo) || d.to;
            toast(`${t('emp.onboardEmailSent')}: ${sentTo}`, 'success');
          },
        });
      });

      const addBtn = $('#obn-due-add', overlay);
      const closeAddPanel = () => {
        const panel = $('#obn-add-panel', overlay);
        if (panel) panel.classList.add('hidden');
        addBtn.classList.remove('active');
        addBtn.setAttribute('aria-expanded', 'false');
      };
      addBtn.setAttribute('aria-expanded', 'false');
      addBtn.addEventListener('click', async () => {
        const panel = $('#obn-add-panel', overlay);
        if (!panel) return;
        if (!panel.classList.contains('hidden')) { closeAddPanel(); return; }
        panel.classList.remove('hidden');
        addBtn.classList.add('active');
        addBtn.setAttribute('aria-expanded', 'true');
        panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

        const lists = $('#obn-add-lists', panel);
        const q = $('#obn-add-q', panel);
        const countEl = $('#obn-add-count', panel);
        const clearBtn = $('#obn-add-clear', panel);
        const saveBtn = $('#obn-add-save', panel);
        lists.innerHTML = `<div class="cell-sub">${esc(t('common.loading'))}</div>`;

        const [stockRes, linesRes] = await Promise.all([
          api('/assets?status=In+Stock&limit=500').catch(() => ({ items: [] })),
          api('/lines?status=Active&limit=500').catch(() => []),
        ]);
        const stock = assetList(stockRes).filter((a) => a.category !== 'Network' && a.category !== 'Server');
        const freeLines = lineList(linesRes).filter((l) => !l.currentEmployeeId && !l.reservedForEmployeeId);
        // Selection lives in these sets, not in the DOM: filtering repaints the
        // rows, and a repaint must not silently forget (or hide) a pick.
        const pickedA = new Set();
        const pickedL = new Set();

        const syncCount = () => {
          const n = pickedA.size + pickedL.size;
          countEl.textContent = t('onb.selectedN').replace('{n}', String(n));
          countEl.classList.toggle('on', n > 0);
          clearBtn.classList.toggle('hidden', n === 0);
          saveBtn.disabled = n === 0;
        };

        const group = (icon, title, total, rows, empty) => `
          <div class="obn-add-group">
            <div class="obn-add-group-h"><span class="ms">${icon}</span>${esc(title)}<span class="obn-add-n">${total}</span></div>
            ${rows ? `<div class="obn-pick-list">${rows}</div>` : `<div class="obn-add-empty">${esc(empty)}</div>`}
          </div>`;

        const paint = (raw) => {
          const term = (raw || '').trim().toLowerCase();
          // Phone numbers are stored with spaces; compare digits to digits so
          // "5051238" finds "+90 505 123 86 46".
          const digits = term.replace(/\D/g, '');
          const aRows = stock
            .filter((a) => !term || `${a.assetTag} ${a.brand} ${a.model} ${a.category || ''} ${a.serialNumber || ''}`.toLowerCase().includes(term))
            .map((a) => `
              <label class="obn-pick-row obn-pick-row2${pickedA.has(a.id) ? ' on' : ''}">
                <input type="checkbox" data-a="${esc(a.id)}"${pickedA.has(a.id) ? ' checked' : ''}>
                <span class="obn-pick-ic"><span class="ms">${obnCatIcon(a.category)}</span></span>
                <span class="obn-pick-main">
                  <strong>${esc([a.brand, a.model].filter(Boolean).join(' ') || a.assetTag)}</strong>
                  <span class="obn-pick-sub">${a.category ? esc(a.category) : ''}${a.serialNumber ? ` <span class="obn-pick-sn">SN ${esc(a.serialNumber)}</span>` : ''}</span>
                </span>
                <span class="obn-pick-tag">${esc(a.assetTag)}</span>
              </label>`).join('');
          const lRows = freeLines
            .filter((l) => !term
              || `${l.operator || ''} ${l.plan || ''}`.toLowerCase().includes(term)
              || (digits && String(l.phoneNumber || '').replace(/\D/g, '').includes(digits)))
            .map((l) => `
              <label class="obn-pick-row obn-pick-row2${pickedL.has(l.id) ? ' on' : ''}">
                <input type="checkbox" data-l="${esc(l.id)}"${pickedL.has(l.id) ? ' checked' : ''}>
                <span class="obn-pick-ic"><span class="ms">sim_card</span></span>
                <span class="obn-pick-main">
                  <strong class="obn-pick-num">${esc(l.phoneNumber)}</strong>
                  <span class="obn-pick-sub">${esc([l.operator, l.plan].filter(Boolean).join(' · ') || '—')}</span>
                </span>
              </label>`).join('');
          lists.innerHTML = group('inventory_2', t('emp.onboardPickStock'), stock.length, aRows, t('onb.noStock'))
            + group('sim_card', t('emp.onboardPickLines'), freeLines.length, lRows,
              freeLines.length ? t('onb.noLineMatch') : t('onb.noLines'));
          lists.querySelectorAll('input[data-a], input[data-l]').forEach((cb) => {
            cb.addEventListener('change', () => {
              const set = cb.dataset.a ? pickedA : pickedL;
              const id = cb.dataset.a || cb.dataset.l;
              if (cb.checked) set.add(id); else set.delete(id);
              cb.closest('.obn-pick-row').classList.toggle('on', cb.checked);
              syncCount();
            });
          });
        };
        paint('');
        syncCount();
        q.value = '';
        q.oninput = (e) => paint(e.target.value);
        setTimeout(() => q.focus(), 50);
        clearBtn.onclick = () => { pickedA.clear(); pickedL.clear(); paint(q.value); syncCount(); };
        $('#obn-add-close', panel).onclick = closeAddPanel;
        $('#obn-add-cancel', panel).onclick = closeAddPanel;
        saveBtn.onclick = async () => {
          const err = $('#obn-due-error', overlay);
          err.classList.add('hidden');
          saveBtn.disabled = true;
          const label = saveBtn.innerHTML;
          saveBtn.innerHTML = `<span class="btn-spin"></span>${esc(t('common.sending'))}`;
          try {
            await api(`/onboardings/${encodeURIComponent(detail.id)}/items`, {
              method: 'POST',
              body: {
                assets: [...pickedA].map((id) => ({ assetId: id })),
                lines: [...pickedL].map((id) => ({ lineId: id })),
              },
            });
            closeAddPanel();
            await renderBody(overlay);
            refreshOnboardingBell().catch(() => {});
            toast(t('onb.reservedOk'), 'success');
          } catch (e) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = label;
            err.textContent = e.message || String(e);
            err.classList.remove('hidden');
          }
        };
      });

      $('#obn-due-complete', overlay).addEventListener('click', async () => {
        const err = $('#obn-due-error', overlay);
        err?.classList.add('hidden');
        try {
          if (!detail?.items?.length) throw new Error(t('emp.onboardNoItems'));
          $('#obn-due-complete', overlay).disabled = true;
          const res = await api(`/onboardings/${encodeURIComponent(detail.id)}/complete`, {
            method: 'POST',
            body: {},
          });
          toast(t('emp.onboardCompleted'), 'success');
          closeModal();
          refreshOnboardingBell().catch(() => {});
          if (typeof onDone === 'function') { try { onDone(); } catch { /* ignore */ } }
          const handoverId = res?.handover?.handoverId || res?.handover?.id;
          if (handoverId && typeof printHandover === 'function') {
            try {
              const full = await api(`/handovers/${handoverId}`);
              printHandover(full);
            } catch { /* ignore print errors */ }
          }
        } catch (e) {
          $('#obn-due-complete', overlay).disabled = false;
          if (err) {
            err.textContent = e.message || String(e);
            err.classList.remove('hidden');
          } else toast(e.message || String(e), 'error');
        }
      });

      // Cancel onboarding: releases reserved devices back to stock. Styled
      // confirmation (not a browser dialog).
      const cancelBtn = $('#obn-due-cancel', overlay);
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          formModal({
            title: 'emp.onboardCancel',
            submitLabel: 'emp.onboardCancel',
            stack: true,
            fields: [{ type: 'html', full: true, html: `<p class="cell-sub">${esc(t('emp.onboardCancelConfirm'))}</p>` }],
            async onSubmit() {
              await api(`/onboardings/${encodeURIComponent(detail.id)}/cancel`, { method: 'POST', body: {} });
              toast(t('emp.onboardCancelled'), 'success');
              closeModal();
              refreshOnboardingBell().catch(() => {});
              if (typeof onDone === 'function') { try { onDone(); } catch { /* ignore */ } }
            },
          });
        });
      }
    },
  });
}

async function refreshOnboardingBell() {
  const btn = document.getElementById('btn-notifications');
  if (!btn || !Auth.profile) return;
  try {
    const d = await api('/dashboard/stats');
    const due = (d.alerts && d.alerts.onboardingDueCount) || 0;
    const sched = (d.alerts && d.alerts.onboardingScheduledCount) || 0;
    /* Badge: due count wins (urgent). If only upcoming scheduled, still show so staff can find it. */
    const n = due > 0 ? due : sched;
    let badge = btn.querySelector('.notif-badge');
    if (n > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'notif-badge';
        btn.appendChild(badge);
      }
      badge.textContent = n > 9 ? '9+' : String(n);
      badge.classList.toggle('notif-badge-soft', due === 0 && sched > 0);
      badge.classList.remove('hidden');
      btn.title = due > 0
        ? (typeof t === 'function' ? t('emp.onboardDueBell').replace('{n}', String(due)) : `${due} onboarding due`)
        : (typeof t === 'function' ? t('emp.onboardSchedBell').replace('{n}', String(sched)) : `${sched} scheduled`);
    } else if (badge) {
      badge.classList.add('hidden');
      badge.classList.remove('notif-badge-soft');
      btn.removeAttribute('title');
    }
  } catch { /* ignore */ }
}

async function checkOnboardingDueOnLogin() {
  if (!Auth.profile) return;
  if (!Auth.canIamOp('onboarding', 'read') && !Auth.canIam('handover', 'create')) return;
  await refreshOnboardingBell();
  setTimeout(() => {
    openOnboardingDueModal({ force: false }).catch(() => {});
  }, 700);
}
