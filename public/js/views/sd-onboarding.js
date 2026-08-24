/* ===================== SERVICE DESK ONBOARDING =====================
 * A stepped, illustrated walkthrough of the service-desk (ticketing) module.
 * Shown once per user when the module is active — and immediately when an admin
 * switches it on. Purely informational; dismissing it sets a per-user flag.
 *
 * Exposes:
 *   showServiceDeskOnboarding(force)      — open the overlay (force ignores the seen flag)
 *   maybeShowServiceDeskOnboarding()      — open it once, if eligible and unseen
 *   resetServiceDeskOnboarding()          — clear the seen flag (used when re-enabling)
 */

const SDOB_KEY = 'itacm:sd-onboarding:v1';

function sdobSeenKey() {
  const uid = (typeof Auth === 'object' && Auth.profile && (Auth.profile.uid || Auth.profile.email)) || 'anon';
  return SDOB_KEY + ':' + uid;
}

// Slide model: an accent colour, a hero icon, t()-keys for the copy, and an
// optional `locate` target — the route to open plus a CSS selector to spotlight
// so "Show me" jumps to the real screen/button and highlights it.
const SDOB_SLIDES = [
  { icon: 'support_agent', color: '#4f46e5', key: 'welcome', bullets: 3,
    locate: { route: '#/tickets', selector: '#nav a[data-route="#/tickets"]' } },
  { icon: 'confirmation_number', color: '#2563eb', key: 'tickets', bullets: 4,
    locate: { route: '#/tickets', selector: '#nav a[data-route="#/tickets"]' } },
  { icon: 'how_to_reg', color: '#7c3aed', key: 'approvals', bullets: 4,
    locate: { route: '#/tickets', selector: '#tk-templates' } },
  { icon: 'account_tree', color: '#0891b2', key: 'workflow', bullets: 3,
    locate: { route: '#/tickets', selector: '#tk-workflow' } },
  { icon: 'menu_book', color: '#059669', key: 'portal', bullets: 4 },
  { icon: 'insights', color: '#d97706', key: 'reports', bullets: 3,
    locate: { route: '#/tickets', selector: '#tk-report' } },
];

// Jump to a feature's screen and spotlight the real nav item / button. Polls
// briefly because the target view renders asynchronously after the hash change.
function sdobLocate(target) {
  if (!target) return;
  try { if (location.hash !== target.route) location.hash = target.route; } catch { /* ignore */ }
  const navFallback = '#nav a[data-route="' + target.route + '"]';
  let tries = 0;
  const tick = () => {
    tries++;
    const el = document.querySelector(target.selector) || document.querySelector(navFallback);
    if (!el) { if (tries < 12) setTimeout(tick, 150); return; }
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
    el.classList.add('sdob-locate-pulse');
    const tag = document.createElement('div');
    tag.className = 'sdob-locate-tag';
    tag.innerHTML = '<span class="ms ms-sm">arrow_upward</span> ' + esc(t('sdob.locateHere'));
    document.body.appendChild(tag);
    const place = () => {
      const r = el.getBoundingClientRect();
      tag.style.top = (r.bottom + 8) + 'px';
      tag.style.left = Math.max(8, Math.min(r.left, window.innerWidth - tag.offsetWidth - 8)) + 'px';
    };
    place();
    const done = () => {
      el.classList.remove('sdob-locate-pulse');
      tag.remove();
      window.removeEventListener('scroll', place, true);
    };
    window.addEventListener('scroll', place, true);
    setTimeout(done, 4000);
  };
  setTimeout(tick, 260);
}

// A small, text-free illustration per slide that demonstrates the feature — a
// mini board, an approval chain, a status graph, a request form, a bar chart.
function sdobIllo(key, c) {
  if (key === 'tickets') {
    return `<div class="sdob-illo sdob-board">${[0, 1, 2].map((col) => `<div class="sdob-col">
        <span class="sdob-coldot" style="background:${c}"></span>
        <span class="sdob-card2" style="border-left-color:${c}"></span>
        ${col < 2 ? `<span class="sdob-card2" style="border-left-color:${c}"></span>` : ''}
      </div>`).join('')}</div>`;
  }
  if (key === 'approvals') {
    return `<div class="sdob-illo sdob-chain">
      <span class="sdob-node" style="background:${c}"><span class="ms">person</span></span>
      <span class="sdob-arr" style="color:${c}">arrow_forward</span>
      <span class="sdob-node" style="background:${c}"><span class="ms">groups</span></span>
      <span class="sdob-arr" style="color:${c}">arrow_forward</span>
      <span class="sdob-node" style="background:${c}"><span class="ms">account_balance</span></span>
    </div>`;
  }
  if (key === 'workflow') {
    const pill = `<span class="sdob-pill" style="border-color:${c}"><span class="sdob-pilldot" style="background:${c}"></span></span>`;
    return `<div class="sdob-illo sdob-chain">
      ${pill}<span class="sdob-arr" style="color:${c}">arrow_forward</span>${pill}<span class="sdob-arr" style="color:${c}">arrow_forward</span>${pill}
    </div>`;
  }
  if (key === 'portal') {
    return `<div class="sdob-illo"><div class="sdob-formcard">
      <span class="sdob-bar" style="width:55%;background:${c}66"></span>
      <span class="sdob-input"></span>
      <span class="sdob-suggest"><span class="ms" style="color:${c}">lightbulb</span><span class="sdob-bar" style="flex:1;background:${c}33"></span></span>
    </div></div>`;
  }
  if (key === 'reports') {
    return `<div class="sdob-illo sdob-chart">${[42, 72, 54, 92, 64].map((h) => `<span class="sdob-bar2" style="height:${h}%;background:${c}"></span>`).join('')}</div>`;
  }
  // welcome — the three pillars of the desk.
  return `<div class="sdob-illo sdob-chips3">
    <span class="sdob-ichip" style="background:${c}"><span class="ms">confirmation_number</span></span>
    <span class="sdob-ichip" style="background:${c}"><span class="ms">how_to_reg</span></span>
    <span class="sdob-ichip" style="background:${c}"><span class="ms">menu_book</span></span>
  </div>`;
}

function resetServiceDeskOnboarding() {
  try { localStorage.removeItem(sdobSeenKey()); } catch { /* ignore */ }
}

function maybeShowServiceDeskOnboarding() {
  try {
    if (typeof moduleOn !== 'function' || !moduleOn('ticketing')) return;
    // Staff who can actually run the service desk (Owner/Admin/Helpdesk etc.).
    if (!(typeof Auth === 'object' && Auth.canIam && Auth.canIam('ticket', 'read'))) return;
    if (localStorage.getItem(sdobSeenKey()) === '1') return;
    showServiceDeskOnboarding(false);
  } catch { /* never block the app */ }
}

function showServiceDeskOnboarding(force) {
  if (!force) {
    try { if (localStorage.getItem(sdobSeenKey()) === '1') return; } catch { /* ignore */ }
  }
  // Only one instance at a time.
  document.getElementById('sdob-overlay')?.remove();

  let i = 0;
  const n = SDOB_SLIDES.length;
  const markSeen = () => { try { localStorage.setItem(sdobSeenKey(), '1'); } catch { /* ignore */ } };

  const overlay = document.createElement('div');
  overlay.id = 'sdob-overlay';
  overlay.className = 'sdob-overlay';
  overlay.innerHTML = `
    <div class="sdob-card" role="dialog" aria-modal="true" aria-label="${esc(t('sdob.aria'))}">
      <button class="sdob-x" id="sdob-x" title="${esc(t('common.close'))}"><span class="ms">close</span></button>
      <div class="sdob-hero" id="sdob-hero"></div>
      <div class="sdob-body">
        <div class="sdob-badge" id="sdob-badge"></div>
        <h2 class="sdob-title" id="sdob-title"></h2>
        <p class="sdob-desc" id="sdob-desc"></p>
        <ul class="sdob-bullets" id="sdob-bullets"></ul>
        <div class="sdob-whererow" id="sdob-where"></div>
      </div>
      <div class="sdob-foot">
        <div class="sdob-dots" id="sdob-dots"></div>
        <div class="sdob-nav">
          <button class="btn btn-ghost" id="sdob-skip">${esc(t('sdob.skip'))}</button>
          <button class="btn btn-outline" id="sdob-back"><span class="ms ms-sm">arrow_back</span> ${esc(t('sdob.back'))}</button>
          <button class="btn btn-primary" id="sdob-next">${esc(t('sdob.next'))} <span class="ms ms-sm">arrow_forward</span></button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const hero = overlay.querySelector('#sdob-hero');
  const badge = overlay.querySelector('#sdob-badge');
  const title = overlay.querySelector('#sdob-title');
  const desc = overlay.querySelector('#sdob-desc');
  const bullets = overlay.querySelector('#sdob-bullets');
  const whereEl = overlay.querySelector('#sdob-where');
  const dots = overlay.querySelector('#sdob-dots');
  const backBtn = overlay.querySelector('#sdob-back');
  const nextBtn = overlay.querySelector('#sdob-next');

  const close = () => { markSeen(); overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
  };

  function render() {
    const s = SDOB_SLIDES[i];
    hero.style.background = `linear-gradient(135deg, ${s.color}22, ${s.color}0d)`;
    hero.innerHTML = sdobIllo(s.key, s.color);
    badge.textContent = t('sdob.badge').replace('{i}', i + 1).replace('{n}', n);
    title.textContent = t('sdob.' + s.key + '.title');
    desc.textContent = t('sdob.' + s.key + '.desc');
    const items = [];
    for (let b = 1; b <= s.bullets; b++) items.push(t('sdob.' + s.key + '.b' + b));
    bullets.innerHTML = items.map((x) => `<li><span class="ms ms-sm" style="color:${s.color}">check_circle</span> ${esc(x)}</li>`).join('');
    whereEl.innerHTML = `<span class="sdob-where"><span class="ms ms-sm">location_on</span> ${esc(t('sdob.' + s.key + '.where'))}</span>`
      + (s.locate ? `<button class="btn btn-outline btn-sm sdob-show" id="sdob-show" style="border-color:${s.color};color:${s.color}"><span class="ms ms-sm">my_location</span> ${esc(t('sdob.locate'))}</button>` : '');
    const showBtn = overlay.querySelector('#sdob-show');
    if (showBtn) showBtn.addEventListener('click', () => { close(); sdobLocate(s.locate); });
    dots.innerHTML = SDOB_SLIDES.map((_, k) => `<button class="sdob-dot ${k === i ? 'active' : ''}" data-k="${k}" aria-label="${k + 1}"></button>`).join('');
    dots.querySelectorAll('.sdob-dot').forEach((d) => d.addEventListener('click', () => go(Number(d.dataset.k))));
    backBtn.style.visibility = i === 0 ? 'hidden' : '';
    const last = i === n - 1;
    nextBtn.innerHTML = last
      ? `<span class="ms ms-sm">rocket_launch</span> ${esc(t('sdob.finish'))}`
      : `${esc(t('sdob.next'))} <span class="ms ms-sm">arrow_forward</span>`;
  }
  function go(to) {
    if (to < 0 || to >= n) { if (to >= n) close(); return; }
    i = to; render();
  }

  overlay.querySelector('#sdob-x').addEventListener('click', close);
  overlay.querySelector('#sdob-skip').addEventListener('click', close);
  backBtn.addEventListener('click', () => go(i - 1));
  nextBtn.addEventListener('click', () => go(i + 1));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  render();
}

window.showServiceDeskOnboarding = showServiceDeskOnboarding;
window.maybeShowServiceDeskOnboarding = maybeShowServiceDeskOnboarding;
window.resetServiceDeskOnboarding = resetServiceDeskOnboarding;
