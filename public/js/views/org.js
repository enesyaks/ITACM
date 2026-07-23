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

  // Top-down chart: GAPX separates sibling columns, GAPYV separates levels.
  const NW = 216, NH = 66, GAPX = 40, GAPYV = 74, PAD = 30;
  const C_ROOT = '#7f77dd', C_DEPT = '#175cd3', C_TEAM = '#0f6e56', C_PERSON = '#b54708';
  // 'struct' = company → departments → teams, 'people' = who reports to whom.
  const view = { mode: 'people', collapsed: new Set() };
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

  /* ---------- SVG topology builder (top-down, draggable) ---------- */
  const ORG_LAYOUT_KEY = 'itacm:org-topo-layout';
  const ORG_DRAG_THRESHOLD = 5;

  function loadOrgLayout() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ORG_LAYOUT_KEY) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  }
  function saveOrgLayout(map) {
    try { localStorage.setItem(ORG_LAYOUT_KEY, JSON.stringify(map)); } catch { /* private mode */ }
  }
  function clearOrgLayout() {
    try { localStorage.removeItem(ORG_LAYOUT_KEY); } catch { /* ignore */ }
  }
  const hasOrgLayout = () => Object.keys(loadOrgLayout()).length > 0;

  function nodeSvg(kind, id, key, x, y, title, sub, meta, accent) {
    return `
      <g class="net-topo-node" data-kind="${kind}" data-id="${esc(id)}" data-node="${esc(key)}"
         transform="translate(${x},${y})" role="button" tabindex="0">
        <rect class="net-topo-node-bg" width="${NW}" height="${NH}" rx="10" ry="10" fill="#fff"/>
        <rect class="net-topo-node-accent" width="6" height="${NH}" rx="3" fill="${accent}"/>
        <rect class="net-topo-node-stroke" width="${NW}" height="${NH}" rx="10" ry="10" fill="none" stroke="#e4e7ec" stroke-width="1.5"/>
        <text class="net-topo-title" x="18" y="25">${esc(trunc(title, 26))}</text>
        <text class="net-topo-sub" x="18" y="43">${esc(trunc(sub, 32))}</text>
        <text class="net-topo-meta" x="18" y="58">${esc(meta)}</text>
      </g>`;
  }

  /** Classic org-chart elbow: straight down out of the parent, across, then down
   *  into the child — stopping just short of the card so the arrow head lands on
   *  the border instead of overlapping the accent bar. */
  function orgEdgePath(a, b) {
    const x1 = a.x + NW / 2;
    const y1 = a.y + NH;
    const x2 = b.x + NW / 2;
    const y2 = b.y - 5;
    const midY = y1 + Math.max(18, (y2 - y1) / 2);
    return `M${x1} ${y1} V ${midY} H ${x2} V ${y2}`;
  }
  const edgeSvg = (from, to, a, b) =>
    `<path class="net-topo-edge" data-from="${esc(from)}" data-to="${esc(to)}" d="${orgEdgePath(a, b)}"
       fill="none" stroke="#cbd2dc" stroke-width="1.5" marker-end="url(#org-arrow)"/>`;

  function topologySvg(tree) {
    // Column packing: a department owns as many columns as it has teams, so teams
    // never collide and the parent sits centred above its own block.
    let cursor = 0;
    const layout = tree.departments.map((d) => {
      const span = Math.max(1, d.teams.length);
      const start = cursor; cursor += span;
      return { d, start, span };
    });
    const cols = Math.max(1, cursor);
    const COLW = NW + GAPX;
    const contentW = cols * COLW - GAPX;
    const levelY = (lv) => PAD + lv * (NH + GAPYV);
    const saved = loadOrgLayout();
    const at = (key, x, y) => {
      const p = saved[key];
      return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
        ? { x: p[0], y: p[1] } : { x, y };
    };

    const peopleCount = tree.departments.reduce((n, d) => n + d.memberCount, 0) + tree.unassigned.length;
    const uPeople = T('people', 'kişi'), uTeams = T('teams', 'takım');

    const placed = [];
    const edges = [];
    const nodes = [];

    const root = at('root', PAD + contentW / 2 - NW / 2, levelY(0));
    placed.push(root);
    nodes.push(nodeSvg('root', '', 'root', root.x, root.y,
      AppConfig.companyName || T('Organization', 'Organizasyon'),
      `${tree.departments.length} ${T('departments', 'departman')}`,
      `${peopleCount.toLocaleString()} ${uPeople}`, C_ROOT));

    layout.forEach(({ d, start, span }) => {
      const dKey = `dept:${d.id}`;
      const dCentre = PAD + start * COLW + (span * COLW - GAPX) / 2;
      const dp = at(dKey, dCentre - NW / 2, levelY(1));
      placed.push(dp);
      edges.push(edgeSvg('root', dKey, root, dp));
      nodes.push(nodeSvg('dept', d.id, dKey, dp.x, dp.y, d.name,
        `${T('Mgr', 'Yön')}: ${d.manager ? d.manager.fullName : '—'}`,
        `${d.memberCount} ${uPeople} · ${d.teams.length} ${uTeams}`, C_DEPT));

      d.teams.forEach((tm, j) => {
        const tKey = `team:${tm.id}`;
        const tp = at(tKey, PAD + (start + j) * COLW, levelY(2));
        placed.push(tp);
        edges.push(edgeSvg(dKey, tKey, dp, tp));
        nodes.push(nodeSvg('team', tm.id, tKey, tp.x, tp.y, tm.name,
          `Lead: ${tm.lead ? tm.lead.fullName : '—'}`, `${tm.members.length} ${uPeople}`, C_TEAM));
      });
    });

    // The canvas must cover dragged nodes too, not just the generated grid.
    let width = PAD * 2 + contentW;
    let height = PAD * 2 + 3 * NH + 2 * GAPYV;
    placed.forEach((p) => {
      width = Math.max(width, p.x + NW + PAD);
      height = Math.max(height, p.y + NH + PAD);
    });

    return `
      <div class="net-topo-scroll" style="max-height:calc(100vh - 340px)">
        <svg class="net-topo-svg org-topo" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
          <defs><marker id="org-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#cbd2dc"/></marker></defs>
          <g class="net-topo-edges">${edges.join('')}</g>
          <g class="net-topo-nodes">${nodes.join('')}</g>
        </svg>
      </div>`;
  }

  /* ---------- reporting-line chart (people) ---------- */
  /** Everyone below level 1 starts folded — 97 cards at once is unreadable. */
  function defaultCollapsed(roots) {
    const set = new Set();
    const walk = (n, level) => {
      if (level >= 1 && n.children.length) set.add(n.id);
      n.children.forEach((c) => walk(c, level + 1));
    };
    roots.forEach((r) => walk(r, 0));
    return set;
  }

  function personNodeSvg(p, x, y, folded) {
    const key = `person:${p.id}`;
    const badgeText = p.isDeptManager ? T('Dept manager', 'Dept. yöneticisi')
      : p.isTeamLead ? T('Team lead', 'Takım lideri') : '';
    const kids = p.children.length;
    return `
      <g class="net-topo-node org-person" data-kind="person" data-id="${esc(p.id)}" data-node="${esc(key)}"
         transform="translate(${x},${y})" role="button" tabindex="0">
        <rect class="net-topo-node-bg" width="${NW}" height="${NH}" rx="10" ry="10" fill="#fff"/>
        <rect class="net-topo-node-accent" width="6" height="${NH}" rx="3" fill="${p.isDeptManager ? C_DEPT : p.isTeamLead ? C_TEAM : C_PERSON}"/>
        <rect class="net-topo-node-stroke" width="${NW}" height="${NH}" rx="10" ry="10" fill="none" stroke="#e4e7ec" stroke-width="1.5"/>
        <text class="net-topo-title" x="18" y="24">${esc(trunc(p.fullName, 24))}</text>
        <text class="net-topo-sub" x="18" y="41">${esc(trunc(p.title || T('No title', 'Ünvan yok'), 30))}</text>
        <text class="net-topo-meta" x="18" y="57">${esc(trunc([p.department, badgeText].filter(Boolean).join(' · '), kids ? 22 : 34))}</text>
        ${kids ? `
        <g class="org-toggle" data-toggle="${esc(p.id)}" role="button" tabindex="0">
          <rect x="${NW - 44}" y="${NH - 24}" width="38" height="18" rx="9" fill="${folded ? '#eef2ff' : '#f2f4f7'}"/>
          <text class="org-toggle-text" x="${NW - 25}" y="${NH - 11}" text-anchor="middle">${folded ? `+${kids}` : '−'}</text>
        </g>` : ''}
      </g>`;
  }

  function peopleTopologySvg(roots) {
    const COLW = NW + GAPX;
    const levelY = (lv) => PAD + lv * (NH + GAPYV);
    const saved = loadOrgLayout();
    const at = (key, x, y) => {
      const p = saved[key];
      return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
        ? { x: p[0], y: p[1] } : { x, y };
    };

    const nodes = [];
    const edges = [];
    const placed = [];
    const nodePos = new Map();
    let col = 0;

    // Tidy layout: leaves take the next column, parents centre over their block.
    const place = (p, level) => {
      const folded = view.collapsed.has(p.id);
      const kids = folded ? [] : p.children;
      let gx;
      if (!kids.length) {
        gx = PAD + col * COLW;
        col += 1;
      } else {
        const xs = kids.map((c) => place(c, level + 1));
        gx = (xs[0] + xs[xs.length - 1]) / 2;
      }
      const pos = at(`person:${p.id}`, gx, levelY(level));
      placed.push(pos);
      nodes.push({ svg: personNodeSvg(p, pos.x, pos.y, folded), level });
      kids.forEach((c) => edges.push({ from: `person:${p.id}`, to: `person:${c.id}` }));
      nodePos.set(`person:${p.id}`, pos);
      return gx;
    };
    roots.forEach((r) => place(r, 0));

    const edgeHtml = edges.map((e) => {
      const a = nodePos.get(e.from);
      const b = nodePos.get(e.to);
      return a && b ? edgeSvg(e.from, e.to, a, b) : '';
    }).join('');

    let width = PAD * 2 + Math.max(1, col) * COLW - GAPX;
    let height = PAD * 2 + NH;
    placed.forEach((p) => {
      width = Math.max(width, p.x + NW + PAD);
      height = Math.max(height, p.y + NH + PAD);
    });

    return `
      <div class="net-topo-scroll" style="max-height:calc(100vh - 340px)">
        <svg class="net-topo-svg org-topo" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
          <defs><marker id="org-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#cbd2dc"/></marker></defs>
          <g class="net-topo-edges">${edgeHtml}</g>
          <g class="net-topo-nodes">${nodes.map((n) => n.svg).join('')}</g>
        </svg>
      </div>`;
  }

  /* ---------- dragging ---------- */
  function svgPoint(svg, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
  }

  function refreshEdges(svg) {
    const boxes = new Map();
    svg.querySelectorAll('.net-topo-node').forEach((g) => {
      const m = /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(g.getAttribute('transform') || '');
      if (m) boxes.set(g.dataset.node, { x: Number(m[1]), y: Number(m[2]) });
    });
    svg.querySelectorAll('.net-topo-edge').forEach((p) => {
      const a = boxes.get(p.dataset.from);
      const b = boxes.get(p.dataset.to);
      if (a && b) p.setAttribute('d', orgEdgePath(a, b));
    });
  }

  function growCanvas(svg, x, y) {
    const w = Math.max(Number(svg.getAttribute('width')) || 0, x + NW + PAD);
    const h = Math.max(Number(svg.getAttribute('height')) || 0, y + NH + PAD);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  function bindOrgDrag(svg, onMoved) {
    let drag = null;

    const onMove = (e) => {
      if (!drag) return;
      const pt = svgPoint(svg, e.clientX, e.clientY);
      const dx = pt.x - drag.startX;
      const dy = pt.y - drag.startY;
      if (!drag.moved && (dx * dx + dy * dy) < ORG_DRAG_THRESHOLD * ORG_DRAG_THRESHOLD) return;
      drag.moved = true;
      drag.g.classList.add('is-dragging');
      // Keep nodes on the canvas — negative coordinates would clip them away.
      drag.x = Math.max(0, drag.originX + dx);
      drag.y = Math.max(0, drag.originY + dy);
      drag.g.setAttribute('transform', `translate(${drag.x},${drag.y})`);
      refreshEdges(svg);
      growCanvas(svg, drag.x, drag.y);
    };

    const onUp = () => {
      if (!drag) return;
      const { g, key, moved, x, y, pointerId } = drag;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try { g.releasePointerCapture(pointerId); } catch { /* already released */ }
      g.classList.remove('is-dragging');
      drag = null;
      if (!moved) return;
      // Swallow the click that follows a drag so the node's modal stays shut.
      g.dataset.justDragged = '1';
      const map = loadOrgLayout();
      map[key] = [Math.round(x), Math.round(y)];
      saveOrgLayout(map);
      if (onMoved) onMoved();
    };

    svg.querySelectorAll('.net-topo-node').forEach((g) => {
      g.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        const m = /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(g.getAttribute('transform') || '');
        if (!m) return;
        const pt = svgPoint(svg, e.clientX, e.clientY);
        drag = {
          g, key: g.dataset.node,
          originX: Number(m[1]), originY: Number(m[2]),
          x: Number(m[1]), y: Number(m[2]),
          startX: pt.x, startY: pt.y,
          moved: false, pointerId: e.pointerId,
        };
        try { g.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        e.preventDefault();
      });
    });
  }

  /* ------------------------------- Render ------------------------------- */
  function render(tree, approvals) {
    const reporting = Array.isArray(tree.reporting) ? tree.reporting : [];
    if (view.mode === 'people' && !view.collapsed.size && reporting.length) {
      view.collapsed = defaultCollapsed(reporting);
    }
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
          ${view.mode === 'people' ? `
            <span class="net-role-chip"><i style="background:${C_DEPT}"></i>${esc(T('Dept manager', 'Dept. yöneticisi'))}</span>
            <span class="net-role-chip"><i style="background:${C_TEAM}"></i>${esc(T('Team lead', 'Takım lideri'))}</span>
            <span class="net-role-chip"><i style="background:${C_PERSON}"></i>${esc(T('Employee', 'Çalışan'))}</span>
          ` : `
            <span class="net-role-chip"><i style="background:${C_ROOT}"></i>${esc(T('Company', 'Şirket'))}</span>
            <span class="net-role-chip"><i style="background:${C_DEPT}"></i>${esc(T('Department', 'Departman'))}</span>
            <span class="net-role-chip"><i style="background:${C_TEAM}"></i>${esc(T('Team', 'Takım'))}</span>
          `}
          <span class="org-mode-switch">
            <button type="button" class="btn btn-sm ${view.mode === 'people' ? 'btn-primary' : 'btn-outline'}" data-org-mode="people">
              <span class="ms">account_tree</span> ${esc(T('Reporting line', 'Raporlama hattı'))}</button>
            <button type="button" class="btn btn-sm ${view.mode === 'struct' ? 'btn-primary' : 'btn-outline'}" data-org-mode="struct">
              <span class="ms">corporate_fare</span> ${esc(T('Departments & teams', 'Departman & takım'))}</button>
          </span>
          <span class="cell-sub" style="margin-left:auto">${esc(view.mode === 'people'
            ? T('Click a card to fold / unfold reports · drag to rearrange', 'Ekibi açıp kapatmak için karta tıklayın · taşımak için sürükleyin')
            : T('Click a node to manage it · drag to rearrange', 'Yönetmek için tıklayın · taşımak için sürükleyin'))}</span>
          <button type="button" class="btn btn-outline btn-sm net-topo-reset" id="org-topo-reset" ${hasOrgLayout() ? '' : 'disabled'}>
            <span class="ms">restart_alt</span> ${esc(T('Reset layout', 'Düzeni sıfırla'))}</button>
        </div>
        ${view.mode === 'people'
          ? (reporting.length
            ? peopleTopologySvg(reporting)
            : `<div class="table-empty" style="padding:24px">${esc(T('No reporting lines yet — set a manager on employee records to build this chart.', 'Henüz raporlama hattı yok — çalışan kayıtlarında yönetici atayarak bu şemayı oluşturun.'))}</div>`)
          : (tree.departments.length
            ? topologySvg(tree)
            : `<div class="table-empty" style="padding:24px">${esc(T('No departments yet. Add one to start building the chart.', 'Henüz departman yok. Şemayı kurmak için bir departman ekleyin.'))}</div>`)}
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

    const resetBtn = $('#org-topo-reset', el);
    if (resetBtn) resetBtn.addEventListener('click', () => { clearOrgLayout(); render(tree, null); });

    el.querySelectorAll('[data-org-mode]').forEach((b) => b.addEventListener('click', () => {
      if (view.mode === b.dataset.orgMode) return;
      view.mode = b.dataset.orgMode;
      render(tree, null);
    }));

    // People mode: the card itself folds / unfolds the branch, so a 97-person
    // org stays readable; the employee record opens on double click.
    const peopleById = new Map();
    (function indexPeople(list) {
      (list || []).forEach((p) => { peopleById.set(p.id, p); indexPeople(p.children); });
    })(tree.reporting);

    el.querySelectorAll('.org-person').forEach((g) => {
      const id = g.dataset.id;
      const toggle = () => {
        const p = peopleById.get(id);
        if (!p || !p.children.length) return;
        if (view.collapsed.has(id)) view.collapsed.delete(id);
        else view.collapsed.add(id);
        render(tree, null);
      };
      g.addEventListener('click', () => {
        if (g.dataset.justDragged) { delete g.dataset.justDragged; return; }
        toggle();
      });
      g.addEventListener('dblclick', async () => {
        try {
          const full = await api(`/employees/${encodeURIComponent(id)}`);
          if (typeof showEmployeeDetail === 'function') showEmployeeDetail(full);
        } catch { /* no access to the record */ }
      });
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
      });
    });

    const svg = el.querySelector('.org-topo');
    if (svg) {
      bindOrgDrag(svg, () => { if (resetBtn) resetBtn.disabled = false; });
      // A wide chart starts scrolled far left of its top node — centre on it.
      const scroller = svg.closest('.net-topo-scroll');
      let top = null;
      svg.querySelectorAll('.net-topo-node').forEach((g) => {
        const m = /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(g.getAttribute('transform') || '');
        if (!m) return;
        const p = { x: Number(m[1]), y: Number(m[2]) };
        if (!top || p.y < top.y) top = p;
      });
      if (scroller && top) {
        scroller.scrollLeft = Math.max(0, top.x + NW / 2 - scroller.clientWidth / 2);
      }
    }

    el.querySelectorAll('.net-topo-node').forEach((g) => {
      const open = () => {
        const kind = g.dataset.kind;
        if (kind === 'dept') { const d = deptById.get(g.dataset.id); if (d) openDeptModal(d); }
        else if (kind === 'team') { const e = teamById.get(g.dataset.id); if (e) openTeamModal(e.dept, e.tm); }
        else if (kind === 'root' && canManage && addDept) addDept.click();
      };
      g.addEventListener('click', () => {
        if (g.dataset.justDragged) { delete g.dataset.justDragged; return; }
        open();
      });
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
