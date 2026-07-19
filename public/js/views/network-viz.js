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
    let start = x.rackUStart != null ? Number(x.rackUStart) : null;
    let size = x.rackUSize != null ? Number(x.rackUSize) : null;
    if (start == null && x.rackUnit) {
      const range = String(x.rackUnit).match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*$/);
      if (range) {
        const a = Number(range[1]);
        const b = Number(range[2]);
        start = Math.min(a, b);
        size = Math.abs(b - a) + 1;
      } else {
        const n = parseInt(String(x.rackUnit), 10);
        if (Number.isFinite(n)) { start = n; size = 1; }
      }
    }
    if (start != null && (!size || size < 1)) size = 1;
    return { start, size: size || 1 };
  }

  function shortestLicenses(list) {
    const arr = list && list.length ? list : (list ? [list] : []);
    return arr;
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

  function parentRef(d) {
    return d.parentAssetId || (d.parentAsset && d.parentAsset.id) || null;
  }

  /* ---------- Topology (parent → child graph), per location ---------- */

  function buildTopoLayout(devices, { allById } = {}) {
    const byId = new Map(devices.map((d) => [d.id, d]));
    const children = new Map();
    devices.forEach((d) => children.set(d.id, []));
    const roots = [];
    const remoteParents = new Map(); // childId → parent asset (other site)

    devices.forEach((d) => {
      const pid = parentRef(d);
      if (pid && byId.has(pid) && pid !== d.id) {
        children.get(pid).push(d.id);
      } else {
        roots.push(d.id);
        if (pid && allById && allById.has(pid) && !byId.has(pid)) {
          remoteParents.set(d.id, allById.get(pid));
        }
      }
    });

    const depth = new Map();
    const queue = roots.map((id) => ({ id, d: 0 }));
    const seen = new Set();
    while (queue.length) {
      const { id, d } = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      depth.set(id, d);
      (children.get(id) || []).forEach((cid) => queue.push({ id: cid, d: d + 1 }));
    }
    devices.forEach((d) => {
      if (!depth.has(d.id)) depth.set(d.id, 0);
    });

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
      const pid = parentRef(d);
      if (pid && positions.has(pid) && positions.has(d.id)) {
        edges.push({ from: pid, to: d.id });
      }
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

  function renderTopoSvg(devices, { allById, markerId } = {}) {
    const layout = buildTopoLayout(devices, { allById });
    const { positions, edges, byId, width, height, remoteParents } = layout;
    const mid = markerId || 'net-arrow';

    const edgeSvg = edges.map((e) => {
      const a = positions.get(e.from);
      const b = positions.get(e.to);
      return `<path class="net-topo-edge" d="${edgePath(a, b)}" marker-end="url(#${mid})"/>`;
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

    return `<svg class="net-topo-svg" viewBox="0 0 ${width} ${Math.max(height, 160)}"
      width="${width}" height="${Math.max(height, 160)}" role="img">
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

  function renderTopology(container, devices, { onSelect } = {}) {
    if (!devices.length) {
      container.innerHTML = `<div class="net-viz-empty"><span class="ms">hub</span>
        <p>${esc(t('network.topoEmpty'))}</p></div>`;
      return;
    }

    const allById = new Map(devices.map((d) => [d.id, d]));
    const linked = devices.filter((d) => parentRef(d)).length;
    const groups = groupByLocation(devices);

    container.innerHTML = `
      <div class="net-viz-toolbar">
        <span class="cell-sub">${esc(t('network.topoHint'))}</span>
        <span class="pill pill-indigo">${groups.length} ${esc(t('network.topoSites'))} · ${linked} ${esc(t('network.topoLinks'))}</span>
      </div>
      <div class="net-topo-sites">
        ${groups.map(([loc, list], i) => {
          const siteLinks = list.filter((d) => {
            const pid = parentRef(d);
            return pid && list.some((x) => x.id === pid);
          }).length;
          const cross = list.filter((d) => {
            const pid = parentRef(d);
            return pid && allById.has(pid) && !list.some((x) => x.id === pid);
          }).length;
          return `<section class="net-site-card">
            <div class="net-site-head">
              <div>
                <div class="net-site-title"><span class="ms">location_on</span> ${esc(loc)}</div>
                <div class="cell-sub">${list.length} ${esc(t('network.topoDevices'))}
                  · ${siteLinks} ${esc(t('network.topoLocalLinks'))}
                  ${cross ? ` · ${cross} ${esc(t('network.topoCrossLinks'))}` : ''}</div>
              </div>
            </div>
            <div class="net-topo-scroll">
              ${renderTopoSvg(list, { allById, markerId: 'net-arrow-' + i })}
            </div>
          </section>`;
        }).join('')}
      </div>
      <div class="net-role-legend">
        ${Object.entries(ROLE_COLORS).map(([role, c]) =>
          `<span class="net-role-chip"><i style="background:${c}"></i>${esc(role)}</span>`).join('')}
      </div>`;

    container.querySelectorAll('.net-topo-node').forEach((g) => {
      const go = () => onSelect && onSelect(g.dataset.id);
      g.addEventListener('click', go);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
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

  function renderRackCabinet(rack, { onSelect } = {}) {
    const DEFAULT_U = 42;
    let maxU = DEFAULT_U;
    rack.devices.forEach((d) => {
      maxU = Math.max(maxU, d._u.start + d._u.size - 1);
    });
    // Round up to common cabinet sizes
    if (maxU <= 24) maxU = 24;
    else if (maxU <= 42) maxU = 42;
    else if (maxU <= 48) maxU = 48;
    else maxU = Math.min(60, Math.ceil(maxU / 6) * 6);

    const overlaps = detectOverlaps(rack.devices);
    const used = rack.devices.reduce((n, d) => n + d._u.size, 0);
    const free = Math.max(0, maxU - used);
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
      const s = d.specs || {};
      const label = (s.hostname || d.assetTag || '').slice(0, 18);
      const model = `${d.brand} ${d.model}`.slice(0, 22);
      return `<g class="net-rack-device${clash ? ' clash' : ''}" data-id="${esc(d.id)}" role="button" tabindex="0">
        <rect x="${labelW + railW + 3}" y="${y + 1}" width="${bayW - 6}" height="${h}"
          rx="4" fill="${clash ? '#fef3f2' : color}" fill-opacity="${clash ? 1 : 0.92}"
          stroke="${clash ? '#f04438' : '#0f172a'}" stroke-opacity=".2" stroke-width="${clash ? 2 : 1}"/>
        <text x="${labelW + railW + 10}" y="${y + Math.min(14, h - 2)}" class="net-rack-dev-title"
          fill="${clash ? '#b42318' : '#fff'}">${esc(label)}</text>
        ${h >= 28 ? `<text x="${labelW + railW + 10}" y="${y + 28}" class="net-rack-dev-sub"
          fill="${clash ? '#b42318' : '#e0e7ff'}">${esc(model)} · U${start}${size > 1 ? '-' + (start + size - 1) : ''}</text>` : ''}
      </g>`;
    }).join('');

    return `
      <div class="net-rack-card">
        <div class="net-rack-head">
          <div>
            <div class="net-rack-name"><span class="ms">dns</span> ${esc(rack.rack)}</div>
            <div class="cell-sub">${esc(rack.location)} · ${maxU}U ·
              ${used}U ${esc(t('network.rackUsed'))} · ${free}U ${esc(t('network.rackFree'))}</div>
          </div>
          ${overlaps.size ? `<span class="pill pill-rose">${esc(t('network.rackOverlap'))}</span>` : ''}
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
        el.addEventListener('click', () => onSelect && onSelect(el.dataset.id));
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect && onSelect(el.dataset.id);
          }
        });
      });
    };
    bind('.net-rack-device');
    bind('.net-unracked-item');
  }

  return {
    roleColor,
    rackPlacement,
    shortestLicenses,
    renderTopology,
    renderRacks,
  };
})();

// Expose globally for classic script tags (const alone is not always enough across caches).
window.NetViz = NetViz;