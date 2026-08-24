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

// Slide model: an accent colour, a hero icon, and t()-keys for the copy.
const SDOB_SLIDES = [
  { icon: 'support_agent', color: '#4f46e5', key: 'welcome', bullets: 3 },
  { icon: 'confirmation_number', color: '#2563eb', key: 'tickets', bullets: 4 },
  { icon: 'how_to_reg', color: '#7c3aed', key: 'approvals', bullets: 4 },
  { icon: 'account_tree', color: '#0891b2', key: 'workflow', bullets: 3 },
  { icon: 'menu_book', color: '#059669', key: 'portal', bullets: 4 },
  { icon: 'insights', color: '#d97706', key: 'reports', bullets: 3 },
];

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
    hero.innerHTML = `<span class="sdob-hero-icon" style="background:${s.color}"><span class="ms">${s.icon}</span></span>`;
    badge.textContent = t('sdob.badge').replace('{i}', i + 1).replace('{n}', n);
    title.textContent = t('sdob.' + s.key + '.title');
    desc.textContent = t('sdob.' + s.key + '.desc');
    const items = [];
    for (let b = 1; b <= s.bullets; b++) items.push(t('sdob.' + s.key + '.b' + b));
    bullets.innerHTML = items.map((x) => `<li><span class="ms ms-sm" style="color:${s.color}">check_circle</span> ${esc(x)}</li>`).join('');
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
