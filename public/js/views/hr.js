/**
 * HR requests — onboard checklist + offboard ticket + request list.
 *
 * HR-only screen (see ROUTES['#/hr'].hrOnly). Approving happens on the IT
 * dashboard, so the only action offered here is withdrawing a ticket you filed.
 * XSS: innerHTML only gets static markup + esc()-encoded values.
 */
'use strict';

Views.hr = async function (el) {
  const today = (() => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  })();

  const [categories, requests, stats] = await Promise.all([
    api('/hr/categories').catch(() => []),
    api('/hr/requests').catch(() => []),
    api('/dashboard/hr-stats').catch(() => ({ hrOnboardPending: 0, hrOffboardPending: 0, myPendingCount: 0 })),
    // The entity picker below. Harmless on a single-company install — the list
    // comes back with one row and no picker is drawn.
    Companies.load().catch(() => {}),
  ]);
  const cats = Array.isArray(categories) ? categories : [];
  const list = Array.isArray(requests) ? requests : [];
  // Permission-driven, not role-driven: a custom IAM group must be able to
  // grant these surfaces without being named 'HR'.
  const canCreate = Auth.canIam('hr_request', 'create');
  const myUid = (Auth.profile && (Auth.profile.uid || Auth.profile.id)) || null;

  // The counters are already scoped to this user's own tickets server-side, so
  // "pending onboard + pending offboard" would just restate "my pending".
  // Show what is still open vs. what IT has already picked up instead.
  const approvedCount = list.filter((r) => r.status === 'acknowledged').length;

  const typeLabel = (v) => t(v === 'offboard' ? 'hr.typeOffboard' : 'hr.typeOnboard');
  const statusLabel = (s) => t(s === 'acknowledged' ? 'hr.statusAcknowledged'
    : s === 'cancelled' ? 'hr.statusCancelled' : 'hr.statusPending');
  const statusPill = (s) => (s === 'pending' ? 'pill-amber' : s === 'cancelled' ? 'pill-slate' : 'pill-indigo');

  // Category names come from the server as free text; known ones get a
  // matching glyph, anything else falls back to a generic device icon.
  const CAT_ICONS = {
    laptop: 'laptop_mac', notebook: 'laptop_mac', desktop: 'desktop_windows', pc: 'desktop_windows',
    monitor: 'monitor', screen: 'monitor', phone: 'smartphone', mobile: 'smartphone',
    headset: 'headset_mic', dock: 'dock', keyboard: 'keyboard', mouse: 'mouse',
    tablet: 'tablet_mac', printer: 'print', sim: 'sim_card', webcam: 'videocam', camera: 'videocam',
  };
  const catIcon = (c) => CAT_ICONS[String(c || '').trim().toLowerCase()] || 'devices_other';

  // Each tile is a div, not one big <label>: clicking the − / + buttons must
  // not toggle the checkbox. The global `input { width: 100% }` rule is undone
  // in CSS (.hr-tile input).
  const checklist = cats.map((c) =>
    '<div class="hr-tile" data-tile="' + esc(c) + '">'
    + '<label class="hr-tile-main">'
    + '<input type="checkbox" data-cat="' + esc(c) + '">'
    + '<span class="hr-tile-ic"><span class="ms">' + catIcon(c) + '</span></span>'
    + '<span class="hr-tile-name">' + esc(c) + '</span>'
    + '</label>'
    + '<div class="hr-qty" aria-label="' + esc(t('hr.qty')) + '">'
    + '<button type="button" data-step="-1" aria-label="' + esc(t('hr.qtyDec')) + '" disabled><span class="ms">remove</span></button>'
    + '<input type="number" min="1" max="99" value="1" data-qty="' + esc(c) + '" aria-label="' + esc(t('hr.qty') + ' — ' + c) + '" disabled>'
    + '<button type="button" data-step="1" aria-label="' + esc(t('hr.qtyInc')) + '" disabled><span class="ms">add</span></button>'
    + '</div></div>'
  ).join('');

  const cardHead = (icon, tone, title, sub) => '<div class="hr-card-head">'
    + '<span class="icon-chip hr-chip-' + tone + '"><span class="ms">' + icon + '</span></span>'
    + '<div><h3>' + esc(title) + '</h3><p>' + esc(sub) + '</p></div></div>';

  const metric = (tint, tone, icon, label, value) => '<div class="card metric2 tint-' + tint + '">'
    + '<div class="metric2-head" style="margin-bottom:0"><div>'
    + '<div class="metric2-label">' + esc(label) + '</div>'
    + '<div class="metric2-value">' + Number(value || 0) + '</div></div>'
    + '<span class="icon-chip hr-chip-' + tone + '"><span class="ms">' + icon + '</span></span></div></div>';

  el.innerHTML = pageHead(t('nav.hr'), t('hr.sub'), '')
    + '<div class="grid-metrics" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:20px">'
    + metric('indigo', 'indigo', 'person_add', t('hr.pendingOnboard'), stats.hrOnboardPending)
    + metric('rose', 'rose', 'person_remove', t('hr.pendingOffboard'), stats.hrOffboardPending)
    + metric('blue', 'green', 'task_alt', t('hr.approved'), approvedCount)
    + '</div>';

  if (canCreate) {
    el.innerHTML += '<div class="grid grid-2 hr-forms">'
      + '<div class="card hr-card">'
      + cardHead('person_add', 'indigo', t('hr.onboardTitle'), t('hr.onboardSub'))
      + '<div class="hr-card-body">'
      + '<div id="hr-on-err" class="form-error hidden" style="margin:0 0 14px"></div>'
      + '<div class="hr-sec"><span class="ms">badge</span>' + esc(t('hr.secPerson')) + '</div>'
      + '<div class="grid grid-2 hr-fields">'
      + '<div class="form-field"><label for="hr-on-name">' + esc(t('hr.fullName')) + ' <span class="hr-req">*</span></label><input id="hr-on-name" autocomplete="name"></div>'
      + '<div class="form-field"><label for="hr-on-email">' + esc(t('hr.email')) + '</label><input id="hr-on-email" type="email" autocomplete="email" aria-describedby="hr-on-email-hint">'
      + '<span class="hr-hint" id="hr-on-email-hint">' + esc(t('hr.emailOptionalHint')) + '</span></div>'
      + '<div class="form-field"><label for="hr-on-dept">' + esc(t('hr.department')) + '</label><select id="hr-on-dept"><option value="">—</option>'
      + (AppConfig.departments || []).map((d) => '<option value="' + esc(d) + '">' + esc(d) + '</option>').join('')
      + '</select></div>'
      + '<div class="form-field"><label for="hr-on-title">' + esc(t('hr.title')) + '</label><input id="hr-on-title"></div>'
      + '<div class="form-field"><label for="hr-on-date">' + esc(t('hr.startDate')) + ' <span class="hr-req">*</span></label><input id="hr-on-date" type="date" value="' + esc(today) + '"></div>'
      // Only when there is a choice to make. One entity needs no question asked,
      // and the request falls back to it on the server either way.
      + (Companies.isMulti()
        ? '<div class="form-field"><label for="hr-on-company">' + esc(t('co.field')) + '</label>'
          + '<select id="hr-on-company">'
          + Companies.active().map((c) => '<option value="' + esc(c.id) + '"'
            + (c.id === Companies.defaultId() ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('')
          + '</select></div>'
        : '')
      // Full width: the picker opens a result list, and half a row cramps it.
      // The new hire has no employee record yet, so the manager is parked on
      // the ticket and written to that record when IT approves.
      + '<div class="form-field" style="grid-column:1/-1"><label>' + esc(t('hr.manager')) + '</label>'
      + '<div data-emp-search="managerEmployeeId"></div>'
      + '<span class="hr-hint">' + esc(t('hr.managerHint')) + '</span></div>'
      + '</div>'
      + '<div class="hr-sec hr-sec-split"><span><span class="ms">devices</span>' + esc(t('hr.equipment')) + '</span>'
      + '<span class="badge-count zero" id="hr-on-count" title="' + esc(t('hr.selectedItems')) + '">0</span></div>'
      + '<p class="hr-hint" style="margin:-4px 0 10px">' + esc(t('hr.equipmentHint')) + '</p>'
      + (cats.length
        ? '<div id="hr-on-cats" class="hr-equip">' + checklist + '</div>'
        : '<div class="hr-empty-cats">' + esc(t('hr.noCats')) + '</div>')
      + '<div class="hr-sec"><span class="ms">notes</span>' + esc(t('hr.notes')) + '</div>'
      + '<div class="form-field"><textarea id="hr-on-notes" rows="3" aria-label="' + esc(t('hr.notes')) + '" placeholder="' + esc(t('hr.notesPh')) + '"></textarea></div>'
      + '</div>'
      + '<div class="hr-card-foot"><button class="btn btn-primary" id="hr-on-submit"><span class="ms">send</span>' + esc(t('hr.submitOnboard')) + '</button></div>'
      + '</div>'
      + '<div class="card hr-card">'
      + cardHead('person_remove', 'rose', t('hr.offboardTitle'), t('hr.offboardSub'))
      + '<div class="hr-card-body">'
      + '<div id="hr-off-err" class="form-error hidden" style="margin:0 0 14px"></div>'
      + '<div class="form-field"><label>' + esc(t('hr.employee')) + ' <span class="hr-req">*</span></label>'
      + '<div data-emp-search="offEmployeeId"></div></div>'
      + '<div class="form-field"><label for="hr-off-date">' + esc(t('hr.endDate')) + ' <span class="hr-req">*</span></label><input id="hr-off-date" type="date" value="' + esc(today) + '"></div>'
      + '<div class="form-field"><label for="hr-off-notes">' + esc(t('hr.notes')) + '</label><textarea id="hr-off-notes" rows="3" placeholder="' + esc(t('hr.offNotesPh')) + '"></textarea></div>'
      + '<div class="hr-note"><span class="ms">info</span><span>' + esc(t('hr.offboardInfo')) + '</span></div>'
      + '</div>'
      + '<div class="hr-card-foot"><button class="btn btn-primary hr-btn-rose" id="hr-off-submit"><span class="ms">send</span>' + esc(t('hr.submitOffboard')) + '</button></div>'
      + '</div></div>';
  }

  function actionsFor(r) {
    if (r.status !== 'pending') {
      // A cancelled ticket surfaces WHY it was rejected (full text on hover),
      // so the requester isn't left guessing.
      if (r.status === 'cancelled') {
        const reason = String(r.cancelReason || '').trim();
        if (!reason) return '<span class="cell-sub">' + esc(t('hr.cancelledNoReason')) + '</span>';
        const short = reason.length > 60 ? reason.slice(0, 60) + '…' : reason;
        return '<span class="cell-sub" title="' + esc(reason) + '">'
          + '<span class="ms" style="font-size:14px;vertical-align:-2px">info</span> ' + esc(short) + '</span>';
      }
      // Three distinct end states, not two: IT picked it up, IT scheduled the
      // onboarding, or the kit is actually in the person's hands.
      if (r.fulfilledAt) {
        return '<span class="pill pill-green">' + esc(t('hr.fulfilled')) + '</span>';
      }
      return r.onboardingId
        ? '<span class="cell-sub">' + esc(t('hr.provisioned')) + '</span>'
        : '—';
    }
    // Approving happens on the IT dashboard. The one action left here is
    // withdrawing a ticket you filed yourself.
    if (myUid && String(r.createdBy) === String(myUid)) {
      return '<button class="btn btn-sm btn-outline" data-cancel="' + esc(r.id) + '">'
        + esc(t('hr.cancel')) + '</button>';
    }
    return '<span class="cell-sub">' + esc(t('hr.awaitingIt')) + '</span>';
  }

  const rowHtml = (r) => '<tr data-status="' + esc(r.status) + '">'
    + '<td><span class="pill ' + (r.type === 'offboard' ? 'pill-rose' : 'pill-indigo') + '">'
    + esc(typeLabel(r.type)) + '</span></td>'
    + '<td><div class="cell-title">' + esc(r.fullName || '') + '</div><div class="cell-sub">' + esc(r.email || r.department || '') + '</div>'
    + (r.managerName
      ? '<div class="cell-sub"><span class="ms" style="font-size:13px;vertical-align:-2px">supervisor_account</span> '
        + esc(r.managerName) + '</div>'
      : '')
    // Only worth a line when more than one entity exists to tell apart.
    + (Companies.isMulti() && r.companyName
      ? '<div class="cell-sub"><span class="ms" style="font-size:13px;vertical-align:-2px">apartment</span> '
        + esc(r.companyName) + '</div>'
      : '') + '</td>'
    + '<td>' + esc(String(r.eventDate || '').slice(0, 10)) + '</td>'
    + '<td><span class="pill ' + statusPill(r.status) + '">' + esc(statusLabel(r.status)) + '</span></td>'
    + '<td class="cell-sub">' + ((r.items || []).map((i) => esc(i.category + '×' + i.qty)).join(', ') || '—') + '</td>'
    + '<td class="cell-sub">' + esc(r.createdByName || '') + '</td>'
    + '<td>' + actionsFor(r) + '</td></tr>';

  const rowsHtml = list.length
    ? list.map(rowHtml).join('')
    : '<tr><td colspan="7" class="table-empty">' + esc(t('hr.none')) + '</td></tr>';

  const countOf = (st) => list.filter((r) => r.status === st).length;
  const filterBtn = (val, label, n) => '<button type="button" class="seg-btn' + (val ? '' : ' active') + '"'
    + ' data-filter="' + val + '" aria-pressed="' + (val ? 'false' : 'true') + '">' + esc(label)
    + ' <span class="hr-seg-n">' + n + '</span></button>';

  el.innerHTML += '<div class="card"><div class="card-head hr-list-head">'
    + '<h3>' + esc(t('hr.requests')) + '</h3>'
    + '<div class="seg hr-seg" id="hr-filter" role="group" aria-label="' + esc(t('hr.status')) + '">'
    + filterBtn('', t('hr.filterAll'), list.length)
    + filterBtn('pending', t('hr.statusPending'), countOf('pending'))
    + filterBtn('acknowledged', t('hr.statusAcknowledged'), countOf('acknowledged'))
    + filterBtn('cancelled', t('hr.statusCancelled'), countOf('cancelled'))
    + '</div></div>'
    + '<div class="table-wrap"><table class="data"><thead><tr>'
    + '<th>' + esc(t('hr.type')) + '</th><th>' + esc(t('hr.employee')) + '</th>'
    + '<th>' + esc(t('hr.eventDate')) + '</th><th>' + esc(t('hr.status')) + '</th>'
    + '<th>' + esc(t('hr.items')) + '</th><th>' + esc(t('hr.requestedBy')) + '</th>'
    + '<th>' + esc(t('hr.actions')) + '</th>'
    + '</tr></thead><tbody id="hr-rows">' + rowsHtml + '</tbody>'
    + '<tbody id="hr-empty" class="hidden"><tr><td colspan="7" class="table-empty">'
    + esc(t('hr.noneFiltered')) + '</td></tr></tbody></table></div></div>';

  // Reuse the shared employee picker so this form behaves like every other
  // employee field in the app (avatar, clear button, keyboard focus).
  const offHost = el.querySelector('[data-emp-search="offEmployeeId"]');
  let offPicker = null;
  if (offHost && typeof mountEmployeeSearchField === 'function') {
    offPicker = mountEmployeeSearchField(offHost, {
      name: 'offEmployeeId',
      searchUrl: '/hr/employees/search',
      placeholder: t('hr.searchEmp'),
    });
  }

  const mgrHost = el.querySelector('[data-emp-search="managerEmployeeId"]');
  let mgrPicker = null;
  if (mgrHost && typeof mountEmployeeSearchField === 'function') {
    mgrPicker = mountEmployeeSearchField(mgrHost, {
      name: 'managerEmployeeId',
      searchUrl: '/hr/employees/search',
      placeholder: t('hr.searchManager'),
    });
  }

  el.querySelectorAll('#hr-filter [data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const want = btn.dataset.filter;
      el.querySelectorAll('#hr-filter [data-filter]').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      let shown = 0;
      el.querySelectorAll('#hr-rows tr[data-status]').forEach((tr) => {
        const match = !want || tr.dataset.status === want;
        tr.classList.toggle('hidden', !match);
        if (match) shown += 1;
      });
      const emptyBody = el.querySelector('#hr-empty');
      if (emptyBody) emptyBody.classList.toggle('hidden', shown > 0 || !list.length);
    });
  });

  el.querySelectorAll('[data-cancel]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.cancel;
      // Styled in-app modal instead of the browser's native prompt().
      formModal({
        title: 'hr.cancelTitle',
        submitLabel: 'hr.cancel',
        fields: [
          { name: 'reason', label: 'hr.cancelReason', type: 'textarea', full: true, placeholder: t('hr.cancelReasonPh') },
        ],
        async onSubmit(d) {
          await api('/hr/requests/' + encodeURIComponent(id) + '/cancel', {
            method: 'POST',
            body: { reason: (d.reason || '').trim() },
          });
          toast(t('hr.cancelOk'), 'success');
          Views.hr(el);
        },
      });
    });
  });

  const countEl = el.querySelector('#hr-on-count');
  function syncItemCount() {
    if (!countEl) return;
    const n = el.querySelectorAll('input[data-cat]:checked').length;
    countEl.textContent = String(n);
    countEl.classList.toggle('zero', n === 0);
  }
  // Scope lookups to the tile rather than building a selector from the
  // category name — server-supplied text may contain quotes.
  el.querySelectorAll('.hr-tile').forEach((tile) => {
    const cb = tile.querySelector('input[data-cat]');
    const qty = tile.querySelector('input[data-qty]');
    const steps = tile.querySelectorAll('[data-step]');
    const clamp = () => { qty.value = String(Math.min(99, Math.max(1, Math.round(Number(qty.value) || 1)))); };
    cb.addEventListener('change', () => {
      tile.classList.toggle('on', cb.checked);
      qty.disabled = !cb.checked;
      steps.forEach((s) => { s.disabled = !cb.checked; });
      syncItemCount();
    });
    qty.addEventListener('change', clamp);
    steps.forEach((s) => s.addEventListener('click', () => {
      qty.value = String((Number(qty.value) || 1) + Number(s.dataset.step));
      clamp();
    }));
  });

  const onSubmit = el.querySelector('#hr-on-submit');
  if (onSubmit) {
    onSubmit.addEventListener('click', async () => {
      const err = el.querySelector('#hr-on-err');
      err.classList.add('hidden');
      const items = [];
      el.querySelectorAll('input[data-cat]:checked').forEach((cb) => {
        const qtyEl = cb.closest('.hr-tile').querySelector('input[data-qty]');
        items.push({ category: cb.dataset.cat, qty: Number(qtyEl && qtyEl.value) || 1 });
      });
      onSubmit.disabled = true;
      const onLabel = onSubmit.innerHTML;
      onSubmit.innerHTML = '<span class="btn-spin"></span>' + esc(t('common.sending'));
      try {
        await api('/hr/onboard-requests', {
          method: 'POST',
          body: {
            fullName: el.querySelector('#hr-on-name').value,
            email: el.querySelector('#hr-on-email').value,
            department: el.querySelector('#hr-on-dept').value,
            title: el.querySelector('#hr-on-title').value,
            eventDate: el.querySelector('#hr-on-date').value,
            managerEmployeeId: (mgrPicker && mgrPicker.getId()) || '',
            companyId: el.querySelector('#hr-on-company')?.value || '',
            notes: el.querySelector('#hr-on-notes').value,
            items,
          },
        });
        toast(t('hr.onboardOk'), 'success');
        Views.hr(el);
      } catch (e) {
        onSubmit.disabled = false;
        onSubmit.innerHTML = onLabel;
        err.textContent = e.message;
        err.classList.remove('hidden');
      }
    });
  }

  const offSubmit = el.querySelector('#hr-off-submit');
  if (offSubmit) {
    offSubmit.addEventListener('click', async () => {
      const err = el.querySelector('#hr-off-err');
      err.classList.add('hidden');
      const employeeId = offPicker ? offPicker.getId() : '';
      if (!employeeId) {
        err.textContent = t('hr.pickEmployee');
        err.classList.remove('hidden');
        return;
      }
      offSubmit.disabled = true;
      const offLabel = offSubmit.innerHTML;
      offSubmit.innerHTML = '<span class="btn-spin"></span>' + esc(t('common.sending'));
      try {
        await api('/hr/offboard-requests', {
          method: 'POST',
          body: {
            employeeId: employeeId,
            eventDate: el.querySelector('#hr-off-date').value,
            notes: el.querySelector('#hr-off-notes').value,
          },
        });
        toast(t('hr.offboardOk'), 'success');
        Views.hr(el);
      } catch (e) {
        offSubmit.disabled = false;
        offSubmit.innerHTML = offLabel;
        err.textContent = e.message;
        err.classList.remove('hidden');
      }
    });
  }
};
