/** Owner Integrations: SMTP, API keys, webhooks, custom fields, sync docs. */
Views.integrations = async function (el) {
  if (!Auth.profile || Auth.profile.role !== 'Owner') {
    el.innerHTML = `<div class="card card-pad"><p class="cell-sub">Owner role required.</p></div>`;
    return;
  }

  const [mail, keys, hooks, cfAsset, cfEmp, cfContract] = await Promise.all([
    api('/integrations/notifications'),
    api('/integrations/api-keys'),
    api('/integrations/webhooks'),
    api('/integrations/custom-fields/asset'),
    api('/integrations/custom-fields/employee'),
    api('/integrations/custom-fields/contract'),
  ]);

  const smtp = mail.smtp || {};
  const notify = mail.notify || {};
  const webhookList = Array.isArray(hooks) ? hooks : [];

  function renderCfTable(entity, defs) {
    if (!defs.length) return `<p class="cell-sub">No custom fields for ${entity}.</p>`;
    return `<div class="table-wrap"><table class="data"><thead><tr>
      <th>Key</th><th>Label</th><th>Type</th><th></th></tr></thead><tbody>
      ${defs.map((d) => `<tr>
        <td class="mono">${esc(d.fieldKey)}</td>
        <td>${esc(d.label)}</td>
        <td>${esc(d.fieldType)}${d.required ? ' *' : ''}</td>
        <td class="actions"><button class="btn btn-outline btn-sm" data-cf-del="${esc(entity)}:${esc(d.fieldKey)}">Delete</button></td>
      </tr>`).join('')}
      </tbody></table></div>`;
  }

  el.innerHTML = `
    ${pageHead('Integrations', 'SMTP alerts, API keys, webhooks, custom fields, and sync connectors.', '')}
    <div class="settings-shell">

      <section class="card card-pad" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">SMTP &amp; alert digest</h3>
        <p class="cell-sub" style="margin:0 0 12px">Daily digest of expired licenses, low stock, EOL, onboarding due.
          iCloud/Gmail: Apple/Google hesabı şifresi değil, <strong>app-specific password</strong> kullanın.
          iCloud: host <code>smtp.mail.me.com</code>, port <code>465</code>, TLS açık.</p>
        <div class="form-grid">
          <div class="form-field"><label>Host</label><input id="int-smtp-host" value="${esc(smtp.host || '')}" placeholder="smtp.mail.me.com"></div>
          <div class="form-field"><label>Port</label><input id="int-smtp-port" type="number" value="${esc(smtp.port || 587)}"></div>
          <div class="form-field"><label>User</label><input id="int-smtp-user" value="${esc(smtp.user || '')}" autocomplete="off"></div>
          <div class="form-field"><label>Password ${smtp.pass ? '<span class="ob-hint">(saved — leave blank to keep)</span>' : ''}</label>
            <input id="int-smtp-pass" type="password" value="" placeholder="${smtp.pass ? '••••••••  leave blank to keep' : 'app-specific password'}" autocomplete="new-password"></div>
          <div class="form-field"><label>From</label><input id="int-smtp-from" value="${esc(smtp.from || '')}" placeholder="itacm@company.com"></div>
          <div class="form-field"><label>Recipients (comma-separated)</label>
            <input id="int-notify-to" value="${esc((notify.to || []).join(', '))}" placeholder="ops@company.com"></div>
          <div class="form-field full" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
            <label><input type="checkbox" id="int-notify-on" ${notify.enabled ? 'checked' : ''}> Enable digests</label>
            <label><input type="checkbox" id="int-smtp-secure" ${smtp.secure ? 'checked' : ''}> TLS (port 465)</label>
            <label><input type="checkbox" id="int-notify-ho" ${notify.handoverCompleted ? 'checked' : ''}> Email on handover</label>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-primary" id="int-smtp-save">Save SMTP</button>
          <button class="btn btn-outline" id="int-smtp-test">Send test email</button>
          <button class="btn btn-outline" id="int-digest">Run digest now</button>
          <button class="btn btn-outline" id="int-smtp-clear" style="margin-left:auto;color:var(--rose,#be123c)">Clear SMTP &amp; recipients</button>
        </div>
      </section>

      <section class="card card-pad" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">API keys</h3>
        <p class="cell-sub" style="margin:0 0 12px">Use <code>Authorization: Bearer itacm_…</code> or <code>X-Api-Key</code> for HR / discovery sync.</p>
        <div class="form-grid" style="margin-bottom:12px">
          <div class="form-field"><label>Name</label><input id="int-key-name" placeholder="HR sync"></div>
          <div class="form-field"><label>Role</label>
            <select id="int-key-role"><option>Helpdesk</option><option>Admin</option><option>Viewer</option></select></div>
        </div>
        <button class="btn btn-primary btn-sm" id="int-key-create">Create key</button>
        <div class="table-wrap" style="margin-top:12px"><table class="data">
          <thead><tr><th>Name</th><th>Prefix</th><th>Role</th><th>Last used</th><th></th></tr></thead>
          <tbody>
            ${(keys || []).length === 0 ? '<tr><td colspan="5" class="table-empty">No keys yet.</td></tr>' :
              keys.map((k) => `<tr style="${k.revokedAt ? 'opacity:.5' : ''}">
                <td>${esc(k.name)}</td>
                <td class="mono">${esc(k.keyPrefix)}…</td>
                <td>${esc(k.role)}</td>
                <td class="cell-sub">${k.lastUsedAt ? fmtDate(k.lastUsedAt) : '—'}</td>
                <td class="actions">${!k.revokedAt ? `<button class="btn btn-outline btn-sm" data-key-revoke="${esc(k.id)}">Revoke</button>` : 'revoked'}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>
      </section>

      <section class="card card-pad" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">Webhooks</h3>
        <p class="cell-sub" style="margin:0 0 12px">Events: <code>handover.completed</code>, <code>employee.offboarded</code>, <code>asset.updated</code>, <code>license.expiring_digest</code>. HMAC in <code>X-ITACM-Signature</code>.</p>
        <div id="int-hooks">
          ${webhookList.map((w, i) => `
            <div class="form-grid hook-row" data-i="${i}" style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border,#e8e6f0)">
              <div class="form-field"><label>URL</label><input data-h="url" value="${esc(w.url || '')}"></div>
              <div class="form-field"><label>Secret ${w.hasSecret || w.secret ? '<span class="ob-hint">(saved — leave blank to keep)</span>' : ''}</label>
                <input data-h="secret" type="password" value="" placeholder="${w.hasSecret || w.secret ? '••••••••  leave blank to keep' : 'auto if empty'}" autocomplete="new-password"></div>
              <div class="form-field full"><label>Events (comma)</label>
                <input data-h="events" value="${esc((w.events || []).join(', '))}"></div>
              <label><input type="checkbox" data-h="active" ${w.active !== false ? 'checked' : ''}> Active</label>
              <input type="hidden" data-h="id" value="${esc(w.id || '')}">
            </div>`).join('') || '<p class="cell-sub">No webhooks — add one below.</p>'}
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-outline btn-sm" id="int-hook-add">Add webhook</button>
          <button class="btn btn-primary btn-sm" id="int-hook-save">Save webhooks</button>
        </div>
      </section>

      <section class="card card-pad" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">Custom fields</h3>
        <div class="form-grid" style="margin-bottom:12px">
          <div class="form-field"><label>Entity</label>
            <select id="int-cf-entity"><option value="asset">asset</option><option value="employee">employee</option><option value="contract">contract</option></select></div>
          <div class="form-field"><label>Key</label><input id="int-cf-key" placeholder="cost_center"></div>
          <div class="form-field"><label>Label</label><input id="int-cf-label" placeholder="Cost center"></div>
          <div class="form-field"><label>Type</label>
            <select id="int-cf-type"><option>text</option><option>number</option><option>date</option><option>select</option></select></div>
        </div>
        <button class="btn btn-primary btn-sm" id="int-cf-add">Add field</button>
        <div style="margin-top:16px">
          <h4>Assets</h4>${renderCfTable('asset', cfAsset || [])}
          <h4 style="margin-top:12px">Employees</h4>${renderCfTable('employee', cfEmp || [])}
          <h4 style="margin-top:12px">Contracts</h4>${renderCfTable('contract', cfContract || [])}
        </div>
      </section>

      <section class="card card-pad">
        <h3 style="margin:0 0 8px">Sync connectors (API)</h3>
        <pre class="mono" style="white-space:pre-wrap;font-size:12px;background:#f6f5fa;padding:12px;border-radius:10px;overflow:auto">POST /api/integrations/sync/employees
{ "items": [{ "email":"a@x.com", "fullName":"Ada", "department":"IT" }] }

POST /api/integrations/sync/assets
{ "items": [{ "assetTag":"IT-1", "serialNumber":"SN1", "brand":"Dell", "model":"L5540", "category":"Laptop" }] }

POST /api/integrations/sync/software-installs
{ "items": [{ "softwareName":"Microsoft 365", "hostname":"LAP-01", "assetTag":"IT-1", "version":"16" }] }

GET /api/integrations/licenses/:id/sam</pre>
      </section>
    </div>`;

  $('#int-smtp-save', el).addEventListener('click', async () => {
    try {
      const to = $('#int-notify-to', el).value.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      await api('/integrations/notifications', {
        method: 'PUT',
        body: {
          smtp: {
            host: $('#int-smtp-host', el).value.trim(),
            port: Number($('#int-smtp-port', el).value) || 587,
            user: $('#int-smtp-user', el).value.trim(),
            pass: $('#int-smtp-pass', el).value,
            from: $('#int-smtp-from', el).value.trim(),
            secure: $('#int-smtp-secure', el).checked,
          },
          notify: {
            enabled: $('#int-notify-on', el).checked,
            to,
            handoverCompleted: $('#int-notify-ho', el).checked,
          },
        },
      });
      toast('SMTP settings saved', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#int-smtp-test', el).addEventListener('click', async () => {
    const btn = $('#int-smtp-test', el);
    try {
      btn.disabled = true;
      // Persist current form first so a freshly typed password is used.
      const toList = $('#int-notify-to', el).value.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      await api('/integrations/notifications', {
        method: 'PUT',
        body: {
          smtp: {
            host: $('#int-smtp-host', el).value.trim(),
            port: Number($('#int-smtp-port', el).value) || 587,
            user: $('#int-smtp-user', el).value.trim(),
            pass: $('#int-smtp-pass', el).value,
            from: $('#int-smtp-from', el).value.trim(),
            secure: $('#int-smtp-secure', el).checked,
          },
          notify: {
            enabled: $('#int-notify-on', el).checked,
            to: toList,
            handoverCompleted: $('#int-notify-ho', el).checked,
          },
        },
      });
      $('#int-smtp-pass', el).value = '';
      $('#int-smtp-pass', el).placeholder = '••••••••  leave blank to keep';
      await api('/integrations/notifications/test', { method: 'POST', body: { to: toList[0] } });
      toast('Test email sent — check inbox', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; }
  });

  $('#int-digest', el).addEventListener('click', async () => {
    try {
      const r = await api('/integrations/notifications/digest', { method: 'POST', body: {} });
      toast(r.skipped ? `Digest skipped: ${r.reason}` : `Digest sent (${r.alertItems} items)`, r.skipped ? 'info' : 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#int-smtp-clear', el).addEventListener('click', () => {
    confirmModal(
      'Clear SMTP host/credentials and all notification recipients / toggles?',
      async () => {
        await api('/integrations/notifications', { method: 'DELETE' });
        toast('SMTP & notification settings cleared', 'success');
        Views.integrations(el);
      }
    );
  });

  $('#int-key-create', el).addEventListener('click', async () => {
    try {
      const data = await api('/integrations/api-keys', {
        method: 'POST',
        body: { name: $('#int-key-name', el).value.trim(), role: $('#int-key-role', el).value },
      });
      await navigator.clipboard.writeText(data.apiKey).catch(() => {});
      openModal({
        title: 'API key created',
        body: `<p>Copy now — it will not be shown again:</p>
               <pre class="mono" style="word-break:break-all;padding:12px;background:#f6f5fa;border-radius:8px">${esc(data.apiKey)}</pre>`,
        foot: '<button class="btn btn-primary" data-close>Done</button>',
      });
      Views.integrations(el);
    } catch (err) { toast(err.message, 'error'); }
  });

  el.querySelectorAll('[data-key-revoke]').forEach((btn) => {
    btn.addEventListener('click', () => {
      confirmModal('Revoke this API key? It will stop working immediately.', async () => {
        await api('/integrations/api-keys/' + btn.dataset.keyRevoke, { method: 'DELETE' });
        toast('Key revoked', 'success');
        Views.integrations(el);
      });
    });
  });

  $('#int-hook-add', el).addEventListener('click', () => {
    const box = $('#int-hooks', el);
    const row = document.createElement('div');
    row.className = 'form-grid hook-row';
    row.style.cssText = 'margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #e8e6f0';
    row.innerHTML = `
      <div class="form-field"><label>URL</label><input data-h="url" placeholder="https://hooks.example/itacm"></div>
      <div class="form-field"><label>Secret</label><input data-h="secret" placeholder="auto if empty"></div>
      <div class="form-field full"><label>Events</label><input data-h="events" value="handover.completed"></div>
      <label><input type="checkbox" data-h="active" checked> Active</label>
      <input type="hidden" data-h="id" value="">`;
    box.appendChild(row);
  });

  $('#int-hook-save', el).addEventListener('click', async () => {
    try {
      const webhooks = [...el.querySelectorAll('.hook-row')].map((row) => ({
        id: $('[data-h=id]', row)?.value || undefined,
        url: $('[data-h=url]', row).value.trim(),
        secret: $('[data-h=secret]', row).value.trim() || undefined,
        events: $('[data-h=events]', row).value.split(',').map((s) => s.trim()).filter(Boolean),
        active: $('[data-h=active]', row).checked,
      })).filter((w) => w.url);
      await api('/integrations/webhooks', { method: 'PUT', body: { webhooks } });
      toast('Webhooks saved', 'success');
      Views.integrations(el);
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#int-cf-add', el).addEventListener('click', async () => {
    try {
      await api('/integrations/custom-fields', {
        method: 'POST',
        body: {
          entity: $('#int-cf-entity', el).value,
          fieldKey: $('#int-cf-key', el).value.trim(),
          label: $('#int-cf-label', el).value.trim(),
          fieldType: $('#int-cf-type', el).value,
        },
      });
      toast('Field saved', 'success');
      Views.integrations(el);
    } catch (err) { toast(err.message, 'error'); }
  });

  el.querySelectorAll('[data-cf-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [entity, key] = btn.dataset.cfDel.split(':');
      confirmModal(`Delete custom field “${key}”? Stored values for this field will be removed.`, async () => {
        await api(`/integrations/custom-fields/${entity}/${key}`, { method: 'DELETE' });
        toast('Deleted', 'success');
        Views.integrations(el);
      });
    });
  });
};
