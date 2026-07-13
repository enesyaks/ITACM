/*
 * App bootstrap: onboarding, branding, hash router, topbar, session lifecycle.
 * XSS policy: innerHTML templates below contain only trusted static markup
 * plus esc()-encoded values (see ui.js).
 */
'use strict';

const ROUTES = {
  '#/dashboard': { title: 'Dashboard', view: 'dashboard', icon: 'dashboard' },
  '#/assets': { title: 'Hardware', view: 'assets', icon: 'devices' },
  '#/network': { title: 'Network & Server', view: 'network', icon: 'dns' },
  '#/catalog': { title: 'Product Catalog', view: 'catalog', icon: 'category' },
  '#/licenses': { title: 'Software & Licenses', view: 'licenses', icon: 'workspace_premium' },
  '#/lines': { title: 'Mobile Lines', view: 'lines', icon: 'sim_card' },
  '#/providers': { title: 'Providers & Contracts', view: 'providers', icon: 'apartment' },
  '#/consumables': { title: 'Consumables', view: 'consumables', icon: 'inventory_2' },
  '#/employees': { title: 'Employees', view: 'employees', icon: 'badge' },
  '#/handover': { title: 'Handover Ops', view: 'handover', icon: 'assignment_turned_in' },
  '#/maintenance': { title: 'Maintenance & Repair', view: 'maintenance', icon: 'build' },
  '#/stockcount': { title: 'Stock Count', view: 'stockcount', icon: 'fact_check' },
  '#/reports': { title: 'Reports', view: 'reports', icon: 'summarize' },
  '#/audit': { title: 'Audit Log', view: 'audit', icon: 'history', perm: 'canViewAudit' },
  '#/users': { title: 'IT Users', view: 'users', icon: 'vpn_key', perm: 'canManageUsers' },
};

function renderNav() {
  // Nav labels come from the i18n dictionary. Prefer nav.<view>, then fall back
  // to a few aliases where the route view name ≠ the historical nav key.
  const NAV_KEY_ALIAS = { assets: 'hardware', licenses: 'software' };
  const label = (r) => {
    const primary = 'nav.' + r.view;
    const alias = NAV_KEY_ALIAS[r.view] ? 'nav.' + NAV_KEY_ALIAS[r.view] : null;
    const v = t(primary);
    if (v !== primary) return v;
    if (alias) {
      const a = t(alias);
      if (a !== alias) return a;
    }
    return r.title;
  };
  $('#nav').innerHTML = Object.entries(ROUTES)
    .filter(([, r]) => !r.perm || Auth.can(r.perm))
    .map(([hash, r]) =>
      `<a href="${hash}" data-route="${hash}"><span class="ms">${r.icon}</span> ${esc(label(r))}</a>`)
    .join('');
  if (typeof syncMobileChrome === 'function') syncMobileChrome();
}

async function navigate() {
  closeNav();
  const gen = bumpNavGen();
  // Support query params in the hash, e.g. #/assets?lifecycle=overdue
  const [rawHash, rawQuery] = location.hash.split('?');
  const hash = ROUTES[rawHash] ? rawHash : '#/dashboard';
  const route = ROUTES[hash];
  const params = Object.fromEntries(new URLSearchParams(rawQuery || ''));
  if (route.perm && !Auth.can(route.perm)) { location.hash = '#/dashboard'; return; }

  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === hash));

  const view = $('#view');
  view.dataset.navGen = String(gen);
  if (view._viewAbort) view._viewAbort.abort(); // drop stale delegated listeners
  view.innerHTML = `<div class="table-empty">${esc(t('common.loading'))}</div>`;
  try {
    await Views[route.view](view, params);
    if (isStaleView(view)) return;
  } catch (err) {
    if (isStaleView(view)) return;
    view.innerHTML = `<div class="card card-pad"><div class="form-error">${esc(err.message)}</div></div>`;
  }
  if (isStaleView(view)) return;
  renderPageTip();
}

function openNav() {
  document.body.classList.add('nav-open');
  const backdrop = $('#sidebar-backdrop');
  if (backdrop) backdrop.hidden = false;
}
function closeNav() {
  document.body.classList.remove('nav-open');
  const backdrop = $('#sidebar-backdrop');
  if (backdrop) backdrop.hidden = true;
}
function toggleNav() {
  if (document.body.classList.contains('nav-open')) closeNav();
  else openNav();
}

/* ---- branding (company name + logo, used in UI and print forms) ---- */
function applyBranding() {
  const name = AppConfig.companyName || 'AssetControl';
  document.title = `${name} — IT Asset Control`;
  $$('[data-brand-name]').forEach((el) => { el.textContent = name; });
  $$('[data-brand-logo]').forEach((el) => {
    el.innerHTML = AppConfig.companyLogo
      ? `<img src="${esc(AppConfig.companyLogo)}" alt="logo">`
      : '<span class="ms">inventory_2</span>';
  });
}

/* ---- screens ---- */
function showApp() {
  $('#onboarding-screen').classList.add('hidden');
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  const name = Auth.profile.username || Auth.profile.email;
  $('#user-name').textContent = name;
  $('#user-role').textContent = Auth.profile.role;
  $('#user-avatar').textContent = initials(name);
  $('#topbar-avatar').textContent = initials(name);
  $('#sidebar-new-asset').style.display = Auth.can('canManageAssets') ? '' : 'none';
  applyBranding();
  if (typeof initMobileShell === 'function' && !window.__mobileShellReady) {
    window.__mobileShellReady = true;
    initMobileShell();
  }
  renderNav();
  navigate().then(() => {
    if (localStorage.getItem('itacm_tips_pending') === '1') {
      localStorage.removeItem('itacm_tips_pending');
      setTimeout(() => {
        openModal({
          title: 'Quick start tips',
          body: `
            <p class="ob-slide-desc">Your workspace is ready. Want a short guided tour of the sidebar, plus lightbulb tips on each page?</p>
            <ul class="ob-bullets">
              <li><span class="ms">check_circle</span> Page tips appear under the top bar</li>
              <li><span class="ms">check_circle</span> Help (?) → replay the product intro anytime</li>
              <li><span class="ms">check_circle</span> Turn tips off with one click on the banner</li>
            </ul>`,
          foot: `<button class="btn btn-outline" id="tips-later" data-close>Maybe later</button>
                 <button class="btn btn-primary" id="tips-start"><span class="ms">tour</span> Start sidebar tour</button>`,
          onMount(overlay) {
            $('#tips-later', overlay).addEventListener('click', () => setTipsEnabled(true));
            $('#tips-start', overlay).addEventListener('click', () => {
              closeModal();
              setTipsEnabled(true);
              startUiTour();
            });
          },
        });
      }, 500);
    }
    if (typeof checkOnboardingDueOnLogin === 'function') {
      checkOnboardingDueOnLogin().catch(() => {});
    }
  });
}

function showLogin() {
  $('#app').classList.add('hidden');
  $('#onboarding-screen').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
  if (typeof setMobileChromeVisible === 'function') setMobileChromeVisible(false);
  else if (typeof syncMobileChrome === 'function') syncMobileChrome();
  applyBranding();
  $('#login-mode-note').textContent = 'IT Asset Control Pro';
  showConfigError('#login-error');
}

// Surface a server configuration problem (e.g. database unreachable) so the
// user sees the real issue instead of a blank screen.
function showConfigError(targetSel) {
  const box = $(targetSel);
  if (!box) return;
  if (AppConfig.configError) {
    box.textContent = '⚠ ' + AppConfig.configError;
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
}

function showOnboarding() {
  $('#app').classList.add('hidden');
  $('#login-screen').classList.add('hidden');
  $('#onboarding-screen').classList.remove('hidden');
  if (typeof setMobileChromeVisible === 'function') setMobileChromeVisible(false);
  else if (typeof syncMobileChrome === 'function') syncMobileChrome();
  showConfigError('#onboarding-error');
}

/* ---- onboarding ---- */
/** Visual zimmet designs (mirrors server HANDOVER_DESIGNS). */
const HANDOVER_DESIGN_CATALOG = [
  {
    id: 'terminal', name: 'Terminal Protocol',
    desc: 'Dark navy header, violet accents — modern IT look',
    swatches: ['#131b2e', '#3525cd', '#e2dfff'],
  },
  {
    id: 'classic', name: 'Classic Formal',
    desc: 'Black & white corporate document — formal print look',
    swatches: ['#111111', '#ffffff', '#e8e8e8'],
  },
  {
    id: 'corporate', name: 'Corporate Blue',
    desc: 'Steel-blue header and calm blue accents',
    swatches: ['#1e3a5f', '#2b6cb0', '#ebf4ff'],
  },
  {
    id: 'slate', name: 'Slate Teal',
    desc: 'Teal accents on a soft slate header',
    swatches: ['#1a2e2a', '#0d9488', '#ccfbf1'],
  },
];

let obDefaultTplId = 'terminal';
let obLogoDataUrl = null;
/** Cached one-time setup key when revealed by a trusted (loopback) client. */
let obSetupToken = null;

function designSwatchesHtml(swatches) {
  return `<span class="ob-tpl-swatches">${(swatches || []).map((c) =>
    `<i style="background:${esc(c)};border:1px solid rgba(0,0,0,.12)"></i>`).join('')}</span>`;
}

function renderObTplCards() {
  const box = $('#ob-tpl-cards');
  if (!box) return;
  box.innerHTML = HANDOVER_DESIGN_CATALOG.map((p) => `
    <label class="ob-tpl-card ${obDefaultTplId === p.id ? 'selected' : ''}">
      <input type="radio" name="obTpl" value="${esc(p.id)}" ${obDefaultTplId === p.id ? 'checked' : ''}>
      <span class="ob-tpl-card-body">
        <strong>${esc(p.name)} ${designSwatchesHtml(p.swatches)}</strong>
        <span>${esc(p.desc)}</span>
      </span>
    </label>`).join('');
  box.querySelectorAll('input[name="obTpl"]').forEach((inp) => {
    inp.addEventListener('change', () => {
      obDefaultTplId = inp.value;
      box.querySelectorAll('.ob-tpl-card').forEach((c) => c.classList.toggle('selected', c.querySelector('input').checked));
    });
  });
}

function buildTemplatesForSetup(defaultDesignId) {
  const pick = HANDOVER_DESIGN_CATALOG.find((p) => p.id === defaultDesignId) || HANDOVER_DESIGN_CATALOG[0];
  const base = defaultTemplateFields();
  // One template per visual design; selected design becomes the default (first).
  const all = HANDOVER_DESIGN_CATALOG.map((d) => ({
    ...base,
    id: d.id,
    name: d.name,
    design: d.id,
  }));
  const chosen = all.find((t) => t.id === pick.id) || all[0];
  return [chosen, ...all.filter((t) => t.id !== chosen.id)];
}

// Guided feature tour shown before the setup form — one slide per product area.
const OB_TOUR = [
  {
    id: 'welcome', icon: 'inventory_2',
    title: 'Welcome to IT Asset Control',
    desc: 'Your self-hosted ITAM workspace for hardware, people, zimmet paperwork, licenses, lines, vendors, repairs and stock counts — with a full audit trail.',
    bullets: [
      'Everything in one app — no more scattered Excel sheets',
      'Onboarding reservations, vendor contracts and network inventory included',
      'Roles, search, currency and alerts built in from day one',
    ],
    tip: 'After setup, use Help (?) anytime to replay this tour or toggle UI tips.',
    preview: 'welcome',
  },
  {
    id: 'dashboard', icon: 'dashboard', route: '#/dashboard',
    title: 'Dashboard',
    desc: 'Start here every morning — KPIs, recent handovers, EOL warnings, scheduled onboardings and license / stock alerts.',
    bullets: [
      'Asset counts by status (In Stock, Assigned, Reserved, Repair…)',
      'Scheduled onboarding card when start dates are coming up',
      'Expiring licenses, low consumables and bell notifications',
    ],
    tip: 'Open Notifications (bell) for due / upcoming onboardings and the same alerts from any page.',
    preview: 'dashboard',
  },
  {
    id: 'hardware', icon: 'devices', route: '#/assets',
    title: 'Hardware Inventory',
    desc: 'The live register of every personal device — laptops, monitors, phones and more.',
    bullets: [
      'Auto sequential asset tags + QR / barcode labels',
      'Filters: status (incl. Reserved / Sold), location, category, lifecycle (EOL)',
      'Bulk return, repair, labels — and Excel/CSV import',
    ],
    tip: 'Use the sidebar “New Asset” button for the fastest add.',
    preview: 'hardware',
  },
  {
    id: 'network', icon: 'dns', route: '#/network',
    title: 'Network & Server',
    desc: 'Infra appliances with site owners, rack placement, firmware and linked licenses — separate from personal zimmet.',
    bullets: [
      'Network / Server category with responsible person (not personal handover)',
      'Rack, U-slot, management IP and firmware tracking',
      'Topology-style view and parent / child relationships',
    ],
    tip: 'Infra devices cannot be marked Sold — dispose via repair/scrap or reassignment flows.',
    preview: 'network',
  },
  {
    id: 'catalog', icon: 'category', route: '#/catalog',
    title: 'Product Catalog',
    desc: 'Central lists that feed every form — brands aren’t free-typed chaos.',
    bullets: [
      'Categories with default lifecycle months',
      'CPU / RAM / Storage option lists',
      'Locations, departments and provider / contract categories',
    ],
    tip: 'Update catalog first if you want clean dropdowns on new assets and contracts.',
    preview: 'catalog',
  },
  {
    id: 'employees', icon: 'badge', route: '#/employees',
    title: 'Employees',
    desc: 'Who holds what — plus schedule new-hire onboarding and structured offboarding.',
    bullets: [
      'Onboard: pick start date, reserve In Stock gear as Reserved',
      'Start-day reminder (bell + once-per-day modal) → print zimmet',
      'Offboard dispositions (return / transfer / scrap / sell) with notes archive',
    ],
    tip: 'Use Onboard on the Employees page before day one — add more devices on the start day if needed.',
    preview: 'employees',
  },
  {
    id: 'handover', icon: 'assignment_turned_in', route: '#/handover',
    title: 'Handover (Zimmet)',
    desc: 'Atomic basket: pick an employee, add hardware and/or mobile lines, confirm — print or download PDF.',
    bullets: [
      'Single or separate documents per item',
      'Accepts Reserved gear when completing a scheduled onboarding',
      'Multiple visual zimmet designs and editable print preview',
    ],
    tip: 'Choose the form design in Settings — or switch it in the print dialog.',
    preview: 'handover',
  },
  {
    id: 'licenses', icon: 'workspace_premium', route: '#/licenses',
    title: 'Software & Licenses',
    desc: 'Seat pools with assign / revoke — software zimmet next to hardware.',
    bullets: [
      'Total vs used seats, atomic claim',
      'Assign from the employee detail or license screen',
      '30-day expiry alerts on the dashboard',
    ],
    tip: 'Revoking a seat frees it immediately for someone else.',
    preview: 'licenses',
  },
  {
    id: 'lines', icon: 'sim_card', route: '#/lines',
    title: 'Mobile Lines',
    desc: 'Company SIMs and phone numbers — assignable like devices, reservable for onboarding, listed on zimmet forms.',
    bullets: [
      'Operator, plan, SIM serial, monthly cost (app currency)',
      'Assign / take-back with history; reserve for a future hire',
      'Add free lines into the handover basket',
    ],
    tip: 'Only Active + unassigned lines appear in the zimmet basket.',
    preview: 'lines',
  },
  {
    id: 'providers', icon: 'apartment', route: '#/providers',
    title: 'Providers & Contracts',
    desc: 'Company vendors, ISPs and MSPs — contacts, support lines, contracts and attached documents.',
    bullets: [
      'Primary + support contacts; http(s) website / portal links',
      'Contracts with term, cost, currency per deal, auto-renew and owner',
      'Upload signed PDFs / invoices; expiring ≤60 days callouts',
    ],
    tip: 'Default currency is set in Settings; each contract can still use USD / EUR / etc.',
    preview: 'providers',
  },
  {
    id: 'consumables', icon: 'inventory_2', route: '#/consumables',
    title: 'Consumables',
    desc: 'Toner, cables, adapters — stock levels with minimum alerts.',
    bullets: [
      'Track quantity and reorder threshold',
      'Low-stock chips on the dashboard',
      'Simple adjustments without full asset tagging',
    ],
    tip: 'Set minimum stock so the bell icon warns you before you run out.',
    preview: 'consumables',
  },
  {
    id: 'maintenance', icon: 'build', route: '#/maintenance',
    title: 'Maintenance & Repair',
    desc: 'Send a device to service, add progress notes, return or scrap — with paperwork attached.',
    bullets: [
      'Repair state restores previous assignment when possible',
      'Notes land in the device history; costs use app currency',
      'Attach invoices / photos to the repair log',
    ],
    tip: 'Start a repair from the asset row — not only from this screen.',
    preview: 'maintenance',
  },
  {
    id: 'stockcount', icon: 'fact_check', route: '#/stockcount',
    title: 'Stock Count',
    desc: 'Physical inventory sessions — scan barcodes (camera or photo) and close against live stock.',
    bullets: [
      'Open a count, scan from any signed-in device',
      'Found / missing / unknown filters when closed',
      'Export filtered CSV of the result',
    ],
    tip: 'On phones, prefer continuous camera scan over rebuilding the page.',
    preview: 'stockcount',
  },
  {
    id: 'reports', icon: 'summarize', route: '#/reports',
    title: 'Reports',
    desc: 'Preset and custom reports — columns, filters, CSV export and letterhead print.',
    bullets: [
      'Ready-made presets for common IT questions',
      'Build your own from multiple data sources',
      'Export CSV for Excel or print with company branding',
    ],
    tip: 'Use presets first — then clone the idea into a custom report.',
    preview: 'reports',
  },
  {
    id: 'audit', icon: 'history', route: '#/audit',
    title: 'Audit Log',
    desc: 'Who changed what — system events for assets, handovers, onboardings, settings and more.',
    bullets: [
      'Filter by action, actor and time range',
      'Sensitive fields (passwords, tokens) are redacted',
      'Owner / Admin visibility for compliance reviews',
    ],
    tip: 'Open Audit after bulk imports or offboarding to confirm every write landed.',
    preview: 'audit',
  },
  {
    id: 'users', icon: 'vpn_key', route: '#/users',
    title: 'IT Users & Security',
    desc: 'Invite your team with the right role. Owner controls branding, zimmet designs and default currency.',
    bullets: [
      'Owner / Admin / Helpdesk / Viewer',
      'Settings: language, default currency, logo, label sizes',
      'Only Owner can change another Owner’s role',
    ],
    tip: 'Set default currency under Settings — contracts can still override per agreement.',
    preview: 'users',
  },
];

/* Localized copy for the onboarding tour, keyed by language → item id. Any
   language/field not present falls back to the English source in OB_TOUR. */
const OB_TOUR_I18N = {
  tr: {
  welcome: {
    title: 'IT Asset Control\'e hoş geldiniz',
    desc: 'Donanım, çalışan, zimmet, lisans, hat, tedarikçi, onarım ve stok sayımı için kendi sunucunuzda çalışan ITAM alanı — tam denetim iziyle.',
    bullets: [
      'Her şey tek uygulamada — dağınık Excel dosyaları yok',
      'Onboarding rezervasyonu, tedarikçi sözleşmeleri ve ağ envanteri dahil',
      'Roller, arama, para birimi ve uyarılar ilk günden hazır',
    ],
    tip: 'Kurulumdan sonra Yardım (?) ile bu turu tekrar oynatabilir veya ipuçlarını açıp kapatabilirsiniz.',
  },
  dashboard: {
    title: 'Panel',
    desc: 'Her sabah buradan başlayın — KPI\'lar, son zimmetler, EOL uyarıları, planlı onboarding ve lisans / stok bildirimleri.',
    bullets: [
      'Duruma göre varlık sayıları (Stokta, Zimmetli, Rezerve, Onarımda…)',
      'Yaklaşan başlangıç tarihlerinde planlı onboarding kartı',
      'Süresi dolan lisans, kritik sarf ve zil bildirimleri',
    ],
    tip: 'Bildirimler (zil) planlı / vadesi gelen onboarding ve aynı uyarıları her sayfadan gösterir.',
  },
  hardware: {
    title: 'Donanım Envanteri',
    desc: 'Kişisel cihazların canlı kaydı — dizüstü, monitör, telefon ve daha fazlası.',
    bullets: [
      'Otomatik sıralı varlık etiketleri + QR / barkod etiketleri',
      'Filtreler: durum (Rezerve / Satıldı dahil), konum, kategori, EOL',
      'Toplu iade, onarım, etiket — ve Excel/CSV içe aktarma',
    ],
    tip: 'En hızlı ekleme için kenar çubuğundaki "Yeni Cihaz" düğmesini kullanın.',
  },
  network: {
    title: 'Ağ ve Sunucu',
    desc: 'Altyapı cihazları — saha sorumlusu, rack, firmware ve bağlı lisanslar; kişisel zimmetten ayrı.',
    bullets: [
      'Network / Server kategorisi, sorumlu kişi (kişisel zimmet değil)',
      'Rack, U, yönetim IP ve firmware takibi',
      'Topoloji görünümü ve üst / alt ilişkiler',
    ],
    tip: 'Altyapı cihazları Satıldı yapılamaz — hurda / onarım veya yeniden atama kullanın.',
  },
  catalog: {
    title: 'Ürün Kataloğu',
    desc: 'Tüm formları besleyen merkezi listeler — marka/model serbest yazımıyla oluşan kaos yok.',
    bullets: [
      'Varsayılan yaşam süresi (ay) olan kategoriler',
      'CPU / RAM / Depolama seçenek listeleri',
      'Konum, departman ve tedarikçi / sözleşme kategorileri',
    ],
    tip: 'Yeni varlıklarda ve sözleşmelerde temiz açılır listeler için önce kataloğu güncelleyin.',
  },
  employees: {
    title: 'Çalışanlar',
    desc: 'Kimde ne var — ayrıca yeni işe alım onboarding’i ve yapılandırılmış offboarding.',
    bullets: [
      'Onboard: başlangıç tarihi seçin, stoktaki cihazları Rezerve edin',
      'Başlangıç günü hatırlatması (zil + günlük modal) → zimmet yazdırın',
      'Offboard tasfiyeleri (iade / transfer / hurda / satış) not arşiviyle',
    ],
    tip: 'İşe başlamadan önce Çalışanlar → Onboard kullanın; gerekirse başlangıç gününde cihaz ekleyin.',
  },
  handover: {
    title: 'Zimmet',
    desc: 'Atomik sepet: çalışanı seçin, donanım ve/veya mobil hat ekleyin, onaylayın — yazdırın veya PDF indirin.',
    bullets: [
      'Kalem başına tek veya ayrı belgeler',
      'Planlı onboarding tamamlanırken Rezerve cihazları kabul eder',
      'Birden çok görsel zimmet tasarımı ve düzenlenebilir önizleme',
    ],
    tip: 'Form tasarımını Ayarlar\'dan seçin — ya da yazdırma penceresinde değiştirin.',
  },
  licenses: {
    title: 'Yazılım ve Lisanslar',
    desc: 'Atama / geri alma ile koltuk havuzları — donanımın yanında yazılım zimmeti.',
    bullets: [
      'Toplam ve kullanılan koltuk, atomik tahsis',
      'Çalışan detayından veya lisans ekranından atama',
      'Panelde 30 gün kala süre uyarıları',
    ],
    tip: 'Bir koltuğu geri almak onu anında başkasına açar.',
  },
  lines: {
    title: 'Mobil Hatlar',
    desc: 'Kurumsal SIM ve numaralar — cihaz gibi atanır, onboarding için rezerve edilir, zimmette listelenir.',
    bullets: [
      'Operatör, tarife, SIM seri no, aylık maliyet (uygulama para birimi)',
      'Geçmişle atama / geri alma; gelecek işe alım için rezervasyon',
      'Boş hatları zimmet sepetine ekleyin',
    ],
    tip: 'Zimmet sepetinde yalnızca Aktif ve zimmetsiz hatlar görünür.',
  },
  providers: {
    title: 'Tedarikçiler ve Sözleşmeler',
    desc: 'ISP, MSP ve satıcılar — iletişim, destek, sözleşmeler ve ekli belgeler.',
    bullets: [
      'Birincil + destek kişileri; http(s) web / portal linkleri',
      'Süre, tutar, sözleşme başına para birimi, otomatik yenileme ve sahip',
      'İmzalı PDF / fatura yükleme; ≤60 gün kala yenileme uyarıları',
    ],
    tip: 'Varsayılan para birimi Ayarlar\'da; her sözleşme yine de USD / EUR kullanabilir.',
  },
  consumables: {
    title: 'Sarf Malzemeleri',
    desc: 'Toner, kablo, adaptör — kritik stok uyarılı stok seviyeleri.',
    bullets: [
      'Miktar ve yeniden sipariş eşiğini takip edin',
      'Panelde kritik stok rozetleri',
      'Tam varlık etiketlemesi olmadan basit düzeltmeler',
    ],
    tip: 'Minimum stok belirleyin; zil simgesi tükenmeden önce sizi uyarsın.',
  },
  maintenance: {
    title: 'Bakım ve Onarım',
    desc: 'Cihazı servise gönderin, ilerleme notu ekleyin, iade edin veya hurdaya ayırın — evrakıyla birlikte.',
    bullets: [
      'Onarım durumu, mümkünse önceki zimmeti geri yükler',
      'Notlar cihaz geçmişine düşer; maliyetler uygulama para biriminde',
      'Onarım kaydına fatura / fotoğraf ekleyin',
    ],
    tip: 'Onarımı yalnızca bu ekrandan değil, varlık satırından da başlatabilirsiniz.',
  },
  stockcount: {
    title: 'Stok Sayımı',
    desc: 'Fiziksel envanter oturumları — barkod tarayın (kamera veya fotoğraf) ve canlı stoğa karşı kapatın.',
    bullets: [
      'Bir sayım açın, oturum açan herhangi bir cihazdan tarayın',
      'Kapatınca bulunan / eksik / bilinmeyen filtreleri',
      'Sonucun filtrelenmiş CSV çıktısı',
    ],
    tip: 'Telefonlarda, sayfayı yeniden oluşturmak yerine sürekli kamera taramayı tercih edin.',
  },
  reports: {
    title: 'Raporlar',
    desc: 'Hazır ve özel raporlar — kolonlar, filtreler, CSV çıktısı ve antetli yazdırma.',
    bullets: [
      'Yaygın BT soruları için hazır şablonlar',
      'Birden çok veri kaynağından kendi raporunuzu oluşturun',
      'Excel için CSV çıktısı veya şirket markasıyla yazdırma',
    ],
    tip: 'Önce hazır şablonları kullanın — sonra fikri özel bir rapora kopyalayın.',
  },
  audit: {
    title: 'Denetim Kaydı',
    desc: 'Kim neyi değiştirdi — varlık, zimmet, onboarding, ayar ve diğer sistem olayları.',
    bullets: [
      'Eylem, aktör ve zaman aralığına göre filtreleyin',
      'Hassas alanlar (şifre, token) gizlenir',
      'Uyumluluk için Owner / Admin görünürlüğü',
    ],
    tip: 'Toplu içe aktarma veya offboarding sonrası Audit\'i açıp yazımları doğrulayın.',
  },
  users: {
    title: 'BT Kullanıcıları ve Güvenlik',
    desc: 'Ekibinizi doğru rolle davet edin. Marka, zimmet tasarımı ve varsayılan para birimini Owner yönetir.',
    bullets: [
      'Owner / Admin / Helpdesk / Viewer',
      'Ayarlar: dil, varsayılan para birimi, logo, etiket boyutları',
      'Owner rolünü yalnızca başka bir Owner değiştirebilir',
    ],
    tip: 'Varsayılan para birimini Ayarlar\'dan seçin — sözleşmeler yine de farklı para birimi kullanabilir.',
  },
  },
  de: {
    welcome: { title: 'Willkommen bei IT Asset Control', desc: 'Ihr selbst gehosteter ITAM-Arbeitsbereich für Hardware, Personen, Übergabebelege, Lizenzen, Rufnummern, Reparaturen und Inventuren — mit vollständigem Prüfprotokoll.', bullets: ['Alles in einer App — keine verstreuten Excel-Tabellen mehr', 'Druckbare Übergabeformulare in mehreren Designs', 'Rollen, Suche und Warnungen von Anfang an'], tip: 'Nach der Einrichtung können Sie diese Tour über Hilfe (?) erneut starten oder Tipps ein-/ausschalten.' },
    dashboard: { title: 'Übersicht', desc: 'Starten Sie jeden Morgen hier — KPIs, letzte Übergaben, EOL-Warnungen und Lizenz-/Bestandshinweise.', bullets: ['Gerätezahlen nach Status (Auf Lager, Zugewiesen, Reparatur…)', 'Ablaufende Lizenzen und niedrige Verbrauchsmaterialien', 'Direkt zu überfälligen Lebenszyklus-Geräten springen'], tip: 'Öffnen Sie die Benachrichtigungen (Glocke) für dieselben Warnungen auf jeder Seite.' },
    hardware: { title: 'Hardware-Inventar', desc: 'Das Live-Register aller Geräte — Laptops, Monitore, Telefone, Netzwerktechnik und mehr.', bullets: ['Automatische fortlaufende Asset-Tags + QR-/Barcode-Etiketten', 'Filter: Status, Standort, Kategorie, Lebenszyklus (EOL)', 'Sammel-Rückgabe, -Reparatur, -Etiketten — und Excel/CSV-Import'], tip: 'Nutzen Sie die Schaltfläche „Neues Gerät" in der Seitenleiste für die schnellste Erfassung.' },
    network: { title: 'Netzwerk & Server', desc: 'Infrastruktur-Geräte mit Standort-Owner, Rack, Firmware und verbundenen Lizenzen — getrennt von persönlicher Übergabe.', bullets: ['Kategorie Network/Server mit Verantwortlichem (keine persönliche Zimmet)', 'Rack, U, Management-IP und Firmware-Tracking', 'Topologie-Ansicht und Parent-/Child-Beziehungen'], tip: 'Infrastruktur kann nicht als Verkauft markiert werden.' },
    catalog: { title: 'Produktkatalog', desc: 'Zentrale Listen, die jedes Formular speisen — kein Chaos durch frei eingegebene Marken.', bullets: ['Kategorien mit Standard-Lebensdauer (Monate)', 'CPU-/RAM-/Speicher-Optionslisten', 'App-weit verwendete Standorte und Abteilungen'], tip: 'Aktualisieren Sie zuerst den Katalog für saubere Dropdowns bei neuen Assets.' },
    employees: { title: 'Mitarbeiter', desc: 'Wer was hat — Geräte, Softwareplätze, Rufnummern und unterschriebene Dokumente.', bullets: ['Mitarbeiterkarte mit aktiven Assets und Verlaufszeitachse', 'Übergabe erneut drucken oder aktuelles Zuweisungsformular erstellen', 'Unterschriebene PDF-/Foto-Scans ins Archiv hochladen'], tip: 'Öffnen Sie einen Mitarbeiter → Reiter Dokumente für erzeugte PDFs und Scans.' },
    handover: { title: 'Übergabe (Zimmet)', desc: 'Atomarer Korb: Mitarbeiter wählen, Hardware und/oder Rufnummern hinzufügen, bestätigen — drucken oder als PDF herunterladen.', bullets: ['Ein oder getrennte Dokumente pro Position', 'Mehrere visuelle Übergabe-Designs (Terminal, Classic…)', 'Optionaler Rückgabebereich und bearbeitbare Druckvorschau'], tip: 'Wählen Sie das Formulardesign in den Einstellungen — oder wechseln Sie es im Druckdialog.' },
    licenses: { title: 'Software & Lizenzen', desc: 'Platz-Pools mit Zuweisen/Entziehen — Software-Übergabe neben Hardware.', bullets: ['Gesamte vs. genutzte Plätze, atomare Zuweisung', 'Zuweisung aus Mitarbeiterdetail oder Lizenzansicht', '30-Tage-Ablaufwarnungen im Dashboard'], tip: 'Das Entziehen eines Platzes gibt ihn sofort für andere frei.' },
    lines: { title: 'Rufnummern', desc: 'Firmen-SIMs und Rufnummern — wie Geräte zuweisbar und auf Übergabeformularen aufgeführt.', bullets: ['Anbieter, Tarif, SIM-Seriennummer, monatliche Kosten', 'Zuweisen/Zurücknehmen mit Verlauf', 'Freie Rufnummern in den Übergabekorb legen'], tip: 'Nur aktive und nicht zugewiesene Rufnummern erscheinen im Übergabekorb.' },
    providers: { title: 'Anbieter & Verträge', desc: 'Firmenlieferanten, ISPs und MSPs — Kontakte, Support, Verträge und angehängte Dokumente.', bullets: ['Primär- und Supportkontakte; http(s)-Links', 'Verträge mit Laufzeit, Kosten, Währung, Auto-Verlängerung', 'PDF-/Rechnungs-Uploads; Ablauf ≤60 Tage'], tip: 'Standardwährung in den Einstellungen — Verträge können USD/EUR überschreiben.' },
    consumables: { title: 'Verbrauchsmaterial', desc: 'Toner, Kabel, Adapter — Bestände mit Mindestwarnungen.', bullets: ['Menge und Nachbestellschwelle verfolgen', 'Warnhinweise bei niedrigem Bestand im Dashboard', 'Einfache Anpassungen ohne vollständige Asset-Kennzeichnung'], tip: 'Legen Sie einen Mindestbestand fest, damit die Glocke vor dem Leerstand warnt.' },
    maintenance: { title: 'Wartung & Reparatur', desc: 'Gerät zur Reparatur senden, Fortschrittsnotizen hinzufügen, zurückgeben oder verschrotten — mit angehängten Belegen.', bullets: ['Reparaturstatus stellt die vorherige Zuweisung wenn möglich wieder her', 'Notizen landen im Geräteverlauf', 'Rechnungen/Fotos an das Reparaturprotokoll anhängen'], tip: 'Starten Sie eine Reparatur aus der Asset-Zeile — nicht nur über diesen Bildschirm.' },
    stockcount: { title: 'Inventur', desc: 'Physische Inventursitzungen — Barcodes scannen (Kamera oder Foto) und gegen den Live-Bestand abschließen.', bullets: ['Zählung öffnen, von jedem angemeldeten Gerät scannen', 'Gefunden-/Fehlt-/Unbekannt-Filter nach Abschluss', 'Gefiltertes CSV des Ergebnisses exportieren'], tip: 'Bevorzugen Sie auf Telefonen das kontinuierliche Kamera-Scannen.' },
    reports: { title: 'Berichte', desc: 'Vordefinierte und benutzerdefinierte Berichte — Spalten, Filter, CSV-Export und Briefkopfdruck.', bullets: ['Fertige Vorlagen für gängige IT-Fragen', 'Erstellen Sie eigene aus mehreren Datenquellen', 'CSV für Excel exportieren oder mit Firmenlogo drucken'], tip: 'Nutzen Sie zuerst Vorlagen — klonen Sie die Idee dann in einen eigenen Bericht.' },
    audit: { title: 'Audit-Protokoll', desc: 'Wer hat was geändert — Systemereignisse für Assets, Übergaben, Onboardings, Einstellungen und mehr.', bullets: ['Filter nach Aktion, Akteur und Zeitraum', 'Sensible Felder werden redigiert', 'Owner/Admin-Sicht für Compliance'], tip: 'Öffnen Sie Audit nach Imports oder Offboarding zur Kontrolle.' },
    users: { title: 'IT-Benutzer & Sicherheit', desc: 'Laden Sie Ihr Team mit der richtigen Rolle ein. Der Owner steuert Branding und Vorlagen.', bullets: ['Owner / Admin / Helpdesk / Viewer', 'Konten deaktivieren ohne Prüfverlauf zu verlieren', 'Gehärtete Standards: CSP, Ratenlimits, transaktionale Schreibvorgänge'], tip: 'Nur der Owner kann Einstellungen → Übergabe-Designs und Firmenlogo öffnen.' },
  },
  fr: {
    welcome: { title: 'Bienvenue dans IT Asset Control', desc: 'Votre espace ITAM auto-hébergé pour le matériel, les personnes, les documents de remise, les licences, les lignes, les réparations et les inventaires — avec une piste d\'audit complète.', bullets: ['Tout dans une seule app — fini les fichiers Excel éparpillés', 'Formulaires de remise imprimables avec plusieurs designs', 'Rôles, recherche et alertes dès le premier jour'], tip: 'Après la configuration, utilisez Aide (?) pour rejouer cette visite ou activer/désactiver les astuces.' },
    dashboard: { title: 'Tableau de bord', desc: 'Commencez ici chaque matin — indicateurs, dernières remises, alertes de fin de vie et de licences/stock.', bullets: ['Nombre d\'appareils par statut (En stock, Attribué, Réparation…)', 'Licences expirant et consommables faibles', 'Accédez directement aux appareils en fin de vie dépassée'], tip: 'Ouvrez les notifications (cloche) pour les mêmes alertes depuis n\'importe quelle page.' },
    hardware: { title: 'Inventaire matériel', desc: 'Le registre en direct de chaque appareil — ordinateurs, écrans, téléphones, équipements réseau et plus.', bullets: ['Étiquettes d\'actifs séquentielles automatiques + étiquettes QR/code-barres', 'Filtres : statut, emplacement, catégorie, cycle de vie (EOL)', 'Retour, réparation, étiquettes en masse — et import Excel/CSV'], tip: 'Utilisez le bouton « Nouvel actif » dans la barre latérale pour l\'ajout le plus rapide.' },
    network: { title: 'Réseau et serveurs', desc: 'Équipements d’infra avec responsable de site, rack, firmware et licences liées — séparés du zimmet personnel.', bullets: ['Catégorie Network/Server avec responsable (pas de remise personnelle)', 'Rack, U, IP de gestion et firmware', 'Vue topologie et relations parent/enfant'], tip: 'Les appareils d’infra ne peuvent pas être marqués Vendus.' },
    catalog: { title: 'Catalogue produits', desc: 'Listes centrales qui alimentent chaque formulaire — pas de chaos de marques saisies librement.', bullets: ['Catégories avec durée de vie par défaut (mois)', 'Listes d\'options CPU/RAM/Stockage', 'Emplacements et services utilisés dans toute l\'app'], tip: 'Mettez d\'abord le catalogue à jour pour des menus déroulants propres.' },
    employees: { title: 'Employés', desc: 'Qui détient quoi — appareils, licences logicielles, lignes mobiles et documents signés.', bullets: ['Fiche employé avec actifs actifs et chronologie', 'Réimprimer la remise ou générer un formulaire d\'attribution actuel', 'Téléverser des scans PDF/photo signés dans l\'archive'], tip: 'Ouvrez un employé → onglet Documents pour les PDF générés et les scans signés.' },
    handover: { title: 'Remise (Zimmet)', desc: 'Panier atomique : choisissez un employé, ajoutez du matériel et/ou des lignes, confirmez — imprimez ou téléchargez le PDF.', bullets: ['Un document unique ou séparé par article', 'Plusieurs designs visuels de remise (Terminal, Classic…)', 'Section de retour optionnelle et aperçu d\'impression modifiable'], tip: 'Choisissez le design du formulaire dans les Paramètres — ou changez-le dans la boîte d\'impression.' },
    licenses: { title: 'Logiciels et licences', desc: 'Pools de sièges avec attribution/révocation — remise logicielle à côté du matériel.', bullets: ['Sièges totaux vs utilisés, attribution atomique', 'Attribuer depuis la fiche employé ou l\'écran des licences', 'Alertes d\'expiration à 30 jours sur le tableau de bord'], tip: 'Révoquer un siège le libère immédiatement pour quelqu\'un d\'autre.' },
    lines: { title: 'Lignes mobiles', desc: 'SIM et numéros de l\'entreprise — attribuables comme des appareils et listés sur les formulaires de remise.', bullets: ['Opérateur, forfait, numéro de série SIM, coût mensuel', 'Attribuer/reprendre avec historique', 'Ajouter des lignes libres au panier de remise'], tip: 'Seules les lignes actives et non attribuées apparaissent dans le panier.' },
    providers: { title: 'Fournisseurs et contrats', desc: 'Fournisseurs, FAI et MSP — contacts, support, contrats et documents joints.', bullets: ['Contacts principal + support ; liens http(s)', 'Contrats avec durée, coût, devise, reconduction', 'PDF / factures ; échéances ≤60 jours'], tip: 'Devise par défaut dans Paramètres — chaque contrat peut utiliser USD/EUR.' },
    consumables: { title: 'Consommables', desc: 'Toner, câbles, adaptateurs — niveaux de stock avec alertes minimales.', bullets: ['Suivre la quantité et le seuil de réapprovisionnement', 'Puces de stock faible sur le tableau de bord', 'Ajustements simples sans étiquetage complet'], tip: 'Définissez un stock minimum pour que la cloche vous prévienne avant la rupture.' },
    maintenance: { title: 'Maintenance et réparation', desc: 'Envoyez un appareil en réparation, ajoutez des notes de suivi, retournez ou mettez au rebut — avec documents joints.', bullets: ['L\'état de réparation restaure l\'attribution précédente si possible', 'Les notes apparaissent dans l\'historique de l\'appareil', 'Joignez factures/photos au journal de réparation'], tip: 'Démarrez une réparation depuis la ligne de l\'actif — pas seulement depuis cet écran.' },
    stockcount: { title: 'Inventaire', desc: 'Sessions d\'inventaire physique — scannez les codes-barres (caméra ou photo) et clôturez face au stock en direct.', bullets: ['Ouvrez un comptage, scannez depuis tout appareil connecté', 'Filtres trouvé/manquant/inconnu à la clôture', 'Exportez le CSV filtré du résultat'], tip: 'Sur téléphone, préférez le scan caméra continu.' },
    reports: { title: 'Rapports', desc: 'Rapports prédéfinis et personnalisés — colonnes, filtres, export CSV et impression à en-tête.', bullets: ['Modèles prêts pour les questions IT courantes', 'Créez le vôtre à partir de plusieurs sources', 'Exportez en CSV pour Excel ou imprimez avec la marque'], tip: 'Utilisez d\'abord les modèles — puis clonez l\'idée dans un rapport personnalisé.' },
    audit: { title: 'Journal d’audit', desc: 'Qui a modifié quoi — événements pour actifs, remises, intégrations, paramètres, etc.', bullets: ['Filtrer par action, acteur et période', 'Champs sensibles caviardés', 'Visibilité Owner/Admin pour la conformité'], tip: 'Ouvrez Audit après un import ou un offboarding.' },
    users: { title: 'Utilisateurs IT et sécurité', desc: 'Invitez votre équipe avec le bon rôle. L\'Owner contrôle la marque et les modèles.', bullets: ['Owner / Admin / Helpdesk / Viewer', 'Désactivez des comptes sans perdre l\'historique d\'audit', 'Valeurs par défaut renforcées : CSP, limites de débit, écritures transactionnelles'], tip: 'Seul l\'Owner peut ouvrir Paramètres → designs de remise et logo.' },
  },
  es: {
    welcome: { title: 'Bienvenido a IT Asset Control', desc: 'Su espacio ITAM autoalojado para hardware, personas, documentos de entrega, licencias, líneas, reparaciones e inventarios — con auditoría completa.', bullets: ['Todo en una app — sin hojas de Excel dispersas', 'Formularios de entrega imprimibles con varios diseños', 'Roles, búsqueda y alertas desde el primer día'], tip: 'Tras la configuración, use Ayuda (?) para repetir este recorrido o activar/desactivar consejos.' },
    dashboard: { title: 'Panel', desc: 'Empiece aquí cada mañana — KPIs, últimas entregas, avisos de fin de vida y de licencias/stock.', bullets: ['Recuento de dispositivos por estado (En stock, Asignado, Reparación…)', 'Licencias por vencer y consumibles bajos', 'Vaya directo a dispositivos con ciclo de vida vencido'], tip: 'Abra Notificaciones (campana) para las mismas alertas desde cualquier página.' },
    hardware: { title: 'Inventario de hardware', desc: 'El registro en vivo de cada dispositivo — portátiles, monitores, teléfonos, equipos de red y más.', bullets: ['Etiquetas de activos secuenciales automáticas + etiquetas QR/código de barras', 'Filtros: estado, ubicación, categoría, ciclo de vida (EOL)', 'Devolución, reparación y etiquetas masivas — e importación Excel/CSV'], tip: 'Use el botón «Nuevo activo» en la barra lateral para añadir más rápido.' },
    network: { title: 'Red y servidores', desc: 'Aparatos de infra con responsable de sede, rack, firmware y licencias vinculadas — separados del zimmet personal.', bullets: ['Categoría Network/Server con responsable (no entrega personal)', 'Rack, U, IP de gestión y firmware', 'Vista de topología y relaciones padre/hijo'], tip: 'Los dispositivos de infra no se pueden marcar como Vendidos.' },
    catalog: { title: 'Catálogo de productos', desc: 'Listas centrales que alimentan cada formulario — sin caos de marcas escritas a mano.', bullets: ['Categorías con vida útil predeterminada (meses)', 'Listas de opciones de CPU/RAM/Almacenamiento', 'Ubicaciones y departamentos usados en toda la app'], tip: 'Actualice primero el catálogo para menús desplegables limpios.' },
    employees: { title: 'Empleados', desc: 'Quién tiene qué — dispositivos, puestos de software, líneas móviles y documentos firmados.', bullets: ['Ficha de empleado con activos activos y línea de tiempo', 'Reimprimir la entrega o generar un formulario de asignación actual', 'Suba escaneos PDF/foto firmados al archivo'], tip: 'Abra un empleado → pestaña Documentos para PDFs generados y escaneos.' },
    handover: { title: 'Entrega (Zimmet)', desc: 'Cesta atómica: elija un empleado, añada hardware y/o líneas, confirme — imprima o descargue PDF.', bullets: ['Documento único o separado por artículo', 'Varios diseños visuales de entrega (Terminal, Classic…)', 'Sección de devolución opcional y vista previa editable'], tip: 'Elija el diseño del formulario en Ajustes — o cámbielo en el diálogo de impresión.' },
    licenses: { title: 'Software y licencias', desc: 'Grupos de puestos con asignar/revocar — entrega de software junto al hardware.', bullets: ['Puestos totales vs usados, asignación atómica', 'Asignar desde el detalle del empleado o la pantalla de licencias', 'Alertas de vencimiento a 30 días en el panel'], tip: 'Revocar un puesto lo libera de inmediato para otra persona.' },
    lines: { title: 'Líneas móviles', desc: 'SIM y números de la empresa — asignables como dispositivos y listados en los formularios de entrega.', bullets: ['Operador, plan, número de serie SIM, coste mensual', 'Asignar/recuperar con historial', 'Añadir líneas libres a la cesta de entrega'], tip: 'Solo las líneas activas y sin asignar aparecen en la cesta.' },
    providers: { title: 'Proveedores y contratos', desc: 'Proveedores, ISP y MSP — contactos, soporte, contratos y documentos adjuntos.', bullets: ['Contactos principal + soporte; enlaces http(s)', 'Contratos con plazo, coste, moneda y autorrenovación', 'PDF/facturas; vencimientos ≤60 días'], tip: 'Moneda predeterminada en Ajustes — cada contrato puede usar USD/EUR.' },
    consumables: { title: 'Consumibles', desc: 'Tóner, cables, adaptadores — niveles de stock con alertas mínimas.', bullets: ['Seguir cantidad y umbral de reposición', 'Indicadores de stock bajo en el panel', 'Ajustes simples sin etiquetado completo'], tip: 'Establezca stock mínimo para que la campana avise antes de agotarse.' },
    maintenance: { title: 'Mantenimiento y reparación', desc: 'Envíe un dispositivo a servicio, añada notas de progreso, devuelva o deseche — con documentación adjunta.', bullets: ['El estado de reparación restaura la asignación previa si es posible', 'Las notas van al historial del dispositivo', 'Adjunte facturas/fotos al registro de reparación'], tip: 'Inicie una reparación desde la fila del activo — no solo desde esta pantalla.' },
    stockcount: { title: 'Recuento de stock', desc: 'Sesiones de inventario físico — escanee códigos (cámara o foto) y cierre contra el stock en vivo.', bullets: ['Abra un recuento, escanee desde cualquier dispositivo conectado', 'Filtros encontrado/faltante/desconocido al cerrar', 'Exporte el CSV filtrado del resultado'], tip: 'En móviles, prefiera el escaneo continuo con cámara.' },
    reports: { title: 'Informes', desc: 'Informes predefinidos y personalizados — columnas, filtros, exportación CSV e impresión con membrete.', bullets: ['Plantillas listas para preguntas comunes de TI', 'Cree el suyo desde varias fuentes de datos', 'Exporte CSV para Excel o imprima con la marca'], tip: 'Use primero las plantillas — luego clone la idea en un informe personalizado.' },
    audit: { title: 'Registro de auditoría', desc: 'Quién cambió qué — eventos de activos, entregas, onboarding, ajustes y más.', bullets: ['Filtrar por acción, actor y periodo', 'Campos sensibles redactados', 'Visibilidad Owner/Admin para cumplimiento'], tip: 'Abra Auditoría tras importaciones u offboarding.' },
    users: { title: 'Usuarios TI y seguridad', desc: 'Invite a su equipo con el rol correcto. El Owner controla marca y plantillas.', bullets: ['Owner / Admin / Helpdesk / Viewer', 'Desactive cuentas sin perder el historial de auditoría', 'Valores reforzados: CSP, límites de tasa, escrituras transaccionales'], tip: 'Solo el Owner puede abrir Ajustes → diseños de entrega y logo.' },
  },
  it: {
    welcome: { title: 'Benvenuto in IT Asset Control', desc: 'Il tuo spazio ITAM self-hosted per hardware, persone, documenti di consegna, licenze, linee, riparazioni e inventari — con audit trail completo.', bullets: ['Tutto in un\'app — niente più fogli Excel sparsi', 'Moduli di consegna stampabili con più design', 'Ruoli, ricerca e avvisi fin dal primo giorno'], tip: 'Dopo la configurazione, usa Aiuto (?) per rivedere questo tour o attivare/disattivare i suggerimenti.' },
    dashboard: { title: 'Pannello', desc: 'Inizia qui ogni mattina — KPI, ultime consegne, avvisi di fine vita e di licenze/scorte.', bullets: ['Conteggio dispositivi per stato (In stock, Assegnato, Riparazione…)', 'Licenze in scadenza e consumabili scarsi', 'Vai direttamente ai dispositivi a fine vita scaduti'], tip: 'Apri Notifiche (campana) per gli stessi avvisi da qualsiasi pagina.' },
    hardware: { title: 'Inventario hardware', desc: 'Il registro live di ogni dispositivo — laptop, monitor, telefoni, apparati di rete e altro.', bullets: ['Tag asset sequenziali automatici + etichette QR/codice a barre', 'Filtri: stato, sede, categoria, ciclo di vita (EOL)', 'Reso, riparazione, etichette in blocco — e import Excel/CSV'], tip: 'Usa il pulsante «Nuovo asset» nella barra laterale per l\'aggiunta più rapida.' },
    network: { title: 'Rete e server', desc: 'Apparecchi infra con responsabile di sede, rack, firmware e licenze collegate — separati dallo zimmet personale.', bullets: ['Categoria Network/Server con responsabile (non consegna personale)', 'Rack, U, IP di gestione e firmware', 'Vista topologia e relazioni parent/child'], tip: 'I dispositivi infra non possono essere segnati come Venduti.' },
    catalog: { title: 'Catalogo prodotti', desc: 'Elenchi centrali che alimentano ogni modulo — niente caos di marche digitate a mano.', bullets: ['Categorie con durata di vita predefinita (mesi)', 'Elenchi di opzioni CPU/RAM/Storage', 'Sedi e reparti usati in tutta l\'app'], tip: 'Aggiorna prima il catalogo per menu a discesa puliti.' },
    employees: { title: 'Dipendenti', desc: 'Chi ha cosa — dispositivi, postazioni software, linee mobili e documenti firmati.', bullets: ['Scheda dipendente con asset attivi e cronologia', 'Ristampa la consegna o genera un modulo di assegnazione attuale', 'Carica scansioni PDF/foto firmate nell\'archivio'], tip: 'Apri un dipendente → scheda Documenti per PDF generati e scansioni.' },
    handover: { title: 'Consegna (Zimmet)', desc: 'Carrello atomico: scegli un dipendente, aggiungi hardware e/o linee, conferma — stampa o scarica il PDF.', bullets: ['Documento unico o separato per articolo', 'Più design visivi di consegna (Terminal, Classic…)', 'Sezione di reso opzionale e anteprima di stampa modificabile'], tip: 'Scegli il design del modulo nelle Impostazioni — o cambialo nella finestra di stampa.' },
    licenses: { title: 'Software e licenze', desc: 'Pool di postazioni con assegna/revoca — consegna software accanto all\'hardware.', bullets: ['Postazioni totali vs usate, assegnazione atomica', 'Assegna dal dettaglio dipendente o dalla schermata licenze', 'Avvisi di scadenza a 30 giorni sul pannello'], tip: 'Revocare una postazione la libera subito per un altro.' },
    lines: { title: 'Linee mobili', desc: 'SIM e numeri aziendali — assegnabili come dispositivi ed elencati sui moduli di consegna.', bullets: ['Operatore, piano, seriale SIM, costo mensile', 'Assegna/riprendi con cronologia', 'Aggiungi linee libere al carrello di consegna'], tip: 'Solo le linee attive e non assegnate compaiono nel carrello.' },
    providers: { title: 'Fornitori e contratti', desc: 'Fornitori, ISP e MSP — contatti, supporto, contratti e documenti allegati.', bullets: ['Contatti primario + supporto; link http(s)', 'Contratti con durata, costo, valuta, rinnovo auto', 'PDF/fatture; scadenze ≤60 giorni'], tip: 'Valuta predefinita in Impostazioni — ogni contratto può usare USD/EUR.' },
    consumables: { title: 'Consumabili', desc: 'Toner, cavi, adattatori — livelli di scorta con avvisi minimi.', bullets: ['Traccia quantità e soglia di riordino', 'Indicatori di scorta bassa sul pannello', 'Regolazioni semplici senza etichettatura completa'], tip: 'Imposta una scorta minima così la campana ti avvisa prima dell\'esaurimento.' },
    maintenance: { title: 'Manutenzione e riparazione', desc: 'Invia un dispositivo in assistenza, aggiungi note di avanzamento, restituisci o rottama — con documenti allegati.', bullets: ['Lo stato di riparazione ripristina l\'assegnazione precedente se possibile', 'Le note finiscono nella cronologia del dispositivo', 'Allega fatture/foto al registro di riparazione'], tip: 'Avvia una riparazione dalla riga dell\'asset — non solo da questa schermata.' },
    stockcount: { title: 'Inventario', desc: 'Sessioni di inventario fisico — scansiona i codici (fotocamera o foto) e chiudi rispetto alle scorte live.', bullets: ['Apri un conteggio, scansiona da qualsiasi dispositivo connesso', 'Filtri trovato/mancante/sconosciuto alla chiusura', 'Esporta il CSV filtrato del risultato'], tip: 'Su telefono, preferisci la scansione continua con fotocamera.' },
    reports: { title: 'Report', desc: 'Report predefiniti e personalizzati — colonne, filtri, export CSV e stampa intestata.', bullets: ['Modelli pronti per le domande IT comuni', 'Crea il tuo da più fonti dati', 'Esporta CSV per Excel o stampa con il marchio'], tip: 'Usa prima i modelli — poi clona l\'idea in un report personalizzato.' },
    audit: { title: 'Registro di audit', desc: 'Chi ha cambiato cosa — eventi su asset, consegne, onboarding, impostazioni e altro.', bullets: ['Filtra per azione, attore e intervallo', 'Campi sensibili redatti', 'Visibilità Owner/Admin per compliance'], tip: 'Apri Audit dopo import o offboarding.' },
    users: { title: 'Utenti IT e sicurezza', desc: 'Invita il team con il ruolo giusto. L\'Owner controlla brand e modelli.', bullets: ['Owner / Admin / Helpdesk / Viewer', 'Disattiva account senza perdere la cronologia di audit', 'Impostazioni rafforzate: CSP, limiti di frequenza, scritture transazionali'], tip: 'Solo l\'Owner può aprire Impostazioni → design di consegna e logo.' },
  },
  pt: {
    welcome: { title: 'Bem-vindo ao IT Asset Control', desc: 'Seu espaço ITAM auto-hospedado para hardware, pessoas, documentos de entrega, licenças, linhas, reparos e inventários — com trilha de auditoria completa.', bullets: ['Tudo em um app — sem planilhas de Excel espalhadas', 'Formulários de entrega imprimíveis com vários designs', 'Funções, busca e alertas desde o primeiro dia'], tip: 'Após a configuração, use Ajuda (?) para repetir este tour ou ativar/desativar dicas.' },
    dashboard: { title: 'Painel', desc: 'Comece aqui toda manhã — KPIs, últimas entregas, avisos de fim de vida e de licenças/estoque.', bullets: ['Contagem de dispositivos por status (Em estoque, Atribuído, Reparo…)', 'Licenças a vencer e consumíveis baixos', 'Vá direto para dispositivos com ciclo de vida vencido'], tip: 'Abra Notificações (sino) para os mesmos alertas em qualquer página.' },
    hardware: { title: 'Inventário de hardware', desc: 'O registro ao vivo de cada dispositivo — notebooks, monitores, telefones, equipamentos de rede e mais.', bullets: ['Etiquetas de ativo sequenciais automáticas + etiquetas QR/código de barras', 'Filtros: status, local, categoria, ciclo de vida (EOL)', 'Devolução, reparo e etiquetas em massa — e importação Excel/CSV'], tip: 'Use o botão «Novo ativo» na barra lateral para adicionar mais rápido.' },
    network: { title: 'Rede e servidores', desc: 'Aparelhos de infra com responsável do site, rack, firmware e licenças vinculadas — separados do zimmet pessoal.', bullets: ['Categoria Network/Server com responsável (não entrega pessoal)', 'Rack, U, IP de gestão e firmware', 'Vista de topologia e relações pai/filho'], tip: 'Dispositivos de infra não podem ser marcados como Vendidos.' },
    catalog: { title: 'Catálogo de produtos', desc: 'Listas centrais que alimentam cada formulário — sem caos de marcas digitadas à mão.', bullets: ['Categorias com vida útil padrão (meses)', 'Listas de opções de CPU/RAM/Armazenamento', 'Locais e departamentos usados em todo o app'], tip: 'Atualize o catálogo primeiro para menus suspensos limpos.' },
    employees: { title: 'Funcionários', desc: 'Quem tem o quê — dispositivos, licenças de software, linhas móveis e documentos assinados.', bullets: ['Cartão do funcionário com ativos ativos e linha do tempo', 'Reimprima a entrega ou gere um formulário de atribuição atual', 'Envie digitalizações PDF/foto assinadas para o arquivo'], tip: 'Abra um funcionário → aba Documentos para PDFs gerados e digitalizações.' },
    handover: { title: 'Entrega (Zimmet)', desc: 'Cesta atômica: escolha um funcionário, adicione hardware e/ou linhas, confirme — imprima ou baixe o PDF.', bullets: ['Documento único ou separado por item', 'Vários designs visuais de entrega (Terminal, Classic…)', 'Seção de devolução opcional e pré-visualização editável'], tip: 'Escolha o design do formulário nas Configurações — ou troque na caixa de impressão.' },
    licenses: { title: 'Software e licenças', desc: 'Pools de assentos com atribuir/revogar — entrega de software ao lado do hardware.', bullets: ['Assentos totais vs usados, atribuição atômica', 'Atribua pelo detalhe do funcionário ou tela de licenças', 'Alertas de expiração de 30 dias no painel'], tip: 'Revogar um assento o libera imediatamente para outra pessoa.' },
    lines: { title: 'Linhas móveis', desc: 'SIMs e números da empresa — atribuíveis como dispositivos e listados nos formulários de entrega.', bullets: ['Operadora, plano, série do SIM, custo mensal', 'Atribua/retome com histórico', 'Adicione linhas livres à cesta de entrega'], tip: 'Apenas linhas ativas e não atribuídas aparecem na cesta.' },
    providers: { title: 'Fornecedores e contratos', desc: 'Fornecedores, ISPs e MSPs — contatos, suporte, contratos e documentos anexos.', bullets: ['Contatos principal + suporte; links http(s)', 'Contratos com prazo, custo, moeda e renovação', 'PDF/faturas; vencimentos ≤60 dias'], tip: 'Moeda padrão em Configurações — cada contrato ainda pode usar USD/EUR.' },
    consumables: { title: 'Consumíveis', desc: 'Toner, cabos, adaptadores — níveis de estoque com alertas mínimos.', bullets: ['Acompanhe quantidade e limite de reposição', 'Selos de estoque baixo no painel', 'Ajustes simples sem etiquetagem completa'], tip: 'Defina estoque mínimo para o sino avisar antes de acabar.' },
    maintenance: { title: 'Manutenção e reparo', desc: 'Envie um dispositivo para assistência, adicione notas de progresso, devolva ou descarte — com documentação anexada.', bullets: ['O estado de reparo restaura a atribuição anterior quando possível', 'As notas vão para o histórico do dispositivo', 'Anexe faturas/fotos ao registro de reparo'], tip: 'Inicie um reparo pela linha do ativo — não apenas por esta tela.' },
    stockcount: { title: 'Contagem de estoque', desc: 'Sessões de inventário físico — escaneie códigos (câmera ou foto) e feche contra o estoque ao vivo.', bullets: ['Abra uma contagem, escaneie de qualquer dispositivo conectado', 'Filtros encontrado/faltante/desconhecido ao fechar', 'Exporte o CSV filtrado do resultado'], tip: 'Em celulares, prefira a leitura contínua por câmera.' },
    reports: { title: 'Relatórios', desc: 'Relatórios predefinidos e personalizados — colunas, filtros, exportação CSV e impressão com timbre.', bullets: ['Modelos prontos para perguntas comuns de TI', 'Crie o seu a partir de várias fontes de dados', 'Exporte CSV para Excel ou imprima com a marca'], tip: 'Use primeiro os modelos — depois clone a ideia em um relatório personalizado.' },
    audit: { title: 'Registro de auditoria', desc: 'Quem alterou o quê — eventos de ativos, entregas, onboarding, configurações e mais.', bullets: ['Filtrar por ação, ator e período', 'Campos sensíveis redactados', 'Visibilidade Owner/Admin para conformidade'], tip: 'Abra Auditoria após importações ou offboarding.' },
    users: { title: 'Usuários de TI e segurança', desc: 'Convide sua equipe com a função certa. O Owner controla marca e modelos.', bullets: ['Owner / Admin / Helpdesk / Viewer', 'Desative contas sem perder o histórico de auditoria', 'Padrões reforçados: CSP, limites de taxa, gravações transacionais'], tip: 'Somente o Owner pode abrir Configurações → designs de entrega e logo.' },
  },
  nl: {
    welcome: { title: 'Welkom bij IT Asset Control', desc: 'Je zelf-gehoste ITAM-werkruimte voor hardware, personen, overdrachtsdocumenten, licenties, lijnen, reparaties en tellingen — met volledig audittraject.', bullets: ['Alles in één app — geen verspreide Excel-bestanden meer', 'Afdrukbare overdrachtsformulieren met meerdere ontwerpen', 'Rollen, zoeken en meldingen vanaf dag één'], tip: 'Gebruik na de installatie Help (?) om deze rondleiding opnieuw te bekijken of tips aan/uit te zetten.' },
    dashboard: { title: 'Dashboard', desc: 'Begin hier elke ochtend — KPI\'s, recente overdrachten, EOL-waarschuwingen en licentie-/voorraadmeldingen.', bullets: ['Aantal apparaten per status (Op voorraad, Toegewezen, Reparatie…)', 'Verlopende licenties en lage verbruiksartikelen', 'Ga direct naar verlopen levenscyclusapparaten'], tip: 'Open Meldingen (bel) voor dezelfde waarschuwingen op elke pagina.' },
    hardware: { title: 'Hardware-inventaris', desc: 'Het live register van elk apparaat — laptops, monitoren, telefoons, netwerkapparatuur en meer.', bullets: ['Automatische opeenvolgende asset-tags + QR-/barcode-labels', 'Filters: status, locatie, categorie, levenscyclus (EOL)', 'Bulk retour, reparatie, labels — en Excel/CSV-import'], tip: 'Gebruik de knop «Nieuw item» in de zijbalk voor de snelste toevoeging.' },
    network: { title: 'Netwerk & server', desc: 'Infra-apparaten met site-eigenaar, rack, firmware en gekoppelde licenties — los van persoonlijke zimmet.', bullets: ['Categorie Network/Server met verantwoordelijke (geen persoonlijke overdracht)', 'Rack, U, management-IP en firmware', 'Topologieweergave en parent/child-relaties'], tip: 'Infra kan niet als Verkocht worden gemarkeerd.' },
    catalog: { title: 'Productcatalogus', desc: 'Centrale lijsten die elk formulier voeden — geen chaos van vrij getypte merken.', bullets: ['Categorieën met standaard levensduur (maanden)', 'CPU-/RAM-/opslag-optielijsten', 'Locaties en afdelingen die overal in de app worden gebruikt'], tip: 'Werk eerst de catalogus bij voor schone keuzelijsten.' },
    employees: { title: 'Medewerkers', desc: 'Wie heeft wat — apparaten, softwareplaatsen, mobiele lijnen en ondertekende documenten.', bullets: ['Medewerkerkaart met actieve items en tijdlijn', 'Overdracht opnieuw afdrukken of huidig toewijzingsformulier maken', 'Ondertekende PDF-/fotoscans uploaden naar het archief'], tip: 'Open een medewerker → tabblad Documenten voor gegenereerde PDF\'s en scans.' },
    handover: { title: 'Overdracht (Zimmet)', desc: 'Atomair mandje: kies een medewerker, voeg hardware en/of lijnen toe, bevestig — afdrukken of pdf downloaden.', bullets: ['Eén of aparte documenten per item', 'Meerdere visuele overdrachtsontwerpen (Terminal, Classic…)', 'Optionele retoursectie en bewerkbaar afdrukvoorbeeld'], tip: 'Kies het formulierontwerp in Instellingen — of wissel het in het afdrukvenster.' },
    licenses: { title: 'Software en licenties', desc: 'Zetel-pools met toewijzen/intrekken — softwareoverdracht naast hardware.', bullets: ['Totaal vs gebruikte zetels, atomaire toewijzing', 'Toewijzen vanuit medewerkerdetail of licentiescherm', 'Vervalmeldingen van 30 dagen op het dashboard'], tip: 'Een zetel intrekken maakt deze direct vrij voor iemand anders.' },
    lines: { title: 'Mobiele lijnen', desc: 'Bedrijfs-simkaarten en nummers — toewijsbaar als apparaten en vermeld op overdrachtsformulieren.', bullets: ['Provider, abonnement, simkaart-serienummer, maandkosten', 'Toewijzen/terugnemen met historie', 'Vrije lijnen toevoegen aan het overdrachtsmandje'], tip: 'Alleen actieve en niet-toegewezen lijnen verschijnen in het mandje.' },
    providers: { title: 'Leveranciers & contracten', desc: 'Leveranciers, ISP’s en MSP’s — contacten, support, contracten en bijlagen.', bullets: ['Primair + support; http(s)-links', 'Contracten met looptijd, kosten, valuta, auto-verlenging', 'PDF/facturen; verval ≤60 dagen'], tip: 'Standaardvaluta in Instellingen — contracten kunnen USD/EUR gebruiken.' },
    consumables: { title: 'Verbruiksartikelen', desc: 'Toner, kabels, adapters — voorraadniveaus met minimummeldingen.', bullets: ['Volg hoeveelheid en besteldrempel', 'Waarschuwingen voor lage voorraad op het dashboard', 'Eenvoudige aanpassingen zonder volledige labeling'], tip: 'Stel een minimumvoorraad in zodat de bel je waarschuwt voordat het op is.' },
    maintenance: { title: 'Onderhoud en reparatie', desc: 'Stuur een apparaat naar reparatie, voeg voortgangsnotities toe, retourneer of sloop — met bijgevoegde documenten.', bullets: ['Reparatiestatus herstelt indien mogelijk de vorige toewijzing', 'Notities komen in de apparaatgeschiedenis', 'Voeg facturen/foto\'s toe aan het reparatielogboek'], tip: 'Start een reparatie vanaf de itemrij — niet alleen vanaf dit scherm.' },
    stockcount: { title: 'Voorraadtelling', desc: 'Fysieke inventarisatiesessies — scan barcodes (camera of foto) en sluit af tegen de live voorraad.', bullets: ['Open een telling, scan vanaf elk aangemeld apparaat', 'Gevonden-/ontbrekend-/onbekend-filters bij afsluiten', 'Exporteer de gefilterde CSV van het resultaat'], tip: 'Geef op telefoons de voorkeur aan continu camerascannen.' },
    reports: { title: 'Rapporten', desc: 'Vooraf ingestelde en aangepaste rapporten — kolommen, filters, CSV-export en briefhoofdafdruk.', bullets: ['Kant-en-klare sjablonen voor veelvoorkomende IT-vragen', 'Bouw je eigen uit meerdere gegevensbronnen', 'Exporteer CSV voor Excel of druk af met bedrijfsmerk'], tip: 'Gebruik eerst sjablonen — kloon het idee daarna in een aangepast rapport.' },
    audit: { title: 'Auditlogboek', desc: 'Wie wijzigde wat — systeemevenementen voor assets, overdrachten, onboarding, instellingen en meer.', bullets: ['Filter op actie, actor en periode', 'Gevoelige velden geredigeerd', 'Owner/Admin-zicht voor compliance'], tip: 'Open Audit na imports of offboarding.' },
    users: { title: 'IT-gebruikers en beveiliging', desc: 'Nodig je team uit met de juiste rol. De Owner beheert branding en sjablonen.', bullets: ['Owner / Admin / Helpdesk / Viewer', 'Schakel accounts uit zonder audithistorie te verliezen', 'Verharde standaarden: CSP, snelheidslimieten, transactionele schrijfacties'], tip: 'Alleen de Owner kan Instellingen → overdrachtsontwerpen en logo openen.' },
  },
  pl: {
    welcome: { title: 'Witaj w IT Asset Control', desc: 'Twoja samodzielnie hostowana przestrzeń ITAM dla sprzętu, osób, dokumentów przekazania, licencji, linii, napraw i inwentaryzacji — z pełnym śladem audytu.', bullets: ['Wszystko w jednej aplikacji — koniec z rozproszonymi arkuszami Excel', 'Drukowalne formularze przekazania w wielu wzorach', 'Role, wyszukiwanie i alerty od pierwszego dnia'], tip: 'Po konfiguracji użyj Pomocy (?), aby ponownie odtworzyć ten przewodnik lub włączyć/wyłączyć wskazówki.' },
    dashboard: { title: 'Panel', desc: 'Zaczynaj tu każdego ranka — wskaźniki, ostatnie przekazania, ostrzeżenia EOL oraz alerty licencji/zapasów.', bullets: ['Liczba urządzeń wg statusu (W magazynie, Przypisane, Naprawa…)', 'Wygasające licencje i niskie materiały eksploatacyjne', 'Przejdź od razu do urządzeń po terminie EOL'], tip: 'Otwórz Powiadomienia (dzwonek), aby zobaczyć te same alerty z każdej strony.' },
    hardware: { title: 'Inwentarz sprzętu', desc: 'Aktualny rejestr każdego urządzenia — laptopy, monitory, telefony, sprzęt sieciowy i więcej.', bullets: ['Automatyczne sekwencyjne etykiety zasobów + etykiety QR/kod kreskowy', 'Filtry: status, lokalizacja, kategoria, cykl życia (EOL)', 'Zbiorczy zwrot, naprawa, etykiety — oraz import Excel/CSV'], tip: 'Użyj przycisku „Nowy zasób" na pasku bocznym, aby dodać najszybciej.' },
    network: { title: 'Sieć i serwery', desc: 'Urządzenia infra z właścicielem lokalizacji, szafą, firmware i powiązanymi licencjami — osobno od osobistego zimmet.', bullets: ['Kategoria Network/Server z odpowiedzialnym (bez osobistego przekazania)', 'Szafa, U, IP zarządzania i firmware', 'Widok topologii oraz relacje parent/child'], tip: 'Urządzeń infra nie można oznaczyć jako Sprzedane.' },
    catalog: { title: 'Katalog produktów', desc: 'Centralne listy zasilające każdy formularz — bez chaosu ręcznie wpisywanych marek.', bullets: ['Kategorie z domyślnym czasem życia (miesiące)', 'Listy opcji CPU/RAM/Dysk', 'Lokalizacje i działy używane w całej aplikacji'], tip: 'Najpierw zaktualizuj katalog, aby mieć czyste listy rozwijane.' },
    employees: { title: 'Pracownicy', desc: 'Kto co ma — urządzenia, stanowiska oprogramowania, linie komórkowe i podpisane dokumenty.', bullets: ['Karta pracownika z aktywnymi zasobami i osią czasu', 'Wydrukuj ponownie przekazanie lub wygeneruj bieżący formularz przydziału', 'Prześlij podpisane skany PDF/zdjęcia do archiwum'], tip: 'Otwórz pracownika → zakładka Dokumenty dla wygenerowanych PDF i skanów.' },
    handover: { title: 'Przekazanie (Zimmet)', desc: 'Atomowy koszyk: wybierz pracownika, dodaj sprzęt i/lub linie, potwierdź — drukuj lub pobierz PDF.', bullets: ['Jeden lub osobne dokumenty na pozycję', 'Wiele wzorów wizualnych przekazania (Terminal, Classic…)', 'Opcjonalna sekcja zwrotu i edytowalny podgląd wydruku'], tip: 'Wybierz wzór formularza w Ustawieniach — lub zmień go w oknie drukowania.' },
    licenses: { title: 'Oprogramowanie i licencje', desc: 'Pule stanowisk z przypisz/cofnij — przekazanie oprogramowania obok sprzętu.', bullets: ['Stanowiska łącznie vs użyte, atomowe przypisanie', 'Przypisz z detalu pracownika lub ekranu licencji', '30-dniowe alerty wygaśnięcia na panelu'], tip: 'Cofnięcie stanowiska natychmiast zwalnia je dla kogoś innego.' },
    lines: { title: 'Linie komórkowe', desc: 'Firmowe karty SIM i numery — przypisywalne jak urządzenia i wymienione na formularzach przekazania.', bullets: ['Operator, taryfa, numer seryjny SIM, koszt miesięczny', 'Przypisz/odbierz z historią', 'Dodaj wolne linie do koszyka przekazania'], tip: 'W koszyku pojawiają się tylko aktywne i nieprzypisane linie.' },
    providers: { title: 'Dostawcy i umowy', desc: 'Dostawcy, ISP i MSP — kontakty, wsparcie, umowy i załączniki.', bullets: ['Kontakt główny + support; linki http(s)', 'Umowy z terminem, kosztem, walutą, auto-odnowieniem', 'PDF/faktury; terminy ≤60 dni'], tip: 'Domyślna waluta w Ustawieniach — umowa może użyć USD/EUR.' },
    consumables: { title: 'Materiały eksploatacyjne', desc: 'Toner, kable, adaptery — poziomy zapasów z alertami minimalnymi.', bullets: ['Śledź ilość i próg ponownego zamówienia', 'Oznaczenia niskiego stanu na panelu', 'Proste korekty bez pełnego etykietowania'], tip: 'Ustaw minimalny stan, aby dzwonek ostrzegł przed wyczerpaniem.' },
    maintenance: { title: 'Konserwacja i naprawa', desc: 'Wyślij urządzenie do serwisu, dodaj notatki postępu, zwróć lub zezłomuj — z załączoną dokumentacją.', bullets: ['Stan naprawy przywraca poprzedni przydział, gdy to możliwe', 'Notatki trafiają do historii urządzenia', 'Załącz faktury/zdjęcia do dziennika napraw'], tip: 'Rozpocznij naprawę z wiersza zasobu — nie tylko z tego ekranu.' },
    stockcount: { title: 'Inwentaryzacja', desc: 'Sesje inwentaryzacji fizycznej — skanuj kody (aparat lub zdjęcie) i zamknij wobec bieżącego stanu.', bullets: ['Otwórz spis, skanuj z dowolnego zalogowanego urządzenia', 'Filtry znalezione/brakujące/nieznane po zamknięciu', 'Eksportuj przefiltrowany CSV wyniku'], tip: 'Na telefonach preferuj ciągłe skanowanie aparatem.' },
    reports: { title: 'Raporty', desc: 'Gotowe i niestandardowe raporty — kolumny, filtry, eksport CSV i wydruk z papierem firmowym.', bullets: ['Gotowe szablony dla typowych pytań IT', 'Zbuduj własny z wielu źródeł danych', 'Eksportuj CSV do Excela lub drukuj z marką'], tip: 'Najpierw użyj szablonów — potem sklonuj pomysł do raportu niestandardowego.' },
    audit: { title: 'Dziennik audytu', desc: 'Kto co zmienił — zdarzenia zasobów, przekazań, onboardingu, ustawień i innych.', bullets: ['Filtruj wg akcji, aktora i czasu', 'Wrażliwe pola zredagowane', 'Widoczność Owner/Admin'], tip: 'Otwórz Audyt po importach lub offboardingu.' },
    users: { title: 'Użytkownicy IT i bezpieczeństwo', desc: 'Zaproś zespół z właściwą rolą. Owner kontroluje markę i szablony.', bullets: ['Owner / Admin / Helpdesk / Viewer', 'Wyłączaj konta bez utraty historii audytu', 'Wzmocnione domyślne: CSP, limity zapytań, zapisy transakcyjne'], tip: 'Tylko Owner może otworzyć Ustawienia → wzory przekazania i logo.' },
  },
  ru: {
    welcome: { title: 'Добро пожаловать в IT Asset Control', desc: 'Ваше локальное ITAM-пространство для оборудования, сотрудников, актов передачи, лицензий, линий, ремонтов и инвентаризаций — с полным журналом аудита.', bullets: ['Всё в одном приложении — больше никаких разрозненных таблиц Excel', 'Печатные акты передачи с несколькими дизайнами', 'Роли, поиск и оповещения с первого дня'], tip: 'После настройки используйте Помощь (?), чтобы повторить тур или включить/выключить подсказки.' },
    dashboard: { title: 'Панель', desc: 'Начинайте каждое утро отсюда — KPI, последние передачи, предупреждения EOL и лицензий/запасов.', bullets: ['Количество устройств по статусу (На складе, Назначено, Ремонт…)', 'Истекающие лицензии и низкие расходники', 'Переходите сразу к устройствам с истёкшим сроком службы'], tip: 'Откройте Уведомления (колокол), чтобы видеть те же оповещения с любой страницы.' },
    hardware: { title: 'Инвентарь оборудования', desc: 'Живой реестр каждого устройства — ноутбуки, мониторы, телефоны, сетевое оборудование и другое.', bullets: ['Автоматические последовательные метки + QR/штрихкод-этикетки', 'Фильтры: статус, местоположение, категория, срок службы (EOL)', 'Массовый возврат, ремонт, этикетки — и импорт Excel/CSV'], tip: 'Используйте кнопку «Новый актив» на боковой панели для быстрого добавления.' },
    network: { title: 'Сеть и серверы', desc: 'Инфраструктура с ответственным за площадку, стойкой, прошивкой и связанными лицензиями — отдельно от личного zimmet.', bullets: ['Категория Network/Server с ответственным (не личная выдача)', 'Стойка, U, IP управления и прошивка', 'Топология и связи parent/child'], tip: 'Инфраструктуру нельзя пометить как Продано.' },
    catalog: { title: 'Каталог продуктов', desc: 'Центральные списки, питающие каждую форму — без хаоса вручную введённых брендов.', bullets: ['Категории со сроком службы по умолчанию (месяцы)', 'Списки вариантов CPU/RAM/накопителя', 'Локации и отделы, используемые во всём приложении'], tip: 'Сначала обновите каталог для чистых выпадающих списков.' },
    employees: { title: 'Сотрудники', desc: 'У кого что — устройства, места ПО, мобильные линии и подписанные документы.', bullets: ['Карточка сотрудника с активами и хронологией', 'Повторно печатайте передачу или создавайте текущую форму назначения', 'Загружайте подписанные PDF/фото-сканы в архив'], tip: 'Откройте сотрудника → вкладка Документы для созданных PDF и сканов.' },
    handover: { title: 'Передача (Zimmet)', desc: 'Атомарная корзина: выберите сотрудника, добавьте оборудование и/или линии, подтвердите — печать или PDF.', bullets: ['Один или отдельные документы на позицию', 'Несколько визуальных дизайнов передачи (Terminal, Classic…)', 'Опциональный раздел возврата и редактируемый предпросмотр'], tip: 'Выберите дизайн формы в Настройках — или смените его в диалоге печати.' },
    licenses: { title: 'ПО и лицензии', desc: 'Пулы мест с назначением/отзывом — передача ПО рядом с оборудованием.', bullets: ['Всего и использовано мест, атомарное назначение', 'Назначайте из карточки сотрудника или экрана лицензий', '30-дневные оповещения об истечении на панели'], tip: 'Отзыв места сразу освобождает его для другого.' },
    lines: { title: 'Мобильные линии', desc: 'Корпоративные SIM и номера — назначаются как устройства и указываются в формах передачи.', bullets: ['Оператор, тариф, серийный номер SIM, ежемесячная стоимость', 'Назначение/возврат с историей', 'Добавляйте свободные линии в корзину передачи'], tip: 'В корзине показываются только активные и неназначенные линии.' },
    providers: { title: 'Провайдеры и договоры', desc: 'Поставщики, ISP и MSP — контакты, поддержка, договоры и вложения.', bullets: ['Основной + support; ссылки http(s)', 'Договоры со сроком, суммой, валютой, автопродлением', 'PDF/счета; срок ≤60 дней'], tip: 'Валюта по умолчанию в Настройках — договор может быть в USD/EUR.' },
    consumables: { title: 'Расходные материалы', desc: 'Тонер, кабели, адаптеры — уровни запасов с оповещениями о минимуме.', bullets: ['Отслеживайте количество и порог дозаказа', 'Метки низкого запаса на панели', 'Простые корректировки без полной маркировки'], tip: 'Задайте минимальный запас, чтобы колокол предупреждал до исчерпания.' },
    maintenance: { title: 'Обслуживание и ремонт', desc: 'Отправьте устройство в сервис, добавьте заметки о ходе, верните или спишите — с приложенными документами.', bullets: ['Статус ремонта восстанавливает прежнее назначение, если возможно', 'Заметки попадают в историю устройства', 'Прикрепляйте счета/фото к журналу ремонта'], tip: 'Начинайте ремонт из строки актива — не только с этого экрана.' },
    stockcount: { title: 'Инвентаризация', desc: 'Сессии физической инвентаризации — сканируйте коды (камера или фото) и закрывайте по текущему остатку.', bullets: ['Откройте пересчёт, сканируйте с любого авторизованного устройства', 'Фильтры найдено/отсутствует/неизвестно при закрытии', 'Экспортируйте отфильтрованный CSV результата'], tip: 'На телефонах предпочитайте непрерывное сканирование камерой.' },
    reports: { title: 'Отчёты', desc: 'Готовые и настраиваемые отчёты — столбцы, фильтры, экспорт CSV и печать с фирменным бланком.', bullets: ['Готовые шаблоны для типовых ИТ-вопросов', 'Создавайте свои из нескольких источников данных', 'Экспортируйте CSV для Excel или печатайте с брендом'], tip: 'Сначала используйте шаблоны — затем клонируйте идею в свой отчёт.' },
    audit: { title: 'Журнал аудита', desc: 'Кто что изменил — события активов, выдач, онбординга, настроек и др.', bullets: ['Фильтр по действию, автору и периоду', 'Чувствительные поля скрыты', 'Видимость Owner/Admin'], tip: 'Откройте Аудит после импорта или офбординга.' },
    users: { title: 'ИТ-пользователи и безопасность', desc: 'Приглашайте команду с нужной ролью. Owner управляет брендингом и шаблонами.', bullets: ['Owner / Admin / Helpdesk / Viewer', 'Отключайте учётные записи без потери истории аудита', 'Усиленные умолчания: CSP, лимиты запросов, транзакционные записи'], tip: 'Только Owner может открыть Настройки → дизайны передачи и логотип.' },
  },
  ar: {
    welcome: { title: 'مرحبًا بك في IT Asset Control', desc: 'مساحة ITAM ذاتية الاستضافة للأجهزة والأشخاص ومستندات التسليم والتراخيص والخطوط والإصلاحات والجرد — مع سجل تدقيق كامل.', bullets: ['كل شيء في تطبيق واحد — لا مزيد من جداول Excel المبعثرة', 'نماذج تسليم قابلة للطباعة بتصاميم متعددة', 'الأدوار والبحث والتنبيهات منذ اليوم الأول'], tip: 'بعد الإعداد، استخدم المساعدة (?) لإعادة تشغيل هذه الجولة أو تفعيل/إيقاف التلميحات.' },
    dashboard: { title: 'لوحة التحكم', desc: 'ابدأ من هنا كل صباح — المؤشرات، آخر عمليات التسليم، تنبيهات نهاية العمر والتراخيص/المخزون.', bullets: ['عدد الأجهزة حسب الحالة (في المخزون، مُسند، إصلاح…)', 'التراخيص المنتهية والمستهلكات المنخفضة', 'انتقل مباشرة إلى الأجهزة المتأخرة عن نهاية العمر'], tip: 'افتح الإشعارات (الجرس) للتنبيهات نفسها من أي صفحة.' },
    hardware: { title: 'مخزون الأجهزة', desc: 'السجل الحي لكل جهاز — حواسيب محمولة وشاشات وهواتف ومعدات شبكة والمزيد.', bullets: ['وسوم أصول تسلسلية تلقائية + ملصقات QR/باركود', 'عوامل تصفية: الحالة، الموقع، الفئة، دورة الحياة (EOL)', 'إرجاع وإصلاح وملصقات جماعية — واستيراد Excel/CSV'], tip: 'استخدم زر «أصل جديد» في الشريط الجانبي لأسرع إضافة.' },
    network: { title: 'الشبكة والخوادم', desc: 'أجهزة البنية مع مسؤول الموقع والرف والبرنامج الثابت والتراخيص المرتبطة — منفصلة عن العهدة الشخصية.', bullets: ['فئة Network/Server مع مسؤول (ليست تسليمًا شخصيًا)', 'رف ووحدة U وIP الإدارة والبرنامج الثابت', 'عرض الطوبولوجيا وعلاقات الأصل/الفرع'], tip: 'لا يمكن تعليم أجهزة البنية كمباعة.' },
    catalog: { title: 'كتالوج المنتجات', desc: 'قوائم مركزية تغذّي كل نموذج — دون فوضى العلامات المكتوبة يدويًا.', bullets: ['فئات بعمر افتراضي (بالأشهر)', 'قوائم خيارات المعالج/الذاكرة/التخزين', 'المواقع والأقسام المستخدمة في التطبيق'], tip: 'حدّث الكتالوج أولًا للحصول على قوائم منسدلة نظيفة.' },
    employees: { title: 'الموظفون', desc: 'من يملك ماذا — الأجهزة ومقاعد البرامج والخطوط والمستندات الموقعة.', bullets: ['بطاقة الموظف مع الأصول النشطة والخط الزمني', 'أعد طباعة التسليم أو أنشئ نموذج إسناد حالي', 'ارفع نسخ PDF/صور موقعة إلى الأرشيف'], tip: 'افتح موظفًا → علامة التبويب المستندات لملفات PDF المُنشأة والمسح الضوئي.' },
    handover: { title: 'التسليم (Zimmet)', desc: 'سلة ذرّية: اختر موظفًا، أضف أجهزة و/أو خطوطًا، أكّد — اطبع أو نزّل PDF.', bullets: ['مستند واحد أو منفصل لكل عنصر', 'تصاميم تسليم مرئية متعددة (Terminal، Classic…)', 'قسم إرجاع اختياري ومعاينة طباعة قابلة للتحرير'], tip: 'اختر تصميم النموذج في الإعدادات — أو بدّله في مربع الطباعة.' },
    licenses: { title: 'البرامج والتراخيص', desc: 'مجمعات مقاعد مع الإسناد/الإلغاء — تسليم البرامج بجانب الأجهزة.', bullets: ['إجمالي المقاعد مقابل المستخدمة، إسناد ذرّي', 'أسند من تفاصيل الموظف أو شاشة التراخيص', 'تنبيهات انتهاء خلال 30 يومًا على اللوحة'], tip: 'إلغاء مقعد يحرره فورًا لشخص آخر.' },
    lines: { title: 'الخطوط الجوالة', desc: 'شرائح وأرقام الشركة — قابلة للإسناد كالأجهزة ومدرجة في نماذج التسليم.', bullets: ['المشغّل، الباقة، الرقم التسلسلي للشريحة، التكلفة الشهرية', 'إسناد/استرجاع مع السجل', 'أضف خطوطًا حرة إلى سلة التسليم'], tip: 'تظهر في السلة الخطوط النشطة وغير المسندة فقط.' },
    providers: { title: 'الموردون والعقود', desc: 'الموردون ومزودو الخدمة — جهات اتصال ودعم وعقود ومستندات.', bullets: ['اتصال أساسي ودعم؛ روابط http(s)', 'عقود بالمدة والتكلفة والعملة والتجديد', 'PDF/فواتير؛ انتهاؤها خلال ≤60 يومًا'], tip: 'العملة الافتراضية في الإعدادات — يمكن للعقد استخدام USD/EUR.' },
    consumables: { title: 'المستهلكات', desc: 'الحبر والكابلات والمحولات — مستويات المخزون مع تنبيهات الحد الأدنى.', bullets: ['تتبّع الكمية وحد إعادة الطلب', 'شارات المخزون المنخفض على اللوحة', 'تعديلات بسيطة دون وسم كامل'], tip: 'حدد حدًا أدنى للمخزون لينبّهك الجرس قبل النفاد.' },
    maintenance: { title: 'الصيانة والإصلاح', desc: 'أرسل جهازًا للصيانة، أضف ملاحظات تقدّم، أعده أو اشطبه — مع إرفاق المستندات.', bullets: ['تعيد حالة الإصلاح الإسناد السابق عند الإمكان', 'تُسجّل الملاحظات في سجل الجهاز', 'أرفق الفواتير/الصور بسجل الإصلاح'], tip: 'ابدأ الإصلاح من صف الأصل — وليس فقط من هذه الشاشة.' },
    stockcount: { title: 'جرد المخزون', desc: 'جلسات جرد مادي — امسح الرموز (كاميرا أو صورة) وأغلق مقابل المخزون الحي.', bullets: ['افتح جردًا، امسح من أي جهاز مسجّل الدخول', 'عوامل تصفية موجود/مفقود/غير معروف عند الإغلاق', 'صدّر CSV مُصفّى للنتيجة'], tip: 'على الهواتف، يُفضّل المسح المستمر بالكاميرا.' },
    reports: { title: 'التقارير', desc: 'تقارير جاهزة ومخصصة — أعمدة وعوامل تصفية وتصدير CSV وطباعة بترويسة.', bullets: ['قوالب جاهزة للأسئلة الشائعة لتقنية المعلومات', 'أنشئ تقريرك من مصادر بيانات متعددة', 'صدّر CSV إلى Excel أو اطبع بالعلامة التجارية'], tip: 'استخدم القوالب أولًا — ثم استنسخ الفكرة في تقرير مخصص.' },
    audit: { title: 'سجل التدقيق', desc: 'من غيّر ماذا — أحداث الأصول والتسليم والتأهيل والإعدادات والمزيد.', bullets: ['تصفية حسب الإجراء والفاعل والفترة', 'حجب الحقول الحساسة', 'رؤية Owner/Admin للامتثال'], tip: 'افتح التدقيق بعد الاستيراد أو المغادرة.' },
    users: { title: 'مستخدمو تقنية المعلومات والأمان', desc: 'ادعُ فريقك بالدور المناسب. يتحكم Owner في العلامة والقوالب.', bullets: ['Owner / Admin / Helpdesk / Viewer', 'عطّل الحسابات دون فقدان سجل التدقيق', 'إعدادات معززة: CSP، حدود المعدل، كتابات معاملاتية'], tip: 'يمكن لـ Owner فقط فتح الإعدادات → تصاميم التسليم والشعار.' },
  },
  ja: {
    welcome: { title: 'IT Asset Control へようこそ', desc: 'ハードウェア、担当者、貸与書類、ライセンス、回線、修理、棚卸しのためのセルフホスト型 ITAM ワークスペース — 完全な監査証跡付き。', bullets: ['すべてが1つのアプリに — バラバラのExcelはもう不要', '複数のデザインで印刷可能な貸与書類', 'ロール・検索・アラートを初日から'], tip: 'セットアップ後は、ヘルプ (?) からこのツアーを再生したりヒントを切り替えたりできます。' },
    dashboard: { title: 'ダッシュボード', desc: '毎朝ここから — KPI、最近の貸与、EOL警告、ライセンス/在庫アラート。', bullets: ['ステータス別の資産数（在庫、割当済み、修理中…）', '期限切れ間近のライセンスと在庫僅少の消耗品', 'EOL超過の機器へ直接ジャンプ'], tip: '通知（ベル）を開くと、どのページからでも同じアラートを確認できます。' },
    hardware: { title: 'ハードウェア資産', desc: 'すべての機器のライブ台帳 — ノートPC、モニター、電話、ネットワーク機器など。', bullets: ['自動連番の資産タグ + QR/バーコードラベル', 'フィルター：ステータス、場所、カテゴリ、ライフサイクル（EOL）', '一括返却・修理・ラベル — および Excel/CSV インポート'], tip: 'サイドバーの「新規資産」ボタンで最速追加。' },
    network: { title: 'ネットワークとサーバー', desc: 'サイト責任者・ラック・ファームウェア・関連ライセンス付きのインフラ機器 — 個人貸与とは分離。', bullets: ['Network/Server カテゴリと責任者（個人貸与ではない）', 'ラック、U、管理IP、ファームウェア追跡', 'トポロジ表示と親子関係'], tip: 'インフラ機器は売却済みにできません。' },
    catalog: { title: '製品カタログ', desc: 'すべてのフォームを支える中央リスト — 手入力ブランドの混乱なし。', bullets: ['既定のライフサイクル（月数）付きカテゴリ', 'CPU/RAM/ストレージの選択肢リスト', 'アプリ全体で使う場所と部署'], tip: 'まずカタログを更新して、きれいなドロップダウンに。' },
    employees: { title: '従業員', desc: '誰が何を保有 — 機器、ソフトウェア席、モバイル回線、署名済み書類。', bullets: ['有効資産と履歴タイムライン付きの従業員カード', '貸与を再印刷、または現在の割当書類を生成', '署名済み PDF/写真スキャンをアーカイブへアップロード'], tip: '従業員を開く → 書類タブで生成PDFとスキャンを確認。' },
    handover: { title: '貸与 (Zimmet)', desc: 'アトミックなカゴ：従業員を選び、ハードや回線を追加、確定 — 印刷またはPDFダウンロード。', bullets: ['項目ごとに単一または個別の書類', '複数のビジュアル貸与デザイン（Terminal、Classic…）', '任意の返却セクションと編集可能な印刷プレビュー'], tip: 'フォームデザインは設定で選択 — または印刷ダイアログで切替。' },
    licenses: { title: 'ソフトウェアとライセンス', desc: '席プールで割当/取消 — ハードと並ぶソフト貸与。', bullets: ['総席数と使用席数、アトミックな割当', '従業員詳細またはライセンス画面から割当', 'ダッシュボードに30日前の期限アラート'], tip: '席を取り消すと即座に他の人へ解放されます。' },
    lines: { title: 'モバイル回線', desc: '会社のSIMと番号 — 機器のように割当でき、貸与書類に記載。', bullets: ['通信事業者、プラン、SIMシリアル、月額費用', '履歴付きで割当/回収', '空き回線を貸与カゴに追加'], tip: 'カゴには有効かつ未割当の回線のみ表示されます。' },
    providers: { title: 'プロバイダーと契約', desc: 'ベンダー・ISP・MSP — 連絡先、サポート、契約、添付書類。', bullets: ['主担当+サポート；http(s)リンク', '期間・金額・通貨・自動更新の契約', 'PDF/請求書；≤60日の期限'], tip: 'デフォルト通貨は設定 — 契約ごとにUSD/EURも可。' },
    consumables: { title: '消耗品', desc: 'トナー、ケーブル、アダプター — 最小アラート付きの在庫レベル。', bullets: ['数量と再発注しきい値を追跡', 'ダッシュボードの在庫僅少バッジ', '完全なタグ付けなしの簡単な調整'], tip: '最小在庫を設定すると、切れる前にベルが警告します。' },
    maintenance: { title: '保守と修理', desc: '機器を修理に出し、進捗メモを追加、返却または廃棄 — 書類添付付き。', bullets: ['修理状態は可能なら以前の割当を復元', 'メモは機器履歴に記録', '請求書/写真を修理ログに添付'], tip: '修理は資産の行から開始 — この画面だけではありません。' },
    stockcount: { title: '棚卸し', desc: '実地棚卸しセッション — バーコードをスキャン（カメラまたは写真）し、ライブ在庫に対して締め。', bullets: ['棚卸しを開き、サインイン済みの任意の端末からスキャン', '締め後に 発見/不足/不明 フィルター', '結果の絞り込みCSVをエクスポート'], tip: 'スマホでは連続カメラスキャンを推奨。' },
    reports: { title: 'レポート', desc: 'プリセットとカスタムのレポート — 列、フィルター、CSVエクスポート、レターヘッド印刷。', bullets: ['一般的なIT課題向けの既製プリセット', '複数のデータソースから自作', 'Excel用にCSV出力、または会社ブランドで印刷'], tip: 'まずプリセットを使用 — その後アイデアをカスタムレポートに複製。' },
    audit: { title: '監査ログ', desc: '誰が何を変更したか — 資産・貸与・オンボード・設定などのイベント。', bullets: ['操作・実行者・期間で絞り込み', '機密フィールドは伏字', 'Owner/Admin向けの可視化'], tip: 'インポートやオフボード後に監査を確認。' },
    users: { title: 'ITユーザーとセキュリティ', desc: '適切なロールでチームを招待。Owner がブランドとテンプレートを管理。', bullets: ['Owner / Admin / Helpdesk / Viewer', '監査履歴を失わずにアカウントを無効化', '強化された既定：CSP、レート制限、トランザクション書き込み'], tip: 'Owner のみが 設定 → 貸与デザインとロゴ を開けます。' },
  },
};

/** Resolve an OB_TOUR item in the active language (localized overrides, else English). */
function obItem(s) {
  const lang = (typeof i18nLang === 'function') ? i18nLang() : 'en';
  const map = OB_TOUR_I18N[lang];
  const loc = map && map[s.id];
  return loc ? { ...s, ...loc } : s;
}

function obPreviewHtml(kind) {
  const shell = (main) => `
    <div class="ob-mock" aria-hidden="true">
      <div class="ob-mock-side">
        <div class="ob-mock-logo"></div>
        <i></i><i></i><i class="on"></i><i></i><i></i>
      </div>
      <div class="ob-mock-main">${main}</div>
    </div>`;
  const map = {
    welcome: `
      <div class="ob-mock-hero">
        <strong>IT Asset Control Pro</strong>
        <span>Hardware · Network · Onboard · Vendors · Audit</span>
      </div>
      <div class="ob-mock-chips"><b></b><b></b><b></b><b></b></div>`,
    dashboard: `
      <div class="ob-mock-kpis"><b></b><b></b><b></b><b></b></div>
      <div class="ob-mock-row"></div><div class="ob-mock-row short"></div>
      <div class="ob-mock-alert"></div>`,
    hardware: `
      <div class="ob-mock-toolbar"><b></b><b></b><span></span></div>
      <div class="ob-mock-table"><i></i><i></i><i></i><i></i></div>`,
    network: `
      <div class="ob-mock-toolbar"><b></b><span></span></div>
      <div class="ob-mock-grid"><b></b><b></b><b></b><b></b></div>
      <div class="ob-mock-row short"></div>`,
    catalog: `
      <div class="ob-mock-grid"><b></b><b></b><b></b><b></b></div>
      <div class="ob-mock-row"></div>`,
    employees: `
      <div class="ob-mock-person"><span></span><div><b></b><i></i></div></div>
      <div class="ob-mock-tabs"><b class="on"></b><b></b><b></b></div>
      <div class="ob-mock-row"></div><div class="ob-mock-row short"></div>`,
    handover: `
      <div class="ob-mock-split">
        <div><div class="ob-mock-row"></div><div class="ob-mock-row"></div></div>
        <div class="ob-mock-basket"><b>Basket</b><i></i><i></i></div>
      </div>`,
    licenses: `
      <div class="ob-mock-toolbar"><b></b><span></span></div>
      <div class="ob-mock-seats"><b></b><b></b><b></b></div>`,
    lines: `
      <div class="ob-mock-table sim"><i></i><i></i><i></i></div>`,
    providers: `
      <div class="ob-mock-tabs"><b class="on"></b><b></b></div>
      <div class="ob-mock-person"><span></span><div><b></b><i></i></div></div>
      <div class="ob-mock-row"></div><div class="ob-mock-row short"></div>`,
    consumables: `
      <div class="ob-mock-kpis small"><b></b><b></b></div>
      <div class="ob-mock-row"></div><div class="ob-mock-row warn"></div>`,
    maintenance: `
      <div class="ob-mock-row"></div>
      <div class="ob-mock-note"></div>
      <div class="ob-mock-row short"></div>`,
    stockcount: `
      <div class="ob-mock-scan"><span></span></div>
      <div class="ob-mock-chips"><b></b><b></b><b></b></div>`,
    reports: `
      <div class="ob-mock-grid"><b></b><b></b><b></b></div>
      <div class="ob-mock-row"></div>`,
    audit: `
      <div class="ob-mock-toolbar"><b></b><b></b><span></span></div>
      <div class="ob-mock-table"><i></i><i></i><i></i><i></i></div>`,
    users: `
      <div class="ob-mock-person"><span></span><div><b></b><i></i></div></div>
      <div class="ob-mock-person"><span></span><div><b></b><i></i></div></div>`,
  };
  return shell(map[kind] || map.welcome);
}

let obStep = 0;

function renderTour() {
  const total = OB_TOUR.length + 1; // +1 for the setup step
  $('#ob-bar').style.width = `${(obStep / (total - 1)) * 100}%`;
  $('#ob-skip').style.display = obStep === OB_TOUR.length ? 'none' : '';
  const stepLabel = $('#ob-step-label');
  if (stepLabel) {
    stepLabel.textContent = obStep >= OB_TOUR.length
      ? `${t('ob.setup')} · ${total}/${total}`
      : `${obStep + 1} / ${total}`;
  }
  const skipBtn = $('#ob-skip');
  if (skipBtn) skipBtn.textContent = t('ob.skip');

  const setup = $('#ob-setup');
  const tour = $('#ob-tour');
  if (obStep >= OB_TOUR.length) {
    tour.classList.add('hidden');
    setup.classList.remove('hidden');
    renderObTplCards();
    return;
  }
  setup.classList.add('hidden');
  tour.classList.remove('hidden');

  const s = obItem(OB_TOUR[obStep]);
  const last = obStep === OB_TOUR.length - 1;
  tour.innerHTML = `
    <div class="ob-layout">
      <aside class="ob-rail" aria-label="Features">
        ${OB_TOUR.map((raw, i) => { const item = obItem(raw); return `
          <button type="button" class="ob-rail-item ${i === obStep ? 'on' : ''} ${i < obStep ? 'done' : ''}" data-dot="${i}">
            <span class="ms">${item.icon}</span>
            <span class="ob-rail-label">${esc(item.title.split('(')[0].trim())}</span>
          </button>`; }).join('')}
        <button type="button" class="ob-rail-item setup" data-dot="${OB_TOUR.length}">
          <span class="ms">rocket_launch</span>
          <span class="ob-rail-label">${esc(t('ob.setup'))}</span>
        </button>
      </aside>
      <div class="ob-slide ob-slide-rich">
        <span class="ob-slide-badge"><span class="ms ms-sm">${s.icon}</span> ${esc(s.title)}</span>
        <div class="ob-slide-grid">
          <div>
            <h2 class="ob-slide-title">${esc(s.title)}</h2>
            <p class="ob-slide-desc">${esc(s.desc)}</p>
            <ul class="ob-bullets">
              ${s.bullets.map((b) => `<li><span class="ms">check_circle</span> ${esc(b)}</li>`).join('')}
            </ul>
            ${s.tip ? `<div class="ob-tip-callout"><span class="ms">lightbulb</span> ${esc(s.tip)}</div>` : ''}
          </div>
          <div class="ob-preview-wrap">
            ${obPreviewHtml(s.preview)}
            <div class="ob-preview-caption">${esc(t('ob.preview'))}</div>
          </div>
        </div>
        <div class="ob-nav">
          <button type="button" class="btn btn-outline" id="ob-back" ${obStep === 0 ? 'disabled' : ''}>
            <span class="ms">arrow_back</span> ${esc(t('ob.back'))}</button>
          <button type="button" class="btn btn-primary" id="ob-next">
            ${last ? esc(t('ob.continueSetup')) : esc(t('ob.next'))} <span class="ms">arrow_forward</span></button>
        </div>
      </div>
    </div>`;

  $('#ob-back', tour).addEventListener('click', () => { if (obStep > 0) { obStep--; renderTour(); } });
  $('#ob-next', tour).addEventListener('click', () => { obStep++; renderTour(); });
  tour.querySelectorAll('[data-dot]').forEach((d) =>
    d.addEventListener('click', () => { obStep = Number(d.dataset.dot); renderTour(); }));
}

function bindOnboarding() {
  const form = $('#onboarding-form');

  // Fetch setup key only via /api/setup/status (never from /api/config).
  // Loopback gets the token automatically; remote clients paste from logs / SETUP_TOKEN.
  (async () => {
    try {
      const res = await fetch('/api/setup/status');
      const json = await res.json();
      const data = (json && json.data) || {};
      const wrap = $('#ob-setup-key-wrap');
      const input = form.elements.setupToken;
      if (data.setupToken) {
        obSetupToken = data.setupToken;
        if (wrap) wrap.classList.add('hidden');
        if (input) { input.required = false; input.value = ''; }
      } else if (data.setupTokenRequired) {
        obSetupToken = null;
        if (wrap) wrap.classList.remove('hidden');
        if (input) input.required = true;
      }
    } catch { /* offline — form submit will surface the error */ }
  })();

  // Language picker: applies immediately to this browser and is saved as the
  // instance default when setup completes (changeable later in Settings).
  const langSel = $('#ob-lang');
  langSel.innerHTML = Object.entries(I18N_LANGS)
    .map(([code, name]) => `<option value="${code}" ${i18nLang() === code ? 'selected' : ''}>${name}</option>`).join('');
  langSel.addEventListener('change', () => setLang(langSel.value));

  // Feature tour navigation
  obStep = 0;
  renderTour();
  $('#ob-skip').addEventListener('click', () => { obStep = OB_TOUR.length; renderTour(); });
  $('#ob-form-back').addEventListener('click', () => { obStep = OB_TOUR.length - 1; renderTour(); });

  form.elements.logoFile.addEventListener('change', () => {
    const file = form.elements.logoFile.files[0];
    obLogoDataUrl = null;
    const preview = $('#ob-logo-preview');
    preview.classList.add('hidden');
    if (!file) return;
    if (file.size > 300 * 1024) {
      toast('Logo too large — keep it under 300KB', 'error');
      form.elements.logoFile.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      obLogoDataUrl = reader.result;
      preview.innerHTML = `<img src="${esc(obLogoDataUrl)}" alt="logo preview">`;
      preview.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#onboarding-btn');
    const errBox = $('#onboarding-error');
    errBox.classList.add('hidden');
    btn.disabled = true;
    try {
      const typedKey = (form.elements.setupToken && form.elements.setupToken.value || '').trim();
      const setupToken = typedKey || obSetupToken || AppConfig.setupToken || '';
      if (!setupToken) {
        throw new Error('Setup key required — open from this host, or paste the key from server logs / SETUP_TOKEN');
      }
      const body = {
        setupToken,
        companyName: form.elements.companyName.value.trim(),
        companyLogo: obLogoDataUrl,
        adminUsername: form.elements.adminUsername.value.trim(),
        adminEmail: form.elements.adminEmail.value.trim(),
        adminPassword: form.elements.adminPassword.value,
        language: i18nLang(), // chosen during the tour → instance default
        defaultTemplateId: obDefaultTplId,
        handoverTemplates: buildTemplatesForSetup(obDefaultTplId),
      };
      // Tips preference (UI coach marks after first login)
      const tipsBox = form.elements.enableTips;
      localStorage.setItem('itacm_tips', tipsBox && tipsBox.checked ? '1' : '0');
      if (tipsBox && tipsBox.checked) localStorage.setItem('itacm_tips_pending', '1');

      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.error || 'Setup failed');

      await loadAppConfig();
      toast(`Welcome, ${body.companyName}! Sign in with your new Admin account.`, 'success');
      $('#login-form').elements.email.value = body.adminEmail;
      showLogin();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---- topbar: global cross-entity search ---- */
function isEditableKeyTarget(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return !!(el.closest && el.closest('input, textarea, select, [contenteditable="true"]'));
}

function topbarSearchVisible() {
  const gs = $('#global-search');
  const wrap = gs && gs.closest('.topbar-search');
  if (!gs || !wrap) return false;
  const st = getComputedStyle(wrap);
  return st.display !== 'none' && st.visibility !== 'hidden' && wrap.offsetWidth > 0;
}

/** Cmd/Ctrl+K (and mobile search button): focus topbar, or open a prompt when it is hidden. */
function focusGlobalSearch() {
  if (!Auth.profile) return;
  const gs = $('#global-search');
  if (gs && topbarSearchVisible()) {
    gs.focus();
    try { gs.select(); } catch { /* ignore */ }
    return;
  }
  openGlobalSearchPrompt(gs ? gs.value : '');
}

function openGlobalSearchPrompt(prefill = '') {
  openModal({
    title: typeof t === 'function' ? t('common.search') : 'Search',
    body: `
      <p class="cell-sub" style="margin:0 0 12px">${esc(typeof t === 'function' ? t('topbar.search') : 'Search assets, employees, or tags')}</p>
      <label class="gs-prompt-label">
        <span class="ms">search</span>
        <input type="search" id="gs-modal-input" autocomplete="off" enterkeyhint="search"
          placeholder="${esc(typeof t === 'function' ? t('common.search') : 'Search')}…"
          value="${esc(prefill || '')}">
      </label>`,
    foot: `
      <button class="btn btn-outline" data-close>${esc(typeof t === 'function' ? t('common.cancel') : 'Cancel')}</button>
      <button class="btn btn-primary" id="gs-modal-go"><span class="ms">search</span> ${esc(typeof t === 'function' ? t('common.search') : 'Search')}</button>`,
    onMount(overlay) {
      const input = $('#gs-modal-input', overlay);
      const run = () => {
        const v = (input.value || '').trim();
        if (!v) { input.focus(); return; }
        closeModal();
        globalSearch(v).catch((e) => toast(e.message, 'error'));
      };
      $('#gs-modal-go', overlay).addEventListener('click', run);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); run(); }
      });
      setTimeout(() => { input.focus(); input.select(); }, 40);
    },
  });
}

async function globalSearch(qText) {
  const needle = qText.trim();
  if (!needle) return;
  const low = needle.toLowerCase();

  const [assetsRes, empsRes, licenses] = await Promise.all([
    api(`/assets?search=${encodeURIComponent(needle)}&limit=50`).catch(() => ({ items: [] })),
    api(`/employees?search=${encodeURIComponent(needle)}&limit=1000`).catch(() => ({ items: [] })),
    api('/licenses').catch(() => []),
  ]);
  const assets = (assetsRes.items || []).slice(0, 8);
  const emps = employeeList(empsRes).items.slice(0, 8);
  const lics = (Array.isArray(licenses) ? licenses : []).filter((l) =>
    [l.softwareName, l.vendor, l.licenseKey].filter(Boolean).some((v) => String(v).toLowerCase().includes(low))
  ).slice(0, 5);

  openModal({
    title: `Search results — “${needle}”`,
    wide: true,
    body: (assets.length + emps.length + lics.length === 0)
      ? '<div class="table-empty">No matches in hardware, employees, or software.</div>'
      : `
      ${assets.length ? `<div class="gs-section">Hardware (${assets.length})</div>` +
        assets.map((a) => `
        <div class="gs-item" data-gs-asset="${esc(a.id)}">
          <span class="ms">${catIcon(a.category)}</span>
          <div style="flex:1"><strong>${esc(a.brand)} ${esc(a.model)}</strong>
            <span class="cell-sub mono">${esc(a.assetTag)} · ${esc(a.serialNumber)}</span></div>
          ${badge(a.status)}
        </div>`).join('') : ''}
      ${emps.length ? `<div class="gs-section">Employees (${emps.length})</div>` +
        emps.map((p) => `
        <div class="gs-item" data-gs-emp="${esc(p.id)}">
          <span class="avatar" style="width:28px;height:28px;font-size:11px">${esc(initials(p.fullName))}</span>
          <div style="flex:1"><strong>${esc(p.fullName)}</strong>
            <span class="cell-sub">${esc(p.department || '—')} · ${esc(p.email)}</span></div>
          <span class="badge-count ${p.activeAssetCount ? '' : 'zero'}">${p.activeAssetCount}</span>
        </div>`).join('') : ''}
      ${lics.length ? `<div class="gs-section">Software (${lics.length})</div>` +
        lics.map((l) => `
        <div class="gs-item" data-gs-lic>
          <span class="ms">vpn_key</span>
          <div style="flex:1"><strong>${esc(l.softwareName)}</strong>
            <span class="cell-sub">${l.usedSeats}/${l.totalSeats} seats</span></div>
        </div>`).join('') : ''}`,
    foot: `
      <button class="btn btn-outline" id="gs-again"><span class="ms">search</span> Search again</button>
      <button class="btn btn-outline" data-close>Close</button>`,
    onMount(overlay) {
      const again = $('#gs-again', overlay);
      if (again) again.addEventListener('click', () => {
        closeModal();
        openGlobalSearchPrompt(needle);
      });
      overlay.querySelectorAll('[data-gs-asset]').forEach((it) => it.addEventListener('click', () => {
        closeModal(); showAssetDetail(it.dataset.gsAsset);
      }));
      overlay.querySelectorAll('[data-gs-emp]').forEach((it) => it.addEventListener('click', () => {
        closeModal();
        const emp = emps.find((p) => String(p.id) === String(it.dataset.gsEmp));
        if (emp && typeof showEmployeeDetail === 'function') showEmployeeDetail(emp);
        else location.hash = '#/employees';
      }));
      overlay.querySelectorAll('[data-gs-lic]').forEach((it) => it.addEventListener('click', () => {
        closeModal(); location.hash = '#/licenses';
      }));
    },
  });
}

/* ---- topbar buttons: notifications / help / settings / profile ---- */
async function showNotifications() {
  const d = await api('/dashboard/stats');
  const todayStr = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  })();
  const onboardSched = d.alerts.onboardingScheduled || [];
  const items = [
    ...onboardSched.map((o) => {
      const sd = String(o.startDate || '').slice(0, 10);
      const due = sd && sd <= todayStr;
      return {
        icon: 'event_available',
        tone: due ? 'rose' : 'indigo',
        label: due
          ? `${o.employeeName || 'Employee'} — onboarding due (${o.itemCount || 0} reserved)`
          : `${o.employeeName || 'Employee'} — scheduled ${sd} (${o.itemCount || 0} reserved)`,
        go: null,
        onboardId: o.id,
      };
    }),
    ...d.alerts.expiringLicenses.map((l) => ({
      icon: 'vpn_key', tone: l.daysLeft <= 7 ? 'rose' : 'amber',
      text: `${l.softwareName} expires in ${l.daysLeft} days`, go: '#/licenses',
    })),
    ...d.alerts.lowStockConsumables.map((c) => ({
      icon: 'inventory_2', tone: 'rose',
      text: `${c.itemName} is low on stock (${c.totalStock}/min ${c.minimumStockAlertLevel})`, go: '#/consumables',
    })),
    ...(d.assets.inRepair > 0 ? [{
      icon: 'build', tone: 'amber',
      text: `${d.assets.inRepair} device(s) currently in repair`, go: '#/maintenance',
    }] : []),
  ];
  openModal({
    title: `Notifications (${items.length})`,
    body: items.length === 0 ? '<div class="table-empty">All clear — no active alerts.</div>' :
      items.map((n, i) => `
      <div class="gs-item" data-note="${i}">
        ${iconChip(n.icon, n.tone)}
        <div style="flex:1">${esc(n.label || n.text)}</div>
        <span class="ms">chevron_right</span>
      </div>`).join(''),
    foot: '<button class="btn btn-outline" data-close>Close</button>',
    onMount(overlay) {
      overlay.querySelectorAll('[data-note]').forEach((it) => it.addEventListener('click', () => {
        const n = items[Number(it.dataset.note)];
        closeModal();
        if (n.onboardId && typeof openOnboardingDueModal === 'function') {
          openOnboardingDueModal({ force: true, focusId: n.onboardId }).catch((e) => toast(e.message, 'error'));
          return;
        }
        if (n.go) location.hash = n.go;
      }));
    },
  });
}

function showHelp() {
  const tipsOn = tipsEnabled();
  const routeTip = tipForCurrentRoute();
  openModal({
    title: 'Help & tips',
    wide: true,
    body: `
      <div class="gs-section">UI tips</div>
      <label class="ob-check" style="margin-bottom:12px">
        <input type="checkbox" id="help-tips-toggle" ${tipsOn ? 'checked' : ''}>
        <span>Show page tips under the top bar (lightbulb banners)</span>
      </label>
      ${routeTip ? `<div class="ob-tip-callout" style="margin-bottom:14px">
        <span class="ms">lightbulb</span>
        <div><strong>This page:</strong> ${esc(routeTip.tip || routeTip.desc)}</div>
      </div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        <button type="button" class="btn btn-outline" id="help-page-tip"><span class="ms">push_pin</span> Show tip for this page</button>
        <button type="button" class="btn btn-outline" id="help-ui-tour"><span class="ms">tour</span> Guided sidebar tour</button>
        <button type="button" class="btn btn-outline" id="help-product-tour"><span class="ms">auto_awesome</span> Replay product intro</button>
      </div>
      <div class="gs-section">Keyboard</div>
      <div class="gs-item"><span class="ms">keyboard_command_key</span><div style="flex:1">Focus global search</div><code>Cmd/Ctrl + K</code></div>
      <div class="gs-item"><span class="ms">search</span><div style="flex:1">Focus global search</div><code>/</code></div>
      <div class="gs-section">Roles</div>
      <div class="gs-item">${badge('Owner')}<div style="flex:1">Branding, zimmet designs, IT users</div></div>
      <div class="gs-item">${badge('Admin')}<div style="flex:1">Day-to-day ops + user management</div></div>
      <div class="gs-item">${badge('Helpdesk')}<div style="flex:1">Assets, handovers, repairs, software zimmet</div></div>
      <div class="gs-item">${badge('Viewer')}<div style="flex:1">Read-only inventory and dashboards</div></div>
      <div class="gs-section">About</div>
      <div class="cell-sub">ITACM — IT Asset Control Pro. Backend: ${esc(AppConfig.backend)}.
        Handovers and seat moves are transactional with a full audit trail.</div>`,
    foot: '<button class="btn btn-outline" data-close>Close</button>',
    onMount(overlay) {
      $('#help-tips-toggle', overlay).addEventListener('change', (e) => {
        setTipsEnabled(e.target.checked);
        renderPageTip();
        toast(e.target.checked ? 'Page tips enabled' : 'Page tips hidden', 'success');
      });
      $('#help-page-tip', overlay).addEventListener('click', () => {
        closeModal();
        setTipsEnabled(true);
        renderPageTip({ force: true });
        toast('Tip pinned under the top bar', 'success');
      });
      $('#help-ui-tour', overlay).addEventListener('click', () => {
        closeModal();
        startUiTour();
      });
      $('#help-product-tour', overlay).addEventListener('click', () => {
        closeModal();
        showProductTourModal();
      });
    },
  });
}

/* ---- In-app tips & coach marks ---- */
function tipsEnabled() {
  return localStorage.getItem('itacm_tips') !== '0';
}
function setTipsEnabled(on) {
  localStorage.setItem('itacm_tips', on ? '1' : '0');
}

function tipForCurrentRoute() {
  const [raw] = (location.hash || '#/dashboard').split('?');
  const found = OB_TOUR.find((s) => s.route === raw);
  return found ? obItem(found) : null;
}

function renderPageTip(opts = {}) {
  const el = $('#page-tip');
  if (!el) return;
  const tip = tipForCurrentRoute();
  if (!tip || (!tipsEnabled() && !opts.force)) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `
    <span class="ms">lightbulb</span>
    <div class="page-tip-body">
      <strong>${esc(tip.title)}</strong>
      <span>${esc(tip.tip || tip.desc)}</span>
    </div>
    <button type="button" class="page-tip-dismiss" id="page-tip-hide" title="Hide tips">
      <span class="ms">close</span>
    </button>`;
  const hide = $('#page-tip-hide', el);
  if (hide) hide.addEventListener('click', () => {
    setTipsEnabled(false);
    el.classList.add('hidden');
    toast('Tips turned off — re-enable from Help (?)', 'success');
  });
}

function showProductTourModal() {
  let step = 0;
  const paint = (overlay) => {
    const s = obItem(OB_TOUR[step]);
    $('#pt-body', overlay).innerHTML = `
      <div class="ob-slide-grid" style="margin:0">
        <div>
          <span class="ob-slide-badge"><span class="ms ms-sm">${s.icon}</span> ${step + 1}/${OB_TOUR.length}</span>
          <h2 class="ob-slide-title" style="font-size:20px">${esc(s.title)}</h2>
          <p class="ob-slide-desc">${esc(s.desc)}</p>
          <ul class="ob-bullets">${s.bullets.map((b) => `<li><span class="ms">check_circle</span> ${esc(b)}</li>`).join('')}</ul>
          ${s.tip ? `<div class="ob-tip-callout"><span class="ms">lightbulb</span> ${esc(s.tip)}</div>` : ''}
        </div>
        <div class="ob-preview-wrap">${obPreviewHtml(s.preview)}</div>
      </div>`;
    $('#pt-back', overlay).disabled = step === 0;
    $('#pt-next', overlay).innerHTML = step === OB_TOUR.length - 1
      ? '<span class="ms">check</span> Done'
      : 'Next <span class="ms">arrow_forward</span>';
  };
  openModal({
    title: 'Product tour',
    wide: true,
    body: '<div id="pt-body"></div>',
    foot: `<button class="btn btn-outline" id="pt-back"><span class="ms">arrow_back</span> Back</button>
           <button class="btn btn-outline" data-close>Close</button>
           <button class="btn btn-primary" id="pt-next">Next</button>`,
    onMount(overlay) {
      paint(overlay);
      $('#pt-back', overlay).addEventListener('click', () => { if (step > 0) { step--; paint(overlay); } });
      $('#pt-next', overlay).addEventListener('click', () => {
        if (step >= OB_TOUR.length - 1) closeModal();
        else { step++; paint(overlay); }
      });
    },
  });
}

function startUiTour() {
  const steps = OB_TOUR.filter((s) => s.route);
  let i = 0;
  const coach = $('#tip-coach');
  if (!coach) return;

  const clear = () => {
    coach.classList.add('hidden');
    coach.innerHTML = '';
    $$('#nav a.tip-highlight').forEach((a) => a.classList.remove('tip-highlight'));
  };

  const show = () => {
    if (i >= steps.length) {
      clear();
      toast('Sidebar tour complete', 'success');
      return;
    }
    const s = obItem(steps[i]);
    location.hash = s.route;
    setTimeout(() => {
      $$('#nav a').forEach((a) => a.classList.toggle('tip-highlight', a.dataset.route === s.route));
      const navLink = $(`#nav a[data-route="${s.route}"]`);
      let top = 120;
      let left = 280;
      if (navLink) {
        const r = navLink.getBoundingClientRect();
        top = Math.min(window.innerHeight - 180, Math.max(72, r.top));
        left = Math.min(window.innerWidth - 340, r.right + 12);
      }
      coach.classList.remove('hidden');
      coach.style.top = `${top}px`;
      coach.style.left = `${left}px`;
      coach.innerHTML = `
        <div class="tip-coach-card">
          <div class="tip-coach-head">
            <span class="ms">${s.icon}</span>
            <strong>${esc(s.title)}</strong>
            <span class="cell-sub">${i + 1}/${steps.length}</span>
          </div>
          <p>${esc(s.tip || s.desc)}</p>
          <div class="tip-coach-actions">
            <button type="button" class="btn btn-outline btn-sm" id="coach-skip">Skip tour</button>
            <button type="button" class="btn btn-primary btn-sm" id="coach-next">
              ${i === steps.length - 1 ? 'Finish' : 'Next'} <span class="ms">arrow_forward</span>
            </button>
          </div>
        </div>`;
      $('#coach-skip', coach).addEventListener('click', clear);
      $('#coach-next', coach).addEventListener('click', () => { i++; show(); });
      renderPageTip();
    }, 280);
  };
  setTipsEnabled(true);
  show();
}

function showSettings() {
  if (!Auth.can('canManageBranding')) {
    toast('Only the Owner can change company & branding settings', 'error');
    return;
  }
  let newLogo = null;
  const hasLogo = !!AppConfig.companyLogo;

  openModal({
    title: 'Company & branding',
    xwide: true,
    body: `
      <div class="settings-shell">
        <div class="settings-intro">
          <p class="settings-lede">Workspace identity, zimmet look, and barcode labels used across the app.</p>
          <span class="draft-chip">Owner only</span>
        </div>

        <section class="settings-panel">
          <header class="settings-panel-head">
            <span class="icon-chip chip-indigo"><span class="ms">apartment</span></span>
            <div>
              <h4>Brand identity</h4>
              <p>Shown in the sidebar, zimmet forms, and printed labels.</p>
            </div>
          </header>
          <div class="form-grid">
            <div class="form-field">
              <label>Company name</label>
              <input id="set-company" value="${esc(AppConfig.companyName || '')}" maxlength="80" placeholder="Acme Teknoloji A.Ş.">
            </div>
            <div class="form-field">
              <label>Language / Dil</label>
              <select id="set-lang">
                ${Object.entries(I18N_LANGS).map(([code, name]) =>
                  `<option value="${code}" ${i18nLang() === code ? 'selected' : ''}>${name}</option>`).join('')}
              </select>
              <span class="ob-hint">Applies to this browser; also saved as the instance default.</span>
            </div>
            <div class="form-field">
              <label>Default currency</label>
              <select id="set-currency">
                ${currencyOptionsForSelect(AppConfig.currency).map((o) =>
                  `<option value="${esc(o.value)}" ${appCurrency() === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
              </select>
              <span class="ob-hint">Used for lines, repairs, sales. Contracts can still pick USD / EUR etc. per deal.</span>
            </div>
            <div class="form-field full">
              <label>Company address <span class="ob-hint">(optional — under the logo on zimmet forms)</span></label>
              <input id="set-address" value="${esc(AppConfig.companyAddress || '')}" maxlength="200"
                placeholder="e.g. Maslak, İstanbul / Büyükdere Cad. No:123">
            </div>
            <div class="form-field full">
              <label>Company logo</label>
              <div class="settings-logo-row">
                <div id="set-logo-preview" class="settings-logo-preview ${hasLogo ? '' : 'is-empty'}">
                  ${hasLogo
                    ? `<img src="${esc(AppConfig.companyLogo)}" alt="logo">`
                    : `<span class="ms">image</span><span>No logo</span>`}
                </div>
                <div class="settings-logo-actions">
                  <label class="btn btn-outline" for="set-logo"><span class="ms">upload</span> Upload logo</label>
                  <input type="file" id="set-logo" accept="image/png,image/jpeg,image/svg+xml,image/webp" class="hidden">
                  <span class="ob-hint">PNG, JPG, SVG or WebP · max 300KB</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="settings-panel">
          <header class="settings-panel-head">
            <span class="icon-chip chip-indigo"><span class="ms">description</span></span>
            <div>
              <h4>Zimmet form</h4>
              <p>Default design and legal terms printed on every handover.</p>
            </div>
          </header>
          <div class="form-grid">
            <div class="form-field full">
              <label>Terms &amp; conditions
                <span class="ob-hint">Blank line between paragraphs; 2nd paragraph prints italic.</span></label>
              <textarea id="set-terms" rows="5" placeholder="Paste your handover terms…">${esc(AppConfig.handoverTerms || '')}</textarea>
            </div>
            <div class="form-field full">
              <label>Default design</label>
              <div class="ob-tpl-cards" id="set-design-cards" style="margin-top:8px"></div>
              <button type="button" class="btn btn-outline" id="set-customize-tpl" style="margin-top:10px">
                <span class="ms">tune</span> Fine-tune fields &amp; labels…
              </button>
            </div>
          </div>
        </section>

        <section class="settings-panel">
          <header class="settings-panel-head">
            <span class="icon-chip chip-indigo"><span class="ms">qr_code_2</span></span>
            <div>
              <h4>Barcode label</h4>
              <p>Applies to every Print Labels action across the app.</p>
            </div>
          </header>
          <div class="form-grid">
            <div class="form-field"><label>Width (mm)</label>
              <input type="number" id="lbl-w" min="20" max="150"></div>
            <div class="form-field"><label>Height (mm)</label>
              <input type="number" id="lbl-h" min="10" max="150"></div>
            <div class="form-field"><label>Barcode height (mm)</label>
              <input type="number" id="lbl-bc" min="5" max="40"></div>
            <div class="form-field"><label>Copies per asset</label>
              <input type="number" id="lbl-copies" min="1" max="50"></div>
            <div class="form-field full">
              <label>Fields on the label</label>
              <div id="lbl-toggles" class="lbl-toggles settings-toggles">
                <label class="settings-toggle"><input type="checkbox" id="lbl-logo"> Logo</label>
                <label class="settings-toggle"><input type="checkbox" id="lbl-company"> Company</label>
                <label class="settings-toggle"><input type="checkbox" id="lbl-model"> Brand &amp; model</label>
                <label class="settings-toggle"><input type="checkbox" id="lbl-category"> Category</label>
                <label class="settings-toggle"><input type="checkbox" id="lbl-serial"> Serial</label>
              </div>
            </div>
            <div class="form-field full">
              <label>Live preview</label>
              <div id="lbl-preview" class="lbl-preview"></div>
            </div>
          </div>
        </section>

        <section class="settings-note">
          <span class="ms">folder_managed</span>
          <div>
            <strong>Document storage</strong>
            <p>Signed scans and repair paperwork are kept on the server filesystem
              (<code>DATA_DIR</code> / Docker volume <code>app-data</code>), role-gated.
              Accepted uploads: PDF, PNG, JPEG, WebP · max 8MB.</p>
          </div>
        </section>
      </div>`,
    foot: `<button class="btn btn-outline" data-close>Cancel</button>
           <button class="btn btn-primary" id="set-save"><span class="ms">save</span> Save settings</button>`,
    onMount(overlay) {
      $('#set-logo', overlay).addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 300 * 1024) { toast('Logo too large — max 300KB', 'error'); e.target.value = ''; return; }
        const r = new FileReader();
        r.onload = () => {
          newLogo = r.result;
          const box = $('#set-logo-preview', overlay);
          box.classList.remove('is-empty');
          box.innerHTML = `<img src="${esc(newLogo)}" alt="logo">`;
        };
        r.readAsDataURL(file);
      });
      $('#set-customize-tpl', overlay).addEventListener('click', () => showTemplateCustomizer());

      // ---- Barcode label designer (live preview) ----
      const LBL_DEF = { widthMm: 58, heightMm: 32, barcodeMm: 12, copies: 1,
        showLogo: true, showCompany: true, showModel: true, showCategory: true, showSerial: true };
      const lc = { ...LBL_DEF, ...(AppConfig.labelConfig || {}) };
      $('#lbl-w', overlay).value = lc.widthMm;
      $('#lbl-h', overlay).value = lc.heightMm;
      $('#lbl-bc', overlay).value = lc.barcodeMm;
      $('#lbl-copies', overlay).value = lc.copies;
      $('#lbl-logo', overlay).checked = !!lc.showLogo;
      $('#lbl-company', overlay).checked = !!lc.showCompany;
      $('#lbl-model', overlay).checked = !!lc.showModel;
      $('#lbl-category', overlay).checked = !!lc.showCategory;
      $('#lbl-serial', overlay).checked = !!lc.showSerial;
      const readLabelCfg = () => ({
        widthMm: Math.min(150, Math.max(20, Number($('#lbl-w', overlay).value) || LBL_DEF.widthMm)),
        heightMm: Math.min(150, Math.max(10, Number($('#lbl-h', overlay).value) || LBL_DEF.heightMm)),
        barcodeMm: Math.min(40, Math.max(5, Number($('#lbl-bc', overlay).value) || LBL_DEF.barcodeMm)),
        copies: Math.min(50, Math.max(1, Math.round(Number($('#lbl-copies', overlay).value) || 1))),
        showLogo: $('#lbl-logo', overlay).checked,
        showCompany: $('#lbl-company', overlay).checked,
        showModel: $('#lbl-model', overlay).checked,
        showCategory: $('#lbl-category', overlay).checked,
        showSerial: $('#lbl-serial', overlay).checked,
      });
      const sampleAsset = { assetTag: 'IT-1042', brand: 'Dell', model: 'Latitude 5540',
        category: 'Laptop', serialNumber: 'SN-10231' };
      const renderLabelPreview = () => {
        const box = $('#lbl-preview', overlay);
        if (!box || typeof assetLabelHTML !== 'function') return;
        box.innerHTML = assetLabelHTML(sampleAsset, readLabelCfg());
      };
      overlay.querySelectorAll('#lbl-w, #lbl-h, #lbl-bc, #lbl-copies, #lbl-toggles input')
        .forEach((inp) => inp.addEventListener('input', renderLabelPreview));
      renderLabelPreview();
      // Design picker cards — selecting one promotes that template (by design id) to default.
      const designBox = $('#set-design-cards', overlay);
      let selectedDesign = (AppConfig.handoverTemplate && AppConfig.handoverTemplate.design)
        || (AppConfig.handoverTemplates && AppConfig.handoverTemplates[0] && AppConfig.handoverTemplates[0].design)
        || 'terminal';
      const renderDesignCards = () => {
        designBox.innerHTML = HANDOVER_DESIGN_CATALOG.map((p) => `
          <label class="ob-tpl-card ${selectedDesign === p.id ? 'selected' : ''}">
            <input type="radio" name="setDesign" value="${esc(p.id)}" ${selectedDesign === p.id ? 'checked' : ''}>
            <span class="ob-tpl-card-body">
              <strong>${esc(p.name)} ${designSwatchesHtml(p.swatches)}</strong>
              <span>${esc(p.desc)}</span>
            </span>
          </label>`).join('');
        designBox.querySelectorAll('input[name="setDesign"]').forEach((inp) => {
          inp.addEventListener('change', () => {
            selectedDesign = inp.value;
            renderDesignCards();
          });
        });
      };
      renderDesignCards();

      $('#set-save', overlay).addEventListener('click', async () => {
        try {
          const langChoice = $('#set-lang', overlay).value;
          const currencyChoice = $('#set-currency', overlay).value;
          const prevCurrency = appCurrency();
          // Ensure a template exists for the chosen design, then promote it.
          let list = (AppConfig.handoverTemplates && AppConfig.handoverTemplates.length
            ? AppConfig.handoverTemplates.map((t) => ({ ...defaultTemplateFields(), ...t }))
            : buildTemplatesForSetup(selectedDesign));
          if (!list.some((t) => t.design === selectedDesign || t.id === selectedDesign)) {
            const d = HANDOVER_DESIGN_CATALOG.find((x) => x.id === selectedDesign);
            list = [{
              ...defaultTemplateFields(),
              id: selectedDesign,
              name: (d && d.name) || selectedDesign,
              design: selectedDesign,
            }, ...list];
          }
          // Match by design field first, then id.
          const idx = list.findIndex((t) => t.design === selectedDesign || t.id === selectedDesign);
          if (idx > 0) {
            const [row] = list.splice(idx, 1);
            row.design = selectedDesign;
            list.unshift(row);
          } else if (idx === 0) {
            list[0].design = selectedDesign;
          }
          const saved = await api('/settings', {
            method: 'PUT',
            body: {
              companyName: $('#set-company', overlay).value.trim(),
              companyLogo: newLogo || undefined,
              companyAddress: $('#set-address', overlay).value.trim(),
              handoverTerms: $('#set-terms', overlay).value,
              language: langChoice,
              currency: currencyChoice,
              handoverTemplates: list,
              defaultTemplateId: list[0].id,
              labelConfig: readLabelCfg(),
            },
          });
          AppConfig.companyName = saved.companyName;
          AppConfig.companyLogo = saved.companyLogo;
          AppConfig.companyAddress = saved.companyAddress;
          AppConfig.handoverTerms = saved.handoverTerms;
          AppConfig.handoverTemplates = saved.handoverTemplates;
          AppConfig.handoverTemplate = saved.handoverTemplate;
          AppConfig.labelConfig = saved.labelConfig;
          AppConfig.currency = saved.currency || currencyChoice;
          AppConfig.language = saved.language || langChoice;
          applyBranding();
          toast('Settings saved', 'success');
          closeModal();
          if (langChoice !== i18nLang()) setLang(langChoice); // reloads with the new language
          else if (currencyChoice !== prevCurrency) location.reload();
        } catch (err) { toast(err.message, 'error'); }
      });
    },
  });
}

/* ---- Zimmet Tutanağı multi-template manager (popup with live preview) ---- */
function newClientTemplateId() {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultTemplateFields() {
  return {
    design: 'terminal',
    titleEn: 'Asset Handover', titleTr: 'Zimmet Belgesi',
    subtitle: 'Corporate Resource Management',
    showLogo: true, showEmployeeId: true, showDepartment: true, showTitle: true,
    colCategory: true, colSerial: true, colMac: false, colCondition: true,
    showTerms: true, showReturnSection: false,
    deliveredByLabel: '', receivedByLabel: '', footerNote: '',
  };
}

function showTemplateCustomizer() {
  if (!Auth.can('canManageBranding')) {
    toast('Only the Owner can customize the handover template', 'error');
    return;
  }

  // Working copy of the full template list. First entry = default for new handovers.
  let list = (AppConfig.handoverTemplates && AppConfig.handoverTemplates.length
    ? AppConfig.handoverTemplates
    : [{ id: 'default', name: 'Standard', ...(AppConfig.handoverTemplate || defaultTemplateFields()) }]
  ).map((t) => ({ ...defaultTemplateFields(), ...t }));
  let activeId = list[0].id;

  const TOGGLES = [
    ['Header', [['showLogo', 'Company logo']]],
    ['Employee fields', [['showEmployeeId', 'Employee ID / Sicil No'], ['showDepartment', 'Department'], ['showTitle', 'Position / Title']]],
    ['Equipment columns', [['colCategory', 'Category'], ['colSerial', 'Serial number'], ['colMac', 'MAC address'], ['colCondition', 'Condition']]],
    ['Sections', [['showTerms', 'Terms & Conditions'], ['showReturnSection', 'Equipment return section']]],
  ];
  const TEXTS = [
    ['titleEn', 'Title (English)', 60], ['titleTr', 'Title (Turkish)', 60], ['subtitle', 'Header subtitle', 100],
    ['deliveredByLabel', 'Delivered-by label', 80], ['receivedByLabel', 'Received-by label', 80], ['footerNote', 'Footer note (optional)', 200],
  ];

  const sampleTerms = `<p>${esc(t('handover.termsBody'))}</p>`;
  const sample = {
    companyName: AppConfig.companyName, companyLogo: AppConfig.companyLogo,
    companyAddress: AppConfig.companyAddress,
    formNo: 'HF-ÖRNEK01', formSuffix: '', dateStr: new Date().toLocaleDateString(),
    pageNum: 1, pageTotal: 1,
    employeeName: 'Ahmet Yılmaz', employeeId: 'EMP12345', department: 'Bilgi İşlem', title: 'Sistem Uzmanı',
    deliveredByName: (Auth.profile && Auth.profile.username) || 'IT Department', termsHtml: sampleTerms,
    items: [
      { brand: 'Dell', model: 'Latitude 5540', category: 'Laptop', serialNumber: 'SN-10231', macAddress: 'AA:BB:CC:11:22', conditionNote: 'New' },
      { brand: 'LG', model: '27UP850', category: 'Monitor', serialNumber: 'MN-88120', macAddress: 'N/A', conditionNote: 'Good' },
      { kind: 'line', phoneNumber: '+90 532 000 00 00', operator: 'Turkcell', plan: 'Kurumsal 20GB', simSerial: '8990012345678901234' },
    ],
  };

  const active = () => list.find((t) => t.id === activeId) || list[0];

  openModal({
    title: 'Manage Zimmet Templates',
    wide: true,
    body: `
      <div class="tc-grid">
        <div class="tc-options">
          <div class="gs-section" style="margin:0 0 8px;display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span>Templates</span>
            <span style="display:flex;gap:4px">
              <button type="button" class="btn btn-outline btn-sm" id="tc-add" title="Add"><span class="ms">add</span></button>
              <button type="button" class="btn btn-outline btn-sm" id="tc-dup" title="Duplicate"><span class="ms">content_copy</span></button>
            </span>
          </div>
          <div id="tc-list" class="tc-tpl-list"></div>
          <div class="cell-sub" style="margin:8px 0 12px">First in the list is the default. Use ↑ to promote.</div>
          <div id="tc-editor"></div>
        </div>
        <div class="tc-preview-wrap">
          <div class="gs-section" style="margin:6px 0 8px">Live preview</div>
          <div class="tc-preview-scroll"><div id="tc-preview"></div></div>
        </div>
      </div>`,
    foot: `<button class="btn btn-outline" data-close>Cancel</button>
           <button class="btn btn-primary" id="tc-save"><span class="ms">save</span> Save all templates</button>`,
    onMount(overlay) {
      const editor = $('#tc-editor', overlay);
      const listEl = $('#tc-list', overlay);

      const renderList = () => {
        listEl.innerHTML = list.map((t, i) => `
          <div class="tc-tpl-item ${t.id === activeId ? 'selected' : ''}" data-id="${esc(t.id)}">
            <button type="button" class="tc-tpl-pick grow" data-pick="${esc(t.id)}">
              <strong>${esc(t.name || 'Untitled')}</strong>
              ${i === 0 ? '<span class="stock-chip" style="margin-left:6px">Default</span>' : ''}
            </button>
            <button type="button" class="icon-btn" data-up="${esc(t.id)}" title="Make default / move up" ${i === 0 ? 'disabled' : ''}>
              <span class="ms">arrow_upward</span>
            </button>
            <button type="button" class="icon-btn" data-del="${esc(t.id)}" title="Delete" ${list.length <= 1 ? 'disabled' : ''}>
              <span class="ms">delete</span>
            </button>
          </div>`).join('');
        listEl.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
          activeId = b.dataset.pick;
          renderAll();
        }));
        listEl.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
          const idx = list.findIndex((t) => t.id === b.dataset.up);
          if (idx <= 0) return;
          const [row] = list.splice(idx, 1);
          list.unshift(row);
          activeId = row.id;
          renderAll();
        }));
        listEl.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
          if (list.length <= 1) return;
          if (!confirm('Delete this template?')) return;
          list = list.filter((t) => t.id !== b.dataset.del);
          if (!list.find((t) => t.id === activeId)) activeId = list[0].id;
          renderAll();
        }));
      };

      const renderEditor = () => {
        const tpl = active();
        const designOpts = HANDOVER_DESIGN_CATALOG.map((d) =>
          `<option value="${esc(d.id)}" ${tpl.design === d.id ? 'selected' : ''}>${esc(d.name)}</option>`
        ).join('');
        editor.innerHTML = `
          <div class="form-field" style="margin-bottom:10px">
            <label>Template name</label>
            <input data-tpl="name" maxlength="60" value="${esc(tpl.name || '')}" placeholder="e.g. Terminal / Classic">
          </div>
          <div class="form-field" style="margin-bottom:10px">
            <label>Visual design</label>
            <select data-tpl="design">${designOpts}</select>
            <div style="margin-top:6px">${designSwatchesHtml(
              (HANDOVER_DESIGN_CATALOG.find((d) => d.id === tpl.design) || HANDOVER_DESIGN_CATALOG[0]).swatches
            )}</div>
          </div>
          ${TOGGLES.map(([grp, items]) => `
            <div class="gs-section" style="margin:6px 0 6px">${esc(grp)}</div>
            ${items.map(([k, l]) =>
              `<label class="tc-opt"><input type="checkbox" data-tpl="${k}" ${tpl[k] ? 'checked' : ''}> ${esc(l)}</label>`
            ).join('')}`).join('')}
          <div class="gs-section" style="margin:14px 0 6px">Titles & labels</div>
          ${TEXTS.map(([k, l, m]) =>
            `<div class="form-field" style="margin-bottom:8px"><label>${esc(l)}</label>
               <input data-tpl="${k}" maxlength="${m}" value="${esc(tpl[k] == null ? '' : tpl[k])}"></div>`
          ).join('')}`;
        editor.querySelectorAll('[data-tpl]').forEach((inp) => {
          const evt = inp.type === 'checkbox' ? 'change' : 'input';
          const ev2 = inp.tagName === 'SELECT' ? 'change' : evt;
          inp.addEventListener(ev2, () => {
            const cur = active();
            cur[inp.dataset.tpl] = inp.type === 'checkbox' ? inp.checked : inp.value;
            if (inp.dataset.tpl === 'name') renderList();
            if (inp.dataset.tpl === 'design') {
              const d = HANDOVER_DESIGN_CATALOG.find((x) => x.id === cur.design);
              if (d && (!cur.name || HANDOVER_DESIGN_CATALOG.some((x) => x.name === cur.name))) {
                cur.name = d.name;
                renderList();
              }
              renderEditor();
              renderPreview();
              return;
            }
            renderPreview();
          });
        });
      };

      const renderPreview = () => {
        $('#tc-preview', overlay).innerHTML =
          `<div class="preview-paper">${handoverReceiptHTML(sample, active())}</div>`;
      };

      const renderAll = () => {
        renderList();
        renderEditor();
        renderPreview();
      };

      $('#tc-add', overlay).addEventListener('click', () => {
        if (list.length >= 12) { toast('Maximum 12 templates', 'error'); return; }
        const n = {
          id: newClientTemplateId(),
          name: `Template ${list.length + 1}`,
          ...defaultTemplateFields(),
        };
        list.push(n);
        activeId = n.id;
        renderAll();
      });
      $('#tc-dup', overlay).addEventListener('click', () => {
        if (list.length >= 12) { toast('Maximum 12 templates', 'error'); return; }
        const src = active();
        const n = { ...src, id: newClientTemplateId(), name: `${src.name || 'Template'} (copy)` };
        list.push(n);
        activeId = n.id;
        renderAll();
      });

      $('#tc-save', overlay).addEventListener('click', async () => {
        try {
          if (list.some((t) => !String(t.name || '').trim())) {
            throw new Error('Every template needs a name');
          }
          const saved = await api('/settings', { method: 'PUT', body: { handoverTemplates: list } });
          AppConfig.handoverTemplates = saved.handoverTemplates;
          AppConfig.handoverTemplate = saved.handoverTemplate;
          toast('Zimmet templates saved', 'success');
          closeModal();
        } catch (err) { toast(err.message, 'error'); }
      });

      renderAll();
    },
  });
}

/** Resolve a handover template by id (falls back to default / first). */
function resolveHandoverTpl(templateId) {
  const list = AppConfig.handoverTemplates || [];
  if (templateId && list.length) {
    const found = list.find((t) => t.id === templateId);
    if (found) return found;
  }
  return AppConfig.handoverTemplate || list[0] || defaultTemplateFields();
}

function handoverTplSelectHtml(selectedId) {
  const list = AppConfig.handoverTemplates && AppConfig.handoverTemplates.length
    ? AppConfig.handoverTemplates
    : HANDOVER_DESIGN_CATALOG.map((d) => ({ id: d.id, name: d.name, design: d.id }));
  const sel = selectedId || (list[0] && list[0].id) || '';
  return `<label class="ho-tpl-pick" style="display:flex;align-items:center;gap:8px;margin:0 0 10px;flex-wrap:wrap">
    <span class="cell-sub" style="font-weight:600">${esc(t('handover.template'))}</span>
    <select id="ho-tpl-select" style="min-width:180px;flex:1">
      ${list.map((tpl) => {
        const d = HANDOVER_DESIGN_CATALOG.find((x) => x.id === (tpl.design || tpl.id));
        const label = tpl.name || (d && d.name) || tpl.id;
        return `<option value="${esc(tpl.id)}" ${tpl.id === sel ? 'selected' : ''}>${esc(label)}</option>`;
      }).join('')}
    </select>
  </label>`;
}

function showProfile() {
  const p = Auth.profile;
  openModal({
    title: 'My profile',
    body: `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
        <span class="avatar" style="width:48px;height:48px;font-size:16px">${esc(initials(p.username || p.email))}</span>
        <div>
          <div class="cell-title" style="font-size:16px">${esc(p.username || '—')}</div>
          <div class="cell-sub">${esc(p.email)}</div>
        </div>
        <span style="margin-left:auto">${badge(p.role)}</span>
      </div>
      <div class="cell-sub">Backend: ${esc(AppConfig.backend)} • Company: ${esc(AppConfig.companyName || '—')}</div>`,
    foot: `<button class="btn btn-outline" data-close>Close</button>
           <button class="btn btn-danger" id="profile-logout"><span class="ms">logout</span> Sign out</button>`,
    onMount(overlay) {
      $('#profile-logout', overlay).addEventListener('click', () => { closeModal(); logout(); });
    },
  });
}

/* ---- init ---- */
async function init() {
  await loadAppConfig();
  applyStaticI18n(); // translate login/topbar statics per the resolved language
  applyBranding();
  bindOnboarding();

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-btn');
    const errBox = $('#login-error');
    errBox.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const email = e.target.elements.email.value.trim();
      const password = e.target.elements.password.value;
      await loginWithPassword(email, password);
      showApp();
    } catch (err) {
      errBox.textContent = err.message; // textContent — no markup interpretation
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });

  $('#logout-btn').addEventListener('click', () => logout());
  window.addEventListener('itacm:logout', showLogin);
  window.addEventListener('hashchange', () => { if (Auth.profile) navigate(); });

  const menuToggle = $('#menu-toggle');
  const backdrop = $('#sidebar-backdrop');
  if (menuToggle) menuToggle.addEventListener('click', () => toggleNav());
  if (backdrop) backdrop.addEventListener('click', () => closeNav());
  // Close the drawer after picking a nav item on phones.
  $('#nav').addEventListener('click', (e) => {
    if (e.target.closest('a[data-route]')) closeNav();
  });

  // Sidebar "+ New Asset" shortcut → Hardware view with the create modal open.
  $('#sidebar-new-asset').addEventListener('click', async () => {
    if (location.hash !== '#/assets') {
      location.hash = '#/assets';
      await new Promise((r) => setTimeout(r, 400)); // let the view render
    }
    const btn = $('#asset-new');
    if (btn) btn.click();
  });

  // Topbar buttons
  $('#btn-notifications').addEventListener('click', () => { if (Auth.profile) showNotifications().catch((e2) => toast(e2.message, 'error')); });
  $('#btn-help').addEventListener('click', showHelp);
  $('#btn-settings').addEventListener('click', () => { if (Auth.profile) showSettings(); });
  $('#topbar-avatar').addEventListener('click', () => { if (Auth.profile) showProfile(); });

  // Global search: searches hardware + employees + software together.
  const gs = $('#global-search');
  if (gs) {
    gs.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && Auth.profile) globalSearch(gs.value).catch((e2) => toast(e2.message, 'error'));
    });
  }
  const gsBtn = $('#btn-global-search');
  if (gsBtn) gsBtn.addEventListener('click', () => focusGlobalSearch());

  // Capture phase so Cmd/Ctrl+K wins over the browser omnibox when possible.
  document.addEventListener('keydown', (e) => {
    if (!Auth.profile) return;
    const key = (e.key || '').toLowerCase();
    if ((e.metaKey || e.ctrlKey) && key === 'k') {
      e.preventDefault();
      e.stopPropagation();
      focusGlobalSearch();
      return;
    }
    // Slash focuses search when not already typing in a field.
    if (key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditableKeyTarget(e.target)) {
      e.preventDefault();
      focusGlobalSearch();
    }
  }, true);

  // First run → onboarding wizard.
  if (AppConfig.onboarded === false) {
    showOnboarding();
    return;
  }

  // Resume session if a token is stored and still valid.
  if (Auth.token) {
    try {
      const profile = await api('/auth/verify-token', { method: 'POST' });
      Auth.save(Auth.token, profile);
      showApp();
      return;
    } catch { Auth.clear(); }
  }
  showLogin();
}

init();
