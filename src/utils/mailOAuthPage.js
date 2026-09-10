'use strict';

/**
 * The page a provider drops the browser on after a mailbox connect attempt.
 *
 * It has to be self-contained. The provider redirects the BROWSER here with no
 * session, so this is rendered server-side, standalone — none of public/css or
 * the client i18n is in play. Everything it needs travels inline.
 *
 * Two branches, and the failing one carries more weight than the succeeding one:
 * success is self-evident, whereas this page is the ONLY surface where a
 * provider's refusal (redirect_uri_mismatch, a revoked consent, an expired
 * state) ever reaches a person. So the provider's own words are the centrepiece
 * there, followed by the specific things worth checking — a dead end is not an
 * acceptable last screen.
 *
 * Strings follow the same table + alias shape as handoverLabels: the instance
 * language decides, and anything unmapped falls back to English.
 */

const LABELS = {
  en: {
    okTitle: 'Mailbox connected',
    okBody: 'ITACM can now read and send mail as this account.',
    failTitle: 'Mailbox not connected',
    failBody: 'The provider refused the connection. Nothing was saved.',
    providerSaid: 'What the provider said',
    checkTitle: 'Worth checking',
    checks: [
      'The redirect URI registered with the provider matches the one on the Integrations screen exactly — protocol, host and trailing slash included.',
      'The OAuth client ID and secret belong to that same registration.',
      'The account you signed in with is allowed to grant the requested mailbox access.',
    ],
    back: 'Back to Integrations',
    returning: 'Returning in {n}…',
    appName: 'ITACM',
  },
  tr: {
    okTitle: 'Posta kutusu bağlandı',
    okBody: 'ITACM artık bu hesapla posta okuyup gönderebilir.',
    failTitle: 'Posta kutusu bağlanmadı',
    failBody: 'Sağlayıcı bağlantıyı reddetti. Hiçbir şey kaydedilmedi.',
    providerSaid: 'Sağlayıcının yanıtı',
    checkTitle: 'Kontrol edilecekler',
    checks: [
      'Sağlayıcıya kayıtlı redirect URI, Entegrasyonlar ekranındakiyle birebir aynı olmalı — protokol, alan adı ve sondaki eğik çizgi dahil.',
      'OAuth istemci kimliği ve gizli anahtarı aynı kayda ait olmalı.',
      'Giriş yaptığın hesabın, istenen posta kutusu erişimini verme yetkisi olmalı.',
    ],
    back: 'Entegrasyonlara dön',
    returning: '{n} saniye içinde dönülüyor…',
    appName: 'ITACM',
  },
  de: {
    okTitle: 'Postfach verbunden',
    okBody: 'ITACM kann jetzt mit diesem Konto Mail lesen und senden.',
    failTitle: 'Postfach nicht verbunden',
    failBody: 'Der Anbieter hat die Verbindung abgelehnt. Es wurde nichts gespeichert.',
    providerSaid: 'Antwort des Anbieters',
    checkTitle: 'Zu prüfen',
    checks: [
      'Die beim Anbieter registrierte Redirect-URI muss exakt der auf dem Integrationen-Bildschirm entsprechen — inklusive Protokoll, Host und abschließendem Schrägstrich.',
      'Client-ID und Secret müssen zu derselben Registrierung gehören.',
      'Das angemeldete Konto muss den angeforderten Postfachzugriff gewähren dürfen.',
    ],
    back: 'Zurück zu Integrationen',
    returning: 'Rückkehr in {n}…',
    appName: 'ITACM',
  },
};

const ALIASES = { fr: 'en', es: 'en', it: 'en', pt: 'en', nl: 'en', pl: 'en', ru: 'en', ar: 'en', ja: 'en' };

function labels(lang) {
  const code = String(lang || 'en').slice(0, 2).toLowerCase();
  return LABELS[code] || LABELS[ALIASES[code]] || LABELS.en;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PROVIDER_NAME = { google: 'Google', microsoft: 'Microsoft' };

/**
 * @param {object} o
 * @param {boolean} o.ok
 * @param {string}  [o.email]     the mailbox that was connected
 * @param {string}  [o.provider]  'google' | 'microsoft'
 * @param {string}  [o.message]   the provider's own words, on failure
 * @param {string}  [o.lang]      instance language
 * @param {number}  [o.redirectSeconds] success only; 0 disables
 * @param {string}  [o.nonce]     CSP nonce — without it script-src 'self' drops
 *                                the inline script, and the page silently loses
 *                                both the countdown and the state-stripping
 */
function renderMailOAuthPage({ ok, email, provider, message, lang, redirectSeconds = 4, nonce = '' } = {}) {
  const L = labels(lang);
  const other = PROVIDER_NAME[provider] || (ok ? '' : '');
  const secs = ok ? Math.max(0, Number(redirectSeconds) || 0) : 0;

  // The subject of this page is a LINK between two things, so the link is what
  // it draws: ITACM on one side, the mailbox on the other, and the state of the
  // connection expressed by the rule between them — joined, or broken open.
  // A checkmark badge would say "something succeeded" without saying what.
  const ends = `
    <div class="link" role="img" aria-label="${esc(ok ? L.okTitle : L.failTitle)}">
      <span class="end">${esc(L.appName)}</span>
      <span class="wire ${ok ? 'joined' : 'broken'}"></span>
      <span class="end">${esc(other || (email ? email.split('@')[1] : '—'))}</span>
    </div>`;

  const detail = ok
    ? (email ? `<p class="addr">${esc(email)}</p>` : '')
    : `<div class="said">
         <h2>${esc(L.providerSaid)}</h2>
         <p>${esc(message || '—')}</p>
       </div>
       <div class="checks">
         <h2>${esc(L.checkTitle)}</h2>
         <ul>${L.checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
       </div>`;

  return `<!doctype html>
<html lang="${esc(String(lang || 'en').slice(0, 2))}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ok ? L.okTitle : L.failTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#1b1b24; --muted:#777587; --line:#c7c4d8; --soft:#f0ecf9;
    --brand:#3525cd; --ok:#0d9488; --bad:#ba1a1a; --badbg:#fef2f2;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0; background:#eeeaf6; color:var(--ink);
    font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
    font-size:14px; line-height:1.5; -webkit-font-smoothing:antialiased;
    display:flex; align-items:center; justify-content:center; padding:24px;
  }
  .sheet{
    width:100%; max-width:${ok ? '30rem' : '38rem'};
    background:#fff; border:1px solid var(--line); border-radius:14px;
    padding:30px 30px 26px;
  }
  /* The two ends and the rule between them. */
  .link{display:flex; align-items:center; gap:14px; margin-bottom:22px}
  .end{
    font-size:12.5px; font-weight:600; letter-spacing:.01em; color:var(--muted);
    background:var(--soft); border-radius:999px; padding:5px 12px; white-space:nowrap;
  }
  .wire{flex:1; height:2px; border-radius:2px; position:relative; min-width:36px}
  .wire.joined{background:var(--ok)}
  /* Broken reads as broken: a real gap, not a red line. */
  .wire.broken{
    background:linear-gradient(90deg,var(--bad) 0 38%,transparent 38% 62%,var(--bad) 62% 100%);
  }
  h1{margin:0 0 6px; font-size:22px; font-weight:700; letter-spacing:-.015em}
  .lede{margin:0; color:var(--muted)}
  .addr{
    margin:18px 0 0; font-size:15px; font-weight:600;
    padding:12px 14px; background:var(--soft); border-radius:10px; word-break:break-all;
  }
  .said{margin:20px 0 0; padding:14px 16px; background:var(--badbg);
        border-radius:10px; border:1px solid #f6cfcf}
  .said h2, .checks h2{
    margin:0 0 4px; font-size:12.5px; font-weight:700; color:var(--muted);
  }
  .said p{margin:0; font-weight:600; color:var(--bad); word-break:break-word}
  .checks{margin:20px 0 0}
  .checks ul{margin:6px 0 0; padding-left:18px; color:var(--muted)}
  .checks li+li{margin-top:6px}
  .foot{display:flex; align-items:center; gap:14px; margin-top:24px; flex-wrap:wrap}
  a.btn{
    display:inline-block; text-decoration:none; font-weight:600; font-size:13.5px;
    background:var(--brand); color:#fff; padding:10px 16px; border-radius:9px;
  }
  a.btn:focus-visible{outline:2px solid var(--ink); outline-offset:2px}
  .tick{color:var(--muted); font-size:12.5px}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
<body>
  <main class="sheet">
    ${ends}
    <h1>${esc(ok ? L.okTitle : L.failTitle)}</h1>
    <p class="lede">${esc(ok ? L.okBody : L.failBody)}</p>
    ${detail}
    <div class="foot">
      <a class="btn" href="/#/integrations">${esc(L.back)}</a>
      ${secs ? `<span class="tick" id="tick"></span>` : ''}
    </div>
  </main>
<script${nonce ? ` nonce="${esc(nonce)}"` : ''}>
(function(){
  // The signed state rode in on the query string; it has been consumed, so keep
  // it out of history, bookmarks and the next screenshot.
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  var secs = ${secs};
  if (!secs) return;               // a failure is never auto-dismissed: it has to be read
  var el = document.getElementById('tick');
  var tpl = ${JSON.stringify(L.returning)};
  (function step(){
    if (el) el.textContent = tpl.replace('{n}', secs);
    if (secs-- <= 0) { location.href = '/#/integrations'; return; }
    setTimeout(step, 1000);
  })();
})();
</script>
</body>
</html>`;
}

module.exports = { renderMailOAuthPage };
