Views.users = async function (el) {
  const [items, groups] = await Promise.all([
    api('/auth/users'),
    api('/auth/permission-groups').catch(() => []),
  ]);
  const groupList = Array.isArray(groups) ? groups : [];
  const systemOrder = { Owner: 0, Admin: 1, Helpdesk: 2, Viewer: 3 };
  const sortedGroups = [...groupList].sort((a, b) => {
    const as = a.is_system ? 0 : 1;
    const bs = b.is_system ? 0 : 1;
    if (as !== bs) return as - bs;
    if (a.is_system && b.is_system) {
      return (systemOrder[a.name] ?? 50) - (systemOrder[b.name] ?? 50)
        || String(a.name).localeCompare(String(b.name));
    }
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  // Only an Owner may assign Owner or Admin; Admin may manage Helpdesk & Viewer.
  const roleOptions = Auth.can('canManageOwner') ? ['Owner', 'Admin', 'Helpdesk', 'Viewer'] : ['Helpdesk', 'Viewer'];
  // Keep current Admin rows selectable when an Admin edits peers' lower roles only;
  // existing Admin targets stay visible but cannot be assigned by non-Owners.
  const roleOptionsFor = (u) => {
    if (Auth.can('canManageOwner')) return roleOptions;
    if (u.role === 'Admin' || u.role === 'Owner') return [u.role, 'Helpdesk', 'Viewer'];
    return roleOptions;
  };

  const groupOptionsHtml = (selectedId) => `
    <option value="">— ${esc('No group')} —</option>
    ${groupList.map((g) => `
      <option value="${esc(g.id)}" ${g.id === selectedId ? 'selected' : ''}>
        ${esc(g.name)}${g.is_system ? ' (system)' : ''}
      </option>`).join('')}`;

  el.innerHTML = `
    ${pageHead(
      'IT Users',
      'Manage operators, roles and IAM permission groups.',
      `<button class="btn btn-outline" id="iam-new-group"><span class="ms">shield_person</span> ${esc('New permission group')}</button>
       <button class="btn btn-primary" id="user-new"><span class="ms">person_add</span> ${esc('New IT User')}</button>`
    )}

    <h3 class="section-title" style="margin:4px 0 10px">${esc('Permission groups')}</h3>
    <div class="iam-groups">
      ${groupList.length ? sortedGroups.map((g) => {
        const nUsers = Number(g.user_count || 0);
        const desc = (g.description || '').trim();
        return `
        <article class="iam-group-card${g.is_system ? ' is-system' : ''}">
          <div class="iam-group-head">
            <div class="iam-group-id">
              <span class="iam-group-icon ms" aria-hidden="true">${g.is_system ? 'verified_user' : 'group'}</span>
              <div class="iam-group-title-wrap">
                <div class="iam-group-title-row">
                  <h4 class="iam-group-name">${esc(g.name)}</h4>
                  ${g.is_system ? `<span class="pill pill-blue">${esc('System')}</span>` : `<span class="pill">${esc('Custom')}</span>`}
                </div>
                ${desc ? `<p class="iam-group-desc">${esc(desc)}</p>` : `<p class="iam-group-desc is-empty">${esc('No description')}</p>`}
              </div>
            </div>
            <div class="iam-group-actions">
              <button type="button" class="btn btn-outline btn-sm" data-iam-view="${esc(g.id)}" title="${esc('View & manage entries')}">
                <span class="ms">visibility</span>
              </button>
              ${!g.is_system ? `
              <button type="button" class="btn btn-outline btn-sm" data-iam-edit="${esc(g.id)}" data-gname="${esc(g.name)}" data-gdesc="${esc(g.description || '')}" title="${esc('Rename / edit description')}">
                <span class="ms">edit</span>
              </button>
              <button type="button" class="btn btn-outline btn-sm" data-iam-del="${esc(g.id)}" data-gname="${esc(g.name)}" title="${esc('Delete')}">
                <span class="ms">delete</span>
              </button>` : ''}
            </div>
          </div>
          <div class="iam-group-foot">
            <span class="iam-group-users">${nUsers} ${esc(nUsers === 1 ? 'user' : 'users')}</span>
            ${g.is_system ? `<span class="iam-group-hint">${esc('Built-in')}</span>` : ''}
          </div>
        </article>`;
      }).join('') : `<div class="iam-groups-empty cell-sub">${esc('No permission groups yet. Run migration 022 or create a custom group.')}</div>`}
    </div>

    <h3 class="section-title" style="margin:4px 0 10px">${esc('Operators')}</h3>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr>
        <th>${esc('User')}</th>
        <th>${esc('Email')}</th>
        <th>${esc('Role')}</th>
        <th>${esc('Permission group')}</th>
        <th>${esc('Status')}</th>
        <th>${esc('Last Login')}</th>
        <th style="text-align:right"></th>
      </tr></thead>
      <tbody>
        ${items.map((u) => `
        <tr style="${u.status === 'Disabled' ? 'opacity:.55' : ''}">
          <td><div style="display:flex;align-items:center;gap:12px">
            <span class="avatar">${esc(initials(u.username))}</span>
            <span class="cell-title">${esc(u.username)}</span></div></td>
          <td>${esc(u.email)}</td>
          <td>${badge(u.role)}</td>
          <td>
            <select data-perm-group="${esc(u.uid)}" style="width:auto;min-width:160px"
              ${(u.role === 'Owner' || u.role === 'Admin') && !Auth.can('canManageOwner') ? 'disabled title="Only an Owner can change Owner/Admin groups"' : ''}>
              ${groupOptionsHtml(u.permissionGroupId)}
            </select>
            ${u.permissionGroupName && !u.permissionGroupId ? `<div class="cell-sub">${esc(u.permissionGroupName)}</div>` : ''}
          </td>
          <td>${u.status === 'Disabled' ? '<span class="pill pill-rose">Disabled</span>' : '<span class="pill pill-emerald">Active</span>'}</td>
          <td>${u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '<span class="cell-sub">Never</span>'}</td>
          <td class="actions">
            <button class="btn btn-outline btn-sm" data-logins="${esc(u.uid)}" data-uname="${esc(u.username)}" data-uemail="${esc(u.email)}">
              <span class="ms">history</span> Logins</button>
            <select data-role="${esc(u.uid)}" style="width:auto" ${(u.role === 'Owner' || u.role === 'Admin') && !Auth.can('canManageOwner') ? 'disabled title="Only an Owner can change Owner/Admin roles"' : ''}>
              ${roleOptionsFor(u).map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
            ${Auth.can('canManageOwner') && u.uid !== (Auth.profile && Auth.profile.uid) ? `
            <button class="btn btn-outline btn-sm" data-toggle-status="${esc(u.uid)}" data-cur="${esc(u.status || 'Active')}" title="${u.status === 'Disabled' ? 'Re-enable this account' : 'Disable sign-in for this account'}">
              <span class="ms">${u.status === 'Disabled' ? 'lock_open' : 'block'}</span> ${u.status === 'Disabled' ? 'Enable' : 'Disable'}</button>
            <button class="btn btn-danger btn-sm" data-del-user="${esc(u.uid)}" data-uname="${esc(u.username)}"><span class="ms">delete</span></button>` : ''}
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div></div>`;

  // IAM matrix — only meaningful actions per resource (mirrors src/utils/iamSchema.js)
  const IAM_RESOURCES = [
    'asset', 'license', 'employee', 'contract', 'provider',
    'line', 'consumable', 'maintenance', 'stock_count', 'report',
    'audit', 'dashboard', 'settings', 'user_management',
    'integration', 'document', 'catalog', 'handover', 'onboarding',
  ];
  const ACTIONS_BY_RESOURCE = {
    asset: ['read', 'create', 'update', 'delete', 'assign', 'unassign', 'export', 'import', 'manage'],
    license: ['read', 'create', 'update', 'delete', 'assign', 'unassign', 'view_confidential', 'manage'],
    line: ['read', 'create', 'update', 'delete', 'assign', 'unassign', 'view_confidential', 'manage'],
    employee: ['read', 'create', 'update', 'delete', 'view_inventory', 'view_history', 'view_handover', 'manage'],
    handover: ['read', 'create', 'update'],
    document: ['read', 'download', 'upload', 'delete'],
    contract: ['read', 'create', 'update', 'delete', 'view_confidential', 'manage'],
    provider: ['read', 'create', 'update', 'delete', 'manage'],
    consumable: ['read', 'create', 'update', 'delete', 'manage'],
    maintenance: ['read', 'create', 'update', 'delete', 'view_confidential', 'manage'],
    stock_count: ['read', 'create', 'update', 'delete', 'manage'],
    catalog: ['read', 'create', 'update', 'delete'],
    onboarding: ['read', 'create', 'update'],
    report: ['read', 'export'],
    dashboard: ['read'],
    audit: ['read'],
    settings: ['manage'],
    user_management: ['read', 'create', 'update', 'delete'],
    integration: ['read', 'update', 'manage'],
  };
  const IAM_ACTIONS_FLAT = [...new Set(Object.values(ACTIONS_BY_RESOURCE).flat())];
  const IAM_CONSTRAINTS = [
    '', 'department', 'location', 'category', 'cost_limit', 'seats_limit', 'max_assets', 'owner_only',
  ];
  const canEditSystem = Auth.profile?.role === 'Owner';

  /** Illustrated guide: what each matrix row controls in the UI. */
  function openIamPermissionGuide(startKey) {
    const shot = (title, body) => `
      <div class="iam-shot" aria-hidden="true">
        <div class="iam-shot-chrome"><i></i>${esc(title)}</div>
        <div class="iam-shot-body">${body}</div>
      </div>`;
    const keyRow = (code, text) => `
      <div class="iam-guide-key"><code>${esc(code)}</code><span>${text}</span></div>`;

    const topics = [
      {
        key: 'general',
        icon: 'tune',
        label: 'General rules',
        title: 'How the matrix works',
        lead: 'Owner bypasses everything. Always test with a user in this group — not as Owner.',
        shot: shot('ITACM · add buttons', `
          <div class="iam-shot-row">
            <strong>Hardware Inventory</strong>
            <span class="muted">list visible with read</span>
            <div class="iam-shot-btns">
              <em class="off">+ New Asset</em>
              <span class="iam-shot-callout warn">needs create</span>
            </div>
          </div>
          <div class="iam-shot-row">
            <strong>Same page with create</strong>
            <span class="muted">manage alone is not enough</span>
            <div class="iam-shot-btns"><em>+ New Asset</em>
              <span class="iam-shot-callout ok">create ON</span></div>
          </div>`),
        keys: [
          keyRow('create', 'Shows “Add New / New Asset” buttons. <strong>manage does not</strong> unlock create.'),
          keyRow('manage', 'Also turns on read, update, delete and assign/unassign — never export, import, view_confidential, or employee view_*.'),
          keyRow('view_confidential', 'Shows money amounts on contracts, licenses, lines and repairs.'),
        ],
      },
      {
        key: 'document',
        icon: 'description',
        label: 'document',
        title: 'Documents (PDF / scans)',
        lead: 'Providers, contracts, licenses, employee handover scans, repair paperwork.',
        shot: shot('Provider · Documents', `
          <div class="iam-shot-row">
            <div class="iam-shot-lock">
              <span class="ms" style="color:#777">picture_as_pdf</span>
              <span class="iam-shot-blur">zimmet-HF-51C80A1F.pdf</span>
            </div>
            <span class="iam-shot-badge"><span class="ms ms-sm">lock</span> File on file — viewing locked</span>
            <div class="iam-shot-btns"><em class="lock">visibility</em><em class="lock">download</em>
              <span class="iam-shot-callout warn">read only</span></div>
          </div>
          <div class="iam-shot-row">
            <div class="iam-shot-lock">
              <span class="ms" style="color:#777">picture_as_pdf</span>
              <strong style="color:var(--primary,#3525cd)">zimmet-HF-51C80A1F.pdf</strong>
            </div>
            <span class="muted">39 KB · openable</span>
            <div class="iam-shot-btns"><em>visibility</em><em>download</em>
              <span class="iam-shot-callout ok">+ download</span></div>
          </div>`),
        keys: [
          keyRow('document:read', 'File is listed (blurred name, size, date). No open/download buttons.'),
          keyRow('document:download', 'View popup + download. Read alone does <strong>not</strong> open the file.'),
          keyRow('document:upload', 'Upload button. Employee docs also need employee:view_handover.'),
          keyRow('document:delete', 'Delete / remove file button.'),
        ],
      },
      {
        key: 'report',
        icon: 'summarize',
        label: 'report',
        title: 'Reports & Analytics',
        lead: 'report:read opens the page. Each preset also needs that module’s read.',
        shot: shot('Reports', `
          <div class="iam-shot-row">
            <strong>Reports &amp; Analytics</strong>
            <span class="muted">page opens</span>
            <span class="iam-shot-callout ok">report:read</span>
          </div>
          <div class="iam-shot-row">
            <strong>Maintenance &amp; Cost</strong>
            <span class="muted">preset card hidden without module read</span>
            <span class="iam-shot-callout warn">needs maintenance:read</span>
          </div>
          <div class="iam-shot-row">
            <strong>Export CSV / Print</strong>
            <div class="iam-shot-btns"><em class="off">Export CSV</em></div>
            <span class="iam-shot-callout warn">needs export</span>
          </div>`),
        keys: [
          keyRow('report:read', 'Opens Reports & Analytics (KPIs, presets you are allowed to see).'),
          keyRow('report:export', 'CSV export and letterhead print buttons.'),
          keyRow('asset / maintenance / … :read', 'Each preset needs the matching module read (e.g. repair reports → maintenance:read).'),
        ],
      },
      {
        key: 'integration',
        icon: 'hub',
        label: 'integration',
        title: 'Integrations (SMTP, API, webhooks)',
        lead: 'Read can look at settings. Secrets stay blurred until manage.',
        shot: shot('Integrations · SMTP', `
          <div class="iam-shot-row">
            <strong>Password</strong>
            <span class="iam-shot-blur">••••••••••••</span>
            <span class="iam-shot-callout warn">read → locked</span>
          </div>
          <div class="iam-shot-row">
            <strong>Save / Create key</strong>
            <div class="iam-shot-btns"><em class="off">Save SMTP</em><em class="off">Create key</em></div>
            <span class="iam-shot-callout warn">needs manage</span>
          </div>`),
        keys: [
          keyRow('integration:read', 'View Integrations. Passwords, secrets and key prefixes are blurred; fields disabled.'),
          keyRow('integration:update', 'Edit custom-field values on asset / employee / contract forms (not SMTP config).'),
          keyRow('integration:manage', 'Change SMTP, webhooks, API keys, field definitions, sync API.'),
        ],
      },
      {
        key: 'consumable',
        icon: 'inventory_2',
        label: 'consumable',
        title: 'Consumables (toner, cables)',
        lead: 'Sarf malzeme stok ekranı — etiketlenmeyen kalemler.',
        shot: shot('Consumables', `
          <div class="iam-shot-row">
            <strong>Toner 83A</strong>
            <span class="muted">4 left · Min 5</span>
            <div class="iam-shot-btns"><em class="off">−1</em><em class="off">+1</em>
              <span class="iam-shot-callout warn">needs update</span></div>
          </div>
          <div class="iam-shot-row">
            <strong>+ New Item</strong>
            <span class="muted">create separate from manage</span>
            <span class="iam-shot-callout warn">needs create</span>
          </div>`),
        keys: [
          keyRow('consumable:read', 'Open Consumables list & related report presets.'),
          keyRow('consumable:create', 'New Item button.'),
          keyRow('consumable:update', '+1 / −1 / Adjust stock.'),
          keyRow('consumable:manage', 'read + update + delete. Create stays a separate toggle.'),
        ],
      },
      {
        key: 'maintenance',
        icon: 'build',
        label: 'maintenance',
        title: 'Maintenance & Repair',
        lead: 'Repair logs, send-to-repair, costs, and maintenance reports.',
        shot: shot('Maintenance & Repair', `
          <div class="iam-shot-row">
            <strong>HW-0981 · In Repair</strong>
            <span class="muted">list / Notes</span>
            <span class="iam-shot-callout ok">read</span>
          </div>
          <div class="iam-shot-row">
            <strong>Cost column</strong>
            <span class="muted">₺3.200 hidden as —</span>
            <span class="iam-shot-callout warn">view_confidential</span>
          </div>
          <div class="iam-shot-row">
            <strong>Send to repair</strong>
            <div class="iam-shot-btns"><em class="off">Repair</em></div>
            <span class="iam-shot-callout warn">needs create</span>
          </div>`),
        keys: [
          keyRow('maintenance:read', 'Repair log list + maintenance report presets.'),
          keyRow('maintenance:create', 'Send asset to repair (Hardware / Network row action).'),
          keyRow('maintenance:update', 'Close repair, add progress notes.'),
          keyRow('view_confidential', 'Show repair cost amounts.'),
        ],
      },
      {
        key: 'provider',
        icon: 'apartment',
        label: 'provider / contract',
        title: 'Providers & Contracts',
        lead: 'Same menu, separate permissions. You can open Providers without Contracts.',
        shot: shot('Providers & Contracts', `
          <div class="iam-shot-row">
            <strong>Providers tab</strong>
            <span class="muted">vendors · contacts · support</span>
            <span class="iam-shot-callout ok">provider:read</span>
          </div>
          <div class="iam-shot-row">
            <strong>Contracts tab</strong>
            <div class="iam-shot-btns"><em class="off">Contracts</em><em class="off">Add contract</em></div>
            <span class="iam-shot-callout warn">needs contract:read</span>
          </div>`),
        keys: [
          keyRow('provider:read', 'Open the page and list providers. Contracts tab stays hidden without contract:read.'),
          keyRow('provider:create|update|delete', 'Add / edit / remove vendor companies.'),
          keyRow('contract:read', 'Show Contracts tab, KPIs, and contract buttons on provider cards.'),
          keyRow('contract:create|update|delete', 'Manage commercial agreements. view_confidential = amounts.'),
        ],
      },
      {
        key: 'catalog',
        icon: 'category',
        label: 'catalog',
        title: 'Product Catalog',
        lead: 'Shared lists that feed every form: brands, models, locations, departments, specs.',
        shot: shot('Product Catalog', `
          <div class="iam-shot-row">
            <strong>Brands &amp; Models</strong>
            <span class="muted">Laptop · Dell · L5540</span>
            <span class="iam-shot-callout ok">read</span>
          </div>
          <div class="iam-shot-row">
            <strong>Locations / Specs / Lifecycle</strong>
            <div class="iam-shot-btns"><em class="off">Add</em><em class="off">Save</em></div>
            <span class="iam-shot-callout warn">create / update</span>
          </div>`),
        keys: [
          keyRow('catalog:read', 'Open Product Catalog page and load dropdown lists.'),
          keyRow('catalog:create', 'Add model, location, department, CPU/RAM option, import from assets.'),
          keyRow('catalog:update', 'Save lifecycle months, set default location.'),
          keyRow('catalog:delete', 'Remove catalog entries / locations / departments.'),
        ],
      },
      {
        key: 'employee',
        icon: 'badge',
        label: 'employee / handover',
        title: 'Employee card & zimmet',
        lead: 'Tabs and actions on the employee detail modal, plus handover create.',
        shot: shot('Employee · Ayşe Yılmaz', `
          <div class="iam-shot-row">
            <strong>Tabs</strong>
            <div class="iam-shot-btns"><em>Overview</em><em class="off">History</em><em class="off">Documents</em>
              <span class="iam-shot-callout warn">view_*</span></div>
          </div>
          <div class="iam-shot-row">
            <strong>Handover / Assign</strong>
            <div class="iam-shot-btns"><em class="off">Zimmet</em><em class="off">Assign license</em>
              <span class="iam-shot-callout warn">create / assign</span></div>
          </div>`),
        keys: [
          keyRow('handover:create', 'Make zimmet / handover form.'),
          keyRow('employee:view_handover', 'Documents tab on employee card.'),
          keyRow('employee:view_inventory|view_history', 'Extra tabs on the employee card.'),
          keyRow('license:assign · line:assign · asset:unassign', 'Assign software / lines / return device from the card.'),
        ],
      },
      {
        key: 'asset',
        icon: 'devices',
        label: 'asset',
        title: 'Hardware Inventory',
        lead: 'Main device register. Network & Server shares the same asset permissions.',
        shot: shot('Hardware Inventory', `
          <div class="iam-shot-row">
            <strong>HW-1042 · MacBook</strong>
            <span class="muted">list / detail</span>
            <span class="iam-shot-callout ok">read</span>
          </div>
          <div class="iam-shot-row">
            <strong>+ New Asset / Import</strong>
            <div class="iam-shot-btns"><em class="off">New Asset</em><em class="off">Import</em>
              <span class="iam-shot-callout warn">create / import</span></div>
          </div>`),
        keys: [
          keyRow('asset:read', 'See inventory list and asset detail.'),
          keyRow('asset:create', 'New Asset button.'),
          keyRow('asset:assign|unassign', 'Assign / return device actions.'),
          keyRow('asset:export|import', 'CSV export and inventory import (manage does not include these).'),
        ],
      },
    ];

    const initial = topics.find((t) => t.key === startKey) ? startKey : 'general';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay iam-guide-overlay';
    overlay.innerHTML = `
      <div class="modal modal-xl iam-guide-panel" role="dialog" aria-modal="true" aria-label="Permission guide">
        <div class="modal-head">
          <h3><span class="ms" style="vertical-align:-3px">help</span> What do these toggles control?</h3>
          <button type="button" class="modal-close" data-iam-guide-close aria-label="Close">×</button>
        </div>
        <div class="modal-body iam-guide-body">
          <nav class="iam-guide-nav" id="iam-guide-nav">
            ${topics.map((t) => `
              <button type="button" data-iam-topic="${esc(t.key)}" class="${t.key === initial ? 'is-on' : ''}">
                <span class="ms">${esc(t.icon)}</span>${esc(t.label)}
              </button>`).join('')}
          </nav>
          <div class="iam-guide-content" id="iam-guide-content"></div>
        </div>
        <div class="modal-foot">
          <span class="cell-sub" style="margin-right:auto">Tip: click the <strong>?</strong> on a matrix row to jump here.</span>
          <button type="button" class="btn btn-outline" data-iam-guide-close>${esc(t('common.close') || 'Close')}</button>
        </div>
      </div>`;

    const renderTopic = (key) => {
      const topic = topics.find((x) => x.key === key) || topics[0];
      overlay.querySelectorAll('[data-iam-topic]').forEach((b) => {
        b.classList.toggle('is-on', b.dataset.iamTopic === topic.key);
      });
      const box = overlay.querySelector('#iam-guide-content');
      if (!box) return;
      box.innerHTML = `
        <h3>${esc(topic.title)}</h3>
        <p class="iam-guide-lead">${esc(topic.lead)}</p>
        ${topic.shot}
        <div class="iam-guide-keys">${topic.keys.join('')}</div>`;
    };

    const close = () => {
      overlay.remove();
      if (!$('#modal-root')?.firstElementChild && !$('.doc-lightbox') && !$('.iam-guide-overlay')) {
        document.body.classList.remove('modal-open');
      }
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-iam-guide-close]')) close();
    });
    overlay.querySelector('#iam-guide-nav')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-iam-topic]');
      if (!btn) return;
      renderTopic(btn.dataset.iamTopic);
    });
    document.body.classList.add('modal-open');
    document.body.appendChild(overlay);
    renderTopic(initial);
  }

  const RESOURCE_GUIDE_KEY = {
    document: 'document',
    report: 'report',
    integration: 'integration',
    consumable: 'consumable',
    maintenance: 'maintenance',
    catalog: 'catalog',
    employee: 'employee',
    handover: 'employee',
    asset: 'asset',
    license: 'asset',
    line: 'employee',
    provider: 'provider',
    contract: 'provider',
  };

  const refreshDetail = async (groupId, detail) => {
    const updated = await api(`/auth/permission-groups/${groupId}`);
    detail.entries = updated.entries;
    detail.users = updated.users;
    detail.description = updated.description;
    detail.name = updated.name;
    detail.is_system = updated.is_system;
  };

  const openGroupDetail = async (groupId) => {
    const detail = await api(`/auth/permission-groups/${groupId}`);
    const editable = !detail.is_system || canEditSystem;

    const renderEntriesModal = () => {
      const entryKey = (resource, action) => `${resource}::${action}`;
      const byKey = {};
      (detail.entries || []).forEach((e) => {
        // Prefer unconstrained entry as the toggle target when duplicates exist
        const k = entryKey(e.resource, e.action);
        if (!byKey[k] || (!e.constraint_type && byKey[k].constraint_type)) byKey[k] = e;
      });

      const rowsHtml = IAM_RESOURCES.map((res) => {
        const acts = ACTIONS_BY_RESOURCE[res] || [];
        const actionCells = acts.map((act) => {
          const entry = byKey[entryKey(res, act)];
          const on = !!entry;
          const constrained = !!(entry && entry.constraint_type);
          return `
            <label class="iam-action-cell ${on ? 'is-on' : ''} ${constrained ? 'is-constrained' : ''}"
              title="${esc(constrained ? `${entry.constraint_type}=${JSON.stringify(entry.constraint_value)}` : act)}">
              <input type="checkbox" data-iam-toggle data-resource="${esc(res)}" data-action="${esc(act)}"
                data-entry-id="${entry ? esc(entry.id) : ''}" ${on ? 'checked' : ''} ${editable ? '' : 'disabled'}>
              <span>${esc(act)}</span>
            </label>`;
        }).join('');
        return `<tr>
          <td class="iam-resource-cell">
            <strong>${esc(res)}</strong>
            <button type="button" class="iam-row-help" data-iam-resource-help="${esc(res)}"
              title="What does ${esc(res)} control?" aria-label="Help for ${esc(res)}">
              <span class="ms">help</span>
            </button>
          </td>
          <td><div class="iam-action-grid">${actionCells}</div></td>
        </tr>`;
      }).join('');

      const constrainedEntries = (detail.entries || []).filter((e) => e.constraint_type);

      openModal({
        title: `${detail.name}${detail.is_system ? ' (system)' : ''}`,
        wide: true,
        body: `
          <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;margin-bottom:12px">
            <div>
              <p class="cell-sub" style="margin:0 0 6px">${esc(detail.description || '')}</p>
              <div class="cell-sub">${(detail.users || []).length} users
                ${(detail.users || []).length ? ` · ${detail.users.map((u) => esc(u.username)).join(', ')}` : ''}</div>
              ${detail.is_system && canEditSystem
                ? '<div class="cell-sub" style="margin-top:6px;color:var(--amber-700,#b45309)">Built-in group — Owner can edit entries. Group name stays fixed.<br><strong>Important:</strong> Your current login is still Owner (full access). To verify these permissions, log in as a user assigned to this group — then refresh the session.</div>'
                : ''}
              ${!detail.is_system
                ? '<div class="cell-sub" style="margin-top:6px">Changes apply immediately to users in this group after they refresh (re-open the app / verify session).</div>'
                : ''}
              ${!editable
                ? '<div class="cell-sub" style="margin-top:6px;color:var(--rose-700,#be123c)">Only an Owner can edit system group permissions.</div>'
                : ''}
            </div>
            ${!detail.is_system || canEditSystem ? `
            <button type="button" class="btn btn-outline btn-sm" id="iam-edit-desc-btn">
              <span class="ms">edit</span> Description
            </button>` : ''}
          </div>

          <div class="iam-matrix-head">
            <h4 class="iam-section-label">Permissions matrix</h4>
            <button type="button" class="iam-help-btn" id="iam-open-guide">
              <span class="ms">help</span> What do these toggles control?
            </button>
          </div>
          <p class="cell-sub" style="margin:-2px 0 12px">
            Only meaningful actions per module. <strong>Owner always has full access</strong> —
            test with a user in this group, then re-login.
            Click <strong>?</strong> next to a resource (or the help button) for a screen preview.
          </p>
          <div class="table-wrap iam-matrix-wrap" style="margin-bottom:18px">
            <table class="data iam-matrix">
              <thead><tr><th style="width:140px">Resource</th><th>Actions</th></tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
          <div id="iam-toggle-error" class="cell-sub" style="color:var(--danger);margin:-8px 0 12px;display:none"></div>

          <h4 class="iam-section-label">Add entry with constraint (optional)</h4>
          <div class="iam-add-row">
            <div>
              <label class="cell-sub iam-field-label">Resource</label>
              <select id="iam-add-resource">${IAM_RESOURCES.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select>
            </div>
            <div>
              <label class="cell-sub iam-field-label">Action</label>
              <select id="iam-add-action">${(ACTIONS_BY_RESOURCE[IAM_RESOURCES[0]] || []).map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select>
            </div>
            <div>
              <label class="cell-sub iam-field-label">Constraint</label>
              <select id="iam-add-constraint">${IAM_CONSTRAINTS.map((c) => `<option value="${esc(c)}">${esc(c || '— none —')}</option>`).join('')}</select>
            </div>
            <div style="flex:1;min-width:160px">
              <label class="cell-sub iam-field-label">Value (JSON / text)</label>
              <input type="text" id="iam-add-constraint-value" placeholder='e.g. ["IT","Finance"] or 50000'>
            </div>
            <button type="button" class="btn btn-primary" id="iam-add-entry-btn" ${editable ? '' : 'disabled'}>
              <span class="ms">add</span> Add
            </button>
          </div>
          <div id="iam-add-error" class="cell-sub" style="color:var(--danger);margin-top:6px;display:none"></div>

          ${constrainedEntries.length ? `
          <h4 class="iam-section-label" style="margin-top:18px">Constrained entries</h4>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Resource</th><th>Action</th><th>Constraint</th><th></th></tr></thead>
            <tbody>
              ${constrainedEntries.map((e) => `
                <tr>
                  <td><strong>${esc(e.resource)}</strong></td>
                  <td><span class="pill pill-indigo" style="font-size:11px">${esc(e.action)}</span></td>
                  <td class="mono" style="font-size:12px">${esc(e.constraint_type)}=${esc(JSON.stringify(e.constraint_value))}</td>
                  <td>
                    <button type="button" class="btn btn-outline btn-sm iam-edit-constraint" data-entry-id="${esc(e.id)}"
                      data-ctype="${esc(e.constraint_type || '')}" data-cval="${esc(JSON.stringify(e.constraint_value ?? ''))}"
                      ${editable ? '' : 'disabled'}><span class="ms">edit</span></button>
                    <button type="button" class="btn btn-outline btn-sm iam-del-entry" data-entry-id="${esc(e.id)}"
                      ${editable ? '' : 'disabled'}><span class="ms">close</span></button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table></div>` : ''}
        `,
        foot: '<button class="btn btn-outline" data-close>Close</button>',
      });

      const showErr = (id, msg) => {
        const box = document.getElementById(id);
        if (!box) return;
        box.textContent = msg || '';
        box.style.display = msg ? 'block' : 'none';
      };

      const reloadModal = async () => {
        await refreshDetail(groupId, detail);
        document.querySelector('#modal-root .modal-overlay [data-close], #modal-root [data-close]')?.click();
        // closeModal removes overlay; reopen with fresh data
        setTimeout(() => renderEntriesModal(), 120);
      };

      document.getElementById('iam-edit-desc-btn')?.addEventListener('click', () => {
        formModal({
          title: `Edit description — ${detail.name}`,
          fields: [
            ...(detail.is_system
              ? []
              : [{ name: 'name', label: 'Name *', value: detail.name, required: true }]),
            {
              name: 'description', label: 'Description', type: 'textarea',
              value: detail.description || '', full: true,
            },
          ],
          submitLabel: 'Save',
          async onSubmit(d) {
            const body = detail.is_system
              ? { description: d.description }
              : { name: d.name, description: d.description };
            await api(`/auth/permission-groups/${groupId}`, { method: 'PUT', body });
            toast('Group updated', 'success');
            await reloadModal();
            Views.users(el);
          },
        });
      });

      document.getElementById('iam-open-guide')?.addEventListener('click', () => openIamPermissionGuide('general'));
      document.querySelectorAll('[data-iam-resource-help]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const res = btn.dataset.iamResourceHelp;
          openIamPermissionGuide(RESOURCE_GUIDE_KEY[res] || 'general');
        });
      });

      document.querySelectorAll('[data-iam-toggle]').forEach((cb) => {
        cb.addEventListener('change', async () => {
          if (!editable) return;
          const resource = cb.dataset.resource;
          const action = cb.dataset.action;
          showErr('iam-toggle-error', '');
          try {
            if (cb.checked) {
              // Clear any stale duplicate rows first, then add unconstrained grant
              await api(`/auth/permission-groups/${groupId}/entries?resource=${encodeURIComponent(resource)}&action=${encodeURIComponent(action)}`, {
                method: 'DELETE',
              }).catch(() => {});
              const created = await api(`/auth/permission-groups/${groupId}/entries`, {
                method: 'POST',
                body: { resource, action },
              });
              cb.dataset.entryId = created?.id || '';
              cb.closest('.iam-action-cell')?.classList.add('is-on');
              toast(`Enabled ${resource}:${action}`, 'success');
              // manage expands sibling ops server-side — refresh matrix
              if (action === 'manage') {
                await refreshDetail(groupId, detail);
                renderEntriesModal();
                return;
              }
            } else {
              // Delete ALL entries for this resource+action (duplicates + constrained)
              await api(`/auth/permission-groups/${groupId}/entries?resource=${encodeURIComponent(resource)}&action=${encodeURIComponent(action)}`, {
                method: 'DELETE',
              });
              cb.dataset.entryId = '';
              cb.closest('.iam-action-cell')?.classList.remove('is-on', 'is-constrained');
              toast(`Disabled ${resource}:${action}`, 'success');
            }
          } catch (err) {
            cb.checked = !cb.checked;
            showErr('iam-toggle-error', err.message);
            toast(err.message, 'error');
          }
        });
      });

      const syncAddActions = () => {
        const res = document.getElementById('iam-add-resource')?.value;
        const sel = document.getElementById('iam-add-action');
        if (!sel) return;
        const acts = ACTIONS_BY_RESOURCE[res] || IAM_ACTIONS_FLAT;
        sel.innerHTML = acts.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
      };
      document.getElementById('iam-add-resource')?.addEventListener('change', syncAddActions);

      document.getElementById('iam-add-entry-btn')?.addEventListener('click', async () => {
        if (!editable) return;
        const resource = document.getElementById('iam-add-resource')?.value;
        const action = document.getElementById('iam-add-action')?.value;
        const constraintType = document.getElementById('iam-add-constraint')?.value || null;
        const rawVal = String(document.getElementById('iam-add-constraint-value')?.value || '').trim();
        let constraintValue;
        if (constraintType) {
          if (!rawVal) {
            showErr('iam-add-error', 'Constraint value is required when a constraint type is selected');
            return;
          }
          try {
            constraintValue = JSON.parse(rawVal);
          } catch {
            // plain string / number
            constraintValue = /^\d+(\.\d+)?$/.test(rawVal) ? Number(rawVal) : rawVal;
            if (rawVal === 'true') constraintValue = true;
            if (rawVal === 'false') constraintValue = false;
          }
        }
        showErr('iam-add-error', '');
        try {
          await api(`/auth/permission-groups/${groupId}/entries`, {
            method: 'POST',
            body: { resource, action, constraintType: constraintType || null, constraintValue },
          });
          toast(`Added ${resource}:${action}`, 'success');
          await reloadModal();
        } catch (err) {
          showErr('iam-add-error', err.message);
        }
      });

      document.querySelectorAll('.iam-del-entry').forEach((b) => {
        b.addEventListener('click', async () => {
          try {
            await api(`/auth/permission-groups/${groupId}/entries/${b.dataset.entryId}`, { method: 'DELETE' });
            toast('Entry removed', 'success');
            await reloadModal();
          } catch (err) { toast(err.message, 'error'); }
        });
      });

      document.querySelectorAll('.iam-edit-constraint').forEach((b) => {
        b.addEventListener('click', () => {
          formModal({
            title: 'Edit constraint',
            fields: [
              {
                name: 'constraintType', label: 'Constraint type', type: 'select',
                value: b.dataset.ctype || '',
                options: IAM_CONSTRAINTS.map((c) => ({ value: c, label: c || '— none —' })),
              },
              {
                name: 'constraintValue', label: 'Value (JSON / text)',
                value: b.dataset.cval === '""' ? '' : (b.dataset.cval || ''),
                full: true,
                placeholder: '["IT"] or 50000 or true',
              },
            ],
            submitLabel: 'Save',
            async onSubmit(d) {
              let constraintValue = null;
              const raw = String(d.constraintValue || '').trim();
              if (d.constraintType) {
                if (!raw) throw new Error('Constraint value required');
                try { constraintValue = JSON.parse(raw); }
                catch {
                  constraintValue = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
                  if (raw === 'true') constraintValue = true;
                  if (raw === 'false') constraintValue = false;
                }
              }
              await api(`/auth/permission-groups/${groupId}/entries/${b.dataset.entryId}`, {
                method: 'PUT',
                body: {
                  constraintType: d.constraintType || null,
                  constraintValue,
                },
              });
              toast('Constraint updated', 'success');
              await reloadModal();
            },
          });
        });
      });
    };

    renderEntriesModal();
  };

  $('#iam-new-group', el)?.addEventListener('click', () => formModal({
    title: 'New permission group',
    fields: [
      { name: 'name', label: 'Name *', required: true },
      { name: 'description', label: 'Description', type: 'textarea', full: true },
    ],
    submitLabel: 'Create group',
    async onSubmit(d) {
      await api('/auth/permission-groups', { method: 'POST', body: d });
      toast('Permission group created', 'success');
      Views.users(el);
    },
  }));

  el.querySelectorAll('[data-iam-view]').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await openGroupDetail(b.dataset.iamView); }
      catch (err) { toast(err.message, 'error'); }
    });
  });

  el.querySelectorAll('[data-iam-edit]').forEach((b) => {
    b.addEventListener('click', () => {
      formModal({
        title: `Edit "${b.dataset.gname}"`,
        fields: [
          { name: 'name', label: 'Name *', value: b.dataset.gname, required: true },
          { name: 'description', label: 'Description', type: 'textarea', value: b.dataset.gdesc || '', full: true },
        ],
        submitLabel: 'Save',
        async onSubmit(d) {
          await api(`/auth/permission-groups/${b.dataset.iamEdit}`, { method: 'PUT', body: d });
          toast('Group updated', 'success');
          Views.users(el);
        },
      });
    });
  });

  el.querySelectorAll('[data-iam-del]').forEach((b) => {
    b.addEventListener('click', () => {
      confirmModal(`Delete permission group "${b.dataset.gname}"?`, async () => {
        try {
          await api(`/auth/permission-groups/${b.dataset.iamDel}`, { method: 'DELETE' });
          toast('Group deleted', 'success');
          Views.users(el);
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  });

  $('#user-new', el).addEventListener('click', () => formModal({
    title: 'New IT User',
    fields: [
      { name: 'username', label: 'Display name *', required: true },
      { name: 'email', label: 'Email *', type: 'email', required: true },
      { name: 'password', label: 'Password *', type: 'password', required: true },
      { name: 'role', label: 'Role *', type: 'select', value: 'Helpdesk', options: roleOptions },
      {
        name: 'permissionGroupId',
        label: 'Permission group',
        type: 'select',
        value: groupList.find((g) => g.name === 'Helpdesk')?.id || '',
        options: [
          { value: '', label: '— No group —' },
          ...groupList.map((g) => ({ value: g.id, label: g.name + (g.is_system ? ' (system)' : '') })),
        ],
      },
    ],
    submitLabel: 'Create user',
    async onSubmit(d) {
      const created = await api('/auth/users', { method: 'POST', body: d });
      if (d.permissionGroupId && created?.uid) {
        await api(`/auth/users/${created.uid}/permission-group`, {
          method: 'PUT',
          body: { groupId: d.permissionGroupId || null },
        }).catch(() => {});
      }
      toast(`${d.role} user created`, 'success');
      Views.users(el);
    },
  }));

  el.querySelectorAll('select[data-role]').forEach((s) => s.addEventListener('change', async () => {
    try {
      await api(`/auth/users/${s.dataset.role}/role`, { method: 'PUT', body: { role: s.value } });
      toast('Role updated', 'success');
    } catch (err) {
      toast(err.message, 'error');
      Views.users(el);
    }
  }));

  el.querySelectorAll('select[data-perm-group]').forEach((s) => s.addEventListener('change', async () => {
    try {
      await api(`/auth/users/${s.dataset.permGroup}/permission-group`, {
        method: 'PUT',
        body: { groupId: s.value || null },
      });
      toast('Permission group updated', 'success');
    } catch (err) {
      toast(err.message, 'error');
      Views.users(el);
    }
  }));

  el.querySelectorAll('button[data-logins]').forEach((b) => b.addEventListener('click', async () => {
    const [logs, adminLogs] = await Promise.all([
      api(`/auth/users/${b.dataset.logins}/logins`),
      api(`/auth/users/admin-logs?email=${encodeURIComponent(b.dataset.uemail || '')}`).catch(() => []),
    ]);
    openModal({
      title: `Account history — ${b.dataset.uname}`,
      body: `
        ${adminLogs.length === 0 ? '' : `
        <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:0 0 6px">Admin actions</h3>
        ${adminLogs.map((a) => `
        <div class="history-item">
          <span class="when">${fmtDateTime(a.timestamp)}</span>
          <span class="pill ${a.action === 'deleted' || a.action === 'disabled' ? 'pill-rose' : a.action === 'enabled' ? 'pill-emerald' : 'pill-indigo'}">${esc(a.action)}</span>
          ${a.detail ? `<span class="cell-sub">${esc(a.detail)}</span>` : ''}
          <span class="cell-sub">by ${esc(a.byName)}</span>
        </div>`).join('')}
        <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:14px 0 6px">Logins</h3>`}
        ${logs.length === 0 ? '<div class="cell-sub">No logins recorded yet.</div>' : `
        <div class="table-wrap"><table class="data">
          <thead><tr><th>When</th><th>IP</th><th>Client</th></tr></thead>
          <tbody>
            ${logs.map((l) => `
            <tr>
              <td>${fmtDateTime(l.timestamp)}</td>
              <td class="mono">${esc(l.ip || '—')}</td>
              <td class="cell-sub" title="${esc(l.userAgent || '')}">${esc(String(l.userAgent || '—').slice(0, 60))}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}`,
      foot: '<button class="btn btn-outline" data-close>Close</button>',
    });
  }));

  // Owner-only account administration: disable/enable and delete (audited).
  el.querySelectorAll('button[data-toggle-status]').forEach((b) => b.addEventListener('click', async () => {
    const next = b.dataset.cur === 'Disabled' ? 'Active' : 'Disabled';
    try {
      await api(`/auth/users/${b.dataset.toggleStatus}/status`, { method: 'PUT', body: { status: next } });
      toast(next === 'Disabled' ? 'Account disabled — sign-in blocked' : 'Account re-enabled', 'success');
      Views.users(el);
    } catch (err) { toast(err.message, 'error'); }
  }));
  el.querySelectorAll('button[data-del-user]').forEach((b) => b.addEventListener('click', () => {
    confirmModal(`Permanently delete the account "${b.dataset.uname}"? Their handover history is kept.`, async () => {
      try {
        await api(`/auth/users/${b.dataset.delUser}`, { method: 'DELETE' });
        toast('Account deleted — recorded in the audit log', 'success');
        Views.users(el);
      } catch (err) { toast(err.message, 'error'); }
    });
  }));

};

/* ============================ PRODUCT CATALOG ============================ */
