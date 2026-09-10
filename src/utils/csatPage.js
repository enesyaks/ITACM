'use strict';

/**
 * The page a requester lands on from the rating links in a resolution email.
 *
 * Self-contained for the same reason the mailbox-OAuth page is: whoever follows
 * this link has no session and may have no account at all — the whole point is
 * that people outside the app can answer — so none of public/css or the client
 * i18n is in play. Everything it needs travels inline.
 *
 * It asks for one more click than the link already carried, and that is
 * deliberate: mail providers follow links in messages to scan them, and a score
 * recorded by a scanner is worse than no score, because it is indistinguishable
 * from a real one. So the link chooses a rating, and the person confirms it.
 *
 * Strings follow the handoverLabels table + alias shape: the instance language
 * decides, and anything unmapped falls back to English.
 */

const LABELS = {
  en: {
    title: 'How did we do?',
    lede: 'Your request {n} was resolved. One star is poor, five is excellent.',
    resolution: 'What was done',
    commentLabel: 'Anything you would like to add? (optional)',
    commentPh: 'What worked, what did not…',
    send: 'Send my rating',
    pick: 'Pick a rating first',
    thanksTitle: 'Thank you',
    thanksBody: 'Your rating for {n} has been recorded.',
    goneTitle: 'This rating link is not valid',
    goneBody: 'It may have been replaced by a newer message, or the ticket may have been removed.',
    notResolved: 'This request is not resolved yet, so there is nothing to rate.',
    ratedTitle: 'Already rated',
    ratedBody: 'You gave {n} {r} out of 5. A ticket is rated once, so this link is now closed.',
    expiredTitle: 'This rating link has closed',
    expiredBody: 'Ratings are open for {d} days after a request is resolved. If something is still wrong, reply to the email and it lands back on the ticket.',
    window: 'This link is open for {d} days and can be used once.',
    stars: ['Poor', 'Not great', 'Fine', 'Good', 'Excellent'],
  },
  tr: {
    title: 'Nasıldık?',
    lede: '{n} numaralı talebiniz çözüldü. Bir yıldız kötü, beş yıldız çok iyi.',
    resolution: 'Yapılan işlem',
    commentLabel: 'Eklemek istediğiniz bir şey var mı? (isteğe bağlı)',
    commentPh: 'Ne iyi gitti, ne gitmedi…',
    send: 'Değerlendirmemi gönder',
    pick: 'Önce bir puan seçin',
    thanksTitle: 'Teşekkürler',
    thanksBody: '{n} için değerlendirmeniz kaydedildi.',
    goneTitle: 'Bu değerlendirme bağlantısı geçerli değil',
    goneBody: 'Daha yeni bir mesajla değişmiş ya da kayıt kaldırılmış olabilir.',
    notResolved: 'Bu talep henüz çözülmedi, değerlendirilecek bir şey yok.',
    ratedTitle: 'Zaten değerlendirildi',
    ratedBody: '{n} için 5 üzerinden {r} verdiniz. Bir talep bir kez değerlendirilir, bu bağlantı artık kapalı.',
    expiredTitle: 'Bu değerlendirme bağlantısı kapandı',
    expiredBody: 'Değerlendirme, talep çözüldükten sonra {d} gün açık kalır. Hâlâ bir sorun varsa maili yanıtlayın, doğrudan kaydın altına düşer.',
    window: 'Bu bağlantı {d} gün açık ve bir kez kullanılabilir.',
    stars: ['Kötü', 'İdare eder', 'Fena değil', 'İyi', 'Çok iyi'],
  },
  de: {
    title: 'Wie waren wir?',
    lede: 'Ihre Anfrage {n} wurde gelöst. Ein Stern ist schlecht, fünf sind ausgezeichnet.',
    resolution: 'Was getan wurde',
    commentLabel: 'Möchten Sie etwas ergänzen? (optional)',
    commentPh: 'Was hat funktioniert, was nicht…',
    send: 'Bewertung senden',
    pick: 'Bitte zuerst eine Bewertung wählen',
    thanksTitle: 'Danke',
    thanksBody: 'Ihre Bewertung für {n} wurde gespeichert.',
    goneTitle: 'Dieser Bewertungslink ist ungültig',
    goneBody: 'Er wurde möglicherweise durch eine neuere Nachricht ersetzt, oder das Ticket wurde entfernt.',
    notResolved: 'Diese Anfrage ist noch nicht gelöst, es gibt nichts zu bewerten.',
    ratedTitle: 'Bereits bewertet',
    ratedBody: 'Sie haben {n} mit {r} von 5 bewertet. Ein Ticket wird einmal bewertet, dieser Link ist nun geschlossen.',
    expiredTitle: 'Dieser Bewertungslink ist geschlossen',
    expiredBody: 'Bewertungen sind {d} Tage nach der Lösung möglich. Wenn etwas weiterhin nicht stimmt, antworten Sie auf die E-Mail — sie landet wieder am Ticket.',
    window: 'Dieser Link ist {d} Tage offen und einmal verwendbar.',
    stars: ['Schlecht', 'Mäßig', 'Geht so', 'Gut', 'Ausgezeichnet'],
  },
};

const ALIASES = { fr: 'en', es: 'en', it: 'en', pt: 'en', nl: 'en', pl: 'en', ru: 'en', ar: 'en', ja: 'en' };

function labels(lang) {
  const code = String(lang || 'en').slice(0, 2).toLowerCase();
  return LABELS[code] || LABELS[ALIASES[code]] || LABELS.en;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE = `
  :root{
    --ink:#1b1b24; --muted:#777587; --line:#c7c4d8; --soft:#f0ecf9;
    --brand:#3525cd; --star:#e8a33d; --ok:#0d9488; --bad:#ba1a1a;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0; background:#eeeaf6; color:var(--ink);
    font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
    font-size:14px; line-height:1.5; -webkit-font-smoothing:antialiased;
    display:flex; align-items:center; justify-content:center; padding:24px;
  }
  .sheet{width:100%; max-width:32rem; background:#fff; border:1px solid var(--line);
    border-radius:14px; padding:30px 30px 26px}
  .eyebrow{font-size:12.5px; color:var(--muted); margin:0 0 6px}
  h1{margin:0 0 6px; font-size:22px; font-weight:700; letter-spacing:-.015em}
  .lede{margin:0 0 20px; color:var(--muted)}
  .note{margin:0 0 20px; padding:12px 14px; background:var(--soft); border-radius:10px;
    border-left:3px solid var(--ok); white-space:pre-wrap}
  .note h2{margin:0 0 4px; font-size:12.5px; font-weight:700; color:var(--muted)}
  /* Radios, not buttons: the choice has to survive with no JavaScript at all.
     The five are written 5→1 and laid out in reverse, which is what lets a
     checked star light every star below it with a sibling selector — four out
     of five has to look like four stars, not like the fourth one. */
  .stars{display:flex; flex-direction:row-reverse; justify-content:flex-end; gap:6px; margin:0 0 6px}
  .stars input{position:absolute; opacity:0; width:0; height:0}
  .stars label{cursor:pointer; font-size:34px; line-height:1; color:var(--line);
    transition:color .12s, transform .12s; user-select:none}
  .stars label:hover{transform:translateY(-2px)}
  .stars input:checked ~ label{color:var(--star)}
  .stars input:checked + label{color:var(--star)}
  .stars:hover label{color:var(--line)}
  .stars label:hover, .stars label:hover ~ label{color:var(--star)}
  .stars input:focus-visible + label{outline:2px solid var(--brand); outline-offset:3px; border-radius:4px}
  /* The thank-you state is not a control: plain characters, gold, left aligned. */
  .done-stars{margin:0; font-size:30px; line-height:1; letter-spacing:4px; color:var(--star)}
  .starname{min-height:18px; margin:0 0 18px; font-size:12.5px; color:var(--muted)}
  label.field{display:block; font-size:12.5px; font-weight:600; color:var(--muted); margin:0 0 6px}
  textarea{width:100%; min-height:84px; padding:10px 12px; font:inherit; color:inherit;
    border:1px solid var(--line); border-radius:10px; background:#fff; resize:vertical}
  textarea:focus{outline:2px solid var(--brand); outline-offset:1px; border-color:transparent}
  button{margin-top:16px; font:inherit; font-weight:600; font-size:13.5px; cursor:pointer;
    background:var(--brand); color:#fff; border:0; padding:11px 18px; border-radius:9px}
  button:focus-visible{outline:2px solid var(--ink); outline-offset:2px}
  .msg{margin:14px 0 0; font-size:13px}
  .msg.bad{color:var(--bad)}
  .foot{margin:22px 0 0; padding-top:14px; border-top:1px solid #ececf4; color:#8a889c; font-size:12px}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

function shell({ lang, title, inner }) {
  return `<!doctype html>
<html lang="${esc(String(lang || 'en').slice(0, 2))}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${STYLE}</style>
<body><main class="sheet">${inner}</main></body>
</html>`;
}

/**
 * @param {object} o
 * @param {object} [o.ticket]   { number, subject, resolutionNote, csatRating }
 * @param {number} [o.picked]   1-5, the star the link carried
 * @param {string} [o.token]    posted back on submit
 * @param {string} [o.error]    'gone' | 'not_resolved' | a message to show
 * @param {boolean} [o.done]    the rating was recorded
 * @param {string} [o.company]
 * @param {string} [o.lang]
 * @param {string} [o.nonce]   CSP nonce for the inline script; without it the
 *                             page still works, it just stops narrating the star
 * @returns {string} a complete HTML document
 */
function renderCsatPage({ ticket, picked = 0, token = '', error = '', done = false, company = 'ITACM', lang, nonce = '', windowDays = 30 } = {}) {
  const L = labels(lang);
  const foot = `<div class="foot">${esc(company)}</div>`;

  if (error === 'gone' || !ticket) {
    return shell({ lang, title: L.goneTitle, inner:
      `<h1>${esc(L.goneTitle)}</h1><p class="lede">${esc(L.goneBody)}</p>${foot}` });
  }
  if (done) {
    return shell({ lang, title: L.thanksTitle, inner:
      `<p class="eyebrow">${esc(company)}</p>
       <h1>${esc(L.thanksTitle)}</h1>
       <p class="lede">${esc(L.thanksBody.replace('{n}', ticket.number))}</p>
       <p class="done-stars" role="img" aria-label="${picked}/5">${'★'.repeat(picked)}${'☆'.repeat(5 - picked)}</p>
       ${foot}` });
  }
  if (error === 'not_resolved') {
    return shell({ lang, title: L.title, inner:
      `<p class="eyebrow">${esc(company)}</p><h1>${esc(L.title)}</h1>
       <p class="lede">${esc(L.notResolved)}</p>${foot}` });
  }
  // A link that has been used, and one that has run out of time, are dead ends
  // with something to say: what the score was, or where to go instead.
  if (error === 'rated') {
    return shell({ lang, title: L.ratedTitle, inner:
      `<p class="eyebrow">${esc(company)}</p>
       <h1>${esc(L.ratedTitle)}</h1>
       <p class="lede">${esc(L.ratedBody.replace('{n}', ticket.number).replace('{r}', ticket.csatRating || '—'))}</p>
       <p class="done-stars" role="img" aria-label="${ticket.csatRating || 0}/5">${'★'.repeat(ticket.csatRating || 0)}${'☆'.repeat(5 - (ticket.csatRating || 0))}</p>
       ${foot}` });
  }
  if (error === 'expired') {
    return shell({ lang, title: L.expiredTitle, inner:
      `<p class="eyebrow">${esc(company)}</p>
       <h1>${esc(L.expiredTitle)}</h1>
       <p class="lede">${esc(L.expiredBody.replace('{d}', windowDays))}</p>${foot}` });
  }

  const star = (n) => `<input type="radio" name="rating" id="r${n}" value="${n}"${n === picked ? ' checked' : ''}>
    <label for="r${n}" title="${esc(L.stars[n - 1])}" aria-label="${n} / 5">★</label>`;

  return shell({ lang, title: L.title, inner:
    `<p class="eyebrow">${esc(company)}</p>
     <h1>${esc(L.title)}</h1>
     <p class="lede">${esc(L.lede.replace('{n}', ticket.number))}</p>
     ${ticket.resolutionNote ? `<div class="note"><h2>${esc(L.resolution)}</h2>${esc(ticket.resolutionNote)}</div>` : ''}
     <form method="POST" action="/csat/${esc(token)}">
       <div class="stars" id="stars">${[5, 4, 3, 2, 1].map(star).join('')}</div>
       <p class="starname" id="starname">${picked ? esc(L.stars[picked - 1]) : ''}</p>
       <label class="field" for="comment">${esc(L.commentLabel)}</label>
       <textarea id="comment" name="comment" maxlength="4000" placeholder="${esc(L.commentPh)}"></textarea>
       <button type="submit">${esc(L.send)}</button>
       <p class="msg" style="color:var(--muted)">${esc(L.window.replace('{d}', windowDays))}</p>
       ${error && error !== 'gone' && error !== 'not_resolved' ? `<p class="msg bad">${esc(error)}</p>` : ''}
     </form>
     ${foot}
     <script${nonce ? ` nonce="${esc(nonce)}"` : ''}>
       // Progressive only: the radios already carry the choice without this.
       (function(){
         var names = ${JSON.stringify(L.stars)};
         var out = document.getElementById('starname');
         document.getElementById('stars').addEventListener('change', function (e) {
           if (e.target && e.target.value) out.textContent = names[Number(e.target.value) - 1] || '';
         });
       })();
     </script>` });
}

module.exports = { renderCsatPage };
