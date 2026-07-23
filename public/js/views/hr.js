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

  // The global `input { width: 100% }` rule stretches a bare checkbox across the
  // row, so pin it and let the label take the slack instead.
  const checklist = cats.map((c) =>
    '<label class="hr-check" style="display:flex;align-items:center;gap:10px;margin:4px 0;cursor:pointer">'
    + '<input type="checkbox" data-cat="' + esc(c) + '" style="width:auto;flex:0 0 auto;margin:0">'
    + '<span style="flex:1">' + esc(c) + '</span>'
    + '<input type="number" min="1" max="99" value="1" data-qty="' + esc(c) + '"'
    + ' style="width:64px;flex:0 0 auto" disabled>'
    + '</label>'
  ).join('');

  el.innerHTML = pageHead(t('nav.hr'), t('hr.sub'), '')
    + '<div class="grid-metrics" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:20px">'
    + '<div class="card metric2 tint-indigo"><div class="metric2-label">' + esc(t('hr.pendingOnboard')) + '</div>'
    + '<div class="metric2-value">' + Number(stats.hrOnboardPending || 0) + '</div></div>'
    + '<div class="card metric2 tint-rose"><div class="metric2-label">' + esc(t('hr.pendingOffboard')) + '</div>'
    + '<div class="metric2-value">' + Number(stats.hrOffboardPending || 0) + '</div></div>'
    + '<div class="card metric2 tint-blue"><div class="metric2-label">' + esc(t('hr.approved')) + '</div>'
    + '<div class="metric2-value">' + approvedCount + '</div></div></div>';

  if (canCreate) {
    el.innerHTML += '<div class="grid grid-2" style="gap:20px;margin-bottom:20px;align-items:start">'
      + '<div class="card card-pad"><h3 style="margin:0 0 12px">' + esc(t('hr.onboardTitle')) + '</h3>'
      + '<div id="hr-on-err" class="form-error hidden" style="margin-bottom:10px"></div>'
      + '<div class="grid grid-2">'
      + '<div class="form-field"><label>' + esc(t('hr.fullName')) + ' *</label><input id="hr-on-name" autocomplete="name"></div>'
      + '<div class="form-field"><label>' + esc(t('hr.email')) + ' *</label><input id="hr-on-email" type="email" autocomplete="email"></div>'
      + '<div class="form-field"><label>' + esc(t('hr.department')) + '</label><select id="hr-on-dept"><option value="">—</option>'
      + (AppConfig.departments || []).map((d) => '<option value="' + esc(d) + '">' + esc(d) + '</option>').join('')
      + '</select></div>'
      + '<div class="form-field"><label>' + esc(t('hr.title')) + '</label><input id="hr-on-title"></div>'
      + '<div class="form-field"><label>' + esc(t('hr.startDate')) + ' *</label><input id="hr-on-date" type="date" value="' + esc(today) + '"></div>'
      + '</div>'
      + '<div style="margin:12px 0 8px;display:flex;justify-content:space-between;align-items:baseline">'
      + '<span class="cell-sub">' + esc(t('hr.equipment')) + '</span>'
      + '<span class="cell-sub" id="hr-on-count">0 ' + esc(t('hr.selectedItems')) + '</span></div>'
      + '<div id="hr-on-cats">' + checklist + '</div>'
      + '<div class="form-field" style="margin-top:10px"><label>' + esc(t('hr.notes')) + '</label><textarea id="hr-on-notes" rows="2"></textarea></div>'
      + '<button class="btn btn-primary" id="hr-on-submit" style="margin-top:12px">' + esc(t('hr.submitOnboard')) + '</button></div>'
      + '<div class="card card-pad"><h3 style="margin:0 0 12px">' + esc(t('hr.offboardTitle')) + '</h3>'
      + '<div id="hr-off-err" class="form-error hidden" style="margin-bottom:10px"></div>'
      + '<div class="form-field"><label>' + esc(t('hr.employee')) + ' *</label>'
      + '<div data-emp-search="offEmployeeId"></div></div>'
      + '<div class="form-field"><label>' + esc(t('hr.endDate')) + ' *</label><input id="hr-off-date" type="date" value="' + esc(today) + '"></div>'
      + '<div class="form-field"><label>' + esc(t('hr.notes')) + '</label><textarea id="hr-off-notes" rows="2"></textarea></div>'
      + '<button class="btn btn-primary" id="hr-off-submit" style="margin-top:12px">' + esc(t('hr.submitOffboard')) + '</button></div></div>';
  }

  function actionsFor(r) {
    if (r.status !== 'pending') {
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
    + '<td><div class="cell-title">' + esc(r.fullName || '') + '</div><div class="cell-sub">' + esc(r.email || r.department || '') + '</div></td>'
    + '<td>' + esc(String(r.eventDate || '').slice(0, 10)) + '</td>'
    + '<td><span class="pill ' + statusPill(r.status) + '">' + esc(statusLabel(r.status)) + '</span></td>'
    + '<td class="cell-sub">' + ((r.items || []).map((i) => esc(i.category + '×' + i.qty)).join(', ') || '—') + '</td>'
    + '<td class="cell-sub">' + esc(r.createdByName || '') + '</td>'
    + '<td>' + actionsFor(r) + '</td></tr>';

  const rowsHtml = list.length
    ? list.map(rowHtml).join('')
    : '<tr><td colspan="7" class="table-empty">' + esc(t('hr.none')) + '</td></tr>';

  el.innerHTML += '<div class="card"><div class="card-head">'
    + '<h3>' + esc(t('hr.requests')) + '</h3>'
    + '<select id="hr-filter" class="btn btn-outline btn-sm" style="min-width:160px">'
    + '<option value="">' + esc(t('hr.filterAll')) + '</option>'
    + '<option value="pending">' + esc(t('hr.statusPending')) + '</option>'
    + '<option value="acknowledged">' + esc(t('hr.statusAcknowledged')) + '</option>'
    + '<option value="cancelled">' + esc(t('hr.statusCancelled')) + '</option>'
    + '</select></div>'
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

  const filterEl = el.querySelector('#hr-filter');
  if (filterEl) {
    filterEl.addEventListener('change', () => {
      const want = filterEl.value;
      let shown = 0;
      el.querySelectorAll('#hr-rows tr[data-status]').forEach((tr) => {
        const match = !want || tr.dataset.status === want;
        tr.classList.toggle('hidden', !match);
        if (match) shown += 1;
      });
      const emptyBody = el.querySelector('#hr-empty');
      if (emptyBody) emptyBody.classList.toggle('hidden', shown > 0 || !list.length);
    });
  }

  el.querySelectorAll('[data-cancel]').forEach((b) => {
    b.addEventListener('click', async () => {
      const reason = prompt(t('hr.cancelReason'), '');
      if (reason === null) return;
      b.disabled = true;
      try {
        await api('/hr/requests/' + encodeURIComponent(b.dataset.cancel) + '/cancel', {
          method: 'POST',
          body: { reason: reason },
        });
        toast(t('hr.cancelOk'), 'success');
        Views.hr(el);
      } catch (e) {
        b.disabled = false;
        toast(e.message, 'error');
      }
    });
  });

  const countEl = el.querySelector('#hr-on-count');
  function syncItemCount() {
    if (!countEl) return;
    const n = el.querySelectorAll('input[data-cat]:checked').length;
    countEl.textContent = n + ' ' + t('hr.selectedItems');
  }
  el.querySelectorAll('input[data-cat]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const qty = el.querySelector('input[data-qty="' + cb.dataset.cat + '"]');
      if (qty) qty.disabled = !cb.checked;
      syncItemCount();
    });
  });

  const onSubmit = el.querySelector('#hr-on-submit');
  if (onSubmit) {
    onSubmit.addEventListener('click', async () => {
      const err = el.querySelector('#hr-on-err');
      err.classList.add('hidden');
      const items = [];
      el.querySelectorAll('input[data-cat]:checked').forEach((cb) => {
        const qtyEl = el.querySelector('input[data-qty="' + cb.dataset.cat + '"]');
        items.push({ category: cb.dataset.cat, qty: Number(qtyEl && qtyEl.value) || 1 });
      });
      onSubmit.disabled = true;
      try {
        await api('/hr/onboard-requests', {
          method: 'POST',
          body: {
            fullName: el.querySelector('#hr-on-name').value,
            email: el.querySelector('#hr-on-email').value,
            department: el.querySelector('#hr-on-dept').value,
            title: el.querySelector('#hr-on-title').value,
            eventDate: el.querySelector('#hr-on-date').value,
            notes: el.querySelector('#hr-on-notes').value,
            items,
          },
        });
        toast(t('hr.onboardOk'), 'success');
        Views.hr(el);
      } catch (e) {
        onSubmit.disabled = false;
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
        err.textContent = e.message;
        err.classList.remove('hidden');
      }
    });
  }
};
