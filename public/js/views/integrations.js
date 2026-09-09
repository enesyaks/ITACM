/** Owner Integrations: SMTP, API keys, webhooks, custom fields, sync docs. */
Views.integrations = async function (el, params = {}) {
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
  const inbound = await api('/integrations/inbound-mail').catch(() => ({}));
  const ldapCfg = await api('/integrations/ldap').catch(() => ({}));
  const moApps = await api('/integrations/mail-oauth/apps').catch(() => ({}));
  const moStatus = await api('/integrations/mail-oauth/status').catch(() => ({ connected: false }));
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

      <section class="card card-pad int-pane" data-int="ai" style="margin-bottom:16px">
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

      <section class="card card-pad int-pane" data-int="smtp" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">SMTP &amp; alert digest</h3>
        <p class="cell-sub" style="margin:0 0 12px">${t('int.smtp.hint')}</p>
        ${smtp.passCorrupt ? `<p class="banner banner-rose" style="margin-bottom:12px">${esc(t('int.smtp.passCorrupt'))}</p>` : ''}
        <div class="form-grid">
          <div class="form-field full"><label>${esc(t('int.mail.authMethod'))}</label>
            <select id="int-smtp-authmethod" ${inputDis}>
              <option value="password" ${smtp.authMethod !== 'oauth2_ms' ? 'selected' : ''}>${esc(t('int.mail.authPassword'))}</option>
              <option value="oauth2_ms" ${smtp.authMethod === 'oauth2_ms' ? 'selected' : ''}>${esc(t('int.mail.authMs'))}</option>
              <option value="oauth2_delegated" ${smtp.authMethod === 'oauth2_delegated' ? 'selected' : ''}>${esc(t('int.mail.authConnected'))}</option>
            </select>
            <span class="ob-hint">${esc(t('int.mail.authHint'))}</span></div>
          <div class="form-field"><label>Host</label><input id="int-smtp-host" value="${esc(smtp.host || '')}" placeholder="smtp.mail.me.com"${inputDis}></div>
          <div class="form-field"><label>Port</label><input id="int-smtp-port" type="number" value="${esc(smtp.port || 587)}"${inputDis}></div>
          <div class="form-field"><label>User</label><input id="int-smtp-user" value="${esc(smtp.user || '')}" autocomplete="off"${inputDis}></div>
          <div class="form-field"><label>Password ${smtp.passConfigured || smtp.pass ? '<span class="ob-hint">(saved — leave blank to keep)</span>' : ''}</label>
            ${readOnly && (smtp.passConfigured || smtp.pass)
              ? secretLocked('••••••••••••')
              : `<input id="int-smtp-pass" type="password" value="" placeholder="${smtp.passConfigured || smtp.pass ? '••••••••  leave blank to keep' : 'app-specific password'}" autocomplete="new-password"${inputDis}>`}
          </div>
          <div class="form-field"><label>From</label><input id="int-smtp-from" value="${esc(smtp.from || '')}" placeholder="itacm@company.com"${inputDis}></div>
          <div class="form-field full" style="border-top:1px dashed var(--outline-variant,#ccc);padding-top:10px"><label>${esc(t('int.mail.oauthTenant'))}</label>
            <input id="int-smtp-oauth-tenant" value="${esc(smtp.oauthTenant || '')}" placeholder="contoso.onmicrosoft.com" autocomplete="off"${inputDis}>
            <span class="ob-hint">${esc(t('int.mail.oauthHint'))}</span></div>
          <div class="form-field"><label>${esc(t('int.mail.oauthClient'))}</label>
            <input id="int-smtp-oauth-client" value="${esc(smtp.oauthClientId || '')}" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off"${inputDis}></div>
          <div class="form-field"><label>${esc(t('int.mail.oauthSecret'))} ${smtp.oauthSecretConfigured ? '<span class="ob-hint">(saved — leave blank to keep)</span>' : ''}</label>
            <input id="int-smtp-oauth-secret" type="password" value="" placeholder="${smtp.oauthSecretConfigured ? '••••••••' : ''}" autocomplete="new-password"${inputDis}></div>
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
          <div class="form-field full" style="display:flex;flex-direction:column;gap:8px">
            <label style="display:flex;gap:8px;align-items:flex-start;margin:0">
              <input type="checkbox" id="int-notify-ack" ${notify.ticketAck !== false ? 'checked' : ''}${chkDis}>
              <span>${esc(t('int.notify.ack'))}<br><span class="ob-hint">${esc(t('int.notify.ackHint'))}</span></span>
            </label>
            <label style="display:flex;gap:8px;align-items:flex-start;margin:0 0 0 22px">
              <input type="checkbox" id="int-notify-ack-unknown" ${notify.ackUnknownSenders ? 'checked' : ''}${chkDis}>
              <span>${esc(t('int.notify.ackUnknown'))}<br><span class="ob-hint">${esc(t('int.notify.ackUnknownHint'))}</span></span>
            </label>
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

      <section class="card card-pad int-pane" data-int="sso" style="margin-bottom:16px">
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

      <section class="card card-pad int-pane" data-int="ldap" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px"><span class="ms ms-sm" style="vertical-align:-3px">domain</span> ${esc(t('int.ldap.title'))}</h3>
        <p class="cell-sub" style="margin:0 0 12px">${esc(t('int.ldap.hint'))}</p>
        <div class="form-grid">
          <div class="form-field full"><label>${esc(t('int.ldap.url'))}</label>
            <input id="int-ldap-url" value="${esc(ldapCfg.url || '')}" placeholder="ldaps://dc01.sirket.local:636"${inputDis}>
            <span class="ob-hint">${esc(t('int.ldap.urlHint'))}</span></div>
          <div class="form-field"><label>${esc(t('int.ldap.bindDn'))}</label>
            <input id="int-ldap-binddn" value="${esc(ldapCfg.bindDn || '')}" placeholder="CN=itacm-svc,OU=Service,DC=sirket,DC=local" autocomplete="off"${inputDis}></div>
          <div class="form-field"><label>${esc(t('int.ldap.bindPw'))} ${ldapCfg.passwordConfigured ? `<span class="ob-hint">${esc(t('int.ldap.savedBlank'))}</span>` : ''}</label>
            ${readOnly && ldapCfg.passwordConfigured
              ? secretLocked('••••••••••••', true)
              : `<input id="int-ldap-bindpw" type="password" value="" placeholder="${ldapCfg.passwordConfigured ? '••••••••' : ''}" autocomplete="new-password"${inputDis}>`}
          </div>
          <div class="form-field full"><label>${esc(t('int.ldap.baseDn'))}</label>
            <input id="int-ldap-basedn" value="${esc(ldapCfg.baseDn || '')}" placeholder="OU=Personel,DC=sirket,DC=local"${inputDis}></div>
          <div class="form-field full"><label><input type="checkbox" id="int-ldap-tls" ${ldapCfg.tlsRejectUnauthorized === false ? '' : 'checked'}${chkDis}> ${esc(t('int.ldap.verifyTls'))}</label>
            <span class="ob-hint">${esc(t('int.ldap.verifyTlsHint'))}</span></div>

          <div class="form-field full"><label>${esc(t('int.ldap.userFilter'))}</label>
            <input id="int-ldap-userfilter" value="${esc(ldapCfg.userFilter || '')}"${inputDis}>
            <span class="ob-hint">${esc(t('int.ldap.userFilterHint'))}</span></div>
          <div class="form-field full"><label>${esc(t('int.ldap.loginFilter'))}</label>
            <input id="int-ldap-loginfilter" value="${esc(ldapCfg.loginFilter || '')}"${inputDis}>
            <span class="ob-hint">${esc(t('int.ldap.loginFilterHint'))}</span></div>
        </div>

        <details class="int-ldap-attrs" style="margin-top:12px">
          <summary>${esc(t('int.ldap.attrsTitle'))}</summary>
          <div class="form-grid" style="margin-top:10px">
            ${['guid', 'username', 'email', 'displayName', 'department', 'title', 'manager'].map((k) => `
              <div class="form-field"><label>${esc(t('int.ldap.attr.' + k))}</label>
                <input id="int-ldap-attr-${k}" value="${esc((ldapCfg.attrs && ldapCfg.attrs[k]) || '')}"${inputDis}></div>`).join('')}
          </div>
          <p class="ob-hint" style="margin-top:8px">${esc(t('int.ldap.attrsHint'))}</p>
        </details>

        <div class="form-grid" style="margin-top:12px">
          <div class="form-field full"><label><input type="checkbox" id="int-ldap-login" ${ldapCfg.loginEnabled ? 'checked' : ''}${chkDis}> ${esc(t('int.ldap.loginEnable'))}</label>
            <span class="ob-hint">${esc(t('int.ldap.loginEnableHint'))}</span></div>
          <div class="form-field full"><label><input type="checkbox" id="int-ldap-syncemp" ${ldapCfg.syncEmployees === false ? '' : 'checked'}${chkDis}> ${esc(t('int.ldap.syncEmployees'))}</label></div>
          <div class="form-field full"><label><input type="checkbox" id="int-ldap-createusers" ${ldapCfg.createUsers ? 'checked' : ''}${chkDis}> ${esc(t('int.ldap.createUsers'))}</label>
            <span class="ob-hint">${esc(t('int.ldap.createUsersHint'))}</span></div>
          <div class="form-field full"><label><input type="checkbox" id="int-ldap-portal" ${ldapCfg.createPortalUsers ? 'checked' : ''}${chkDis}> ${esc(t('int.ldap.createPortal'))}</label>
            <span class="ob-hint">${esc(t('int.ldap.createPortalHint'))}</span></div>
          <div class="form-field full"><label><input type="checkbox" id="int-ldap-deactivate" ${ldapCfg.deactivateMissing ? 'checked' : ''}${chkDis}> ${esc(t('int.ldap.deactivate'))}</label>
            <span class="ob-hint">${esc(t('int.ldap.deactivateHint'))}</span></div>
        </div>

        <div class="int-ldap-groups">
          <div class="int-ldap-sub">${esc(t('int.ldap.groupsTitle'))}</div>
          <p class="ob-hint" style="margin:0 0 8px">${esc(t('int.ldap.groupsHint'))}</p>
          <div id="int-ldap-grouplist">
            ${((ldapCfg.groupRoleMap && ldapCfg.groupRoleMap.length) ? ldapCfg.groupRoleMap : [{ group: '', role: 'Helpdesk' }]).map((g) => `
              <div class="int-ldap-grow">
                <input class="int-ldap-g" value="${esc(g.group || '')}" placeholder="IT-Helpdesk"${inputDis}>
                <select class="int-ldap-r"${inputDis}>${['Admin', 'Helpdesk', 'Viewer', 'HR'].map((r) => `<option value="${r}"${r === g.role ? ' selected' : ''}>${r}</option>`).join('')}</select>
                <button type="button" class="btn btn-ghost btn-sm int-ldap-gdel"${inputDis}><span class="ms">close</span></button>
              </div>`).join('')}
          </div>
          ${canManage ? `<button type="button" class="btn btn-outline btn-sm" id="int-ldap-gadd"><span class="ms ms-sm">add</span> ${esc(t('int.ldap.addGroup'))}</button>` : ''}
        </div>

        <div class="form-grid" style="margin-top:12px">
          <div class="form-field"><label>${esc(t('int.ldap.schedule'))}</label>
            <select id="int-ldap-schedule"${inputDis}>
              ${['off', 'hourly', 'daily'].map((v) => `<option value="${v}"${(ldapCfg.syncSchedule || 'off') === v ? ' selected' : ''}>${esc(t('int.ldap.sched.' + v))}</option>`).join('')}
            </select></div>
          <div class="form-field"><label>${esc(t('int.ldap.scheduleHour'))}</label>
            <input id="int-ldap-hour" type="number" min="0" max="23" value="${esc(String(ldapCfg.syncHour == null ? 3 : ldapCfg.syncHour))}"${inputDis}></div>
          <div class="form-field full"><label><input type="checkbox" id="int-ldap-enabled" ${ldapCfg.enabled ? 'checked' : ''}${chkDis}> ${esc(t('int.ldap.enable'))}</label></div>
        </div>

        ${ldapCfg.lastRun ? `<p class="cell-sub" style="margin:10px 0 0">${esc(t('int.ldap.lastRun'))}:
          ${esc(String(ldapCfg.lastRun.startedAt).replace('T', ' ').slice(0, 16))} ·
          ${esc(t('int.ldap.created'))} ${esc(String(ldapCfg.lastRun.created))} ·
          ${esc(t('int.ldap.updated'))} ${esc(String(ldapCfg.lastRun.updated))} ·
          ${esc(t('int.ldap.deactivated'))} ${esc(String(ldapCfg.lastRun.deactivated))}
          ${ldapCfg.lastRun.error ? `<span style="color:var(--rose-600,#e11d48)"> · ${esc(ldapCfg.lastRun.error)}</span>` : ''}</p>` : ''}

        ${canManage ? `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-primary" id="int-ldap-save">${esc(t('common.save'))}</button>
          <button class="btn btn-outline" id="int-ldap-test">${esc(t('int.ldap.test'))}</button>
          <button class="btn btn-outline" id="int-ldap-preview">${esc(t('int.ldap.preview'))}</button>
          <button class="btn btn-outline" id="int-ldap-sync">${esc(t('int.ldap.syncNow'))}</button>
        </div>` : ''}
        <div id="int-ldap-out" class="int-ldap-out"></div>
      </section>

      <section class="card card-pad int-pane" data-int="mailoauth" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px"><span class="ms ms-sm" style="vertical-align:-3px">link</span> ${esc(t('int.mo.title'))}</h3>
        <p class="cell-sub" style="margin:0 0 12px">${esc(t('int.mo.hint'))}</p>
        ${moStatus.connected
    ? `<p class="banner banner-emerald" style="margin:0 0 12px">${esc(t('int.mo.connectedAs'))} <strong>${esc(moStatus.email || '')}</strong> · ${esc(moStatus.provider || '')}</p>
           ${canManage ? `<button class="btn btn-outline" id="int-mo-disconnect">${esc(t('int.mo.disconnect'))}</button>` : ''}`
    : `<p class="cell-sub" style="margin:0 0 8px">${esc(t('int.mo.notConnected'))}</p>
           ${canManage ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
             <button class="btn btn-primary" id="int-mo-connect-microsoft">${esc(t('int.mo.connectMs'))}</button>
             <button class="btn btn-primary" id="int-mo-connect-google">${esc(t('int.mo.connectGoogle'))}</button>
           </div>` : ''}`}
        <details style="margin-top:14px">
          <summary style="cursor:pointer;font-size:13px;color:var(--on-surface-variant,#555)">${esc(t('int.mo.appSettings'))}</summary>
          <div class="form-grid" style="margin-top:10px">
            <div class="form-field full"><label>${esc(t('int.mo.redirectUri'))}</label>
              <input value="${esc(moApps.redirectUri || '')}" readonly onclick="this.select()" style="font-family:ui-monospace,monospace;font-size:12px">
              <span class="ob-hint">${esc(t('int.mo.redirectHint'))}</span></div>
            <div class="form-field full"><strong>Microsoft</strong></div>
            <div class="form-field"><label>Client ID</label><input id="int-mo-ms-client" value="${esc((moApps.microsoft || {}).clientId || '')}" autocomplete="off"${inputDis}></div>
            <div class="form-field"><label>${esc(t('int.mo.tenant'))}</label><input id="int-mo-ms-tenant" value="${esc((moApps.microsoft || {}).tenant || '')}" placeholder="common" autocomplete="off"${inputDis}></div>
            <div class="form-field full"><label>Client secret ${(moApps.microsoft || {}).hasSecret ? `<span class="ob-hint">${esc(t('int.inbound.keep'))}</span>` : ''}</label>
              <input id="int-mo-ms-secret" type="password" value="" placeholder="${(moApps.microsoft || {}).hasSecret ? '••••••••' : ''}" autocomplete="new-password"${inputDis}></div>
            <div class="form-field full"><strong>Google</strong></div>
            <div class="form-field"><label>Client ID</label><input id="int-mo-g-client" value="${esc((moApps.google || {}).clientId || '')}" autocomplete="off"${inputDis}></div>
            <div class="form-field"><label>Client secret ${(moApps.google || {}).hasSecret ? `<span class="ob-hint">${esc(t('int.inbound.keep'))}</span>` : ''}</label>
              <input id="int-mo-g-secret" type="password" value="" placeholder="${(moApps.google || {}).hasSecret ? '••••••••' : ''}" autocomplete="new-password"${inputDis}></div>
          </div>
          ${canManage ? `<button class="btn btn-outline" id="int-mo-apps-save" style="margin-top:10px">${esc(t('common.save'))}</button>` : ''}
        </details>
      </section>

      <section class="card card-pad int-pane" data-int="inbound" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px"><span class="ms ms-sm" style="vertical-align:-3px">forward_to_inbox</span> ${esc(t('int.inbound.title'))}</h3>
        <p class="cell-sub" style="margin:0 0 12px">${esc(t('int.inbound.hint'))}</p>
        <div class="form-grid">
          <div class="form-field full"><label>${esc(t('int.mail.authMethod'))}</label>
            <select id="int-imap-authmethod" ${inputDis}>
              <option value="password" ${inbound.authMethod !== 'oauth2_ms' ? 'selected' : ''}>${esc(t('int.mail.authPassword'))}</option>
              <option value="oauth2_ms" ${inbound.authMethod === 'oauth2_ms' ? 'selected' : ''}>${esc(t('int.mail.authMs'))}</option>
              <option value="oauth2_delegated" ${inbound.authMethod === 'oauth2_delegated' ? 'selected' : ''}>${esc(t('int.mail.authConnected'))}</option>
            </select>
            <span class="ob-hint">${esc(t('int.mail.authHint'))}</span></div>
          <div class="form-field"><label>${esc(t('int.inbound.host'))}</label>
            <input id="int-imap-host" value="${esc(inbound.host || '')}" placeholder="imap.gmail.com"${inputDis}></div>
          <div class="form-field"><label>${esc(t('int.inbound.port'))}</label>
            <input id="int-imap-port" type="number" value="${esc(inbound.port || 993)}" placeholder="993"${inputDis}></div>
          <div class="form-field"><label>${esc(t('int.inbound.user'))}</label>
            <input id="int-imap-user" value="${esc(inbound.user || '')}" placeholder="destek@sirket.com" autocomplete="off"${inputDis}></div>
          <div class="form-field"><label>${esc(t('int.inbound.pass'))} ${inbound.hasPass ? `<span class="ob-hint">${esc(t('int.inbound.keep'))}</span>` : ''}</label>
            <input id="int-imap-pass" type="password" value="" placeholder="${inbound.hasPass ? '••••••••' : ''}" autocomplete="new-password"${inputDis}></div>
          <div class="form-field full" style="border-top:1px dashed var(--outline-variant,#ccc);padding-top:10px"><label>${esc(t('int.mail.oauthTenant'))}</label>
            <input id="int-imap-oauth-tenant" value="${esc(inbound.oauthTenant || '')}" placeholder="contoso.onmicrosoft.com" autocomplete="off"${inputDis}>
            <span class="ob-hint">${esc(t('int.mail.oauthHint'))}</span></div>
          <div class="form-field"><label>${esc(t('int.mail.oauthClient'))}</label>
            <input id="int-imap-oauth-client" value="${esc(inbound.oauthClientId || '')}" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off"${inputDis}></div>
          <div class="form-field"><label>${esc(t('int.mail.oauthSecret'))} ${inbound.hasOauthSecret ? `<span class="ob-hint">${esc(t('int.inbound.keep'))}</span>` : ''}</label>
            <input id="int-imap-oauth-secret" type="password" value="" placeholder="${inbound.hasOauthSecret ? '••••••••' : ''}" autocomplete="new-password"${inputDis}></div>
          <div class="form-field"><label>${esc(t('int.inbound.folder'))}</label>
            <div style="display:flex;gap:6px">
              <input id="int-imap-folder" value="${esc(inbound.folder || 'INBOX')}" placeholder="INBOX" list="int-imap-folder-list"${inputDis}>
              <button type="button" class="btn btn-outline btn-sm" id="int-imap-folder-load"${inputDis}>${esc(t('int.inbound.folderLoad'))}</button>
            </div>
            <datalist id="int-imap-folder-list"></datalist>
            <span class="ob-hint" id="int-imap-folder-hint">${esc(t('int.inbound.folderHint'))}</span></div>
          <div class="form-field"><label>${esc(t('int.inbound.type'))}</label>
            <select id="int-imap-type" ${inputDis}>
              <option value="incident" ${inbound.defaultType !== 'request' ? 'selected' : ''}>${esc(tkTypeLabel ? tkTypeLabel('incident') : 'Incident')}</option>
              <option value="request" ${inbound.defaultType === 'request' ? 'selected' : ''}>${esc(tkTypeLabel ? tkTypeLabel('request') : 'Request')}</option>
            </select></div>
          <div class="form-field"><label>${esc(t('int.inbound.category'))}</label>
            <input id="int-imap-cat" value="${esc(inbound.defaultCategory || '')}" placeholder="${esc(t('int.inbound.categoryPh'))}"${inputDis}></div>
          <div class="form-field full"><label>${esc(t('int.inbound.authserv'))}</label>
            <input id="int-imap-authserv" value="${esc(inbound.authServId || '')}" placeholder="mx.google.com" autocomplete="off"${inputDis}>
            <span class="ob-hint">${esc(t('int.inbound.authservHint'))}</span></div>
          <div class="form-field"><label style="padding-top:26px"><input type="checkbox" id="int-imap-secure" ${inbound.secure !== false ? 'checked' : ''}${chkDis}> TLS (SSL)</label></div>
          <div class="form-field full"><label><input type="checkbox" id="int-imap-enabled" ${inbound.enabled ? 'checked' : ''}${chkDis}> ${esc(t('int.inbound.enable'))}</label>
            <span class="ob-hint">${esc(t('int.inbound.enableHint'))}</span></div>
          <div class="form-field full">
            <span class="ob-hint">${inbound.watch
              ? esc(t('int.inbound.watching').replace('{folder}', inbound.watch.folder || 'INBOX').replace('{uid}', inbound.watch.uid))
              : esc(t('int.inbound.watchingNone'))}</span></div>
        </div>
        ${canManage ? `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-primary" id="int-imap-save">${esc(t('common.save'))}</button>
          <button class="btn btn-outline" id="int-imap-test">${esc(t('int.inbound.test'))}</button>
          <button class="btn btn-outline" id="int-imap-poll">${esc(t('int.inbound.pollNow'))}</button>
          <button class="btn btn-outline" id="int-imap-block"><span class="ms ms-sm" style="vertical-align:-3px">block</span> ${esc(t('int.inbound.block'))}</button>
        </div>` : ''}
      </section>

      <section class="card card-pad int-pane" data-int="templates" style="margin-bottom:16px">
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

      <section class="card card-pad int-pane" data-int="apikeys" style="margin-bottom:16px">
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

      <section class="card card-pad int-pane" data-int="webhooks" style="margin-bottom:16px">
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

      <section class="card card-pad int-pane" data-int="customfields" style="margin-bottom:16px">
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

      ${canExport ? `<section class="card card-pad int-pane" data-int="migration" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">${esc(t('integration.migrationTitle') || 'System migration')}</h3>
        <p class="cell-sub" style="margin:0 0 12px">${esc(t('integration.migrationHint') || '')}</p>
        <p class="banner banner-amber" style="margin:0 0 12px">${esc(t('integration.migrationSmtpWarn') || '')}</p>
        <button type="button" class="btn btn-primary" id="int-migrate-export">
          <span class="ms">download</span> ${esc(t('integration.migrationExport') || 'Export full backup')}
        </button>
      </section>` : ''}

      ${canExport ? `<section class="card card-pad int-pane" data-int="updates" style="margin-bottom:16px">
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

      ${canExport ? `<section class="card card-pad int-pane" data-int="ocr" style="margin-bottom:16px">
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

      <section class="card card-pad int-pane" data-int="ticketing" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">${esc(t('int.ticketing.title'))}</h3>
        <p class="cell-sub" style="margin:0 0 12px">${esc(t('int.ticketing.hint'))}</p>
        <label class="ob-check" style="margin-bottom:12px">
          <input type="checkbox" id="int-ticketing" ${AppConfig.ticketingEnabled ? 'checked' : ''}${chkDis}>
          <span>${esc(t('int.ticketing.toggle'))}</span>
        </label>
        ${canManage ? `<div><button type="button" class="btn btn-primary" id="int-ticketing-save">
          <span class="ms">save</span> ${esc(t('common.save') || 'Save')}</button></div>` : ''}
      </section>

      <section class="card card-pad int-pane" data-int="sync">
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

  // Wall of forms -> status board + side nav. Sections keep their markup and
  // ids, so every listener below still finds its element.
  buildIntegrationShell();

  /** Per-integration status, derived from the config we already fetched. */
  function integrationStatus() {
    const smtpReady = !!(smtp.host && (smtp.passConfigured || smtp.pass || smtp.authMethod !== 'password'));
    const ldapReady = !!(ldapCfg.url && ldapCfg.baseDn);
    const inboundReady = !!(inbound.host && inbound.user);
    const cfCount = cfAsset.length + cfEmp.length + cfContract.length;
    const activeHooks = webhookList.filter((h) => h.active !== false).length;
    const liveKeys = (Array.isArray(keys) ? keys : []).filter((k) => !k.revokedAt).length;
    const customTpls = tplKeys.filter((k) => tpls[k] && tpls[k].isCustom).length;
    const lastLdap = ldapCfg.lastRun && ldapCfg.lastRun.at ? fmtDate(ldapCfg.lastRun.at) : '';

    return {
      ai: aiCfg.apiKeyCorrupt
        ? { state: 'err', label: t('int.st.error') || 'Error', detail: t('int.ai.keyUnreadable') || 'API key unreadable' }
        : aiCfg.enabled
          ? { state: 'on', label: t('int.st.on') || 'On', detail: [aiCfg.provider, aiCfg.model].filter(Boolean).join(' · ') }
          : { state: 'off', label: t('int.st.off') || 'Off', detail: aiCfg.provider || '' },
      smtp: smtp.passCorrupt
        ? { state: 'err', label: t('int.st.error') || 'Error', detail: t('int.smtp.passCorrupt') || '' }
        : smtpReady
          ? { state: notify.enabled ? 'on' : 'warn', label: notify.enabled ? (t('int.st.on') || 'On') : (t('int.st.configured') || 'Configured'), detail: smtp.host }
          : { state: 'none', label: t('int.st.none') || 'Not set up', detail: '' },
      sso: sso.ready || sso.issuer
        ? { state: sso.enabled === false ? 'warn' : 'on', label: sso.enabled === false ? (t('int.st.configured') || 'Configured') : (t('int.st.on') || 'On'), detail: hostOf(sso.issuer) }
        : { state: 'none', label: t('int.st.none') || 'Not set up', detail: '' },
      ldap: ldapReady
        ? { state: ldapCfg.enabled ? 'on' : 'warn', label: ldapCfg.enabled ? (t('int.st.on') || 'On') : (t('int.st.configured') || 'Configured'), detail: [hostOf(ldapCfg.url), lastLdap].filter(Boolean).join(' · ') }
        : { state: 'none', label: t('int.st.none') || 'Not set up', detail: '' },
      mailoauth: moStatus.connected
        ? { state: 'on', label: t('int.st.connected') || 'Connected', detail: moStatus.email || moStatus.provider || '' }
        : { state: 'none', label: t('int.st.none') || 'Not set up', detail: '' },
      inbound: inboundReady
        ? { state: inbound.enabled ? 'on' : 'warn', label: inbound.enabled ? (t('int.st.on') || 'On') : (t('int.st.configured') || 'Configured'), detail: inbound.user || hostOf(inbound.host) }
        : { state: 'none', label: t('int.st.none') || 'Not set up', detail: '' },
      templates: { state: customTpls ? 'on' : 'off', label: String(tplKeys.length), detail: customTpls ? `${customTpls} ${t('int.st.customized') || 'customized'}` : (t('int.st.defaults') || 'all default') },
      apikeys: { state: liveKeys ? 'on' : 'off', label: String(liveKeys), detail: liveKeys ? (t('int.st.active') || 'active') : (t('int.st.none') || 'Not set up') },
      webhooks: { state: activeHooks ? 'on' : 'off', label: String(webhookList.length), detail: activeHooks ? `${activeHooks} ${t('int.st.active') || 'active'}` : (t('int.st.none') || 'Not set up') },
      customfields: { state: cfCount ? 'on' : 'off', label: String(cfCount), detail: `${cfAsset.length} asset · ${cfEmp.length} employee · ${cfContract.length} contract` },
      migration: { state: 'idle', label: t('int.st.tool') || 'Tool', detail: t('int.st.exportImport') || 'export / import' },
      updates: { state: 'idle', label: t('int.st.tool') || 'Tool', detail: t('int.st.checkVersion') || 'version check' },
      ocr: { state: 'idle', label: t('int.st.tool') || 'Tool', detail: 'OCR' },
      ticketing: { state: 'idle', label: t('int.st.tool') || 'Tool', detail: t('int.st.moduleSettings') || 'module settings' },
      sync: { state: 'idle', label: t('int.st.docs') || 'Docs', detail: t('int.st.apiEndpoints') || 'API endpoints' },
    };
  }

  function hostOf(url) {
    if (!url) return '';
    try { return new URL(url).host; } catch { return String(url).replace(/^\w+:\/\//, '').split('/')[0]; }
  }

  /** Icon per section — falls back to a generic plug. */
  function intIcon(key) {
    return ({
      ai: 'auto_awesome', smtp: 'mail', sso: 'passkey', ldap: 'domain', mailoauth: 'link',
      inbound: 'forward_to_inbox', templates: 'markunread_mailbox', apikeys: 'key',
      webhooks: 'webhook', customfields: 'tune', migration: 'swap_horiz', updates: 'system_update_alt',
      ocr: 'document_scanner', ticketing: 'confirmation_number', sync: 'api',
    })[key] || 'power';
  }

  /** Moves the rendered sections into a nav + panel shell with a status board. */
  function buildIntegrationShell() {
    const shell = $('.settings-shell', el);
    if (!shell) return;
    const panes = Array.from(shell.querySelectorAll(':scope > section[data-int]'));
    if (!panes.length) return;

    const st = integrationStatus();
    const items = panes.map((sec) => {
      const key = sec.dataset.int;
      const h3 = sec.querySelector('h3');
      // The heading starts with a material-symbols span; drop it so the nav
      // label is plain text (icons come from intIcon instead).
      let title = key;
      if (h3) {
        const clone = h3.cloneNode(true);
        clone.querySelectorAll('.ms').forEach((n) => n.remove());
        title = clone.textContent.trim() || h3.textContent.trim();
      }
      return { key, title, sec, ...(st[key] || { state: 'idle', label: '', detail: '' }) };
    });

    const layout = document.createElement('div');
    layout.className = 'int-layout';
    layout.innerHTML = `
      <aside class="int-nav">
        <div class="int-search">
          <span class="ms ms-sm">search</span>
          <input type="search" id="int-nav-search" placeholder="${esc(t('int.searchPh') || 'Search integrations…')}" autocomplete="off">
        </div>
        <button type="button" class="int-nav-item is-active" data-go="overview">
          <span class="ms ms-sm">grid_view</span>
          <span class="int-nav-label">${esc(t('int.overview') || 'Overview')}</span>
        </button>
        <div class="int-nav-sep"></div>
        ${items.map((it) => `
          <button type="button" class="int-nav-item" data-go="${esc(it.key)}">
            <span class="ms ms-sm">${esc(intIcon(it.key))}</span>
            <span class="int-nav-label">${esc(it.title)}</span>
            <span class="int-dot int-dot-${esc(it.state)}" title="${esc(it.label)}"></span>
          </button>`).join('')}
      </aside>
      <div class="int-body">
        <section class="int-overview" data-int-overview>
          <div class="int-summary">
            ${[
              ['on', items.filter((i) => i.state === 'on').length, t('int.st.on') || 'On'],
              ['warn', items.filter((i) => i.state === 'warn').length, t('int.st.configured') || 'Configured'],
              ['err', items.filter((i) => i.state === 'err').length, t('int.st.error') || 'Error'],
              ['off', items.filter((i) => i.state === 'off' || i.state === 'none').length, t('int.st.none') || 'Not set up'],
            ].filter(([, n]) => n > 0).map(([state, n, label]) => `
              <span class="int-sum-chip int-chip-${esc(state)}"><b>${n}</b> ${esc(label)}</span>`).join('')}
            <span class="int-sum-hint">${esc(t('int.overviewHint') || 'Pick an integration to configure it.')}</span>
          </div>
          <div class="int-tiles">
            ${items.map((it) => `
              <button type="button" class="int-tile" data-go="${esc(it.key)}">
                <span class="int-tile-icon ms">${esc(intIcon(it.key))}</span>
                <span class="int-tile-main">
                  <span class="int-tile-title">${esc(it.title)}</span>
                  <span class="int-tile-detail">${esc(it.detail || '—')}</span>
                </span>
                <span class="int-chip int-chip-${esc(it.state)}">${esc(it.label)}</span>
              </button>`).join('')}
          </div>
        </section>
      </div>`;

    const body = layout.querySelector('.int-body');
    panes.forEach((sec) => { sec.hidden = true; sec.style.marginBottom = '0'; body.appendChild(sec); });
    shell.appendChild(layout);

    const overview = body.querySelector('[data-int-overview]');
    const navBtns = Array.from(layout.querySelectorAll('.int-nav-item'));

    function show(key, { push = true } = {}) {
      const target = key === 'overview' ? null : panes.find((p) => p.dataset.int === key);
      if (key !== 'overview' && !target) key = 'overview';
      overview.hidden = key !== 'overview';
      panes.forEach((p) => { p.hidden = p !== target; });
      navBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.go === key));
      if (push) {
        const base = (location.hash.split('?')[0]) || '#/integrations';
        const next = key === 'overview' ? base : `${base}?s=${encodeURIComponent(key)}`;
        // replaceState keeps the router quiet — same route, only the sub-tab moves.
        try { history.replaceState(null, '', next); } catch { /* file:// preview */ }
      }
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    layout.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-go]');
      if (!btn) return;
      show(btn.dataset.go);
    });

    const search = layout.querySelector('#int-nav-search');
    search?.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      navBtns.forEach((b) => {
        if (b.dataset.go === 'overview') return;
        const hit = !q || b.textContent.toLowerCase().includes(q);
        b.hidden = !hit;
      });
      layout.querySelectorAll('.int-tile').forEach((tile) => {
        const hit = !q || tile.textContent.toLowerCase().includes(q);
        tile.hidden = !hit;
      });
      if (q) show('overview', { push: false });
    });

    show(params.s || 'overview', { push: false });
  }

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

  /* ---- Directory (AD / LDAP) ---- */
  const ldapBody = () => ({
    enabled: !!$('#int-ldap-enabled', el)?.checked,
    url: $('#int-ldap-url', el)?.value.trim() || '',
    bindDn: $('#int-ldap-binddn', el)?.value.trim() || '',
    bindPassword: $('#int-ldap-bindpw', el)?.value || '',
    baseDn: $('#int-ldap-basedn', el)?.value.trim() || '',
    tlsRejectUnauthorized: !!$('#int-ldap-tls', el)?.checked,
    userFilter: $('#int-ldap-userfilter', el)?.value.trim() || '',
    loginFilter: $('#int-ldap-loginfilter', el)?.value.trim() || '',
    attrs: ['guid', 'username', 'email', 'displayName', 'department', 'title', 'manager']
      .reduce((o, k) => { o[k] = $('#int-ldap-attr-' + k, el)?.value.trim() || ''; return o; }, {}),
    loginEnabled: !!$('#int-ldap-login', el)?.checked,
    syncEmployees: !!$('#int-ldap-syncemp', el)?.checked,
    createUsers: !!$('#int-ldap-createusers', el)?.checked,
    createPortalUsers: !!$('#int-ldap-portal', el)?.checked,
    deactivateMissing: !!$('#int-ldap-deactivate', el)?.checked,
    groupRoleMap: [...el.querySelectorAll('.int-ldap-grow')]
      .map((row) => ({ group: row.querySelector('.int-ldap-g').value.trim(), role: row.querySelector('.int-ldap-r').value }))
      .filter((g) => g.group),
    syncSchedule: $('#int-ldap-schedule', el)?.value || 'off',
    syncHour: Number($('#int-ldap-hour', el)?.value) || 0,
  });

  const ldapOut = (html) => { const o = $('#int-ldap-out', el); if (o) o.innerHTML = html; };
  const ldapSummary = (r) => {
    const line = (label, n) => `<li>${esc(label)}: <strong>${esc(String(n))}</strong></li>`;
    return `<ul class="int-ldap-stats">
        ${line(t('int.ldap.created'), r.created)}
        ${line(t('int.ldap.updated'), r.updated)}
        ${line(t('int.ldap.deactivated'), r.deactivated)}
        ${line(t('int.ldap.skipped'), r.skipped)}
        ${r.users && (r.users.created || r.users.roleChanged) ? line(t('int.ldap.itAccounts'), `${r.users.created} / ${r.users.roleChanged}`) : ''}
        ${r.users && r.users.portalCreated ? line(t('int.ldap.portalAccounts'), r.users.portalCreated) : ''}
        ${r.users && r.users.portalDisabled ? line(t('int.ldap.portalDisabled'), r.users.portalDisabled) : ''}
      </ul>
      ${r.skipped && r.skippedReasons ? `<p class="cell-sub" style="margin:8px 0 0">${esc(t('int.ldap.skippedWhy'))}: ${Object.entries(r.skippedReasons).map(([k, v]) => `${esc(t('int.ldap.skip.' + k) || k)} — <strong>${esc(String(v))}</strong>`).join(' · ')}</p>` : ''}
      ${(r.warnings || []).map((w) => `<p class="banner banner-amber" style="margin:8px 0 0">${esc(w)}</p>`).join('')}
      ${(r.samples || []).length ? `<ul class="int-ldap-samples">${r.samples.map((sm) => `<li><span class="pill pill-slate">${esc(t('int.ldap.act.' + sm.action) || sm.action)}</span> ${esc(sm.name)} <span class="cell-sub">${esc(sm.email || '')}${sm.changes ? ' · ' + esc(sm.changes.join(', ')) : ''}</span></li>`).join('')}</ul>` : ''}`;
  };

  // Directory calls take seconds against a real DC, so every button locks while
  // it runs — a double-click on "Sync now" must not start a second pass.
  const ldapRun = async (btnId, fn) => {
    const btn = $(btnId, el);
    if (!btn) return;
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = t('common.loading') || 'Loading…';
    try { await fn(); } catch (err) { ldapOut(`<p class="banner banner-rose">${esc(err.message)}</p>`); toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = label; }
  };

  $('#int-ldap-gadd', el)?.addEventListener('click', () => {
    const list = $('#int-ldap-grouplist', el);
    list.insertAdjacentHTML('beforeend', `<div class="int-ldap-grow">
      <input class="int-ldap-g" value="" placeholder="IT-Helpdesk">
      <select class="int-ldap-r">${['Admin', 'Helpdesk', 'Viewer', 'HR'].map((r) => `<option value="${r}"${r === 'Helpdesk' ? ' selected' : ''}>${r}</option>`).join('')}</select>
      <button type="button" class="btn btn-ghost btn-sm int-ldap-gdel"><span class="ms">close</span></button>
    </div>`);
  });
  $('#int-ldap-grouplist', el)?.addEventListener('click', (e) => {
    const del = e.target.closest('.int-ldap-gdel');
    if (del) del.closest('.int-ldap-grow').remove();
  });

  $('#int-ldap-save', el)?.addEventListener('click', () => ldapRun('#int-ldap-save', async () => {
    await api('/integrations/ldap', { method: 'PUT', body: ldapBody() });
    toast(t('int.ldap.saved'), 'success');
    Views.integrations(el);
  }));

  $('#int-ldap-test', el)?.addEventListener('click', () => ldapRun('#int-ldap-test', async () => {
    // Save first, so "Test" always checks what is on screen rather than what
    // was stored on the last visit.
    await api('/integrations/ldap', { method: 'PUT', body: ldapBody() });
    const r = await api('/integrations/ldap/test', { method: 'POST' });
    ldapOut(`<p class="banner banner-emerald">${esc(t('int.ldap.testOk'))} — ${esc(String(r.sampleCount))} ${esc(t('int.ldap.peopleFound'))}</p>
      ${(r.warnings || []).map((w) => `<p class="banner banner-amber" style="margin-top:8px">${esc(w)}</p>`).join('')}
      <ul class="int-ldap-samples">${(r.sample || []).map((p2) => `<li>${esc(p2.name || '—')} <span class="cell-sub">${esc(p2.email || t('int.ldap.noEmail'))}</span></li>`).join('')}</ul>`);
    toast(t('int.ldap.testOk'), 'success');
  }));

  $('#int-ldap-preview', el)?.addEventListener('click', () => ldapRun('#int-ldap-preview', async () => {
    await api('/integrations/ldap', { method: 'PUT', body: ldapBody() });
    const r = await api('/integrations/ldap/preview', { method: 'POST' });
    ldapOut(`<p class="banner banner-amber">${esc(t('int.ldap.previewNote'))}</p>${ldapSummary(r)}`);
  }));

  $('#int-ldap-sync', el)?.addEventListener('click', () => ldapRun('#int-ldap-sync', async () => {
    await api('/integrations/ldap', { method: 'PUT', body: ldapBody() });
    const r = await api('/integrations/ldap/sync', { method: 'POST' });
    ldapOut(`<p class="banner banner-emerald">${esc(t('int.ldap.syncDone'))}</p>${ldapSummary(r)}`);
    toast(t('int.ldap.syncDone'), 'success');
  }));

  // Email-to-ticket (IMAP)
  const imapBody = () => ({
    enabled: !!$('#int-imap-enabled', el)?.checked,
    host: $('#int-imap-host', el)?.value.trim() || '',
    port: Number($('#int-imap-port', el)?.value) || 993,
    secure: !!$('#int-imap-secure', el)?.checked,
    user: $('#int-imap-user', el)?.value.trim() || '',
    pass: $('#int-imap-pass', el)?.value || '',
    folder: $('#int-imap-folder', el)?.value.trim() || 'INBOX',
    defaultType: $('#int-imap-type', el)?.value || 'incident',
    defaultCategory: $('#int-imap-cat', el)?.value.trim() || '',
    authServId: $('#int-imap-authserv', el)?.value.trim() || '',
    authMethod: $('#int-imap-authmethod', el)?.value || 'password',
    oauthTenant: $('#int-imap-oauth-tenant', el)?.value.trim() || '',
    oauthClientId: $('#int-imap-oauth-client', el)?.value.trim() || '',
    oauthClientSecret: $('#int-imap-oauth-secret', el)?.value || '',
  });
  $('#int-imap-save', el)?.addEventListener('click', async () => {
    const btn = $('#int-imap-save', el); btn.disabled = true;
    try { await api('/integrations/inbound-mail', { method: 'PUT', body: imapBody() }); toast(t('int.inbound.saved'), 'success'); Views.integrations(el); }
    catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  });
  $('#int-imap-test', el)?.addEventListener('click', async () => {
    const btn = $('#int-imap-test', el); const label = btn.textContent;
    btn.disabled = true; btn.textContent = t('common.loading') || '…';
    try { await api('/integrations/inbound-mail/test', { method: 'POST', body: imapBody() }); toast(t('int.inbound.testOk'), 'success'); }
    catch (err) { toast(t('int.inbound.testFail') + ': ' + err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = label; }
  });
  // Ask the mailbox what folders it actually has, so the name is picked rather
  // than typed. A wrong folder fails with the same "Command failed" as a bad
  // credential, which is exactly the confusion this removes.
  $('#int-imap-folder-load', el)?.addEventListener('click', async () => {
    const btn = $('#int-imap-folder-load', el);
    const hint = $('#int-imap-folder-hint', el);
    const list = $('#int-imap-folder-list', el);
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = t('common.loading') || '…';
    try {
      const r = await api('/integrations/inbound-mail/folders', { method: 'POST', body: imapBody() });
      const folders = (r && r.folders) || [];
      // Gmail's path is "[Gmail]/All Mail" while its name is "All Mail"; the
      // path is what IMAP wants, so that is the value — the name only labels it.
      list.innerHTML = folders.map((f) =>
        `<option value="${esc(f.path)}">${esc(f.name !== f.path ? f.name : '')}</option>`).join('');
      hint.textContent = folders.length
        ? t('int.inbound.folderFound').replace('{n}', folders.length)
        : t('int.inbound.folderNone');
    } catch (err) {
      // Listing is a convenience: a mailbox that refuses LIST can still be typed
      // in by hand, so this must not block the form.
      hint.textContent = t('int.inbound.folderFail') + ' ' + err.message;
    } finally { btn.disabled = false; btn.textContent = label; }
  });
  $('#int-imap-poll', el)?.addEventListener('click', async () => {
    const btn = $('#int-imap-poll', el); const label = btn.textContent;
    btn.disabled = true; btn.textContent = t('common.loading') || '…';
    try { const r = await api('/integrations/inbound-mail/poll', { method: 'POST' });
      // `skipped` is the "didn't run" flag; `filtered` counts messages the
      // blocklist/bulk rules declined — a successful run, not a failure.
      // "0 ticket" with nothing after it is the reply that sends people looking
      // in the wrong place: the fetch only takes UNSEEN mail and a message is
      // claimed the first time it is handled, so say which of those happened.
      const extra = [
        r.filtered ? t('int.inbound.pollFiltered').replace('{n}', r.filtered) : '',
        r.duplicate ? t('int.inbound.pollDuplicate').replace('{n}', r.duplicate) : '',
        r.failed ? t('int.inbound.pollFailed').replace('{n}', r.failed) : '',
      ].filter(Boolean).join('');
      const opened = (r.created || 0) + (r.appended || 0);
      const done = t('int.inbound.pollDone').replace('{n}', opened) + extra
        + (r.capped ? ' ' + t('int.inbound.pollCapped') : '')
        + (!opened && !extra ? ' ' + t('int.inbound.pollNothing') : '');
      // First look at a mailbox: what is already in it is history, and saying so
      // is the difference between "it works" and "it ignored my test mail".
      const adopted = r.adopted
        ? t('int.inbound.pollAdopted').replace('{n}', r.adopted.existing).replace('{folder}', r.adopted.folder)
        : '';
      toast(r.skipped ? (t('int.inbound.pollSkipped') + (r.reason ? ' (' + r.reason + ')' : '')) : (adopted || done),
        r.skipped ? 'error' : 'success');
      if (r.adopted) Views.integrations(el); }
    catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = label; }
  });

  // Delegated mail OAuth ("Connect mailbox")
  const moConnect = async (provider) => {
    try {
      const r = await api('/integrations/mail-oauth/start?provider=' + encodeURIComponent(provider));
      if (r && r.url) window.location.href = r.url; // full-page redirect to the provider's consent screen
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#int-mo-connect-microsoft', el)?.addEventListener('click', () => moConnect('microsoft'));
  $('#int-mo-connect-google', el)?.addEventListener('click', () => moConnect('google'));
  $('#int-mo-disconnect', el)?.addEventListener('click', async () => {
    try { await api('/integrations/mail-oauth/disconnect', { method: 'POST' }); toast(t('int.mo.disconnected'), 'success'); Views.integrations(el); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('#int-mo-apps-save', el)?.addEventListener('click', async () => {
    const btn = $('#int-mo-apps-save', el); btn.disabled = true;
    try {
      await api('/integrations/mail-oauth/apps', { method: 'PUT', body: {
        microsoft: {
          clientId: $('#int-mo-ms-client', el)?.value.trim() || '',
          tenant: $('#int-mo-ms-tenant', el)?.value.trim() || '',
          clientSecret: $('#int-mo-ms-secret', el)?.value || '',
        },
        google: {
          clientId: $('#int-mo-g-client', el)?.value.trim() || '',
          clientSecret: $('#int-mo-g-secret', el)?.value || '',
        },
      } });
      toast(t('common.saved') || 'Saved', 'success'); Views.integrations(el);
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  });

  // Blocked senders + the bulk-mail switch. Its own sheet and its own endpoint,
  // so editing the list never persists a half-typed connection form.
  $('#int-imap-block', el)?.addEventListener('click', async () => {
    let cfg;
    try { cfg = await api('/integrations/inbound-mail/blocklist'); }
    catch (err) { toast(err.message, 'error'); return; }
    let list = Array.isArray(cfg.blocklist) ? cfg.blocklist.slice() : [];
    const skips = Array.isArray(cfg.recentSkips) ? cfg.recentSkips : [];
    // Mirrors the server's accepted shapes for instant feedback; the server
    // normalises again and stays authoritative.
    const norm = (raw) => {
      const s = String(raw || '').trim().toLowerCase().replace(/^\*@/, '@').replace(/^@/, '');
      if (!s || s.length > 200) return '';
      if (s.includes('@')) return /^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : '';
      return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : '';
    };
    const reasonLabel = (s) => (s.reason === 'bulk'
      ? t('int.inbound.reasonBulk') + (s.detail ? ' · ' + s.detail : '')
      : t('int.inbound.reasonBlocked'));
    openModal({
      title: t('int.inbound.blockTitle'),
      icon: 'block',
      wide: true,
      body: `
        <label style="display:flex;gap:8px;align-items:flex-start;margin:0 0 8px">
          <input type="checkbox" id="imapblk-bulk" ${cfg.blockBulk ? 'checked' : ''}>
          <span>${esc(t('int.inbound.blockBulk'))}<br><span class="ob-hint">${esc(t('int.inbound.blockBulkHint'))}</span></span>
        </label>
        <div class="form-field full" style="margin:0 0 14px 26px">
          <label>${esc(t('int.inbound.bulkAction'))}</label>
          <select id="imapblk-bulkaction">
            <option value="skip" ${cfg.bulkAction !== 'close' ? 'selected' : ''}>${esc(t('int.inbound.bulkSkip'))}</option>
            <option value="close" ${cfg.bulkAction === 'close' ? 'selected' : ''}>${esc(t('int.inbound.bulkClose'))}</option>
          </select>
          <span class="ob-hint">${esc(t('int.inbound.bulkActionHint'))}</span>
        </div>
        <div class="form-field full" style="margin:0">
          <label>${esc(t('int.inbound.block'))}</label>
          <div style="display:flex;gap:8px">
            <input id="imapblk-input" style="flex:1" autocomplete="off" placeholder="${esc(t('int.inbound.blockPh'))}">
            <button type="button" class="btn btn-outline" id="imapblk-add">${esc(t('int.inbound.blockAdd'))}</button>
          </div>
          <span class="ob-hint">${esc(t('int.inbound.blockHint'))}</span>
        </div>
        <div id="imapblk-list" style="margin-top:10px"></div>
        <h4 style="margin:20px 0 4px">${esc(t('int.inbound.skipped'))}</h4>
        <p class="cell-sub" style="margin:0 0 8px">${esc(t('int.inbound.skippedNote'))}</p>
        <div id="imapblk-skips"></div>`,
      foot: `<button type="button" class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
        <button type="button" class="btn btn-primary" id="imapblk-save">${esc(t('common.save'))}</button>`,
      onMount(overlay) {
        const listBox = $('#imapblk-list', overlay);
        const skipBox = $('#imapblk-skips', overlay);
        const input = $('#imapblk-input', overlay);
        const renderList = () => {
          listBox.innerHTML = list.length
            ? list.map((e, i) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border,#e8e6f0)">
                <span class="ms ms-sm" style="opacity:.6">${e.includes('@') ? 'alternate_email' : 'language'}</span>
                <span style="flex:1;word-break:break-all">${esc(e)}</span>
                <button type="button" class="btn btn-sm btn-outline" data-rm="${i}" aria-label="${esc(t('common.delete'))}">×</button>
              </div>`).join('')
            : `<p class="cell-sub" style="margin:6px 0">${esc(t('int.inbound.blockEmpty'))}</p>`;
        };
        const renderSkips = () => {
          skipBox.innerHTML = skips.length
            ? skips.map((s) => {
              const blocked = !!norm(s.from) && list.includes(norm(s.from));
              return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border,#e8e6f0)">
                <div style="flex:1;min-width:0">
                  <div style="word-break:break-all">${esc(s.from || '—')}</div>
                  <div class="cell-sub">${esc(s.subject || '')}</div>
                  <div class="cell-sub">${esc(reasonLabel(s))} · ${esc(new Date(s.at).toLocaleString())}</div>
                </div>
                ${s.messageId ? `<button type="button" class="btn btn-sm btn-outline" data-release="${esc(s.messageId)}">${esc(t('int.inbound.release'))}</button>` : ''}
                ${blocked || !norm(s.from) ? '' : `<button type="button" class="btn btn-sm btn-outline" data-block="${esc(norm(s.from))}">${esc(t('int.inbound.blockThis'))}</button>`}
              </div>`;
            }).join('')
            : `<p class="cell-sub" style="margin:6px 0">${esc(t('int.inbound.skippedEmpty'))}</p>`;
        };
        const add = (raw) => {
          const e = norm(raw);
          if (!e) { toast(t('int.inbound.blockInvalid'), 'error'); return false; }
          if (list.includes(e)) { toast(t('int.inbound.blockDup'), 'error'); return false; }
          list.push(e); renderList(); renderSkips(); return true;
        };
        renderList(); renderSkips();
        $('#imapblk-add', overlay).addEventListener('click', () => { if (add(input.value)) input.value = ''; });
        input.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter') return;
          ev.preventDefault();
          if (add(input.value)) input.value = '';
        });
        listBox.addEventListener('click', (ev) => {
          const btn = ev.target.closest('[data-rm]');
          if (!btn) return;
          list.splice(Number(btn.dataset.rm), 1);
          renderList(); renderSkips();
        });
        skipBox.addEventListener('click', async (ev) => {
          const block = ev.target.closest('[data-block]');
          if (block) { add(block.dataset.block); return; }
          const rel = ev.target.closest('[data-release]');
          if (!rel) return;
          rel.disabled = true;
          try {
            const r = await api('/integrations/inbound-mail/release', {
              method: 'POST', body: { messageId: rel.dataset.release },
            });
            const num = r && (r.number || (r.data && r.data.number));
            toast(num ? t('int.inbound.releaseDone') + ' ' + num : t('int.inbound.releaseDone'), 'success');
            // Drop the released entry from the list.
            const i = skips.findIndex((s) => s.messageId === rel.dataset.release);
            if (i >= 0) skips.splice(i, 1);
            renderSkips();
          } catch (err) { toast(err.message, 'error'); rel.disabled = false; }
        });
        $('#imapblk-save', overlay).addEventListener('click', async () => {
          const btn = $('#imapblk-save', overlay);
          btn.disabled = true;
          try {
            await api('/integrations/inbound-mail/blocklist', {
              method: 'PUT',
              body: {
                blocklist: list,
                blockBulk: !!$('#imapblk-bulk', overlay).checked,
                bulkAction: $('#imapblk-bulkaction', overlay)?.value || 'skip',
              },
            });
            toast(t('int.inbound.blockSaved'), 'success');
            closeModal();
          } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
        });
      },
    });
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
            authMethod: $('#int-smtp-authmethod', el)?.value || 'password',
            oauthTenant: $('#int-smtp-oauth-tenant', el)?.value.trim() || '',
            oauthClientId: $('#int-smtp-oauth-client', el)?.value.trim() || '',
            oauthClientSecret: $('#int-smtp-oauth-secret', el)?.value || '',
          },
          notify: {
            enabled: $('#int-notify-on', el).checked,
            to,
            handoverCompleted: $('#int-notify-ho', el).checked,
            ticketUpdates: $('#int-notify-tickets', el).checked,
            ticketAck: $('#int-notify-ack', el).checked,
            ackUnknownSenders: $('#int-notify-ack-unknown', el).checked,
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
            authMethod: $('#int-smtp-authmethod', el)?.value || 'password',
            oauthTenant: $('#int-smtp-oauth-tenant', el)?.value.trim() || '',
            oauthClientId: $('#int-smtp-oauth-client', el)?.value.trim() || '',
            oauthClientSecret: $('#int-smtp-oauth-secret', el)?.value || '',
          },
          notify: {
            enabled: $('#int-notify-on', el).checked,
            to: toList,
            handoverCompleted: $('#int-notify-ho', el).checked,
            ticketUpdates: $('#int-notify-tickets', el).checked,
            ticketAck: $('#int-notify-ack', el).checked,
            ackUnknownSenders: $('#int-notify-ack-unknown', el).checked,
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
      const wasOff = !AppConfig.ticketingEnabled;
      const saved = await api('/settings', { method: 'PUT', body: { ticketingEnabled: on } });
      if (typeof AppConfig === 'object' && AppConfig) AppConfig.ticketingEnabled = saved ? !!saved.ticketingEnabled : on;
      toast(t('int.ticketing.saved'), 'success');
      if (typeof renderNav === 'function') renderNav(); // show/hide the Service Desk item
      // Just switched the module on → walk the admin through what it offers.
      if (on && wasOff) {
        if (typeof resetServiceDeskOnboarding === 'function') resetServiceDeskOnboarding();
        if (typeof showServiceDeskOnboarding === 'function') setTimeout(() => showServiceDeskOnboarding(true), 300);
      }
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
      // Service-desk placeholders. Without these the ticket templates previewed
      // as raw {{braces}} — the one screen where they should read as mail.
      ticketNumber: 'INC-1042',
      subject: 'Printer on the third floor is offline',
      requesterName: 'Ada Lovelace',
      priority: 'high',
      event: 'status changed to “in progress”',
      actorName: 'Deniz · IT',
      snippet: 'Toner has been ordered.',
      replyText: 'The replacement toner is ordered and arrives tomorrow morning.',
      slaType: 'Resolution',
      dueAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      overdueBy: '1h 20m',
      assigneeName: 'Deniz · IT',
      ticketUrl: ((typeof location !== 'undefined' && location.origin) || 'http://localhost:8000')
        + '/#/tickets?open=4f6a1c2e-0000-4000-8000-000000000000',
      // Approvals
      summary: 'New laptop for Ada Lovelace',
      resourceRef: ' (REQ-2087)',
      decision: 'approved',
      deciderName: 'Approved by Mehmet Y. · Finance',
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
