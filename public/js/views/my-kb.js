/* ===================== KNOWLEDGE BASE (portal self-service) ===================== */

Views.myKb = async function (el) {
  let searchTerm = '';
  const cardHtml = (a) => `<div class="card card-pad kb-card" data-open="${esc(a.id)}" style="cursor:pointer;margin-bottom:10px">
      <div class="cell-title">${esc(a.title)}</div>
      ${a.category ? `<div class="cell-sub" style="margin-top:2px"><span class="ms ms-sm" style="vertical-align:-3px">sell</span> ${esc(a.category)}</div>` : ''}
    </div>`;

  async function refresh() {
    const list = await api('/me/kb?search=' + encodeURIComponent(searchTerm)).catch(() => []);
    const box = $('#mkb-list', el);
    if (box) box.innerHTML = (Array.isArray(list) && list.length) ? list.map(cardHtml).join('')
      : `<div class="table-empty" style="padding:24px">${esc(t('kb.noneEmp'))}</div>`;
    el.querySelectorAll('.kb-card[data-open]').forEach((c) => c.addEventListener('click', () => openArticle(c.dataset.open)));
  }

  const list = await api('/me/kb').catch(() => []);
  el.innerHTML = `
    ${pageHead(t('mkb.title'), t('mkb.subtitle'), '')}
    <div class="card card-pad" style="margin-bottom:14px">
      <input type="search" id="mkb-search" class="ops-select" placeholder="${esc(t('kb.searchPh'))}" style="min-width:280px;width:100%;max-width:480px"></div>
    <div id="mkb-list">${(Array.isArray(list) && list.length) ? list.map(cardHtml).join('')
      : `<div class="table-empty" style="padding:24px">${esc(t('kb.noneEmp'))}</div>`}</div>`;

  el.querySelectorAll('.kb-card[data-open]').forEach((c) => c.addEventListener('click', () => openArticle(c.dataset.open)));
  let searchTimer = null;
  $('#mkb-search', el).addEventListener('input', (e) => { searchTerm = e.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(refresh, 300); });

  async function openArticle(id) {
    const a = await api('/me/kb/' + encodeURIComponent(id)).catch((e) => { toast(e.message, 'error'); return null; });
    if (!a) return;
    openModal({
      title: a.title,
      wide: true,
      body: `${a.category ? `<div style="margin-bottom:12px"><span class="pill pill-slate">${esc(a.category)}</span></div>` : ''}
        <div class="tk-desc" style="line-height:1.6">${esc(a.body || '—').replace(/\n/g, '<br>')}</div>
        <div id="mkb-attach" class="kb-attach" style="margin-top:12px"></div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>`,
      async onMount(ov) {
        const docs = await api('/me/kb/' + encodeURIComponent(id) + '/documents').catch(() => []);
        kbRenderAttachments($('#mkb-attach', ov), Array.isArray(docs) ? docs : [], (docId) => '/api/me/kb/' + encodeURIComponent(id) + '/documents/' + docId + '/download');
      },
    });
  }
};
