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
          <div class="form-field"><label>Full name *</label>
            <input name="fullName" autocomplete="name" value="${esc(stash.fullName)}"></div>
          <div class="form-field"><label>Email *</label>
            <input name="email" type="email" autocomplete="email" value="${esc(stash.email)}"></div>
          <div class="form-field"><label>Department</label>
            <select name="department">
              <option value="">—</option>
              ${(AppConfig.departments || []).map((d) =>
                `<option value="${esc(d)}" ${stash.department === d ? 'selected' : ''}>${esc(d)}</option>`
              ).join('')}
            </select></div>
          <div class="form-field"><label>Title</label>
            <input name="title" value="${esc(stash.title)}"></div>
        </div>
        <div class="form-field" style="margin-top:12px;max-width:240px">
          <label>${esc(t('emp.onboardStartDate'))}</label>
          <input type="date" name="startDate" value="${esc(stash.startDate)}">
        </div>
        <div class="form-field full" style="margin-top:10px">
          <label>Notes</label>
          <textarea name="notes" rows="2" maxlength="2000">${esc(stash.notes)}</textarea>
        </div>
      </div>
      <div id="obn-step-2" class="hidden">
        <p class="cell-sub" style="margin:0 0 10px">${esc(t('emp.onboardNoGearOk'))}</p>
        <div class="search-box" style="margin-bottom:10px;max-width:360px">
          <span class="ms">search</span>
          <input type="search" id="obn-gear-q" placeholder="Filter stock…" autocomplete="off">
        </div>
        <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:0 0 6px">${esc(t('emp.onboardPickStock'))} (${stock.length})</h3>
        <div id="obn-assets" class="obn-pick-list"></div>
        <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:14px 0 6px">${esc(t('emp.onboardPickLines'))} (${freeLines.length})</h3>
        <div id="obn-lines" class="obn-pick-list" style="max-height:160px"></div>
      </div>
      <div id="obn-step-3" class="hidden"></div>`,
    foot: `
      <button class="btn btn-outline" data-close>Cancel</button>
      <button class="btn btn-outline hidden" id="obn-back">Back</button>
      <button class="btn btn-primary" id="obn-next">Next</button>
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
          </label>`).join('') || `<div class="cell-sub" style="padding:12px">No stock matches.</div>`;
        linesEl.innerHTML = freeLines.filter(matchL).map((l) => `
          <label class="obn-pick-row">
            <input type="checkbox" data-line="${esc(l.id)}" ${pickedLines.has(l.id) ? 'checked' : ''}>
            <span class="obn-pick-meta">${esc(l.phoneNumber)}
              <span class="cell-sub"> · ${esc([l.operator, l.plan].filter(Boolean).join(' · ') || '—')}</span></span>
          </label>`).join('') || `<div class="cell-sub" style="padding:12px">No free lines.</div>`;
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
            <div><span class="cell-sub">Employee</span><div class="cell-title">${esc(empLabel)}</div>
              ${mode === 'new' ? `<div class="cell-sub">${esc(stash.email)}</div>` : ''}</div>
            <div><span class="cell-sub">${esc(t('emp.onboardStartDate'))}</span>
              <div class="cell-title">${esc(stash.startDate)}</div></div>
          </div>
          ${stash.notes ? `<div style="margin-top:10px"><span class="cell-sub">Notes</span><div>${esc(stash.notes)}</div></div>` : ''}
          <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:16px 0 6px">Reserved assets (${aLabels.length})</h3>
          ${aLabels.length ? `<ul style="margin:0;padding-left:18px">${aLabels.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
            : `<div class="cell-sub">${esc(t('emp.onboardNoGearOk'))}</div>`}
          <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:16px 0 6px">Reserved lines (${lLabels.length})</h3>
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
              throw new Error('Full name and email are required');
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

async function openOnboardingDueModal({ force = false, focusId = null } = {}) {
  if (!Auth.canIamOp('onboarding', 'read') && !Auth.canIam('handover', 'create')) return;
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
        <div><span class="cell-sub">Employee</span>
          <div class="cell-title">${esc(emp.fullName || current.employeeName || '—')}</div>
          <div class="cell-sub">${esc(emp.email || '')}</div></div>
        <div><span class="cell-sub">${esc(t('emp.onboardStartDate'))}</span>
          <div class="cell-title">${esc(String(detail.startDate || current.startDate || '').slice(0, 10))}</div>
          <div>${badge(detail.status || 'scheduled')}</div></div>
      </div>
      <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:0 0 6px">
        Reserved items (${items.length})</h3>
      ${items.length === 0
        ? `<div class="banner banner-amber" style="margin-bottom:10px">${esc(t('emp.onboardNoItems'))}</div>`
        : `<div class="table-wrap" style="margin-bottom:12px"><table class="data">
            <thead><tr><th>Item</th><th>Note</th><th></th></tr></thead>
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
                  <td class="actions"><button type="button" class="btn btn-outline btn-sm" data-rm="${esc(it.id)}"><span class="ms">close</span></button></td>
                </tr>`).join('')}
            </tbody></table></div>`}
      <div id="obn-add-panel" class="hidden" style="margin-top:8px">
        <div class="search-box" style="margin-bottom:8px;max-width:320px">
          <span class="ms">search</span>
          <input type="search" id="obn-add-q" placeholder="Filter…" autocomplete="off">
        </div>
        <div id="obn-add-assets" style="max-height:160px;overflow:auto;border:1px solid var(--outline-variant);border-radius:8px;margin-bottom:8px"></div>
        <div id="obn-add-lines" style="max-height:120px;overflow:auto;border:1px solid var(--outline-variant);border-radius:8px;margin-bottom:8px"></div>
        <button type="button" class="btn btn-outline btn-sm" id="obn-add-save">${esc(t('emp.onboardSaveItems'))}</button>
      </div>
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
      <button class="btn btn-outline" id="obn-due-add"><span class="ms">add</span> ${esc(t('emp.onboardAddDevices'))}</button>
      <button class="btn btn-primary" id="obn-due-complete"><span class="ms">print</span> ${esc(t('emp.onboardComplete'))}</button>`,
    onMount(overlay) {
      renderBody(overlay);

      $('#obn-due-later', overlay).addEventListener('click', () => closeModal());

      $('#obn-due-add', overlay).addEventListener('click', async () => {
        const panel = $('#obn-add-panel', overlay);
        if (!panel) return;
        panel.classList.toggle('hidden');
        if (panel.classList.contains('hidden')) return;

        const [stockRes, linesRes] = await Promise.all([
          api('/assets?status=In+Stock&limit=500').catch(() => ({ items: [] })),
          api('/lines?status=Active&limit=500').catch(() => []),
        ]);
        const stock = assetList(stockRes).filter((a) => a.category !== 'Network' && a.category !== 'Server');
        const freeLines = lineList(linesRes).filter((l) => !l.currentEmployeeId && !l.reservedForEmployeeId);
        const pickedA = new Set();
        const pickedL = new Set();

        const paint = (q) => {
          const term = (q || '').trim().toLowerCase();
          $('#obn-add-assets', panel).innerHTML = stock
            .filter((a) => !term || `${a.assetTag} ${a.brand} ${a.model}`.toLowerCase().includes(term))
            .map((a) => `
              <label class="obn-pick-row">
                <input type="checkbox" data-a="${esc(a.id)}">
                <span class="obn-pick-tag">${esc(a.assetTag)}</span>
                <span class="obn-pick-meta">${esc(a.brand)} ${esc(a.model)}</span>
              </label>`).join('') || '<div class="cell-sub" style="padding:8px">No stock</div>';
          $('#obn-add-lines', panel).innerHTML = freeLines
            .filter((l) => !term || String(l.phoneNumber).includes(term))
            .map((l) => `
              <label class="obn-pick-row">
                <input type="checkbox" data-l="${esc(l.id)}">
                <span class="obn-pick-meta">${esc(l.phoneNumber)}</span>
              </label>`).join('') || '<div class="cell-sub" style="padding:8px">No lines</div>';
          panel.querySelectorAll('[data-a]').forEach((cb) => {
            cb.addEventListener('change', () => { if (cb.checked) pickedA.add(cb.dataset.a); else pickedA.delete(cb.dataset.a); });
          });
          panel.querySelectorAll('[data-l]').forEach((cb) => {
            cb.addEventListener('change', () => { if (cb.checked) pickedL.add(cb.dataset.l); else pickedL.delete(cb.dataset.l); });
          });
        };
        paint('');
        const addAssets = $('#obn-add-assets', panel);
        const addLines = $('#obn-add-lines', panel);
        if (addAssets) addAssets.classList.add('obn-pick-list');
        if (addLines) addLines.classList.add('obn-pick-list');
        $('#obn-add-q', panel).oninput = (e) => paint(e.target.value);
        $('#obn-add-save', panel).onclick = async () => {
          const err = $('#obn-due-error', overlay);
          try {
            await api(`/onboardings/${encodeURIComponent(detail.id)}/items`, {
              method: 'POST',
              body: {
                assets: [...pickedA].map((id) => ({ assetId: id })),
                lines: [...pickedL].map((id) => ({ lineId: id })),
              },
            });
            panel.classList.add('hidden');
            await renderBody(overlay);
            refreshOnboardingBell().catch(() => {});
            toast(t('emp.onboardSaveItems'), 'success');
          } catch (e) {
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
