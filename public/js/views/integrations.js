/** Owner Integrations: SMTP, API keys, webhooks, custom fields, sync docs. */
Views.integrations = async function (el) {
  if (!Auth.can('canAccessIntegrations') && !Auth.canIam('integration', 'read') && !Auth.canIam('integration', 'update') && !Auth.canIam('integration', 'manage')) {
    el.innerHTML = `<div class="card card-pad"><p class="cell-sub">Integrations requires <strong>integration:read</strong>.</p></div>`;
    return;
  }
  const canManage = Auth.canIam('integration', 'manage');
  const canExport = Auth.can('isOwner') || Auth.profile?.role === 'Owner';
  const canRead = Auth.can('canAccessIntegrations') || Auth.canIam('integration', 'read') || Auth.canIam('integration', 'update') || canManage;
  const readOnly = canRead && !canManage;
  const lockedTip = esc(t('integration.viewLocked') || 'Saved — editing requires integration:manage');

  const [mail, keys, hooks, cfAsset, cfEmp, cfContract, emailTemplates, aiCfg] = await Promise.all([
    api('/integrations/notifications'),
    api('/integrations/api-keys'),
    api('/integrations/webhooks'),
    api('/integrations/custom-fields/asset'),
    api('/integrations/custom-fields/employee'),
    api('/integrations/custom-fields/contract'),
    api('/integrations/email-templates').catch(() => ({})),
    api('/ai/config').catch(() => ({ enabled: false, provider: 'ollama', providers: [] })),
  ]);
  const sso = await api('/integrations/sso').catch(() => ({}));
  // The server ships every template it knows about, with its label and
  // placeholders — no local copy of the list to drift out of sync.
  const tpls = emailTemplates || {};
  const tplKeys = Object.keys(tpls);
  const tplLabel = (k) => (tpls[k] && tpls[k].label) || k;
  const tplPhOf = (k) => (tpls[k] && tpls[k].placeholders) || [];
  const emptyTpl = { subject: '', bodyHtml: '', bodyText: '', isCustom: false };
  const tplKey = tplKeys[0] || '';
  const tpl = tpls[tplKey] || emptyTpl;
  const phList = tplPhOf(tplKey);

  const smtp = mail.smtp || {};
  const notify = mail.notify || {};
  const webhookList = Array.isArray(hooks) ? hooks : [];
  const inputDis = readOnly ? ' disabled' : '';
  const chkDis = readOnly ? ' disabled' : '';

  function secretLocked(label, hasValue) {
    if (!readOnly || !hasValue) return '';
    return `<div class="doc-locked" style="max-width:100%;margin-top:4px" title="${lockedTip}">
      <span class="doc-locked-filename">${esc(label)}</span>
      <span class="doc-locked-badge"><span class="ms ms-sm">lock</span>${lockedTip}</span>
    </div>`;
  }

  function renderCfTable(entity, defs) {
    if (!defs.length) return `<p class="cell-sub">No custom fields for ${entity}.</p>`;
    return `<div class="table-wrap"><table class="data"><thead><tr>
      <th>Key</th><th>Label</th><th>Type</th><th>Options</th>${canManage ? '<th></th>' : ''}</tr></thead><tbody>
      ${defs.map((d) => `<tr>
        <td class="mono">${esc(d.fieldKey)}</td>
        <td>${esc(d.label)}</td>
        <td>${esc(d.fieldType)}${d.required ? ' *' : ''}</td>
        <td class="cell-sub">${(d.options && d.options.length) ? esc(d.options.join(', ')) : '—'}</td>
        ${canManage ? `<td class="actions"><button class="btn btn-outline btn-sm" data-cf-del="${esc(entity)}:${esc(d.fieldKey)}">Delete</button></td>` : ''}
      </tr>`).join('')}
      </tbody></table></div>`;
  }

  const aiProviders = Array.isArray(aiCfg.providers) ? aiCfg.providers : [];
  const aiProviderOpts = aiProviders.map((p) =>
    `<option value="${esc(p.id)}" ${aiCfg.provider === p.id ? 'selected' : ''}>${esc(p.label)}</option>`
  ).join('') || '<option value="ollama">Ollama</option><option value="deepseek">DeepSeek</option>';

  el.innerHTML = `
    ${pageHead('Integrations', 'SMTP alerts, API keys, webhooks, custom fields, AI assistant, and sync connectors.', '')}
    ${readOnly ? `<div class="card card-pad" style="margin-bottom:16px;border-style:dashed">
      <span class="ms" style="vertical-align:-3px;color:var(--on-surface-variant)">lock</span>
      <span class="cell-sub">${lockedTip}</span>
    </div>` : ''}
    <div class="settings-shell">

      <section class="card card-pad" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px"><span class="ms ms-sm" style="vertical-align:-3px">auto_awesome</span> AI Assistant</h3>
        <p class="cell-sub" style="margin:0 0 12px">
          Multi-provider ask-and-get assistant (Ollama local-first, then DeepSeek / OpenAI / Anthropic / Groq…).
          Tools are read-only and respect IAM. Open with the sparkles button or <kbd>Cmd/Ctrl+J</kbd>.
        </p>
        ${aiCfg.apiKeyCorrupt ? `<p class="banner banner-rose" style="margin-bottom:12px">Saved AI API key could not be read — enter it again and Save.</p>` : ''}
        <div class="form-grid">
          <div class="form-field"><label>Enabled</label>
            <label class="chk" style="margin-top:8px"><input type="checkbox" id="int-ai-enabled" ${aiCfg.enabled ? 'checked' : ''}${chkDis}> On</label>
          </div>
          <div class="form-field"><label>Provider</label>
            <select id="int-ai-provider"${inputDis}>${aiProviderOpts}</select>
          </div>
          <div class="form-field"><label>Model</label>
            <input id="int-ai-model" value="${esc(aiCfg.model || '')}" placeholder="llama3.1 / deepseek-chat"${inputDis}>
          </div>
          <div class="form-field"><label>Base URL</label>
            <input id="int-ai-base" value="${esc(aiCfg.baseUrl || '')}" placeholder="http://127.0.0.1:11434"${inputDis}>
          </div>
          <div class="form-field"><label>API key ${aiCfg.apiKeyConfigured ? '<span class="ob-hint">(saved — leave blank to keep)</span>' : '<span class="ob-hint">(not needed for local Ollama)</span>'}</label>
            ${readOnly && aiCfg.apiKeyConfigured
              ? secretLocked('••••••••••••', true)
              : `<input id="int-ai-key" type="password" value="" placeholder="${aiCfg.apiKeyConfigured ? '••••••••  leave blank to keep' : 'sk-…'}" autocomplete="new-password"${inputDis}>`}
          </div>
        </div>
        ${aiCfg.enabled ? `<p class="banner" style="margin:12px 0 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span>${esc(t('ai.launcherHintOn'))}</span>
          <button type="button" class="btn btn-primary btn-sm" id="int-ai-open">${esc(t('ai.openChat'))}</button>
        </p>` : `<p class="cell-sub" style="margin:12px 0 0">${esc(t('ai.launcherHintOff'))}</p>`}
        ${canManage ? `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-primary" id="int-ai-save">Save AI</button>
          <button class="btn btn-outline" id="int-ai-test">Test connection</button>
          <button class="btn btn-outline" id="int-ai-clear" style="margin-left:auto;color:var(--rose,#be123c)">Clear AI</button>
        </div>` : ''}
      </section>

      <section class="card card-pad" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">SMTP &amp; alert digest</h3>
        <p class="cell-sub" style="margin:0 0 12px">${t('int.smtp.hint')}</p>
        ${smtp.passCorrupt ? `<p class="banner banner-rose" style="margin-bottom:12px">${esc(t('int.smtp.passCorrupt'))}</p>` : ''}
        <div class="form-grid">
          <div class="form-field"><label>Host</label><input id="int-smtp-host" value="${esc(smtp.host || '')}" placeholder="smtp.mail.me.com"${inputDis}></div>
          <div class="form-field"><label>Port</label><input id="int-smtp-port" type="number" value="${esc(smtp.port || 587)}"${inputDis}></div>
          <div class="form-field"><label>User</label><input id="int-smtp-user" value="${esc(smtp.user || '')}" autocomplete="off"${inputDis}></div>
          <div class="form-field"><label>Password ${smtp.passConfigured || smtp.pass ? '<span class="ob-hint">(saved — leave blank to keep)</span>' : ''}</label>
            ${readOnly && (smtp.passConfigured || smtp.pass)
              ? secretLocked('••••••••••••')
              : `<input id="int-smtp-pass" type="password" value="" placeholder="${smtp.passConfigured || smtp.pass ? '••••••••  leave blank to keep' : 'app-specific password'}" autocomplete="new-password"${inputDis}>`}
          </div>
          <div class="form-field"><label>From</label><input id="int-smtp-from" value="${esc(smtp.from || '')}" placeholder="itacm@company.com"${inputDis}></div>
          <div class="form-field"><label>Recipients (comma-separated)</label>
            <input id="int-notify-to" value="${esc((notify.to || []).join(', '))}" placeholder="ops@company.com"${inputDis}></div>
          <div class="form-field full"><label>${esc(t('int.appUrl.label'))} <span class="ob-hint">${esc(t('int.appUrl.hint'))}</span></label>
            <input id="int-notify-appurl" type="url" value="${esc(notify.appUrl || '')}" placeholder="https://itacm.company.com"${inputDis}></div>
          <div class="form-field full" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
            <label><input type="checkbox" id="int-notify-on" ${notify.enabled ? 'checked' : ''}${chkDis}> Enable digests</label>
            <label title="Only for servers that require implicit TLS on 465. Leave off for iCloud (587)."><input type="checkbox" id="int-smtp-secure" ${smtp.secure ? 'checked' : ''}${chkDis}> TLS (port 465)</label>
            <label><input type="checkbox" id="int-notify-ho" ${notify.handoverCompleted ? 'checked' : ''}${chkDis}> Email on handover</label>
            <label title="Notify the requester and assignee on replies, status changes and assignment."><input type="checkbox" id="int-notify-tickets" ${notify.ticketUpdates ? 'checked' : ''}${chkDis}> Email on ticket updates</label>
          </div>
          <div class="form-field full" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
            <label style="display:flex;align-items:center;gap:6px">Auto-send
              <select id="int-notify-schedule"${inputDis}>
                <option value="off" ${notify.schedule !== 'daily' && notify.schedule !== 'weekly' ? 'selected' : ''}>Off (manual)</option>
                <option value="daily" ${notify.schedule === 'daily' ? 'selected' : ''}>Daily</option>
                <option value="weekly" ${notify.schedule === 'weekly' ? 'selected' : ''}>Weekly</option>
              </select>
            </label>
            <label style="display:flex;align-items:center;gap:6px" id="int-notify-weekday-wrap">Day
              <select id="int-notify-weekday"${inputDis}>
                ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
                  .map((d, i) => `<option value="${i}" ${Number(notify.weekday) === i ? 'selected' : ''}>${d}</option>`).join('')}
              </select>
            </label>
            <label style="display:flex;align-items:center;gap:6px">at
              <select id="int-notify-hour"${inputDis}>
                ${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${Number(notify.hour) === h || (notify.hour == null && h === 8) ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}
              </select>
            </label>
            <span class="cell-sub" style="margin:0">server time</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          ${canManage ? `<button class="btn btn-primary" id="int-smtp-save">Save SMTP</button>
          <button class="btn btn-outline" id="int-smtp-test">Send test email</button>
          <button class="btn btn-outline" id="int-smtp-clear" style="margin-left:auto;color:var(--rose,#be123c)">Clear SMTP &amp; recipients</button>` : ''}
          ${canRead ? `<button class="btn btn-outline" id="int-digest">Run digest now</button>` : ''}
        </div>
      </section>

      <section class="card card-pad" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">${esc(t('int.sso.title') || 'Single sign-on (SSO)')}</h3>
        <p class="cell-sub" style="margin:0 0 12px">${esc(t('int.sso.hint') || 'Invite-only OpenID Connect. Signs in users who already exist in ITACM (by verified email); it never creates accounts.')}</p>
        ${sso.source === 'env' && (sso.issuer || sso.ready) ? `<p class="banner banner-amber" style="margin-bottom:12px">${esc(t('int.sso.envNote') || 'Currently configured via SSO_* environment variables. Saving here moves configuration to the database.')}</p>` : ''}
        <div class="form-grid">
          <div class="form-field full"><label>${esc(t('int.sso.redirect') || 'Redirect URI — register this verbatim at your provider')}</label>
            <input value="${esc(sso.redirectUri || '')}" placeholder="https://itacm.company.com/api/auth/sso/callback" id="int-sso-redirect"${inputDis}></div>
          <div class="form-field full"><label>${esc(t('int.sso.issuer') || 'Issuer URL')}</label>
            <input id="int-sso-issuer" value="${esc(sso.issuer || '')}" placeholder="https://accounts.google.com"${inputDis}></div>
          <div class="form-field"><label>Client ID</label>
            <input id="int-sso-client" value="${esc(sso.clientId || '')}" autocomplete="off"${inputDis}></div>
          <div class="form-field"><label>Client secret ${sso.secretConfigured ? '<span class="ob-hint">(saved — leave blank to keep)</span>' : ''}</label>
            ${readOnly && sso.secretConfigured
              ? secretLocked('••••••••••••', true)
              : `<input id="int-sso-secret" type="password" value="" placeholder="${sso.secretConfigured ? '••••••••  leave blank to keep' : 'client secret'}" autocomplete="new-password"${inputDis}>`}
          </div>
          <div class="form-field"><label>${esc(t('int.sso.domains') || 'Allowed email domains (comma-separated, optional)')}</label>
            <input id="int-sso-domains" value="${esc((sso.allowedDomains || []).join(', '))}" placeholder="company.com"${inputDis}></div>
          <div class="form-field"><label>${esc(t('int.sso.button') || 'Login button label')}</label>
            <input id="int-sso-label" value="${esc(sso.buttonLabel || '')}" placeholder="Sign in with Google"${inputDis}></div>
          <div class="form-field full"><label><input type="checkbox" id="int-sso-enabled" ${sso.enabled ? 'checked' : ''}${chkDis}> ${esc(t('int.sso.enable') || 'Enable SSO sign-in')}</label></div>
          <div class="form-field full"><label><input type="checkbox" id="int-sso-require" ${sso.requireSso ? 'checked' : ''}${chkDis}> ${esc(t('int.sso.require') || 'Require SSO for staff (optional — Owner can still use a password)')}</label>
            <span class="ob-hint">${esc(t('int.sso.requireHint') || 'Off by default. When on, only an Owner may sign in with a password; everyone else must use SSO.')}</span></div>
        </div>
        ${canManage ? `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-primary" id="int-sso-save">${esc(t('int.sso.save') || 'Save SSO')}</button>
          <button class="btn btn-outline" id="int-sso-test">${esc(t('int.sso.test') || 'Test connection')}</button>
        </div>` : ''}
      </section>

      <section class="card card-pad" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">${esc(t('integration.emailTemplates') || 'Email templates')}</h3>
        <p class="cell-sub" style="margin:0 0 12px">${esc(t('integration.emailTemplatesHint') || 'Edit the onboarding welcome and web-access emails. Placeholders are replaced when sending.')}</p>
        ${!smtp.host ? '<p class="banner banner-amber" style="margin-bottom:12px">SMTP host is not configured — save SMTP before sending.</p>' : ''}
        <div class="form-grid">
          <div class="form-field"><label>Template</label>
            <select id="int-tpl-key" ${inputDis}>
              ${tplKeys.map((k) => `<option value="${esc(k)}" ${k === tplKey ? 'selected' : ''}>${esc(tplLabel(k))}</option>`).join('')}
            </select>
          </div>
          <div class="form-field full"><label>Subject</label>
            <input id="int-tpl-subject" value="${esc(tpl.subject || '')}" ${inputDis}></div>
          <div class="form-field full"><label>Body (HTML)</label>
            <textarea id="int-tpl-html" rows="10" style="font-family:ui-monospace,monospace;font-size:12px" ${inputDis}>${esc(tpl.bodyHtml || '')}</textarea></div>
          <div class="form-field full"><label>Body (text)</label>
            <textarea id="int-tpl-text" rows="8" style="font-family:ui-monospace,monospace;font-size:12px" ${inputDis}>${esc(tpl.bodyText || '')}</textarea></div>
          <div class="form-field full">
            <p class="cell-sub" style="margin:0" id="int-tpl-ph">Placeholders:
              ${phList.map((p) => '<code>{{' + p + '}}</code>').join(' ')}
            </p>
            <p class="ob-hint" style="margin:6px 0 0" id="int-tpl-custom">${tpl.isCustom ? 'Custom override saved' : 'Using built-in default'}</p>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button type="button" class="btn btn-outline" id="int-tpl-preview">${esc(t('integration.emailTemplatePreview') || 'Preview')}</button>
          ${canManage ? '<button class="btn btn-primary" id="int-tpl-save">Save template</button><button class="btn btn-outline" id="int-tpl-reset">Reset to default</button>' : ''}
        </div>
      </section>

      <section class="card card-pad" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">API keys</h3>
        <p class="cell-sub" style="margin:0 0 12px">Use <code>Authorization: Bearer itacm_…</code> or <code>X-Api-Key</code> for HR / discovery sync.</p>
        ${canManage ? `<div class="form-grid" style="margin-bottom:12px">
          <div class="form-field"><label>Name</label><input id="int-key-name" placeholder="HR sync"></div>
          <div class="form-field"><label>Role</label>
            <select id="int-key-role"><option>Helpdesk</option><option>Admin</option><option>Viewer</option></select></div>
        </div>
        <button class="btn btn-primary btn-sm" id="int-key-create">Create key</button>` : ''}
        <div class="table-wrap" style="margin-top:12px"><table class="data">
          <thead><tr><th>Name</th><th>Prefix</th><th>Role</th><th>Last used</th>${canManage ? '<th></th>' : ''}</tr></thead>
          <tbody>
            ${(keys || []).length === 0 ? `<tr><td colspan="${canManage ? 5 : 4}" class="table-empty">No keys yet.</td></tr>` :
              keys.map((k) => `<tr style="${k.revokedAt ? 'opacity:.5' : ''}">
                <td>${esc(k.name)}</td>
                <td class="mono">${readOnly && k.keyPrefix
                  ? `<span class="doc-locked doc-locked-inline" style="max-width:120px" title="${lockedTip}"><span class="doc-locked-filename">${esc(k.keyPrefix)}…</span><span class="doc-locked-badge"><span class="ms ms-sm">lock</span></span></span>`
                  : `${esc(k.keyPrefix)}…`}</td>
                <td>${esc(k.role)}</td>
                <td class="cell-sub">${k.lastUsedAt ? fmtDate(k.lastUsedAt) : '—'}</td>
                ${canManage ? `<td class="actions">${!k.revokedAt ? `<button class="btn btn-outline btn-sm" data-key-revoke="${esc(k.id)}">Revoke</button>` : 'revoked'}</td>` : ''}
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
              <div class="form-field"><label>URL</label><input data-h="url" value="${esc(w.url || '')}"${inputDis}></div>
              <div class="form-field"><label>Secret ${w.hasSecret || w.secret ? '<span class="ob-hint">(saved — leave blank to keep)</span>' : ''}</label>
                ${readOnly && (w.hasSecret || w.secret)
                  ? secretLocked('••••••••••••')
                  : `<input data-h="secret" type="password" value="" placeholder="${w.hasSecret || w.secret ? '••••••••  leave blank to keep' : 'auto if empty'}" autocomplete="new-password"${inputDis}>`}
              </div>
              <div class="form-field full"><label>Events (comma)</label>
                <input data-h="events" value="${esc((w.events || []).join(', '))}"${inputDis}></div>
              <label><input type="checkbox" data-h="active" ${w.active !== false ? 'checked' : ''}${chkDis}> Active</label>
              <input type="hidden" data-h="id" value="${esc(w.id || '')}">
            </div>`).join('') || '<p class="cell-sub">No webhooks — add one below.</p>'}
        </div>
        ${canManage ? `<div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-outline btn-sm" id="int-hook-add">Add webhook</button>
          <button class="btn btn-primary btn-sm" id="int-hook-save">Save webhooks</button>
        </div>` : ''}
      </section>

      <section class="card card-pad" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">Custom fields</h3>
        <p class="cell-sub" style="margin:0 0 12px">
          Fields you add here appear on the matching create/edit forms:
          <strong>asset</strong> → Hardware / Network device form,
          <strong>employee</strong> → employee form,
          <strong>contract</strong> → provider contract form.
          Values are saved per record.
        </p>
        ${canManage ? `<div class="form-grid" style="margin-bottom:12px">
          <div class="form-field"><label>Entity</label>
            <select id="int-cf-entity"><option value="asset">asset</option><option value="employee">employee</option><option value="contract">contract</option></select></div>
          <div class="form-field"><label>Key</label><input id="int-cf-key" placeholder="cost_center"></div>
          <div class="form-field"><label>Label</label><input id="int-cf-label" placeholder="Cost center"></div>
          <div class="form-field"><label>Type</label>
            <select id="int-cf-type"><option>text</option><option>number</option><option>date</option><option>select</option></select></div>
          <div class="form-field full" id="int-cf-options-wrap" style="display:none">
            <label>Select options <span class="ob-hint">(comma-separated — required for dropdown)</span></label>
            <input id="int-cf-options" placeholder="Alpha, Beta, Gamma">
          </div>
        </div>
        <button class="btn btn-primary btn-sm" id="int-cf-add">Add field</button>` : ''}
        <div style="margin-top:16px">
          <h4>Assets</h4>${renderCfTable('asset', cfAsset || [])}
          <h4 style="margin-top:12px">Employees</h4>${renderCfTable('employee', cfEmp || [])}
          <h4 style="margin-top:12px">Contracts</h4>${renderCfTable('contract', cfContract || [])}
        </div>
      </section>

      ${canExport ? `<section class="card card-pad" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">${esc(t('integration.migrationTitle') || 'System migration')}</h3>
        <p class="cell-sub" style="margin:0 0 12px">${esc(t('integration.migrationHint') || '')}</p>
        <p class="banner banner-amber" style="margin:0 0 12px">${esc(t('integration.migrationSmtpWarn') || '')}</p>
        <button type="button" class="btn btn-primary" id="int-migrate-export">
          <span class="ms">download</span> ${esc(t('integration.migrationExport') || 'Export full backup')}
        </button>
      </section>` : ''}

      ${canExport ? `<section class="card card-pad" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">${esc(t('integration.updatesTitle') || 'Software updates')}</h3>
        <p class="cell-sub" style="margin:0 0 12px">${esc(t('integration.updatesHint') || 'Check GitHub once a day for a newer release and show the Owner an “update available” notice. Off keeps this instance fully offline — no outbound request.')}</p>
        <label class="ob-check" style="margin-bottom:12px">
          <input type="checkbox" id="int-update-check" ${AppConfig.updateCheck ? 'checked' : ''}>
          <span>${esc(t('integration.updatesToggle') || 'Check for new releases and notify the Owner')}</span>
        </label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="int-update-save">
            <span class="ms">save</span> ${esc(t('common.save') || 'Save')}
          </button>
          <button type="button" class="btn btn-outline" id="int-update-now">
            <span class="ms">sync</span> ${esc(t('integration.checkNow') || 'Check now')}
          </button>
          <span class="cell-sub" id="int-update-result" style="margin:0"></span>
        </div>
      </section>` : ''}

      ${canExport ? `<section class="card card-pad" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">${esc(t('integration.ocrTitle'))}</h3>
        <p class="cell-sub" style="margin:0 0 12px">${esc(t('integration.ocrHint'))}</p>
        <label class="ob-check" style="margin-bottom:12px">
          <input type="checkbox" id="int-ocr" ${AppConfig.zimmetOcr ? 'checked' : ''}>
          <span>${esc(t('integration.ocrToggle'))}</span>
        </label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="int-ocr-save">
            <span class="ms">save</span> ${esc(t('common.save') || 'Save')}
          </button>
        </div>
      </section>` : ''}

      <section class="card card-pad" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">${esc(t('int.ticketing.title'))}</h3>
        <p class="cell-sub" style="margin:0 0 12px">${esc(t('int.ticketing.hint'))}</p>
        <label class="ob-check" style="margin-bottom:12px">
          <input type="checkbox" id="int-ticketing" ${AppConfig.ticketingEnabled ? 'checked' : ''}${chkDis}>
          <span>${esc(t('int.ticketing.toggle'))}</span>
        </label>
        ${canManage ? `<div><button type="button" class="btn btn-primary" id="int-ticketing-save">
          <span class="ms">save</span> ${esc(t('common.save') || 'Save')}</button></div>` : ''}
      </section>

      <section class="card card-pad">
        <h3 style="margin:0 0 8px">Sync connectors (API)</h3>
        <pre class="mono" style="white-space:pre-wrap;font-size:12px;background:#f6f5fa;padding:12px;border-radius:10px;overflow:auto">POST /api/integrations/sync/employees
{ "items": [{ "email":"a@x.com", "fullName":"Ada", "department":"IT" }] }

POST /api/integrations/sync/assets
{ "items": [{ "assetTag":"IT-1", "serialNumber":"SN1", "brand":"Dell", "model":"L5540", "category":"Laptop" }] }

POST /api/integrations/sync/software-installs
{ "items": [{ "softwareName":"Microsoft 365", "hostname":"LAP-01", "assetTag":"IT-1", "version":"16" }] }

GET /api/integrations/licenses/:id/sam
  (SAM button on Licenses appears only after sync data exists for that software)</pre>
      </section>
    </div>`;

  // Weekday picker is only meaningful for the weekly cadence.
  const syncWeekdayVisibility = () => {
    const wrap = $('#int-notify-weekday-wrap', el);
    if (wrap) wrap.style.display = $('#int-notify-schedule', el)?.value === 'weekly' ? '' : 'none';
  };
  $('#int-notify-schedule', el)?.addEventListener('change', syncWeekdayVisibility);
  syncWeekdayVisibility();

  $('#int-ai-provider', el)?.addEventListener('change', () => {
    const sel = $('#int-ai-provider', el);
    const prov = aiProviders.find((p) => p.id === sel?.value);
    if (!prov) return;
    const model = $('#int-ai-model', el);
    const base = $('#int-ai-base', el);
    if (model) model.value = prov.defaultModel || '';
    if (base) base.value = prov.defaultBaseUrl || '';
  });

  $('#int-ai-open', el)?.addEventListener('click', async () => {
    try {
      if (typeof syncAssistantChrome === 'function') await syncAssistantChrome();
      if (typeof openAssistant === 'function') openAssistant();
      else toast(t('ai.loadFailed'), 'error');
    } catch (err) { toast(err.message, 'error'); }
  });

  // Keep floating launcher in sync with the saved toggle when this page is open.
  if (typeof syncAssistantChrome === 'function') syncAssistantChrome().catch(() => {});

  $('#int-ai-save', el)?.addEventListener('click', async () => {
    try {
      const enabled = !!$('#int-ai-enabled', el)?.checked;
      await api('/ai/config', {
        method: 'PUT',
        body: {
          enabled,
          provider: $('#int-ai-provider', el)?.value,
          model: $('#int-ai-model', el)?.value.trim(),
          baseUrl: $('#int-ai-base', el)?.value.trim(),
          apiKey: $('#int-ai-key', el)?.value,
        },
      });
      toast(enabled ? t('ai.savedOn') : t('ai.savedOff'), 'success');
      if (typeof syncAssistantChrome === 'function') await syncAssistantChrome();
      Views.integrations(el);
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#int-ai-test', el)?.addEventListener('click', async () => {
    const btn = $('#int-ai-test', el);
    try {
      btn.disabled = true;
      // Persist first so test uses the form values.
      await api('/ai/config', {
        method: 'PUT',
        body: {
          enabled: true,
          provider: $('#int-ai-provider', el)?.value,
          model: $('#int-ai-model', el)?.value.trim(),
          baseUrl: $('#int-ai-base', el)?.value.trim(),
          apiKey: $('#int-ai-key', el)?.value,
        },
      });
      const data = await api('/ai/test', { method: 'POST', body: {} });
      const models = (data.models || []).slice(0, 8).join(', ');
      toast(data.ok
        ? `Connected${models ? ` — models: ${models}` : ''}`
        : 'Probe finished', 'success');
      if (typeof syncAssistantChrome === 'function') syncAssistantChrome().catch(() => {});
      Views.integrations(el);
    } catch (err) { toast(err.message, 'error'); }
    finally { if (btn) btn.disabled = false; }
  });

  $('#int-ai-clear', el)?.addEventListener('click', () => {
    confirmModal('Clear AI provider settings (API key + model)?', async () => {
      await api('/ai/config', { method: 'DELETE' });
      toast('AI settings cleared', 'success');
      if (typeof syncAssistantChrome === 'function') syncAssistantChrome().catch(() => {});
      Views.integrations(el);
    });
  });

  $('#int-sso-save', el)?.addEventListener('click', async () => {
    try {
      await api('/integrations/sso', {
        method: 'PUT',
        body: {
          enabled: !!$('#int-sso-enabled', el)?.checked,
          issuer: $('#int-sso-issuer', el)?.value.trim(),
          clientId: $('#int-sso-client', el)?.value.trim(),
          clientSecret: $('#int-sso-secret', el)?.value,
          redirectUri: $('#int-sso-redirect', el)?.value.trim(),
          allowedDomains: $('#int-sso-domains', el)?.value,
          buttonLabel: $('#int-sso-label', el)?.value.trim(),
          requireSso: !!$('#int-sso-require', el)?.checked,
        },
      });
      toast(t('int.sso.saved') || 'SSO settings saved', 'success');
      Views.integrations(el);
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#int-sso-test', el)?.addEventListener('click', async () => {
    const btn = $('#int-sso-test', el);
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = t('common.loading') || 'Loading…';
    try {
      const r = await api('/integrations/sso/test', { method: 'POST' });
      toast((t('int.sso.testOk') || 'Provider reachable') + ' — ' + (r.issuer || ''), 'success');
    } catch (err) {
      toast((t('int.sso.testFail') || 'Could not reach provider') + ': ' + err.message, 'error');
    } finally { btn.disabled = false; btn.textContent = label; }
  });

  $('#int-smtp-save', el)?.addEventListener('click', async () => {
    try {
      const to = $('#int-notify-to', el).value.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      let host = $('#int-smtp-host', el).value.trim();
      let port = Number($('#int-smtp-port', el).value) || 587;
      let secure = $('#int-smtp-secure', el).checked;
      // iCloud: Docker/NAT often cannot open 465 — force Apple's documented STARTTLS setup.
      if (/^smtp\.mail\.me\.com$/i.test(host) && (port === 465 || secure)) {
        port = 587;
        secure = false;
        $('#int-smtp-port', el).value = '587';
        $('#int-smtp-secure', el).checked = false;
      }
      await api('/integrations/notifications', {
        method: 'PUT',
        body: {
          smtp: {
            host,
            port,
            user: $('#int-smtp-user', el).value.trim(),
            pass: $('#int-smtp-pass', el).value,
            from: $('#int-smtp-from', el).value.trim(),
            secure,
          },
          notify: {
            enabled: $('#int-notify-on', el).checked,
            to,
            handoverCompleted: $('#int-notify-ho', el).checked,
            ticketUpdates: $('#int-notify-tickets', el).checked,
            schedule: $('#int-notify-schedule', el).value,
            hour: Number($('#int-notify-hour', el).value),
            weekday: Number($('#int-notify-weekday', el).value),
            appUrl: $('#int-notify-appurl', el).value.trim(),
          },
        },
      });
      toast('SMTP settings saved', 'success');
      Views.integrations(el);
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#int-smtp-test', el)?.addEventListener('click', async () => {
    const btn = $('#int-smtp-test', el);
    try {
      btn.disabled = true;
      // Persist current form first so a freshly typed password is used.
      const toList = $('#int-notify-to', el).value.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      let host = $('#int-smtp-host', el).value.trim();
      let port = Number($('#int-smtp-port', el).value) || 587;
      let secure = $('#int-smtp-secure', el).checked;
      if (/^smtp\.mail\.me\.com$/i.test(host) && (port === 465 || secure)) {
        port = 587;
        secure = false;
        $('#int-smtp-port', el).value = '587';
        $('#int-smtp-secure', el).checked = false;
      }
      await api('/integrations/notifications', {
        method: 'PUT',
        body: {
          smtp: {
            host,
            port,
            user: $('#int-smtp-user', el).value.trim(),
            pass: $('#int-smtp-pass', el).value,
            from: $('#int-smtp-from', el).value.trim(),
            secure,
          },
          notify: {
            enabled: $('#int-notify-on', el).checked,
            to: toList,
            handoverCompleted: $('#int-notify-ho', el).checked,
            schedule: $('#int-notify-schedule', el).value,
            hour: Number($('#int-notify-hour', el).value),
            weekday: Number($('#int-notify-weekday', el).value),
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

  $('#int-digest', el)?.addEventListener('click', async () => {
    try {
      const r = await api('/integrations/notifications/digest', { method: 'POST', body: {} });
      toast(r.skipped ? `Digest skipped: ${r.reason}` : `Digest sent (${r.alertItems} items)`, r.skipped ? 'info' : 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#int-smtp-clear', el)?.addEventListener('click', () => {
    confirmModal(
      'Clear SMTP host/credentials and all notification recipients / toggles?',
      async () => {
        await api('/integrations/notifications', { method: 'DELETE' });
        toast('SMTP & notification settings cleared', 'success');
        Views.integrations(el);
      }
    );
  });


  $('#int-migrate-export', el)?.addEventListener('click', async () => {
    const btn = $('#int-migrate-export', el);
    try {
      if (btn) btn.disabled = true;
      const res = await fetch('/api/migrations/export', {
        headers: Auth.token ? { Authorization: 'Bearer ' + Auth.token } : {},
      });
      if (!res.ok) {
        let msg = 'Export failed';
        try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const name = (m && m[1]) || 'itacm-migrate.tar.gz';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      toast(t('integration.migrationExportDone') || 'Migration package downloaded — keep JWT_SECRET with it', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { if (btn) btn.disabled = false; }
  });

  $('#int-update-save', el)?.addEventListener('click', async () => {
    const btn = $('#int-update-save', el);
    const on = !!$('#int-update-check', el)?.checked;
    if (btn) btn.disabled = true;
    try {
      const saved = await api('/settings', { method: 'PUT', body: { updateCheck: on } });
      // Keep the in-memory bootstrap config in sync so the toggle survives a
      // client-side re-render without a full reload.
      if (typeof AppConfig === 'object' && AppConfig) AppConfig.updateCheck = saved ? !!saved.updateCheck : on;
      toast(t('integration.updatesSaved') || 'Update settings saved', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { if (btn) btn.disabled = false; }
  });

  $('#int-ocr-save', el)?.addEventListener('click', async () => {
    const btn = $('#int-ocr-save', el);
    const on = !!$('#int-ocr', el)?.checked;
    if (btn) btn.disabled = true;
    try {
      const saved = await api('/settings', { method: 'PUT', body: { zimmetOcr: on } });
      // Keep the in-memory bootstrap config in sync so the toggle survives a
      // client-side re-render without a full reload.
      if (typeof AppConfig === 'object' && AppConfig) AppConfig.zimmetOcr = saved ? !!saved.zimmetOcr : on;
      toast(t('integration.ocrSaved'), 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { if (btn) btn.disabled = false; }
  });

  $('#int-ticketing-save', el)?.addEventListener('click', async () => {
    const btn = $('#int-ticketing-save', el);
    const on = !!$('#int-ticketing', el)?.checked;
    if (btn) btn.disabled = true;
    try {
      const saved = await api('/settings', { method: 'PUT', body: { ticketingEnabled: on } });
      if (typeof AppConfig === 'object' && AppConfig) AppConfig.ticketingEnabled = saved ? !!saved.ticketingEnabled : on;
      toast(t('int.ticketing.saved'), 'success');
      if (typeof renderNav === 'function') renderNav(); // show/hide the Service Desk item
    } catch (err) { toast(err.message, 'error'); }
    finally { if (btn) btn.disabled = false; }
  });

  $('#int-update-now', el)?.addEventListener('click', async () => {
    const btn = $('#int-update-now', el);
    const out = $('#int-update-result', el);
    if (btn) btn.disabled = true;
    if (out) out.textContent = t('integration.checking') || 'Checking…';
    try {
      const info = await api('/integrations/update-check', { method: 'POST' });
      if (!info || !info.ok) {
        if (out) out.textContent = t('integration.checkFailed') || 'Could not reach the update server';
      } else if (info.updateAvailable) {
        const msg = (t('integration.updateAvail') || 'Update available: v{v}').replace('{v}', info.updateAvailable);
        if (out) out.textContent = msg;
        if (typeof AppConfig === 'object' && AppConfig) AppConfig.updateAvailable = info.updateAvailable;
        toast(msg, 'success');
      } else {
        const msg = (t('integration.upToDate') || 'You are on the latest version (v{v})').replace('{v}', info.current);
        if (out) out.textContent = msg;
        toast(msg, 'success');
      }
    } catch (err) { toast(err.message, 'error'); if (out) out.textContent = ''; }
    finally { if (btn) btn.disabled = false; }
  });


  function applyEmailTplPreviewVars(template, vars, { html = false } = {}) {
    let out = String(template ?? '');
    for (const [k, v] of Object.entries(vars || {})) {
      const raw = v == null ? '' : String(v);
      const val = html ? esc(raw) : raw;
      out = out.split(`{{${k}}}`).join(val);
    }
    return out;
  }

  // Switching templates loads the saved (or default) content for that key.
  // Unsaved edits to the previous template are discarded, same as a reload.
  $('#int-tpl-key', el)?.addEventListener('change', () => {
    const k = $('#int-tpl-key', el).value;
    const cur = tpls[k] || emptyTpl;
    $('#int-tpl-subject', el).value = cur.subject || '';
    $('#int-tpl-html', el).value = cur.bodyHtml || '';
    $('#int-tpl-text', el).value = cur.bodyText || '';
    const ph = $('#int-tpl-ph', el);
    if (ph) ph.innerHTML = 'Placeholders: ' + tplPhOf(k).map((p) => '<code>{{' + esc(p) + '}}</code>').join(' ');
    const ch = $('#int-tpl-custom', el);
    if (ch) ch.textContent = cur.isCustom ? 'Custom override saved' : 'Using built-in default';
  });

  $('#int-tpl-preview', el)?.addEventListener('click', () => {
    const cfg = typeof AppConfig !== 'undefined' ? AppConfig : {};
    const vars = {
      companyName: cfg.companyName || 'Acme Corp',
      companyAddress: cfg.companyAddress || '123 Example Street',
      employeeName: 'Ada Lovelace',
      employeeEmail: 'ada@example.com',
      startDate: new Date().toISOString().slice(0, 10),
      itemList: '- IT-1001: Dell Latitude 5540\n- Line: +1 555-0100 (Operator · Plan)',
      appUrl: (typeof location !== 'undefined' && location.origin) || 'http://localhost:8000',
      accessInstructions: 'Sign in with your company email. Contact IT Helpdesk if you need help getting access.',
      tempPassword: 'Xy7-sample-pass',
      // HR request / handover / digest / ownership placeholders
      department: 'Sales',
      eventDate: new Date().toISOString().slice(0, 10),
      notes: 'Needs a docking station on day one.',
      requestedBy: 'HR Team',
      requestType: 'onboard',
      itemCount: '3',
      handoverId: 'HF-9F91888D',
      ackNote: 'An acknowledgement link was generated for the employee to confirm receipt.',
      alertCount: '4',
      alertSummary: 'Expired licenses (2)\n  - Adobe CC · 2026-06-30\n\nLow stock (2)\n  - Toner 26X: 1/5',
      credentials: 'Sign in with your existing credentials and MFA.',
    };
    const subject = applyEmailTplPreviewVars($('#int-tpl-subject', el)?.value || '', vars, { html: false });
    const bodyHtml = applyEmailTplPreviewVars($('#int-tpl-html', el)?.value || '', vars, { html: true });
    const bodyText = applyEmailTplPreviewVars($('#int-tpl-text', el)?.value || '', vars, { html: false });
    const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>`
      + `<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#1a1a1a;max-width:640px;margin:0 auto;padding:24px">`
      + `${bodyHtml}</body></html>`;

    openModal({
      wide: true,
      title: t('integration.emailTemplatePreview') || 'Preview',
      body: `
        <p class="cell-sub" style="margin:0 0 12px">${esc(t('integration.emailTemplatePreviewHint') || 'Sample data is used for placeholders. This is not sent.')}</p>
        <div style="margin-bottom:12px">
          <span class="cell-sub">${esc(t('integration.emailTemplateSubject') || 'Subject')}</span>
          <div style="font-weight:600;margin-top:4px">${esc(subject)}</div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <button type="button" class="btn btn-primary btn-sm" id="tpl-prev-html">HTML</button>
          <button type="button" class="btn btn-outline btn-sm" id="tpl-prev-text">Text</button>
        </div>
        <iframe id="tpl-prev-frame" title="HTML preview" sandbox
          style="width:100%;height:360px;border:1px solid var(--border,#e8e6f0);border-radius:8px;background:#fff"></iframe>
        <pre id="tpl-prev-textpane" class="mono" hidden
          style="white-space:pre-wrap;font-size:12px;background:#f6f5fa;padding:12px;border-radius:8px;max-height:360px;overflow:auto;margin:0">${esc(bodyText)}</pre>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close') || 'Close')}</button>`,
      onMount(overlay) {
        const frame = $('#tpl-prev-frame', overlay);
        const textPane = $('#tpl-prev-textpane', overlay);
        const btnHtml = $('#tpl-prev-html', overlay);
        const btnText = $('#tpl-prev-text', overlay);
        if (frame) frame.srcdoc = wrappedHtml;
        const show = (mode) => {
          const isHtml = mode === 'html';
          if (frame) frame.hidden = !isHtml;
          if (textPane) textPane.hidden = isHtml;
          if (btnHtml) btnHtml.className = isHtml ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
          if (btnText) btnText.className = isHtml ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm';
        };
        btnHtml?.addEventListener('click', () => show('html'));
        btnText?.addEventListener('click', () => show('text'));
      },
    });
  });

  $('#int-tpl-save', el)?.addEventListener('click', async () => {
    try {
      const key = $('#int-tpl-key', el)?.value || 'onboarding_welcome';
      await api('/integrations/email-templates', {
        method: 'PUT',
        body: {
          [key]: {
            subject: $('#int-tpl-subject', el).value,
            bodyHtml: $('#int-tpl-html', el).value,
            bodyText: $('#int-tpl-text', el).value,
          },
        },
      });
      toast('Email template saved', 'success');
      Views.integrations(el);
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#int-tpl-reset', el)?.addEventListener('click', async () => {
    try {
      const key = $('#int-tpl-key', el)?.value || 'onboarding_welcome';
      await api('/integrations/email-templates', {
        method: 'PUT',
        body: { reset: [key] },
      });
      toast('Template reset to default', 'success');
      Views.integrations(el);
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#int-key-create', el)?.addEventListener('click', async () => {
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

  $('#int-hook-add', el)?.addEventListener('click', () => {
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

  $('#int-hook-save', el)?.addEventListener('click', async () => {
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

  $('#int-cf-add', el)?.addEventListener('click', async () => {
    try {
      const fieldType = $('#int-cf-type', el).value;
      const optionsRaw = ($('#int-cf-options', el)?.value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await api('/integrations/custom-fields', {
        method: 'POST',
        body: {
          entity: $('#int-cf-entity', el).value,
          fieldKey: $('#int-cf-key', el).value.trim(),
          label: $('#int-cf-label', el).value.trim(),
          fieldType,
          options: fieldType === 'select' ? optionsRaw : [],
        },
      });
      toast('Field saved — it will show on the matching form', 'success');
      Views.integrations(el);
    } catch (err) { toast(err.message, 'error'); }
  });

  const syncCfOptions = () => {
    const wrap = $('#int-cf-options-wrap', el);
    if (!wrap) return;
    wrap.style.display = $('#int-cf-type', el).value === 'select' ? '' : 'none';
  };
  $('#int-cf-type', el)?.addEventListener('change', syncCfOptions);
  syncCfOptions();

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
