/* =============================== ORGANIZATION =============================== */
/* Topology-style org chart: Company → Departments → Teams drawn as an SVG node
 * graph (same look as the network topology view). Click a node to manage it.
 * Strings follow the app language via T(en, tr); other languages get English. */
Views.org = async function (el) {
  if (isStaleView(el)) return;
  const canManage = Auth.canIam('employee', 'manage');
  const isApprovalAdmin = !!(Auth.profile && ['Owner', 'Admin'].includes(Auth.profile.role));
  const _lng = (typeof window.i18nLang === 'function' ? window.i18nLang() : 'en');
  const T = (en, tr) => (_lng === 'tr' ? tr : en);

  const NW = 216, NH = 66, GAPX = 96, GAPY = 20, PAD = 30, ROWH = NH + GAPY;
  const C_ROOT = '#7f77dd', C_DEPT = '#175cd3', C_TEAM = '#0f6e56';
  const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  /* ---------- Employee picker (manager / lead) ---------- */
  function pickEmployee({ title, selected, onPick }) {
    openModal({
      title,
      body: `<div id="org-pick-host"></div>`,
      foot: `
        <button class="btn btn-outline" data-close>${esc(T('Cancel', 'İptal'))}</button>
        <button class="btn btn-outline" id="org-pick-none"><span class="ms">person_off</span> ${esc(T('Clear', 'Temizle'))}</button>
        <button class="btn btn-primary" id="org-pick-save" disabled>${esc(T('Save', 'Kaydet'))}</button>`,
      onMount(overlay) {
        let chosen = selected || null;
        mountEmployeeSearchField($('#org-pick-host', overlay), {
          selected: selected && selected.id ? selected : null,
          placeholder: T('Search by name, email or department…', 'İsim, e-posta veya departmanla ara…'),
          onChange(emp) { chosen = emp; $('#org-pick-save', overlay).disabled = !emp; },
        });
        $('#org-pick-save', overlay).addEventListener('click', async () => {
          try { await onPick(chosen ? chosen.id : null); closeModal(); await load(); }
          catch (err) { toast(err.message, 'error'); }
        });
        $('#org-pick-none', overlay).addEventListener('click', async () => {
          try { await onPick(null); closeModal(); await load(); }
          catch (err) { toast(err.message, 'error'); }
        });
      },
    });
  }

  function moveMember(dept, member) {
    const options = [
      ...dept.teams.map((tm) => `<button class="btn btn-outline" data-team="${esc(tm.id)}" style="justify-content:flex-start">${esc(tm.name)}</button>`),
      `<button class="btn btn-outline" data-team="" style="justify-content:flex-start"><span class="ms">person_off</span> ${esc(T('No team (department only)', 'Takımsız (sadece departman)'))}</button>`,
    ].join('');
    openModal({
      title: `${T('Move', 'Taşı')} — ${member.fullName}`,
      body: `<div style="display:flex;flex-direction:column;gap:8px">${dept.teams.length ? '' : `<div class="cell-sub">${esc(T('This department has no teams yet.', 'Bu departmanda henüz takım yok.'))}</div>`}${options}</div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(T('Close', 'Kapat'))}</button>`,
      stack: true,
      onMount(overlay) {
        overlay.querySelectorAll('[data-team]').forEach((b) => b.addEventListener('click', async () => {
          try {
            await api(`/org/employees/${encodeURIComponent(member.id)}/team`, { method: 'PATCH', body: { teamId: b.dataset.team || null } });
            toast(T('Member moved', 'Üye taşındı'), 'success'); closeModal(); await load();
          } catch (err) { toast(err.message, 'error'); }
        }));
      },
    });
  }

  const memberChips = (dept, members, leadId) => members.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;max-height:240px;overflow:auto">${members.map((m) => `
        <span class="chip" ${canManage ? `data-move data-mid="${esc(m.id)}"` : ''} style="${canManage ? 'cursor:pointer' : ''}" title="${canManage ? esc(T('Move member', 'Üyeyi taşı')) : ''}">
          <span class="avatar" style="width:22px;height:22px;font-size:10px">${esc(initials(m.fullName))}</span>
          ${esc(m.fullName)}${leadId && leadId === m.id ? ' <span class="cell-sub">· Lead</span>' : ''}</span>`).join('')}</div>`
    : `<div class="cell-sub">${esc(T('No members yet.', 'Henüz üye yok.'))}</div>`;

  const managerPill = (p) => p
    ? `<span class="pill pill-indigo"><span class="ms ms-sm">badge</span> ${esc(p.fullName)}</span>`
    : `<span class="pill pill-slate"><span class="ms ms-sm">help</span> ${esc(T('Unassigned', 'Atanmadı'))}</span>`;

  /* ---------- Node management modals ---------- */
  function openDeptModal(dept) {
    openModal({
      title: dept.name,
      wide: true,
      body: `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <span class="cell-sub" style="min-width:68px">${esc(T('Manager', 'Yönetici'))}</span>${managerPill(dept.manager)}
          ${canManage ? `<button class="btn btn-outline btn-sm" id="dm-mgr" style="margin-left:auto"><span class="ms">manage_accounts</span> ${esc(T('Set manager', 'Yönetici ata'))}</button>` : ''}
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 6px">
          <h3 style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--on-surface-variant);margin:0">${esc(T('Teams', 'Takımlar'))} (${dept.teams.length})</h3>
          ${canManage ? `<button class="btn btn-primary btn-sm" id="dm-addteam"><span class="ms">add</span> ${esc(T('Add team', 'Takım ekle'))}</button>` : ''}
        </div>
        ${dept.teams.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${dept.teams.map((tm) => `
          <button class="btn btn-outline btn-sm" data-open-team="${esc(tm.id)}"><span class="ms">groups</span> ${esc(tm.name)} <span class="badge-count">${tm.members.length}</span></button>`).join('')}</div>` : `<div class="cell-sub" style="margin-bottom:8px">${esc(T('No teams yet.', 'Henüz takım yok.'))}</div>`}
        <h3 style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--on-surface-variant);margin:14px 0 6px">${esc(T('Direct members', 'Doğrudan üyeler'))} (${dept.directMembers.length})</h3>
        ${memberChips(dept, dept.directMembers, null)}`,
      foot: `<button class="btn btn-outline" data-close>${esc(T('Close', 'Kapat'))}</button>`,
      onMount(overlay) {
        const mgr = $('#dm-mgr', overlay);
        if (mgr) mgr.addEventListener('click', () => pickEmployee({
          title: `${T('Set manager', 'Yönetici ata')} — ${dept.name}`, selected: dept.manager,
          onPick: (id) => api(`/org/departments/${encodeURIComponent(dept.id)}`, { method: 'PATCH', body: { managerEmployeeId: id } }),
        }));
        const add = $('#dm-addteam', overlay);
        if (add) add.addEventListener('click', () => formModal({
          title: T('Add team', 'Takım ekle'), stack: true,
          fields: [{ name: 'name', label: T('Team name', 'Takım adı'), required: true, full: true, maxlength: 60 }],
          submitLabel: T('Add', 'Ekle'),
          async onSubmit(d) { await api('/org/teams', { method: 'POST', body: { name: d.name, departmentId: dept.id } }); toast(T('Team added', 'Takım eklendi'), 'success'); closeModal(); await load(); },
        }));
        overlay.querySelectorAll('[data-open-team]').forEach((b) => b.addEventListener('click', () => {
          const tm = dept.teams.find((x) => x.id === b.dataset.openTeam);
          if (tm) { closeModal(); openTeamModal(dept, tm); }
        }));
        overlay.querySelectorAll('[data-move]').forEach((s) => s.addEventListener('click', () => {
          const m = dept.directMembers.find((x) => x.id === s.dataset.mid);
          if (m) moveMember(dept, m);
        }));
      },
    });
  }

  function openTeamModal(dept, tm) {
    openModal({
      title: `${dept.name} / ${tm.name}`,
      wide: true,
      body: `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <span class="cell-sub" style="min-width:52px">Lead</span>${managerPill(tm.lead)}
          ${canManage ? `<div class="actions" style="margin-left:auto">
            <button class="btn btn-outline btn-sm" id="tm-lead"><span class="ms">military_tech</span> ${esc(T('Set lead', 'Lead ata'))}</button>
            <button class="btn btn-outline btn-sm" id="tm-rename">${esc(T('Rename', 'Yeniden adlandır'))}</button>
            <button class="btn btn-outline btn-sm" id="tm-del"><span class="ms">delete</span></button>
          </div>` : ''}
        </div>
        <h3 style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--on-surface-variant);margin:14px 0 6px">${esc(T('Members', 'Üyeler'))} (${tm.members.length})</h3>
        ${memberChips(dept, tm.members, tm.lead && tm.lead.id)}`,
      foot: `<button class="btn btn-outline" data-close>${esc(T('Close', 'Kapat'))}</button>`,
      onMount(overlay) {
        const lead = $('#tm-lead', overlay);
        if (lead) lead.addEventListener('click', () => pickEmployee({
          title: `${T('Set lead', 'Lead ata')} — ${tm.name}`, selected: tm.lead,
          onPick: (id) => api(`/org/teams/${encodeURIComponent(tm.id)}`, { method: 'PATCH', body: { leadEmployeeId: id } }),
        }));
        const ren = $('#tm-rename', overlay);
        if (ren) ren.addEventListener('click', () => formModal({
          title: T('Rename', 'Yeniden adlandır'), stack: true,
          fields: [{ name: 'name', label: T('Team name', 'Takım adı'), required: true, full: true, value: tm.name, maxlength: 60 }],
          submitLabel: T('Save', 'Kaydet'),
          async onSubmit(d) { await api(`/org/teams/${encodeURIComponent(tm.id)}`, { method: 'PATCH', body: { name: d.name } }); toast(T('Saved', 'Kaydedildi'), 'success'); closeModal(); await load(); },
        }));
        const del = $('#tm-del', overlay);
        if (del) del.addEventListener('click', () => confirmModal(`${T('Delete this team? Its members stay attached to the department only.', 'Bu takım silinsin mi? Üyeleri sadece departmana bağlı kalır.')}\n\n${tm.name}`, async () => {
          await api(`/org/teams/${encodeURIComponent(tm.id)}`, { method: 'DELETE' }); toast(T('Team deleted', 'Takım silindi'), 'success'); closeModal(); await load();
        }));
        overlay.querySelectorAll('[data-move]').forEach((s) => s.addEventListener('click', () => {
          const m = tm.members.find((x) => x.id === s.dataset.mid);
          if (m) moveMember(dept, m);
        }));
      },
    });
  }

  /* ---------- SVG topology builder ---------- */
  function nodeSvg(kind, id, x, y, title, sub, meta, accent) {
    return `
      <g class="net-topo-node" data-kind="${kind}" data-id="${esc(id)}" transform="translate(${x},${y})" role="button" tabindex="0">
        <rect class="net-topo-node-bg" width="${NW}" height="${NH}" rx="10" ry="10" fill="#fff"/>
        <rect class="net-topo-node-accent" width="6" height="${NH}" rx="3" fill="${accent}"/>
        <rect class="net-topo-node-stroke" width="${NW}" height="${NH}" rx="10" ry="10" fill="none" stroke="#e4e7ec" stroke-width="1.5"/>
        <text class="net-topo-title" x="18" y="25">${esc(trunc(title, 26))}</text>
        <text class="net-topo-sub" x="18" y="43">${esc(trunc(sub, 32))}</text>
        <text class="net-topo-meta" x="18" y="58">${esc(meta)}</text>
      </g>`;
  }
  const edge = (x1, y1, x2, y2) =>
    `<path class="net-topo-edge" d="M${x1} ${y1} C ${x1 + 46} ${y1}, ${x2 - 46} ${y2}, ${x2} ${y2}" fill="none" stroke="#cbd2dc" stroke-width="1.5" marker-end="url(#org-arrow)"/>`;

  function topologySvg(tree) {
    let cursor = 0;
    const layout = tree.departments.map((d) => {
      const span = Math.max(1, d.teams.length);
      const start = cursor; cursor += span;
      return { d, start, span };
    });
    const totalRows = Math.max(1, cursor);
    const colX = [PAD, PAD + (NW + GAPX), PAD + 2 * (NW + GAPX)];
    const width = PAD * 2 + 3 * NW + 2 * GAPX;
    const height = PAD * 2 + totalRows * ROWH - GAPY;
    const rowY = (r) => PAD + r * ROWH;
    const contentH = totalRows * ROWH - GAPY;
    const rootY = PAD + contentH / 2 - NH / 2;
    const peopleCount = tree.departments.reduce((n, d) => n + d.memberCount, 0) + tree.unassigned.length;
    const uPeople = T('people', 'kişi'), uTeams = T('teams', 'takım');

    const edges = [];
    const nodes = [];
    const rootRight = [colX[0] + NW, rootY + NH / 2];
    nodes.push(nodeSvg('root', '', colX[0], rootY,
      AppConfig.companyName || T('Organization', 'Organizasyon'),
      `${tree.departments.length} ${T('departments', 'departman')}`, `${peopleCount.toLocaleString()} ${uPeople}`, C_ROOT));

    layout.forEach(({ d, start, span }) => {
      const dy = rowY(start) + (span * ROWH - GAPY) / 2 - NH / 2;
      edges.push(edge(rootRight[0], rootRight[1], colX[1], dy + NH / 2));
      nodes.push(nodeSvg('dept', d.id, colX[1], dy, d.name,
        `${T('Mgr', 'Yön')}: ${d.manager ? d.manager.fullName : '—'}`,
        `${d.memberCount} ${uPeople} · ${d.teams.length} ${uTeams}`, C_DEPT));
      d.teams.forEach((tm, j) => {
        const ty = rowY(start + j);
        edges.push(edge(colX[1] + NW, dy + NH / 2, colX[2], ty + NH / 2));
        nodes.push(nodeSvg('team', tm.id, colX[2], ty, tm.name,
          `Lead: ${tm.lead ? tm.lead.fullName : '—'}`, `${tm.members.length} ${uPeople}`, C_TEAM));
      });
    });

    return `
      <div class="net-topo-scroll" style="max-height:calc(100vh - 340px)">
        <svg class="net-topo-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
          <defs><marker id="org-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#cbd2dc"/></marker></defs>
          <g class="net-topo-edges">${edges.join('')}</g>
          <g class="net-topo-nodes">${nodes.join('')}</g>
        </svg>
      </div>`;
  }

  /* ------------------------------- Render ------------------------------- */
  function render(tree, approvals) {
    const teamCount = tree.departments.reduce((n, d) => n + d.teams.length, 0);
    const peopleCount = tree.departments.reduce((n, d) => n + d.memberCount, 0) + tree.unassigned.length;

    el.innerHTML = `
      ${pageHead(T('Organization', 'Organizasyon'), T('Departments, teams, reporting lines and helpdesk escalation.', 'Departmanlar, takımlar, raporlama hattı ve helpdesk eskalasyonu.'), `
        ${canManage ? `<button class="btn btn-outline" id="org-add-dept"><span class="ms">domain_add</span> ${esc(T('Add department', 'Departman ekle'))}</button>` : ''}
      `)}

      <div class="grid grid-4" style="margin-bottom:16px">
        <div class="card card-pad metric"><div class="metric-top"><h3 class="card-title">${esc(T('Departments', 'Departmanlar'))}</h3>${iconChip('corporate_fare', 'indigo')}</div>
          <div class="metric-value">${tree.departments.length}</div></div>
        <div class="card card-pad metric"><div class="metric-top"><h3 class="card-title">${esc(T('Teams', 'Takımlar'))}</h3>${iconChip('groups', 'blue')}</div>
          <div class="metric-value">${teamCount}</div></div>
        <div class="card card-pad metric"><div class="metric-top"><h3 class="card-title">${esc(T('People', 'Kişiler'))}</h3>${iconChip('group', 'emerald')}</div>
          <div class="metric-value">${peopleCount.toLocaleString()}</div></div>
        <div class="card card-pad metric"><div class="metric-top"><h3 class="card-title">${esc(T('Unassigned', 'Bağlanmamış'))}</h3>${iconChip('help', tree.unassigned.length ? 'amber' : 'slate')}</div>
          <div class="metric-value">${tree.unassigned.length}</div></div>
      </div>

      <div class="card" style="padding:12px">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:0 4px 10px">
          <span class="net-role-chip"><i style="background:${C_ROOT}"></i>${esc(T('Company', 'Şirket'))}</span>
          <span class="net-role-chip"><i style="background:${C_DEPT}"></i>${esc(T('Department', 'Departman'))}</span>
          <span class="net-role-chip"><i style="background:${C_TEAM}"></i>${esc(T('Team', 'Takım'))}</span>
          <span class="cell-sub" style="margin-left:auto">${esc(T('Click a node to manage it', 'Yönetmek için bir düğüme tıklayın'))}</span>
        </div>
        ${tree.departments.length ? topologySvg(tree) : `<div class="table-empty" style="padding:24px">${esc(T('No departments yet. Add one to start building the chart.', 'Henüz departman yok. Şemayı kurmak için bir departman ekleyin.'))}</div>`}
      </div>`;

    wire(tree);
  }

  /* ------------------------------- Wiring ------------------------------- */
  function wire(tree) {
    const deptById = new Map(tree.departments.map((d) => [d.id, d]));
    const teamById = new Map();
    tree.departments.forEach((d) => d.teams.forEach((tm) => teamById.set(tm.id, { tm, dept: d })));

    const addDept = $('#org-add-dept', el);
    if (addDept) addDept.addEventListener('click', () => formModal({
      title: T('Add department', 'Departman ekle'),
      fields: [{ name: 'name', label: T('Department name', 'Departman adı'), required: true, full: true, maxlength: 60 }],
      submitLabel: T('Add', 'Ekle'),
      async onSubmit(d) {
        await api('/catalog/departments', { method: 'POST', body: { name: d.name } });
        AppConfig.departments = await api('/catalog/departments');
        toast(T('Department added', 'Departman eklendi'), 'success'); await load();
      },
    }));

    el.querySelectorAll('.net-topo-node').forEach((g) => {
      const open = () => {
        const kind = g.dataset.kind;
        if (kind === 'dept') { const d = deptById.get(g.dataset.id); if (d) openDeptModal(d); }
        else if (kind === 'team') { const e = teamById.get(g.dataset.id); if (e) openTeamModal(e.dept, e.tm); }
        else if (kind === 'root' && canManage && addDept) addDept.click();
      };
      g.style.cursor = 'pointer';
      g.addEventListener('click', open);
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
    });
  }

  /* -------------------------------- Load -------------------------------- */
  async function load() {
    const tree = await api('/org/tree');
    if (isStaleView(el)) return;
    render(tree, null);
  }

  try {
    await load();
  } catch (err) {
    if (isStaleView(el)) return;
    el.innerHTML = `<div class="card card-pad"><div class="form-error">${esc(err.message)}</div></div>`;
  }
};
