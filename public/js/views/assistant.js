'use strict';

(function () {
  let root = null;
  let busy = false;
  let statusLabel = '';
  let aiEnabled = false;
  let expanded = false;
  let soundEnabled = false;
  const HISTORY_KEY = 'itacm_ai_history_v1';
  const SOUND_KEY = 'itacm_ai_sound_v1';
  const MAX_PERSISTED = 25;

  const history = [];

  let audioCtx = null;
  function playChime(type = 'sent') {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      if (type === 'sent') {
        osc.frequency.setValueAtTime(520, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(784, audioCtx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + 0.15);
      } else if (type === 'received') {
        osc.frequency.setValueAtTime(659, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.18);
        gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + 0.2);
      }
    } catch { /* ignore audio errors */ }
  }

  function loadSoundPref() {
    try { soundEnabled = localStorage.getItem(SOUND_KEY) === 'true'; } catch { soundEnabled = false; }
  }

  function saveSoundPref(val) {
    soundEnabled = !!val;
    try { localStorage.setItem(SOUND_KEY, String(soundEnabled)); } catch { /* ignore */ }
  }

  function loadPersistedThread() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  }

  function savePersistedThread(msgs) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-MAX_PERSISTED))); } catch { /* ignore */ }
  }

  function clearPersistedThread() {
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
  }

  function isStaffUi() {
    if (!Auth.profile) return false;
    if (typeof isPortalUser === 'function' && isPortalUser()) return false;
    if (typeof isHrUser === 'function' && isHrUser()) return false;
    return true;
  }

  function renderMarkdown(raw) {
    if (!raw) return '';
    let s = String(raw);
    s = s.replace(/(^|\n)\s*\|.+\|(\s*\n\|?[\s\-:|]+\|)*(\s*\n\s*\|.+\|)*/g, '\n');
    s = s.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, code) => `<code class="ai-code-block">${esc(code.trim())}</code>`);
    s = esc(s);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>');
    s = s.replace(/(^|\n)[ \t]*[-•][ \t]+(.+)/g, '$1<li>$2</li>');
    s = s.replace(/(<li>[\s\S]*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
    s = s.replace(/\n/g, '<br>');
    s = s.replace(/&lt;code class=&quot;/g, '<code class="')
         .replace(/&lt;\/code&gt;/g, '</code>')
         .replace(/&quot;&gt;/g, '">');
    return s;
  }

  const QUICK_PROMPT_KEYS = [
    { icon: 'inventory_2', key: 'ai.qpStock' },
    { icon: 'bar_chart', key: 'ai.qpLocationDist' },
    { icon: 'assignment_turned_in', key: 'ai.qpContracts' },
    { icon: 'warning_amber', key: 'ai.qpEol' },
  ];

  function quickPrompts() {
    return QUICK_PROMPT_KEYS.map((qp) => ({
      icon: qp.icon,
      label: t(qp.key),
      prompt: t(`${qp.key}Prompt`),
    }));
  }

  function uiLang() {
    return typeof i18nLang === 'function' ? i18nLang() : 'en';
  }

  function tf(key, vars) {
    return String(t(key)).replace(/\{(\w+)\}/g, (m, name) => (vars[name] != null ? String(vars[name]) : m));
  }

  function ensureRoot() {
    if (root) return root;
    loadSoundPref();
    root = document.createElement('div');
    root.id = 'ai-panel-root';
    root.innerHTML = `
      <button type="button" class="ai-launcher" id="ai-launcher" hidden
        data-i18n-title="ai.launcherTitle" data-i18n-aria="ai.title" title="Assistant (Cmd+K)" aria-label="Assistant">
        <span class="ai-launcher-mark"><span class="ms">auto_awesome</span></span>
        <span class="ai-launcher-text" data-i18n="ai.title">Assistant</span>
        <span class="ai-kbd-badge">⌘K</span>
      </button>
      <div class="ai-backdrop" data-ai-close hidden></div>
      <aside class="ai-panel" id="ai-panel" aria-hidden="true" role="dialog"
        data-i18n-aria="ai.title" aria-label="Assistant">
        <header class="ai-head">
          <div class="ai-brand">
            <span class="ai-mark"><span class="ms">auto_awesome</span></span>
            <strong data-i18n="ai.title">Assistant</strong>
          </div>
          <div class="ai-head-right">
            <span class="ai-pill" id="ai-status-pill" hidden></span>
            <button type="button" class="icon-btn" id="ai-sound-btn"
              data-i18n-title="ai.sound" data-i18n-aria="ai.sound" title="Sound effects" aria-label="Sound effects">
              <span class="ms">${soundEnabled ? 'volume_up' : 'volume_off'}</span>
            </button>
            <button type="button" class="icon-btn" id="ai-expand-btn"
              data-i18n-title="ai.fullscreen" data-i18n-aria="ai.fullscreen" title="Fullscreen" aria-label="Fullscreen">
              <span class="ms">open_in_full</span>
            </button>
            <button type="button" class="icon-btn ai-clear-btn" id="ai-clear-btn"
              data-i18n-title="ai.clearChat" data-i18n-aria="ai.clearChat" title="Clear chat" aria-label="Clear chat">
              <span class="ms">delete_sweep</span>
            </button>
            <button type="button" class="icon-btn" data-ai-close data-i18n-title="common.close" title="Close" aria-label="Close">
              <span class="ms">close</span>
            </button>
          </div>
        </header>
        <div class="ai-thread" id="ai-thread"></div>
        <footer class="ai-foot">
          <form id="ai-form" class="ai-form" autocomplete="off">
            <input type="text" id="ai-input" maxlength="4000"
              data-i18n-ph="ai.placeholder" placeholder="Ask your inventory…" />
            <button type="submit" class="ai-send" id="ai-send" aria-label="Send">
              <span class="ms">arrow_upward</span>
            </button>
          </form>
        </footer>
      </aside>`;
    document.body.appendChild(root);

    $('#ai-launcher', root).addEventListener('click', () => toggleAssistant());
    root.querySelectorAll('[data-ai-close]').forEach((el) => {
      el.addEventListener('click', closeAssistant);
    });
    $('#ai-form', root).addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#ai-input', root);
      const q = (input.value || '').trim();
      if (!q || busy) return;
      input.value = '';
      askAssistant(q).catch((err) => toast(err.message || t('ai.error'), 'error'));
    });
    $('#ai-clear-btn', root).addEventListener('click', clearThread);
    $('#ai-expand-btn', root).addEventListener('click', toggleExpand);
    $('#ai-sound-btn', root).addEventListener('click', toggleSound);

    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'j')) {
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && !document.activeElement?.isContentEditable) {
          e.preventDefault();
          toggleAssistant();
        }
      }
    });

    return root;
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    saveSoundPref(soundEnabled);
    const btn = $('#ai-sound-btn', root);
    if (btn) {
      btn.innerHTML = `<span class="ms">${soundEnabled ? 'volume_up' : 'volume_off'}</span>`;
    }
    toast(t(soundEnabled ? 'ai.soundOn' : 'ai.soundOff'), 'info');
  }

  function toggleExpand() {
    ensureRoot();
    expanded = !expanded;
    const panel = $('#ai-panel', root);
    const backdrop = root.querySelector('.ai-backdrop');
    const btn = $('#ai-expand-btn', root);

    panel.classList.toggle('ai-panel-expanded', expanded);
    if (backdrop) backdrop.hidden = !expanded && !document.body.classList.contains('ai-open');
    if (btn) btn.innerHTML = `<span class="ms">${expanded ? 'close_fullscreen' : 'open_in_full'}</span>`;
  }

  function applyAiI18n() {
    if (!root) return;
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
  }

  function setLauncherVisible(on) {
    ensureRoot();
    const btn = $('#ai-launcher', root);
    if (!btn) return;
    btn.hidden = !on;
    document.body.classList.toggle('ai-launcher-on', !!on);
  }

  function showWelcome() {
    const thread = threadEl();
    if (!thread) return;
    const prompts = quickPrompts();
    const welcome = document.createElement('div');
    welcome.className = 'ai-welcome';
    welcome.id = 'ai-welcome-block';
    welcome.innerHTML = `
      <div class="ai-welcome-icon"><span class="ms">auto_awesome</span></div>
      <h3 class="ai-welcome-title">${esc(t('ai.brand'))}</h3>
      <p class="ai-welcome-sub">${esc(t('ai.welcomeSub'))}</p>
      <div class="ai-chips">
        ${prompts.map((qp, i) => `
          <button type="button" class="ai-chip" data-chip="${i}">
            <span class="ms ai-chip-icon">${qp.icon}</span>
            <span>${esc(qp.label)}</span>
          </button>`).join('')}
      </div>`;
    thread.appendChild(welcome);

    welcome.querySelectorAll('[data-chip]').forEach((btn) => {
      const idx = Number(btn.dataset.chip);
      btn.addEventListener('click', () => {
        removeWelcome();
        askAssistant(prompts[idx].prompt).catch((err) => toast(err.message || t('ai.error'), 'error'));
      });
    });
  }

  function removeWelcome() {
    const w = document.getElementById('ai-welcome-block');
    if (w) w.remove();
  }

  function clearThread() {
    history.splice(0, history.length);
    clearPersistedThread();
    const thread = threadEl();
    if (thread) thread.innerHTML = '';
    showWelcome();
  }

  function restoreThread() {
    const msgs = loadPersistedThread();
    if (!msgs.length) {
      showWelcome();
      return;
    }
    for (const m of msgs) {
      if (m.role === 'user') {
        appendUserBubble(m.content);
        history.push({ role: 'user', content: m.content });
      } else if (m.role === 'assistant') {
        const shell = appendAssistantShell();
        const bubble = shell.querySelector('.ai-bubble-assistant');
        bubble.innerHTML = renderMarkdown(m.content);
        if (m.rows?.length) {
          const rowsEl = shell.querySelector('.ai-rows');
          renderRows(rowsEl, m.rows);
        }
        if (m.ui) {
          const actionsEl = shell.querySelector('.ai-actions');
          renderActions(actionsEl, m.ui);
        }
        attachCopyBtn(shell, m.content);
        history.push({ role: 'assistant', content: m.content });
      }
    }
    scrollThread();
  }

  function openAssistant(seedPrompt) {
    if (!isStaffUi() || !aiEnabled) return;
    ensureRoot();
    document.body.classList.add('ai-open');
    const panel = $('#ai-panel', root);
    const backdrop = root.querySelector('.ai-backdrop');
    panel.setAttribute('aria-hidden', 'false');
    if (backdrop && expanded) backdrop.hidden = false;
    applyAiI18n();
    refreshStatus().catch(() => {});

    const thread = threadEl();
    if (thread && !thread.hasChildNodes()) restoreThread();

    const input = $('#ai-input', root);
    setTimeout(() => input && input.focus(), 50);
    if (seedPrompt) askAssistant(seedPrompt).catch((err) => toast(err.message || t('ai.error'), 'error'));
  }

  function closeAssistant() {
    if (!root) return;
    document.body.classList.remove('ai-open');
    const panel = $('#ai-panel', root);
    const backdrop = root.querySelector('.ai-backdrop');
    if (panel) panel.setAttribute('aria-hidden', 'true');
    if (backdrop) backdrop.hidden = true;
  }

  function toggleAssistant() {
    if (!aiEnabled || !isStaffUi()) return;
    if (document.body.classList.contains('ai-open')) closeAssistant();
    else openAssistant();
  }

  async function refreshStatus() {
    try {
      const data = await api(`/ai/status?lang=${encodeURIComponent(uiLang())}`);
      statusLabel = data.label || '';
      const pill = $('#ai-status-pill', root);
      if (!pill) return;
      if (statusLabel) {
        pill.hidden = false;
        pill.textContent = statusLabel;
        pill.classList.add('ai-pill-live');
      } else {
        pill.hidden = true;
      }
    } catch {
    }
  }

  async function syncAssistantChrome() {
    try {
      ensureRoot();
      applyAiI18n();
      if (!isStaffUi()) {
        aiEnabled = false;
        setLauncherVisible(false);
        closeAssistant();
        return false;
      }
      const data = await api(`/ai/status?lang=${encodeURIComponent(uiLang())}`);
      aiEnabled = !!data && !!data.enabled;
      statusLabel = (data && data.label) || '';
      setLauncherVisible(aiEnabled);
      if (!aiEnabled) closeAssistant();
      return aiEnabled;
    } catch {
      aiEnabled = false;
      try { setLauncherVisible(false); closeAssistant(); } catch { /* ignore */ }
      return false;
    }
  }

  function teardownAssistantChrome() {
    aiEnabled = false;
    closeAssistant();
    if (root) setLauncherVisible(false);
    document.body.classList.remove('ai-launcher-on', 'ai-open');
  }

  function threadEl() {
    return $('#ai-thread', root);
  }

  function scrollThread() {
    const el = threadEl();
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  function appendUserBubble(text) {
    const el = document.createElement('div');
    el.className = 'ai-msg ai-msg-user';
    el.innerHTML = `<div class="ai-bubble">${esc(text)}</div>`;
    threadEl().appendChild(el);
    scrollThread();
    return el;
  }

  function appendAssistantShell() {
    const el = document.createElement('div');
    el.className = 'ai-msg ai-msg-assistant';
    el.innerHTML = `
      <div class="ai-tools-line" hidden></div>
      <div class="ai-bubble ai-bubble-assistant"><span class="ai-typing"><span></span><span></span><span></span></span></div>
      <div class="ai-metrics" hidden></div>
      <div class="ai-chart" hidden></div>
      <div class="ai-table" hidden></div>
      <div class="ai-rows" hidden></div>
      <div class="ai-actions" hidden></div>
      <div class="ai-meta-line" hidden></div>
      <div class="ai-followups" hidden></div>`;
    threadEl().appendChild(el);
    scrollThread();
    return el;
  }

  function attachCopyBtn(shell, text) {
    if (!text || shell.querySelector('.ai-copy-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-copy-btn icon-btn';
    btn.title = t('ai.copy');
    btn.setAttribute('aria-label', t('ai.copy'));
    btn.innerHTML = '<span class="ms">content_copy</span>';
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = '<span class="ms">check</span>';
        setTimeout(() => { btn.innerHTML = '<span class="ms">content_copy</span>'; }, 1800);
      }).catch(() => toast(t('ai.copyFailed'), 'error'));
    });
    const bubble = shell.querySelector('.ai-bubble-assistant');
    if (bubble) bubble.appendChild(btn);
  }

  function renderMetrics(container, metrics) {
    if (!Array.isArray(metrics) || !metrics.length) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    container.hidden = false;
    container.innerHTML = metrics.slice(0, 4).map((m) =>
      `<span class="ai-metric"><b>${esc(String(m.value))}</b> ${esc(m.label || '')}</span>`
    ).join('');
  }

  function renderTable(container, table) {
    if (!container) return;
    if (!table || !Array.isArray(table.columns) || !table.columns.length || !Array.isArray(table.rows)) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    const cols = table.columns;
    const cell = (v) => {
      if (v == null) return '<span class="ai-tbl-null">—</span>';
      if (typeof v === 'object') return esc(JSON.stringify(v));
      return esc(String(v));
    };
    const head = cols.map((c) => `<th>${esc(c)}</th>`).join('');
    const body = table.rows
      .map((r) => `<tr>${cols.map((c) => `<td>${cell(r[c])}</td>`).join('')}</tr>`)
      .join('');
    const sqlBlock = table.sql
      ? `<details class="ai-sql"><summary><span class="ms ms-sm">code</span> ${esc(i18nOr('ai.showSql', 'SQL'))}</summary><pre>${esc(table.sql)}</pre></details>`
      : '';
    container.hidden = false;
    container.innerHTML = sqlBlock + `<div class="ai-tbl-scroll"><table class="ai-tbl">`
      + `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function renderChart(container, chart) {
    if (!chart || !Array.isArray(chart.items) || !chart.items.length) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    container.hidden = false;
    const colors = ['#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#2dd4bf', '#fb923c', '#94a3b8'];
    const items = chart.items.slice(0, 12);
    const type = chart.type === 'pie' ? 'pie' : 'bar';

    if (type === 'pie') {
      const total = items.reduce((s, x) => s + (Number(x.value) || 0), 0) || 1;
      let angle = -Math.PI / 2;
      const cx = 70;
      const cy = 70;
      const r = 54;
      const ir = 30;
      const wedges = items.map((it, i) => {
        const frac = Math.max(0, (Number(it.value) || 0) / total);
        const sweep = frac * Math.PI * 2;
        const a0 = angle;
        const a1 = angle + sweep;
        angle = a1;
        if (sweep <= 0.0001) return '';
        const x0 = cx + r * Math.cos(a0);
        const y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1);
        const y1 = cy + r * Math.sin(a1);
        const xi0 = cx + ir * Math.cos(a1);
        const yi0 = cy + ir * Math.sin(a1);
        const xi1 = cx + ir * Math.cos(a0);
        const yi1 = cy + ir * Math.sin(a0);
        const large = sweep > Math.PI ? 1 : 0;
        const d = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi0} ${yi0} A ${ir} ${ir} 0 ${large} 0 ${xi1} ${yi1} Z`;
        return `<path d="${d}" fill="${colors[i % colors.length]}"><title>${esc(it.label)}: ${it.value}</title></path>`;
      }).join('');
      const legend = items.map((it, i) =>
        `<span class="ai-chart-legend-item"><i style="background:${colors[i % colors.length]}"></i>${esc(it.label)} <b>${esc(String(it.value))}</b></span>`
      ).join('');
      container.innerHTML = `
        <div class="ai-chart-pie-wrap">
          <svg class="ai-chart-pie" viewBox="0 0 140 140" width="120" height="120" role="img" aria-label="distribution">
            ${wedges}
            <text x="70" y="74" text-anchor="middle" font-size="14" font-weight="700" fill="#e2e8f0">${total}</text>
          </svg>
          <div class="ai-chart-legend">${legend}</div>
        </div>`;
      return;
    }

    const max = Math.max(...items.map((x) => Number(x.value) || 0), 1);
    container.innerHTML = `<div class="ai-chart-bars" role="img" aria-label="distribution">
      ${items.map((it, i) => {
        const val = Number(it.value) || 0;
        const pct = it.pct != null ? Number(it.pct) : Math.round((val / max) * 100);
        const width = Math.max(4, Math.round((val / max) * 100));
        return `<div class="ai-chart-bar-row">
          <span class="ai-chart-bar-label" title="${esc(it.label)}">${esc(it.label)}</span>
          <span class="ai-chart-bar-track"><span class="ai-chart-bar-fill" style="width:${width}%;background:${colors[i % colors.length]}"></span></span>
          <span class="ai-chart-bar-val">${esc(String(val))}${pct != null && !Number.isNaN(pct) ? ` <small>${esc(String(pct))}%</small>` : ''}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  function renderRows(container, rows) {
    if (!rows?.length) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    container.hidden = false;

    const itemsCount = rows.filter((r) => r.kind !== 'section').length;
    const showFilter = itemsCount > 3;

    const filterHtml = showFilter ? `
      <div class="ai-rows-filter">
        <span class="ms ms-sm">search</span>
        <input type="text" class="ai-card-search" placeholder="${esc(tf('ai.filterCards', { n: itemsCount }))}" />
      </div>` : '';

    const cardsHtml = rows.map((r, i) => {
      if (r.kind === 'section') {
        return `<div class="ai-row ai-row-section" data-row-idx="${i}" role="separator">
          <strong>${esc(r.title || '')}</strong>
        </div>`;
      }
      const tags = (r.tags || []).map((tg) => {
        const cls = /EOL/i.test(tg)
          ? 'ai-tag-eol'
          : (/zimmet|assigned/i.test(tg) ? 'ai-tag-assigned' : (/stok|stock/i.test(tg) ? 'ai-tag-stock' : ''));
        return `<span class="ai-tag ${cls}">${esc(tg)}</span>`;
      }).join('');
      const href = r.href ? `href="${esc(r.href)}"` : '';
      const textToSearch = `${r.title || ''} ${r.subtitle || ''} ${(r.tags || []).join(' ')}`.toLowerCase();
      return `<a class="ai-row" data-row-idx="${i}" data-search-str="${esc(textToSearch)}" ${href}>
        <span class="ai-row-body">
          <strong>${esc(r.title || '—')}</strong>
          <small>${esc(r.subtitle || '')}</small>
        </span>
        <span class="ai-row-tags">${tags}</span>
      </a>`;
    }).join('');

    container.innerHTML = filterHtml + cardsHtml;

    const searchInput = container.querySelector('.ai-card-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = (e.target.value || '').toLowerCase().trim();
        container.querySelectorAll('.ai-row:not(.ai-row-section)').forEach((card) => {
          const haystack = card.dataset.searchStr || '';
          card.style.display = !q || haystack.includes(q) ? '' : 'none';
        });
      });
    }
  }

  function renderFollowups(container, items, onPick) {
    if (!items?.length) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    container.hidden = false;
    container.innerHTML = items.map((q) =>
      `<button type="button" class="ai-follow">${esc(q)} <span class="ms ms-sm">north_east</span></button>`
    ).join('');
    container.querySelectorAll('.ai-follow').forEach((btn, i) => {
      btn.addEventListener('click', () => onPick(items[i]));
    });
  }

  function i18nOr(key, fallback) {
    const v = t(key);
    return v && v !== key ? v : fallback;
  }

  async function downloadPdf(pdf) {
    if (!pdf) return;
    try {
      if (pdf.url) {
        const res = await fetch(pdf.url, {
          headers: {
            ...(Auth.token ? { Authorization: 'Bearer ' + Auth.token } : {}),
          },
        });
        if (res.status === 401) {
          Auth.clear();
          location.href = '/';
          return;
        }
        if (!res.ok) throw new Error('pdf http ' + res.status);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = pdf.filename || 'report.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      } else if (pdf.base64) {
        const bin = atob(pdf.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = pdf.filename || 'report.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      } else {
        throw new Error('no pdf payload');
      }
      toast(i18nOr('ai.pdfDone', 'PDF downloaded'), 'success');
    } catch {
      toast(i18nOr('ai.pdfFailed', 'PDF download failed'), 'error');
    }
  }

  function renderActions(container, ui) {
    const links = (ui && Array.isArray(ui.links) ? ui.links : []).filter((l) => l && l.href);
    const csv = ui && ui.csv && Array.isArray(ui.csv.rows) && ui.csv.rows.length ? ui.csv : null;
    const pdf = ui && ui.pdf && (ui.pdf.url || ui.pdf.base64) ? ui.pdf : null;
    if (!links.length && !csv && !pdf) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    container.hidden = false;
    container.innerHTML = links.map((l, i) => {
      const fallback = l.kind === 'employee'
        ? i18nOr('ai.actionOpenPerson', 'open employee')
        : i18nOr('ai.actionOpenList', 'open in inventory');
      return `<button type="button" class="btn btn-outline btn-sm ai-act" data-link="${i}">
        <span class="ms ms-sm">open_in_new</span>
        <span>${esc(l.label || fallback)}</span>
      </button>`;
    }).join('') + (csv
      ? `<button type="button" class="btn btn-outline btn-sm ai-act" data-csv="1">
        <span class="ms ms-sm">download</span>
        <span>${esc(i18nOr('ai.actionCsv', 'download csv'))}</span>
      </button>`
      : '') + (pdf
      ? `<button type="button" class="btn btn-outline btn-sm ai-act" data-pdf="1">
        <span class="ms ms-sm">picture_as_pdf</span>
        <span>${esc(i18nOr('ai.actionPdf', 'download pdf'))}</span>
      </button>`
      : '');

    container.querySelectorAll('[data-link]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const link = links[Number(btn.dataset.link)];
        if (!link) return;
        closeAssistant();
        location.hash = link.href;
      });
    });
    const dl = container.querySelector('[data-csv]');
    if (dl) {
      dl.addEventListener('click', () => {
        csvDownload(csv.filename || 'itacm.csv', csv.cols || [], csv.rows);
        toast(csv.truncated
          ? i18nOr('ai.csvCapped', 'CSV capped at 1000 rows')
          : i18nOr('ai.csvDone', 'CSV downloaded'), 'success');
      });
    }
    const pdfBtn = container.querySelector('[data-pdf]');
    if (pdfBtn) {
      pdfBtn.addEventListener('click', () => { downloadPdf(pdf); });
    }
  }

  const TOOL_LABEL_KEYS = {
    search_assets: 'ai.toolHardware',
    find_employees: 'ai.toolEmployee',
    list_licenses: 'ai.toolLicense',
    list_contracts: 'ai.toolContract',
    handover_history: 'ai.toolHistory',
    run_report: 'ai.toolReport',
    build_report: 'ai.toolReport',
    document_summary: 'ai.toolDocument',
    query_operations: 'ai.toolOps',
    unified_search: 'ai.toolComprehensive',
  };

  function toolUiLabel(name) {
    const key = TOOL_LABEL_KEYS[name];
    return key ? t(key) : name;
  }

  const META_UNIT_KEYS = {
    stat: 'ai.unitItem',
    employee: 'ai.unitRecord',
    license: 'ai.unitLicense',
    contract: 'ai.unitContract',
    provider: 'ai.unitContract',
    line: 'ai.unitLine',
    consumable: 'ai.unitConsumable',
    maintenance: 'ai.unitMaintenance',
    stock_count: 'ai.unitStockCount',
    handover: 'ai.unitHandover',
  };

  function mergeUi(prev, next) {
    if (!next) return prev;
    if (!prev) return next;
    const links = [...(prev.links || []), ...(next.links || [])].filter((l) => l && l.href);
    const seen = new Set();
    const deduped = links.filter((l) => {
      const k = `${l.href}|${l.label || ''}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return {
      ...prev,
      ...next,
      kind: prev.kind === 'multi' || next.kind === 'multi' || (prev.kind && next.kind && prev.kind !== next.kind)
        ? 'multi'
        : (next.kind || prev.kind),
      links: deduped.length ? deduped : undefined,
      csv: (next.csv && next.csv.rows?.length) ? next.csv : prev.csv,
      chart: (next.chart && next.chart.items?.length) ? next.chart : prev.chart,
      table: (next.table && next.table.columns?.length) ? next.table : prev.table,
      pdf: (next.pdf && (next.pdf.url || next.pdf.base64)) ? next.pdf : prev.pdf,
      metrics: (next.metrics && next.metrics.length) ? next.metrics : prev.metrics,
    };
  }

  function cleanAssistantText(raw) {
    let s = String(raw || '');
    s = s.replace(/(^|\n)\s*\|.+\|(\s*\n\|?\s*[-:| ]+\|)*(\s*\n\s*\|.+\|)*/g, '\n');
    s = s.replace(/```[\s\S]*?```/g, '');
    s = s.replace(/\n{3,}/g, '\n\n').trim();
    return s;
  }

  async function askAssistant(prompt) {
    ensureRoot();
    if (!aiEnabled) {
      toast(t('ai.disabled'), 'error');
      return;
    }
    if (!document.body.classList.contains('ai-open')) openAssistant();
    removeWelcome();
    playChime('sent');
    busy = true;
    const sendBtn = $('#ai-send', root);
    if (sendBtn) sendBtn.disabled = true;

    appendUserBubble(prompt);
    const shell = appendAssistantShell();
    const bubble = shell.querySelector('.ai-bubble-assistant');
    const toolsLine = shell.querySelector('.ai-tools-line');
    const metricsEl = shell.querySelector('.ai-metrics');
    const chartEl = shell.querySelector('.ai-chart');
    const tableEl = shell.querySelector('.ai-table');
    const rowsEl = shell.querySelector('.ai-rows');
    const actionsEl = shell.querySelector('.ai-actions');
    const metaEl = shell.querySelector('.ai-meta-line');
    const followEl = shell.querySelector('.ai-followups');

    let streamedText = '';
    let finalText = '';
    const toolNames = [];
    let lastRows = null;
    let lastUi = null;
    let followups = [];
    let totalScanned = null;
    let prevToolName = null;
    let partCount = 0;
    const summaries = [];

    let typingCleared = false;
    function clearTyping() {
      if (typingCleared) return;
      typingCleared = true;
      const t = bubble.querySelector('.ai-typing');
      if (t) t.remove();
    }

    function setBubble(raw) {
      clearTyping();
      const cleaned = cleanAssistantText(raw);
      finalText = cleaned;
      bubble.innerHTML = renderMarkdown(cleaned);
    }

    function appendStreamDelta(delta) {
      clearTyping();
      streamedText += delta;
      bubble.innerHTML = renderMarkdown(streamedText);
      scrollThread();
    }

    function adoptRows(rows, ui, follow, scanned, toolName) {
      if (rows?.length) {
        if (lastRows?.length && toolName && prevToolName && toolName !== prevToolName) {
          const needPrevHeader = !lastRows.some((r) => r.kind === 'section');
          lastRows = [
            ...(needPrevHeader
              ? [{ id: `section-${prevToolName}`, kind: 'section', title: toolUiLabel(prevToolName) }, ...lastRows]
              : lastRows),
            { id: `section-${toolName}-${partCount}`, kind: 'section', title: toolUiLabel(toolName) },
            ...rows,
          ];
        } else if (!lastRows?.length) {
          lastRows = rows;
        } else {
          lastRows = rows;
        }
        if (toolName) prevToolName = toolName;
        partCount += 1;
      }
      if (ui) lastUi = mergeUi(lastUi, ui);
      if (follow?.length) followups = follow;
      if (scanned != null) totalScanned = scanned;
      renderMetrics(metricsEl, lastUi && lastUi.metrics);
      renderChart(chartEl, lastUi && lastUi.chart);
      renderTable(tableEl, lastUi && lastUi.table);
      renderRows(rowsEl, lastRows);
    }

    try {
      const res = await fetch('/api/ai/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(Auth.token ? { Authorization: 'Bearer ' + Auth.token } : {}),
        },
        body: JSON.stringify({ prompt, history: history.slice(-6), lang: uiLang() }),
      });

      if (res.status === 401) {
        Auth.clear();
        window.dispatchEvent(new Event('itacm:logout'));
        throw new Error('Session expired');
      }
      if (!res.ok) {
        let msg = 'AI request failed';
        try {
          const j = await res.json();
          msg = j.error || msg;
        } catch { /* ignore */ }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      const handleEvent = (event, data) => {
        if (event === 'status' && data.label) {
          statusLabel = data.label;
          const pill = $('#ai-status-pill', root);
          if (pill) { pill.hidden = false; pill.textContent = statusLabel; pill.classList.add('ai-pill-live'); }
        }
        if (event === 'tool_start') {
          streamedText = '';
          bubble.innerHTML = '';
          clearTyping();
          toolNames.push(data.name);
          toolsLine.hidden = false;
          const labels = [...new Set(toolNames)].map(toolUiLabel);
          toolsLine.innerHTML = `<span class="ms ms-sm">search</span> ${esc(tf('ai.searching', { labels: labels.join(' · ') }))}`;
        }
        if (event === 'tool_end' && data.result) {
          if (data.result.summary) summaries.push(data.result.summary);
          streamedText = '';
          adoptRows(
            data.result.rows,
            data.result.ui,
            data.result.followups,
            data.result.meta?.totalMatched ?? data.result.meta?.totalScanned,
            data.name
          );
          if (summaries.length) setBubble(summaries.join(' '));
          const labels = [...new Set(toolNames)].map(toolUiLabel);
          toolsLine.innerHTML = `<span class="ms ms-sm">check_circle</span> ${esc(labels.join(' · '))}`;
        }
        if (event === 'delta' && data.text) {
          if (!toolNames.length && !finalText) appendStreamDelta(data.text);
        }
        if (event === 'message' && data.text) {
          streamedText = '';
          setBubble(data.text);
        }
        if (event === 'done') {
          playChime('received');
          if (data.meta?.followups?.length) followups = data.meta.followups;
          if (data.meta?.ui) lastUi = mergeUi(lastUi, data.meta.ui);
          if (data.meta?.totalScanned != null) totalScanned = data.meta.totalScanned;
          if (partCount <= 1 && Array.isArray(data.meta?.rows) && data.meta.rows.length) {
            adoptRows(data.meta.rows, data.meta.ui, data.meta.followups, data.meta.totalScanned);
          } else if (partCount > 1 && Array.isArray(data.meta?.rows) && data.meta.rows.some((r) => r.kind === 'section')) {
            lastRows = data.meta.rows;
            renderRows(rowsEl, lastRows);
          }
          if (data.meta?.summary) setBubble(data.meta.summary);
          else if (partCount > 1 && summaries.length) setBubble(summaries.join(' '));
          else if (finalText) setBubble(finalText);
          else if (streamedText) setBubble(streamedText);
        }
        if (event === 'error') {
          clearTyping();
          bubble.innerHTML = `<span class="ai-err"><span class="ms ms-sm">error_outline</span> ${esc(data.error || t('ai.error'))}</span>`;
        }
        scrollThread();
      };

      const handleStreamDelta = (data) => {
        if (toolNames.length || finalText) return;
        if (data.text) appendStreamDelta(data.text);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          let event = 'message';
          let dataLine = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          try {
            const parsed = JSON.parse(dataLine);
            if (event === 'delta') handleStreamDelta(parsed);
            else handleEvent(event, parsed);
          } catch { /* ignore bad chunk */ }
        }
      }

      if (!finalText && !streamedText && !lastRows?.length) {
        clearTyping();
        bubble.innerHTML = esc(t('ai.noAnswer'));
      } else if (!finalText && streamedText) {
        setBubble(streamedText);
      }

      renderMetrics(metricsEl, lastUi && lastUi.metrics);
      renderChart(chartEl, lastUi && lastUi.chart);
      renderRows(rowsEl, lastRows);
      renderActions(actionsEl, lastUi);
      if (totalScanned != null) {
        metaEl.hidden = false;
        const k = lastRows?.find((r) => r.kind !== 'section')?.kind;
        const unit = t(META_UNIT_KEYS[k] || 'ai.unitDevice');
        metaEl.innerHTML = `<span class="ms ms-sm">database</span> ${totalScanned} ${esc(unit)} · ${esc(t('ai.liveData'))}`;
      }
      renderFollowups(followEl, followups, (q) => {
        askAssistant(q).catch((err) => toast(err.message || t('ai.error'), 'error'));
      });
      scrollThread();

      const responseText = finalText || streamedText;
      attachCopyBtn(shell, responseText);

      history.push({ role: 'user', content: prompt });
      if (responseText) history.push({ role: 'assistant', content: cleanAssistantText(responseText) });

      const persisted = loadPersistedThread();
      persisted.push({ role: 'user', content: prompt });
      if (responseText) {
        persisted.push({
          role: 'assistant',
          content: cleanAssistantText(responseText),
          rows: lastRows || undefined,
          ui: lastUi || undefined,
        });
      }
      savePersistedThread(persisted);

    } catch (err) {
      clearTyping();
      bubble.innerHTML = `<span class="ai-err"><span class="ms ms-sm">error_outline</span> ${esc(err.message || t('ai.error'))}</span>`;
      throw err;
    } finally {
      busy = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  window.openAssistant = openAssistant;
  window.closeAssistant = closeAssistant;
  window.toggleAssistant = toggleAssistant;
  window.syncAssistantChrome = syncAssistantChrome;
  window.teardownAssistantChrome = teardownAssistantChrome;
})();
