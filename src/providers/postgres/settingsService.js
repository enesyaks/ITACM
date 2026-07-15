/** App settings (postgres): company branding, handover terms, onboarding flag. */
const crypto = require('crypto');
const { query, withTransaction } = require('./pool');
const { HttpError } = require('../../utils/httpError');
const {
  DEFAULT_HANDOVER_TERMS, DEFAULT_LIFECYCLES, DEFAULT_LOCATIONS, DEFAULT_SPEC_OPTIONS,
  DEFAULT_HANDOVER_TEMPLATE, DEFAULT_HANDOVER_TEMPLATES, MAX_HANDOVER_TEMPLATES,
  DEFAULT_LABEL_CONFIG, DEFAULT_DEPARTMENTS, DEFAULT_PROVIDER_CATEGORIES,
  DEFAULT_CONTRACT_CATEGORIES, DEFAULT_CURRENCY, HANDOVER_DESIGN_IDS,
} = require('../../utils/defaults');

function normalizeCurrency(raw) {
  if (raw == null || raw === '') return null;
  const c = String(raw).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) {
    throw HttpError.badRequest('currency must be a 3-letter ISO code (e.g. TRY, USD, EUR)');
  }
  return c;
}

const LABEL_NUM_KEYS = { widthMm: [20, 150], heightMm: [10, 150], barcodeMm: [5, 40], copies: [1, 50] };
const LABEL_BOOL_KEYS = ['showLogo', 'showCompany', 'showModel', 'showCategory', 'showSerial'];

/** Sanitize the barcode-label config: clamp numeric sizes, coerce booleans. */
function sanitizeLabelConfig(cfg) {
  if (cfg == null) return null;
  if (typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw HttpError.badRequest('labelConfig must be an object');
  }
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(LABEL_NUM_KEYS)) {
    if (k in cfg) {
      const n = Math.round(Number(cfg[k]));
      if (!Number.isFinite(n)) throw HttpError.badRequest(`labelConfig.${k} must be a number`);
      out[k] = Math.min(hi, Math.max(lo, n));
    }
  }
  for (const k of LABEL_BOOL_KEYS) if (k in cfg) out[k] = !!cfg[k];
  return out;
}

const BOOL_KEYS = ['showLogo', 'showEmployeeId', 'showDepartment', 'showTitle',
  'colCategory', 'colSerial', 'colMac', 'colCondition', 'showTerms', 'showReturnSection'];
const TEXT_KEYS = {
  titleEn: 60, titleTr: 60, subtitle: 100,
  deliveredByLabel: 80, receivedByLabel: 80, footerNote: 200,
  name: 60, id: 64,
};

function newTemplateId() {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Sanitize one template object (fields + optional id/name/design). */
function sanitizeTemplate(tpl, { requireName = false } = {}) {
  if (tpl == null) return null;
  if (typeof tpl !== 'object' || Array.isArray(tpl)) {
    throw HttpError.badRequest('handoverTemplate must be an object');
  }
  const out = {};
  for (const k of BOOL_KEYS) if (k in tpl) out[k] = !!tpl[k];
  for (const [k, max] of Object.entries(TEXT_KEYS)) {
    if (k in tpl) {
      const v = tpl[k] == null ? '' : String(tpl[k]).trim();
      if (v.length > max) throw HttpError.badRequest(`${k} too long (max ${max} chars)`);
      out[k] = v;
    }
  }
  if ('design' in tpl) {
    const d = String(tpl.design || '').trim();
    if (!HANDOVER_DESIGN_IDS.includes(d)) {
      throw HttpError.badRequest(`design must be one of: ${HANDOVER_DESIGN_IDS.join(', ')}`);
    }
    out.design = d;
  }
  if (requireName && !out.name) throw HttpError.badRequest('Template name is required');
  return out;
}

/**
 * Normalize stored templates into a stable array.
 * Migrates legacy single `handover_template` when the array column is empty.
 */
function normalizeTemplates(templatesRaw, legacySingle) {
  let list = [];
  if (Array.isArray(templatesRaw) && templatesRaw.length) {
    list = templatesRaw.map((t, i) => {
      const merged = { ...DEFAULT_HANDOVER_TEMPLATE, ...(t || {}) };
      return {
        ...merged,
        id: String(merged.id || `legacy_${i}`).slice(0, 64),
        name: String(merged.name || `Template ${i + 1}`).slice(0, 60),
      };
    });
  } else if (legacySingle && typeof legacySingle === 'object' && !Array.isArray(legacySingle)) {
    list = [{
      ...DEFAULT_HANDOVER_TEMPLATE,
      ...legacySingle,
      id: legacySingle.id || 'default',
      name: legacySingle.name || 'Standard',
    }];
  } else {
    list = DEFAULT_HANDOVER_TEMPLATES.map((t) => ({ ...t }));
  }
  // Deduplicate ids
  const seen = new Set();
  list = list.map((t) => {
    let id = t.id;
    if (!id || seen.has(id)) id = newTemplateId();
    seen.add(id);
    return { ...t, id };
  });
  return list.slice(0, MAX_HANDOVER_TEMPLATES);
}

function resolveTemplate(templates, templateId) {
  const list = normalizeTemplates(templates, null);
  if (templateId) {
    const found = list.find((t) => t.id === templateId);
    if (found) return found;
  }
  return list[0];
}

function sanitizeTemplatesArray(arr) {
  if (arr == null) return null;
  if (!Array.isArray(arr)) throw HttpError.badRequest('handoverTemplates must be an array');
  if (arr.length === 0) throw HttpError.badRequest('At least one handover template is required');
  if (arr.length > MAX_HANDOVER_TEMPLATES) {
    throw HttpError.badRequest(`Maximum ${MAX_HANDOVER_TEMPLATES} templates allowed`);
  }
  const seen = new Set();
  const out = arr.map((raw, i) => {
    const cleaned = sanitizeTemplate(raw, { requireName: true });
    let id = cleaned.id || newTemplateId();
    if (seen.has(id)) id = newTemplateId();
    seen.add(id);
    const merged = {
      ...DEFAULT_HANDOVER_TEMPLATE,
      ...cleaned,
      id,
      name: cleaned.name || `Template ${i + 1}`,
    };
    return merged;
  });
  return out;
}

let setupTokenLogged = false;

function logSetupKey(token, source) {
  if (setupTokenLogged || !token) return;
  setupTokenLogged = true;
  console.log('='.repeat(64));
  console.log('[itacm] Setup key (one-time, required to finish onboarding):');
  console.log(`[itacm]   ${token}`);
  if (source === 'env') {
    console.log('[itacm] Source: SETUP_TOKEN environment variable');
  } else if (source === 'existing') {
    console.log('[itacm] (reprinted — key was created earlier; paste into remote browsers)');
  }
  console.log('[itacm] Open the app from this host, or paste the key into the setup form.');
  console.log('[itacm] Or set SETUP_TOKEN in the environment before first boot.');
  console.log('='.repeat(64));
}

async function ensureSetupToken() {
  const { rows } = await query('SELECT setup_token, onboarded FROM app_settings WHERE id = 1');
  if (!rows[0] || rows[0].onboarded) return null;

  const envTok = String(process.env.SETUP_TOKEN || '').trim();
  if (envTok && /^[A-Za-z0-9_-]{16,128}$/.test(envTok)) {
    if (rows[0].setup_token !== envTok) {
      await query('UPDATE app_settings SET setup_token = $1 WHERE id = 1 AND onboarded = FALSE', [envTok]);
    }
    logSetupKey(envTok, 'env');
    return envTok;
  }

  if (rows[0].setup_token) {
    logSetupKey(rows[0].setup_token, 'existing');
    return rows[0].setup_token;
  }
  const token = crypto.randomBytes(24).toString('hex');
  await query('UPDATE app_settings SET setup_token = $1 WHERE id = 1', [token]);
  logSetupKey(token, 'new');
  return token;
}

/**
 * Atomic first-run setup: verify one-time token, flip onboarded under row lock.
 * `adminFn(client)` must upsert the Owner account inside the same transaction.
 */
async function completeSetup(setupToken, fields, adminFn) {
  if (!setupToken || typeof setupToken !== 'string') {
    throw HttpError.badRequest('setupToken is required');
  }
  const {
    companyName, companyLogo, language, handoverTemplates, defaultTemplateId,
  } = fields || {};
  if (!companyName) throw HttpError.badRequest('companyName is required');

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT onboarded, setup_token FROM app_settings WHERE id = 1 FOR UPDATE'
    );
    const row = rows[0];
    if (!row) throw new HttpError(500, 'App settings row missing');
    if (row.onboarded) {
      throw HttpError.forbidden('This instance is already set up. Sign in as Admin to change settings.');
    }
    if (!row.setup_token || row.setup_token !== setupToken) {
      throw HttpError.forbidden('Invalid or expired setup token — refresh the page and try again.');
    }

    const admin = await adminFn(client);

    validateLogo(companyLogo);
    let templatesToSave = null;
    if (handoverTemplates !== undefined) {
      templatesToSave = sanitizeTemplatesArray(handoverTemplates);
    }
    if (templatesToSave && defaultTemplateId) {
      const idx = templatesToSave.findIndex((t) => t.id === String(defaultTemplateId));
      if (idx > 0) {
        const [tpl] = templatesToSave.splice(idx, 1);
        templatesToSave.unshift(tpl);
      } else if (idx < 0 && handoverTemplates !== undefined) {
        throw HttpError.badRequest('defaultTemplateId does not match any template in handoverTemplates');
      }
    }
    const defaultMirror = templatesToSave ? templatesToSave[0] : null;

    await client.query(
      `UPDATE app_settings SET
         company_name = $1,
         company_logo = COALESCE($2, company_logo),
         onboarded = TRUE,
         setup_token = NULL,
         language = COALESCE($3, language),
         handover_templates = COALESCE($4::jsonb, handover_templates),
         handover_template = COALESCE($5::jsonb, handover_template)
       WHERE id = 1`,
      [
        companyName,
        companyLogo ?? null,
        language ?? null,
        templatesToSave ? JSON.stringify(templatesToSave) : null,
        defaultMirror ? JSON.stringify(defaultMirror) : null,
      ]
    );

    const settings = await getSettings();
    return { settings, admin };
  });
}

async function getSettings() {
  const { rows } = await query(
    `SELECT company_name, company_logo, company_address, onboarded, handover_terms, lifecycles,
            locations, default_location, spec_options, document_storage, handover_template,
            handover_templates, departments, language, currency, label_config,
            provider_categories, contract_categories
     FROM app_settings WHERE id = 1`
  );
  const s = rows[0] || {};
  const handoverTemplates = normalizeTemplates(s.handover_templates, s.handover_template);
  const handoverTemplate = { ...DEFAULT_HANDOVER_TEMPLATE, ...handoverTemplates[0] };
  let currency = DEFAULT_CURRENCY;
  try {
    currency = normalizeCurrency(s.currency) || DEFAULT_CURRENCY;
  } catch {
    currency = DEFAULT_CURRENCY;
  }
  return {
    companyName: s.company_name || 'IT Asset Control Pro',
    companyLogo: s.company_logo || null,
    companyAddress: s.company_address || '',
    onboarded: !!s.onboarded,
    handoverTerms: s.handover_terms || DEFAULT_HANDOVER_TERMS,
    lifecycles: { ...DEFAULT_LIFECYCLES, ...(s.lifecycles || {}) },
    locations: (s.locations && s.locations.length) ? s.locations : [...DEFAULT_LOCATIONS],
    defaultLocation: s.default_location || null,
    departments: (s.departments && s.departments.length) ? s.departments : [...DEFAULT_DEPARTMENTS],
    providerCategories: (s.provider_categories && s.provider_categories.length)
      ? s.provider_categories : [...DEFAULT_PROVIDER_CATEGORIES],
    contractCategories: (s.contract_categories && s.contract_categories.length)
      ? s.contract_categories : [...DEFAULT_CONTRACT_CATEGORIES],
    specOptions: { ...DEFAULT_SPEC_OPTIONS, ...(s.spec_options || {}) },
    documentStorage: s.document_storage || { provider: 'local' },
    language: s.language || 'en',
    currency,
    labelConfig: { ...DEFAULT_LABEL_CONFIG, ...(s.label_config || {}) },
    handoverTemplates,
    // First template = default (used by older callers that only read handoverTemplate).
    handoverTemplate,
  };
}

function validateLogo(logo) {
  if (logo == null) return;
  if (typeof logo !== 'string' || !logo.startsWith('data:image/')) {
    throw HttpError.badRequest('companyLogo must be a data:image/... URL');
  }
  if (logo.length > 400_000) throw HttpError.badRequest('Logo too large — keep it under ~300KB');
}

function validateLifecycles(lc) {
  if (lc == null) return;
  if (typeof lc !== 'object') throw HttpError.badRequest('lifecycles must be an object of category -> months');
  for (const [cat, months] of Object.entries(lc)) {
    const m = Number(months);
    if (!Number.isInteger(m) || m < 0 || m > 240) {
      throw HttpError.badRequest(`Lifecycle for ${cat} must be 0-240 months (0 = EOL tracking off)`);
    }
  }
}

function validateSpecOptions(so) {
  if (so == null) return;
  if (typeof so !== 'object') throw HttpError.badRequest('specOptions must be an object');
  for (const key of Object.keys(so)) {
    if (!['cpu', 'ram', 'storage'].includes(key)) throw HttpError.badRequest(`Unknown spec list "${key}"`);
    if (!Array.isArray(so[key]) || so[key].some((v) => typeof v !== 'string' || !v.trim() || v.length > 60)) {
      throw HttpError.badRequest(`Spec list "${key}" must be an array of short strings`);
    }
  }
}

async function saveSettings({
  companyName, companyLogo, companyAddress, onboarded, handoverTerms, lifecycles,
  locations, defaultLocation, specOptions, documentStorage, handoverTemplate,
  handoverTemplates, defaultTemplateId, departments, language, currency, labelConfig,
  providerCategories, contractCategories,
}) {
  if (language !== undefined && language !== null && !/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(String(language))) {
    throw HttpError.badRequest('language must be a short code like "en" or "tr"');
  }
  const currencyClean = currency !== undefined ? normalizeCurrency(currency) : undefined;
  if (companyName !== undefined && (!companyName || companyName.length > 80)) {
    throw HttpError.badRequest('companyName is required (max 80 chars)');
  }
  if (companyAddress !== undefined && companyAddress !== null && String(companyAddress).length > 200) {
    throw HttpError.badRequest('companyAddress too long (max 200 chars)');
  }
  if (handoverTerms !== undefined && handoverTerms !== null && handoverTerms.length > 8000) {
    throw HttpError.badRequest('handoverTerms too long (max 8000 chars)');
  }
  validateLogo(companyLogo);
  validateLifecycles(lifecycles);
  validateSpecOptions(specOptions);
  const labelConfigClean = sanitizeLabelConfig(labelConfig);

  let templatesToSave = null;
  let defaultMirror = null;

  if (handoverTemplates !== undefined) {
    templatesToSave = sanitizeTemplatesArray(handoverTemplates);
  } else if (handoverTemplate !== undefined) {
    // Legacy single-template save: merge into the existing list's first entry (or create one).
    const current = await getSettings();
    const list = current.handoverTemplates.map((t) => ({ ...t }));
    const cleaned = sanitizeTemplate(handoverTemplate);
    const first = { ...list[0], ...cleaned, id: list[0].id, name: list[0].name || 'Standard' };
    list[0] = first;
    templatesToSave = list;
  } else if (defaultTemplateId) {
    // Promote an existing template to default without rewriting the whole list.
    const current = await getSettings();
    const list = current.handoverTemplates.map((t) => ({ ...t }));
    const idx = list.findIndex((t) => t.id === String(defaultTemplateId));
    if (idx < 0) throw HttpError.badRequest('defaultTemplateId does not match any template');
    if (idx > 0) {
      const [row] = list.splice(idx, 1);
      list.unshift(row);
    }
    templatesToSave = list;
  }

  if (templatesToSave && defaultTemplateId) {
    const idx = templatesToSave.findIndex((t) => t.id === String(defaultTemplateId));
    if (idx > 0) {
      const [row] = templatesToSave.splice(idx, 1);
      templatesToSave.unshift(row);
    } else if (idx < 0 && handoverTemplates !== undefined) {
      throw HttpError.badRequest('defaultTemplateId does not match any template in handoverTemplates');
    }
  }

  if (templatesToSave) defaultMirror = templatesToSave[0];

  await query(
    `UPDATE app_settings SET
       company_name   = COALESCE($1, company_name),
       company_logo   = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE company_logo END,
       onboarded      = COALESCE($3, onboarded),
       handover_terms = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE handover_terms END,
       lifecycles     = CASE WHEN $5::jsonb IS NOT NULL THEN $5 ELSE lifecycles END,
       locations      = CASE WHEN $6::jsonb IS NOT NULL THEN $6 ELSE locations END,
       default_location = CASE WHEN $7::text IS NOT NULL THEN NULLIF($7, '__none__') ELSE default_location END,
       spec_options   = CASE WHEN $8::jsonb IS NOT NULL THEN $8 ELSE spec_options END,
       document_storage = CASE WHEN $9::jsonb IS NOT NULL THEN $9 ELSE document_storage END,
       handover_template = CASE WHEN $10::jsonb IS NOT NULL THEN $10 ELSE handover_template END,
       departments    = CASE WHEN $11::jsonb IS NOT NULL THEN $11 ELSE departments END,
       language       = CASE WHEN $12::text IS NOT NULL THEN $12 ELSE language END,
       company_address = CASE WHEN $13::text IS NOT NULL THEN $13 ELSE company_address END,
       handover_templates = CASE WHEN $14::jsonb IS NOT NULL THEN $14 ELSE handover_templates END,
       label_config   = CASE WHEN $15::jsonb IS NOT NULL THEN $15 ELSE label_config END,
       provider_categories = CASE WHEN $16::jsonb IS NOT NULL THEN $16 ELSE provider_categories END,
       contract_categories = CASE WHEN $17::jsonb IS NOT NULL THEN $17 ELSE contract_categories END,
       currency = CASE WHEN $18::text IS NOT NULL THEN $18 ELSE currency END
     WHERE id = 1`,
    [companyName ?? null, companyLogo ?? null, onboarded ?? null, handoverTerms ?? null,
     lifecycles ? JSON.stringify(lifecycles) : null,
     locations ? JSON.stringify(locations.map((l) => String(l).trim()).filter(Boolean)) : null,
     defaultLocation === null ? '__none__' : (defaultLocation ?? null),
     specOptions ? JSON.stringify(specOptions) : null,
     documentStorage ? JSON.stringify(documentStorage) : null,
     defaultMirror ? JSON.stringify(defaultMirror) : null,
     departments ? JSON.stringify(departments.map((d) => String(d).trim()).filter(Boolean)) : null,
     language ?? null,
     companyAddress !== undefined ? String(companyAddress || '') : null,
     templatesToSave ? JSON.stringify(templatesToSave) : null,
     labelConfigClean ? JSON.stringify(labelConfigClean) : null,
     providerCategories
       ? JSON.stringify(providerCategories.map((d) => String(d).trim()).filter(Boolean))
       : null,
     contractCategories
       ? JSON.stringify(contractCategories.map((d) => String(d).trim()).filter(Boolean))
       : null,
     currencyClean ?? null]
  );
  return getSettings();
}

module.exports = {
  getSettings,
  saveSettings,
  resolveTemplate,
  normalizeTemplates,
  newTemplateId,
  ensureSetupToken,
  completeSetup,
};
