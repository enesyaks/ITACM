(function () {
  const token = new URLSearchParams(location.search).get('token') || location.hash.replace(/^#/, '');
  const root = document.getElementById('root');

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/\n/g, ' '); }

  async function load() {
    if (!token) {
      root.innerHTML = '<h1>Invalid link</h1><p>Missing acknowledgement token.</p>';
      return;
    }
    const res = await fetch('/api/ack/' + encodeURIComponent(token));
    const json = await res.json();
    if (!res.ok || !json.success) {
      root.innerHTML = '<h1>Link unavailable</h1><p>' + escapeHtml(json.error || 'Not found') + '</p>';
      return;
    }
    const d = json.data;
    if (d.acknowledged) {
      root.innerHTML = '<h1 class="ack-ok">Already acknowledged</h1><p>Signed by <strong>' +
        escapeHtml(d.ackName || '—') + '</strong>' +
        (d.ackAt ? ' on ' + new Date(d.ackAt).toLocaleString() : '') + '.</p>';
      return;
    }
    root.innerHTML = '<h1>Confirm handover</h1><p>I confirm I received the following items for <strong>' +
      escapeHtml(d.employeeName || '') + '</strong>:</p><ul>' +
      (d.items || []).map(function (it) {
        return '<li><strong>' + escapeHtml(it.label) + '</strong> ' + escapeHtml(it.detail || '') + '</li>';
      }).join('') + '</ul>' +
      '<label>Your name<input id="name" value="' + escapeAttr(d.employeeName || '') + '" /></label>' +
      '<div class="err" id="err" hidden></div>' +
      '<button type="button" id="go">I received these items</button>';
    document.getElementById('go').addEventListener('click', confirmAck);
  }

  async function confirmAck() {
    const btn = document.getElementById('go');
    const err = document.getElementById('err');
    btn.disabled = true;
    err.hidden = true;
    try {
      const res = await fetch('/api/ack/' + encodeURIComponent(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: document.getElementById('name').value.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed');
      await load();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      btn.disabled = false;
    }
  }

  load();
})();
