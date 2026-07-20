/*
 * Network & Server visualisations — dependency topology + rack cabinet fronts.
 * Consumed by Views.network (List / Topology / Racks tabs).
 */
'use strict';

const NetViz = (() => {
  const ROLE_COLORS = {
    Switch: '#3525cd',
    Firewall: '#b42318',
    'Access Point': '#027a48',
    Router: '#175cd3',
    'Load Balancer': '#6941c6',
    Hypervisor: '#b54708',
    'Physical Server': '#344054',
    Storage: '#026aa2',
    Appliance: '#5925dc',
    Other: '#667085',
  };

  function roleColor(role) {
    return ROLE_COLORS[role] || ROLE_COLORS.Other;
  }

  function rackPlacement(x) {
    let start = x.rackUStart != null && x.rackUStart !== '' ? Number(x.rackUStart) : null;
    let size = x.rackUSize != null && x.rackUSize !== '' ? Number(x.rackUSize) : null;
    if (!Number.isFinite(start) || start < 1) start = null;
    if (!Number.isFinite(size) || size < 1) size = null;

    // Legacy free-text rackUnit only fills gaps — never overwrite an explicit size.
    if (start == null && x.rackUnit) {
      const range = String(x.rackUnit).match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*$/);
      if (range) {
        const a = Number(range[1]);
        const b = Number(range[2]);
        start = Math.min(a, b);
        if (size == null) size = Math.abs(b - a) + 1;
      } else {
        const n = parseInt(String(x.rackUnit), 10);
        if (Number.isFinite(n) && n >= 1) start = n;
      }
    }
    if (start != null && size == null) size = 1;
    return { start, size: size || 1 };
  }

  /** Round up to a common cabinet height (24 / 42 / 48 / … / 60). */
  function cabinetHeight(maxNeeded) {
    const n = Math.max(1, Number(maxNeeded) || 1);
    if (n <= 24) return 24;
    if (n <= 42) return 42;
    if (n <= 48) return 48;
    return Math.min(60, Math.ceil(n / 6) * 6);
  }

  function groupByLocation(devices) {
    const map = new Map();
    devices.forEach((d) => {
      const loc = (d.location || '').trim() || t('network.noLocation');
      if (!map.has(loc)) map.set(loc, []);
      map.get(loc).push(d);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  function parentRefs(d) {
    if (d.parentAssetIds && d.parentAssetIds.length) return d.parentAssetIds.filter(Boolean);
    if (d.parentAssets && d.parentAssets.length) return d.parentAssets.map((p) => p.id).filter(Boolean);
    const one = d.parentAssetId || (d.parentAsset && d.parentAsset.id) || null;
    return one ? [one] : [];
  }

  /* ---------- Topology (parent → child graph), per location ---------- */

  const TOPO_LAYOUT_KEY = 'itacm:net-topo-layout';
  const TOPO_DRAG_THRESHOLD = 6;

  function loadTopoLayouts() {
    try {
      const raw = localStorage.getItem(TOPO_LAYOUT_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveTopoLayouts(all) {
    try {
      localStorage.setItem(TOPO_LAYOUT_KEY, JSON.stringify(all || {}));
    } catch (_) { /* quota / private mode */ }
  }

  function siteLayoutKey(location) {
    return String(location || '').trim() || '__none__';
  }

  function getSiteLayout(location) {
    const all = loadTopoLayouts();
    const site = all[siteLayoutKey(location)];
    return site && typeof site === 'object' ? site : {};
  }

  function setNodeLayout(location, assetId, x, y) {
    const all = loadTopoLayouts();
    const key = siteLayoutKey(location);
    if (!all[key] || typeof all[key] !== 'object') all[key] = {};
    all[key][assetId] = { x: Math.round(x), y: Math.round(y) };
    saveTopoLayouts(all);
  }

  function clearSiteLayout(location) {
    const all = loadTopoLayouts();
    delete all[siteLayoutKey(location)];
    saveTopoLayouts(all);
  }

  function applySavedPositions(positions, saved, pad = 40) {
    if (saved && typeof saved === 'object') {
      positions.forEach((p, id) => {
        const s = saved[id];
        if (!s || typeof s !== 'object') return;
        if (Number.isFinite(s.x)) p.x = s.x;
        if (Number.isFinite(s.y)) p.y = s.y;
      });
    }
    let maxR = pad;
    let maxB = pad;
    positions.forEach((p) => {
      maxR = Math.max(maxR, p.x + p.w);
      maxB = Math.max(maxB, p.y + p.h);
    });
    return { width: maxR + pad, height: maxB + pad };
  }

  function clientToSvgPoint(svg, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  }

  function buildTopoLayout(devices, { allById } = {}) {
    const byId = new Map(devices.map((d) => [d.id, d]));
    const children = new Map();
    devices.forEach((d) => children.set(d.id, []));
    const roots = [];
    const remoteParents = new Map(); // childId → first remote parent asset

    devices.forEach((d) => {
      const pids = parentRefs(d).filter((pid) => pid !== d.id);
      const local = pids.filter((pid) => byId.has(pid));
      const remote = pids.filter((pid) => allById && allById.has(pid) && !byId.has(pid));
      if (local.length) {
        local.forEach((pid) => {
          const list = children.get(pid);
          if (list && !list.includes(d.id)) list.push(d.id);
        });
      } else {
        roots.push(d.id);
      }
      if (remote.length) remoteParents.set(d.id, allById.get(remote[0]));
    });

    // Longest-path depth so multi-parent children sit below all parents.
    const depth = new Map();
    devices.forEach((d) => depth.set(d.id, 0));
    let guard = devices.length + 2;
    let changed = true;
    while (changed && guard-- > 0) {
      changed = false;
      devices.forEach((d) => {
        const local = parentRefs(d).filter((pid) => byId.has(pid) && pid !== d.id);
        if (!local.length) return;
        const next = 1 + Math.max(...local.map((pid) => depth.get(pid) || 0));
        if (next > (depth.get(d.id) || 0)) {
          depth.set(d.id, next);
          changed = true;
        }
      });
    }

    const cols = new Map();
    depth.forEach((d, id) => {
      if (!cols.has(d)) cols.set(d, []);
      cols.get(d).push(id);
    });

    const colKeys = [...cols.keys()].sort((a, b) => a - b);
    const nodeW = 168;
    const nodeH = 64;
    const gapX = 88;
    const gapY = 28;
    const pad = 40;
    const positions = new Map();

    let maxRows = 1;
    colKeys.forEach((c) => {
      maxRows = Math.max(maxRows, cols.get(c).length);
    });

    colKeys.forEach((c, ci) => {
      const ids = cols.get(c).slice().sort((a, b) => {
        const A = byId.get(a); const B = byId.get(b);
        return String(A.assetTag).localeCompare(String(B.assetTag));
      });
      const colH = ids.length * (nodeH + gapY) - gapY;
      const startY = pad + Math.max(0, (maxRows * (nodeH + gapY) - gapY - colH) / 2);
      ids.forEach((id, ri) => {
        positions.set(id, {
          x: pad + ci * (nodeW + gapX),
          y: startY + ri * (nodeH + gapY),
          w: nodeW,
          h: nodeH,
        });
      });
    });

    const width = pad * 2 + Math.max(1, colKeys.length) * nodeW + Math.max(0, colKeys.length - 1) * gapX;
    const height = pad * 2 + maxRows * (nodeH + gapY) - gapY;

    const edges = [];
    devices.forEach((d) => {
      parentRefs(d).forEach((pid) => {
        if (pid && positions.has(pid) && positions.has(d.id)) {
          edges.push({ from: pid, to: d.id });
        }
      });
    });

    return { byId, positions, edges, width, height, remoteParents };
  }

  function edgePath(a, b) {
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }

  function renderTopoSvg(devices, { allById, markerId, location } = {}) {
    const layout = buildTopoLayout(devices, { allById });
    const { positions, edges, byId, remoteParents } = layout;
    const saved = getSiteLayout(location);
    const { width, height } = applySavedPositions(positions, saved, 40);
    const mid = markerId || 'net-arrow';
    const h = Math.max(height, 160);

    const edgeSvg = edges.map((e) => {
      const a = positions.get(e.from);
      const b = positions.get(e.to);
      return `<path class="net-topo-edge" data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="${edgePath(a, b)}" marker-end="url(#${mid})"/>`;
    }).join('');

    const clipDefs = [];
    const nodes = [...positions.entries()].map(([id, p], ni) => {
      const d = byId.get(id);
      const s = d.specs || {};
      const color = roleColor(d.infraRole);
      const remote = remoteParents.get(id);
      const sub = [d.infraRole, s.hostname || s.ipAddress].filter(Boolean).join(' · ');
      const remoteNote = remote
        ? `↑ ${remote.assetTag} @ ${(remote.location || '?')}`
        : '';
      const clipId = `ntc-${mid}-${ni}`;
      clipDefs.push(`<clipPath id="${clipId}"><rect width="${p.w}" height="${p.h}" rx="10" ry="10"/></clipPath>`);
      return `<g class="net-topo-node" data-id="${esc(id)}" transform="translate(${p.x},${p.y})" role="button" tabindex="0">
        <g clip-path="url(#${clipId})">
          <rect class="net-topo-node-bg" width="${p.w}" height="${p.h}" fill="#fff"/>
          <rect class="net-topo-node-accent" width="6" height="${p.h}" fill="${color}"/>
        </g>
        <rect class="net-topo-node-stroke" width="${p.w}" height="${p.h}" rx="10" ry="10"
          fill="none" stroke="${color}" stroke-width="2"/>
        <text x="16" y="22" class="net-topo-title">${esc(d.assetTag)}</text>
        <text x="16" y="38" class="net-topo-sub">${esc((d.brand + ' ' + d.model).slice(0, 22))}</text>
        <text x="16" y="52" class="net-topo-meta">${esc((remoteNote || sub).slice(0, 28) || d.category)}</text>
      </g>`;
    }).join('');

    return `<svg class="net-topo-svg" data-location="${esc(location || '')}" viewBox="0 0 ${width} ${h}"
      width="${width}" height="${h}" role="img">
      <defs>
        <marker id="${mid}" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#98a2b3"/>
        </marker>
        ${clipDefs.join('')}
      </defs>
      <g class="net-topo-edges">${edgeSvg}</g>
      <g class="net-topo-nodes">${nodes}</g>
    </svg>`;
  }

  function refreshTopoEdges(svg) {
    const nodes = new Map();
    svg.querySelectorAll('.net-topo-node').forEach((g) => {
      const m = /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(g.getAttribute('transform') || '');
      if (!m) return;
      const bg = g.querySelector('.net-topo-node-bg');
      const w = bg ? Number(bg.getAttribute('width')) || 168 : 168;
      const h = bg ? Number(bg.getAttribute('height')) || 64 : 64;
      nodes.set(g.dataset.id, { x: Number(m[1]), y: Number(m[2]), w, h });
    });
    svg.querySelectorAll('.net-topo-edge').forEach((path) => {
      const a = nodes.get(path.dataset.from);
      const b = nodes.get(path.dataset.to);
      if (a && b) path.setAttribute('d', edgePath(a, b));
    });
  }

  function expandTopoSvg(svg, x, y, w, h, pad = 40) {
    const needW = Math.max(Number(svg.getAttribute('width')) || 0, x + w + pad);
    const needH = Math.max(Number(svg.getAttribute('height')) || 0, y + h + pad, 160);
    svg.setAttribute('width', needW);
    svg.setAttribute('height', needH);
    svg.setAttribute('viewBox', `0 0 ${needW} ${needH}`);
  }

  function bindTopoDrag(svg, { onSelect } = {}) {
    const location = svg.dataset.location || '';
    let drag = null;

    const onMove = (e) => {
      if (!drag) return;
      const pt = clientToSvgPoint(svg, e.clientX, e.clientY);
      const dx = pt.x - drag.startPt.x;
      const dy = pt.y - drag.startPt.y;
      if (!drag.moved && (dx * dx + dy * dy) < TOPO_DRAG_THRESHOLD * TOPO_DRAG_THRESHOLD) return;
      drag.moved = true;
      drag.g.classList.add('is-dragging');
      const nx = drag.originX + dx;
      const ny = drag.originY + dy;
      drag.g.setAttribute('transform', `translate(${nx},${ny})`);
      refreshTopoEdges(svg);
      expandTopoSvg(svg, nx, ny, drag.w, drag.h);
    };

    const onUp = (e) => {
      if (!drag) return;
      const { g, id, moved, pointerId } = drag;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try { g.releasePointerCapture(pointerId); } catch (_) { /* already released */ }
      g.classList.remove('is-dragging');
      g.style.touchAction = '';
      drag = null;
      if (moved) {
        const m = /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(g.getAttribute('transform') || '');
        if (m) setNodeLayout(location, id, Number(m[1]), Number(m[2]));
        const btn = svg.closest('.net-site-card')?.querySelector('[data-reset-loc]');
        if (btn) btn.disabled = false;
      } else if (onSelect && id) {
        onSelect(id);
      }
      e.preventDefault();
    };

    svg.querySelectorAll('.net-topo-node').forEach((g) => {
      g.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        const id = g.dataset.id;
        if (!id) return;
        const m = /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(g.getAttribute('transform') || '');
        if (!m) return;
        const bg = g.querySelector('.net-topo-node-bg');
        const w = bg ? Number(bg.getAttribute('width')) || 168 : 168;
        const h = bg ? Number(bg.getAttribute('height')) || 64 : 64;
        const startPt = clientToSvgPoint(svg, e.clientX, e.clientY);
        drag = {
          g, id,
          originX: Number(m[1]),
          originY: Number(m[2]),
          startPt,
          w, h,
          moved: false,
          pointerId: e.pointerId,
        };
        g.style.touchAction = 'none';
        try { g.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        e.preventDefault();
      });

      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (onSelect) onSelect(g.dataset.id);
        }
      });
    });
  }

  function renderTopology(container, devices, { onSelect } = {}) {
    if (!devices.length) {
      container.innerHTML = `<div class="net-viz-empty"><span class="ms">hub</span>
        <p>${esc(t('network.topoEmpty'))}</p></div>`;
      return;
    }

    const allById = new Map(devices.map((d) => [d.id, d]));
    const linked = devices.filter((d) => parentRefs(d).length).length;
    const groups = groupByLocation(devices);

    container.innerHTML = `
      <div class="net-viz-toolbar">
        <span class="cell-sub">${esc(t('network.topoHint'))}</span>
        <span class="pill pill-indigo">${groups.length} ${esc(t('network.topoSites'))} · ${linked} ${esc(t('network.topoLinks'))}</span>
      </div>
      <div class="net-topo-sites">
        ${groups.map(([loc, list], i) => {
          const siteLinks = list.filter((d) => {
            return parentRefs(d).some((pid) => list.some((x) => x.id === pid));
          }).length;
          const cross = list.filter((d) => {
            return parentRefs(d).some((pid) => allById.has(pid) && !list.some((x) => x.id === pid));
          }).length;
          const hasCustom = Object.keys(getSiteLayout(loc)).length > 0;
          return `<section class="net-site-card">
            <div class="net-site-head">
              <div>
                <div class="net-site-title"><span class="ms">location_on</span> ${esc(loc)}</div>
                <div class="cell-sub">${list.length} ${esc(t('network.topoDevices'))}
                  · ${siteLinks} ${esc(t('network.topoLocalLinks'))}
                  ${cross ? ` · ${cross} ${esc(t('network.topoCrossLinks'))}` : ''}</div>
              </div>
              <button type="button" class="btn btn-outline btn-sm net-topo-reset" data-reset-loc="${esc(loc)}"
                ${hasCustom ? '' : 'disabled'}>${esc(t('network.topoReset'))}</button>
            </div>
            <div class="net-topo-scroll">
              ${renderTopoSvg(list, { allById, markerId: 'net-arrow-' + i, location: loc })}
            </div>
          </section>`;
        }).join('')}
      </div>
      <div class="net-role-legend">
        ${Object.entries(ROLE_COLORS).map(([role, c]) =>
          `<span class="net-role-chip"><i style="background:${c}"></i>${esc(role)}</span>`).join('')}
      </div>`;

    container.querySelectorAll('.net-topo-svg').forEach((svg) => {
      bindTopoDrag(svg, { onSelect });
    });

    container.querySelectorAll('[data-reset-loc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        clearSiteLayout(btn.dataset.resetLoc);
        renderTopology(container, devices, { onSelect });
      });
    });
  }

  /* ---------- Rack cabinets (grouped by location) ---------- */

  function groupRacks(devices) {
    const map = new Map();
    const unracked = [];
    devices.forEach((d) => {
      const rack = (d.rack || '').trim();
      const place = rackPlacement(d);
      if (!rack || place.start == null) {
        unracked.push(d);
        return;
      }
      const loc = (d.location || '').trim() || t('network.noLocation');
      const key = loc + '|||' + rack;
      if (!map.has(key)) map.set(key, { location: loc, rack, devices: [] });
      map.get(key).devices.push({ ...d, _u: place });
    });
    const racks = [...map.values()].sort((a, b) =>
      a.location.localeCompare(b.location) || a.rack.localeCompare(b.rack));
    return { racks, unracked };
  }

  function detectOverlaps(devices) {
    const hits = new Set();
    for (let i = 0; i < devices.length; i++) {
      for (let j = i + 1; j < devices.length; j++) {
        const A = devices[i]._u;
        const B = devices[j]._u;
        if (!A || A.start == null || !B || B.start == null) continue;
        const a1 = A.start; const a2 = A.start + A.size - 1;
        const b1 = B.start; const b2 = B.start + B.size - 1;
        if (a1 <= b2 && b1 <= a2) {
          hits.add(devices[i].id);
          hits.add(devices[j].id);
        }
      }
    }
    return hits;
  }

  /** Unique U slots occupied (overlaps count once — used/free stay honest). */
  function occupiedUnitSet(devices) {
    const set = new Set();
    devices.forEach((d) => {
      const p = d._u;
      if (!p || p.start == null) return;
      for (let u = p.start; u < p.start + p.size; u++) set.add(u);
    });
    return set;
  }

  /** Horizontal lane so overlapping devices stay visible instead of stacking. */
  function clashLanes(devices, overlaps) {
    const lanes = new Map();
    if (!overlaps.size) return lanes;
    const clashers = devices
      .filter((d) => overlaps.has(d.id))
      .sort((a, b) => a._u.start - b._u.start
        || String(a.assetTag || '').localeCompare(String(b.assetTag || '')));
    clashers.forEach((d) => {
      let lane = 0;
      const a1 = d._u.start;
      const a2 = d._u.start + d._u.size - 1;
      clashers.forEach((o) => {
        if (o.id === d.id || !lanes.has(o.id)) return;
        const b1 = o._u.start;
        const b2 = o._u.start + o._u.size - 1;
        if (a1 <= b2 && b1 <= a2) lane = Math.max(lane, lanes.get(o.id) + 1);
      });
      lanes.set(d.id, lane);
    });
    return lanes;
  }

  function renderRackCabinet(rack, { onSelect } = {}) {
    let needed = 42;
    rack.devices.forEach((d) => {
      needed = Math.max(needed, d._u.start + d._u.size - 1);
    });
    const maxU = cabinetHeight(needed);

    const overlaps = detectOverlaps(rack.devices);
    const occupied = occupiedUnitSet(rack.devices);
    const used = occupied.size;
    const free = Math.max(0, maxU - used);
    const lanes = clashLanes(rack.devices, overlaps);
    const clashLabels = rack.devices
      .filter((d) => overlaps.has(d.id))
      .map((d) => {
        const p = d._u;
        const range = p.size > 1 ? `U${p.start}–${p.start + p.size - 1}` : `U${p.start}`;
        return `${d.assetTag} (${range})`;
      })
      .join(', ');
    const uH = 18;
    const labelW = 28;
    const railW = 14;
    const bayW = 220;
    const padTop = 36;
    const padBot = 28;
    const height = padTop + maxU * uH + padBot;
    const width = labelW + railW + bayW + railW + 8;

    const units = [];
    for (let u = maxU; u >= 1; u--) {
      const y = padTop + (maxU - u) * uH;
      units.push(`<rect class="net-rack-slot" x="${labelW + railW}" y="${y}" width="${bayW}" height="${uH}"
        fill="${u % 2 ? '#f8fafc' : '#f1f5f9'}"/>
        <text class="net-rack-u" x="${labelW / 2}" y="${y + uH / 2 + 3}" text-anchor="middle">${u}</text>`);
    }

    const devicesHtml = rack.devices.map((d) => {
      const { start, size } = d._u;
      const topU = start + size - 1;
      const y = padTop + (maxU - topU) * uH;
      const h = size * uH - 2;
      const color = roleColor(d.infraRole);
      const clash = overlaps.has(d.id);
      const lane = lanes.get(d.id) || 0;
      const xOff = clash ? Math.min(lane, 3) * 10 : 0;
      const wShrink = clash ? Math.min(lane, 3) * 10 + 4 : 0;
      const s = d.specs || {};
      const label = (s.hostname || d.assetTag || '').slice(0, 18);
      const model = `${d.brand} ${d.model}`.slice(0, 22);
      const uTxt = `U${start}${size > 1 ? '-' + (start + size - 1) : ''}`;
      const x0 = labelW + railW + 3 + xOff;
      const w0 = Math.max(40, bayW - 6 - wShrink);
      return `<g class="net-rack-device${clash ? ' clash' : ''}" data-id="${esc(d.id)}" role="button" tabindex="0">
        <rect x="${x0}" y="${y + 1}" width="${w0}" height="${h}"
          rx="4" fill="${clash ? '#fef3f2' : color}" fill-opacity="${clash ? 1 : 0.92}"
          stroke="${clash ? '#f04438' : '#0f172a'}" stroke-opacity=".2" stroke-width="${clash ? 2 : 1}"/>
        <text x="${x0 + 7}" y="${y + Math.min(14, h - 2)}" class="net-rack-dev-title"
          fill="${clash ? '#b42318' : '#fff'}">${esc(label)}</text>
        ${h >= 28
          ? `<text x="${x0 + 7}" y="${y + 28}" class="net-rack-dev-sub"
              fill="${clash ? '#b42318' : '#e0e7ff'}">${esc(model)} · ${esc(uTxt)}</text>`
          : (clash
            ? `<title>${esc(label)} · ${esc(uTxt)}</title>`
            : '')}
      </g>`;
    }).join('');

    const overlapPill = overlaps.size
      ? `<span class="pill pill-rose" title="${esc(clashLabels)}">${esc(t('network.rackOverlap'))} · ${overlaps.size}</span>`
      : '';

    return `
      <div class="net-rack-card">
        <div class="net-rack-head">
          <div>
            <div class="net-rack-name"><span class="ms">dns</span> ${esc(rack.rack)}</div>
            <div class="cell-sub">${esc(rack.location)} · ${maxU}U ·
              ${used}U ${esc(t('network.rackUsed'))} · ${free}U ${esc(t('network.rackFree'))}</div>
          </div>
          ${overlapPill}
        </div>
        <div class="net-rack-body">
          <svg class="net-rack-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
            role="img" aria-label="${esc(rack.rack)}">
            <rect x="0" y="8" width="${width - 4}" height="${height - 16}" rx="10"
              fill="#1e293b" stroke="#0f172a" stroke-width="2"/>
            <rect x="${labelW}" y="${padTop - 6}" width="${railW}" height="${maxU * uH + 12}" fill="#334155"/>
            <rect x="${labelW + railW + bayW}" y="${padTop - 6}" width="${railW}" height="${maxU * uH + 12}" fill="#334155"/>
            ${units.join('')}
            ${devicesHtml}
            <text x="${width / 2}" y="${height - 10}" text-anchor="middle" class="net-rack-foot">FRONT</text>
          </svg>
        </div>
      </div>`;
  }

  function renderRacks(container, devices, { onSelect } = {}) {
    const { racks, unracked } = groupRacks(devices);
    if (!racks.length) {
      container.innerHTML = `<div class="net-viz-empty"><span class="ms">view_column</span>
        <p>${esc(t('network.rackEmpty'))}</p>
        <p class="cell-sub">${esc(t('network.rackEmptyHint'))}</p></div>`;
      return;
    }

    const byLoc = new Map();
    racks.forEach((r) => {
      if (!byLoc.has(r.location)) byLoc.set(r.location, []);
      byLoc.get(r.location).push(r);
    });
    const locEntries = [...byLoc.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    container.innerHTML = `
      <div class="net-viz-toolbar">
        <span class="cell-sub">${esc(t('network.rackHint'))}</span>
        <span class="pill pill-indigo">${locEntries.length} ${esc(t('network.topoSites'))} · ${racks.length} ${esc(t('network.rackCabinets'))}</span>
      </div>
      ${locEntries.map(([loc, list]) => `
        <section class="net-site-card">
          <div class="net-site-head">
            <div class="net-site-title"><span class="ms">location_on</span> ${esc(loc)}</div>
            <div class="cell-sub">${list.length} ${esc(t('network.rackCabinets'))}</div>
          </div>
          <div class="net-rack-grid">
            ${list.map((r) => renderRackCabinet(r)).join('')}
          </div>
        </section>`).join('')}
      ${unracked.length ? `
        <div class="net-unracked">
          <h3 class="card-title">${esc(t('network.unracked'))} (${unracked.length})</h3>
          <div class="net-unracked-list">
            ${unracked.map((d) => `
              <button type="button" class="net-unracked-item" data-id="${esc(d.id)}">
                <strong class="mono">${esc(d.assetTag)}</strong>
                <span>${esc(d.brand)} ${esc(d.model)}</span>
                <span class="cell-sub">${esc(d.infraRole || d.category)}${d.location ? ' · ' + esc(d.location) : ''}</span>
              </button>`).join('')}
          </div>
        </div>` : ''}`;

    const bind = (sel) => {
      container.querySelectorAll(sel).forEach((el) => {
        const open = (e) => {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          const id = el.getAttribute('data-id');
          if (id && onSelect) onSelect(id);
        };
        el.addEventListener('click', open);
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') open(e);
        });
      });
    };
    bind('.net-rack-device');
    bind('.net-unracked-item');
  }

  return {
    roleColor,
    rackPlacement,
    cabinetHeight,
    detectOverlaps,
    occupiedUnitSet,
    renderTopology,
    renderRacks,
  };
})();

// Expose globally for classic script tags (const alone is not always enough across caches).
window.NetViz = NetViz;