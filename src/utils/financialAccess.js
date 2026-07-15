/**
 * Financial / confidential field gating via IAM `view_confidential`.
 * Documents (invoices, PDFs) use the separate `document` resource.
 */
'use strict';

const { HttpError } = require('./httpError');

const COST_FIELDS_BY_RESOURCE = {
  contract: ['costAmount'],
  line: ['monthlyCost'],
  license: ['purchaseAmount'],
  maintenance: ['cost'],
  asset: ['purchaseCost', 'cost'],
};

async function canViewCosts(user, resource) {
  if (!user) return false;
  const { permissionService } = require('../services');
  return permissionService.checkPermission(user, resource, 'view_confidential');
}

async function canAccessDocuments(user, action = 'read') {
  if (!user) return false;
  const { permissionService } = require('../services');
  return permissionService.checkPermission(user, 'document', action);
}

function redactRecord(record, fields, { hideDocumentCount = false } = {}) {
  if (!record || typeof record !== 'object') return record;
  const out = { ...record };
  for (const f of fields) {
    if (f in out) out[f] = null;
  }
  if (hideDocumentCount && 'documentCount' in out) out.documentCount = 0;
  out.financialRedacted = true;
  return out;
}

function redactList(items, fields, opts) {
  if (!Array.isArray(items)) return items;
  return items.map((x) => redactRecord(x, fields, opts));
}

async function redactCosts(user, resource, data) {
  const fields = COST_FIELDS_BY_RESOURCE[resource] || [];
  const allowed = await canViewCosts(user, resource);
  if (allowed) return data;
  if (Array.isArray(data)) return redactList(data, fields);
  if (data && Array.isArray(data.items)) {
    return { ...data, items: redactList(data.items, fields) };
  }
  return redactRecord(data, fields);
}

async function redactDocsMeta(user, data) {
  const allowed = await canAccessDocuments(user, 'read');
  if (allowed) return data;
  if (Array.isArray(data)) {
    return data.map((x) => (x && typeof x === 'object' ? { ...x, documentCount: 0 } : x));
  }
  if (data && typeof data === 'object' && 'documentCount' in data) {
    return { ...data, documentCount: 0 };
  }
  if (data && Array.isArray(data.items)) {
    return {
      ...data,
      items: data.items.map((x) => (x && typeof x === 'object' ? { ...x, documentCount: 0 } : x)),
    };
  }
  return data;
}

/**
 * Strip cost fields from body for create/update when user lacks view_confidential.
 * If they explicitly send a cost field without permission → 403.
 */
async function gateCostWrite(user, resource, body) {
  if (!body || typeof body !== 'object') return body;
  const fields = COST_FIELDS_BY_RESOURCE[resource] || [];
  const touched = fields.filter((f) => Object.prototype.hasOwnProperty.call(body, f)
    && body[f] !== undefined && body[f] !== '');
  if (!touched.length) return body;
  const allowed = await canViewCosts(user, resource);
  if (!allowed) {
    throw HttpError.forbidden(
      `Access denied: ${resource}:view_confidential required to set ${touched.join(', ')}`
    );
  }
  return body;
}

module.exports = {
  COST_FIELDS_BY_RESOURCE,
  canViewCosts,
  canAccessDocuments,
  redactCosts,
  redactDocsMeta,
  gateCostWrite,
};
