/**
 * Canonical IAM matrix — which actions make sense per resource.
 * Shared by permissionService (validation / manage expand) and matrix UI docs.
 *
 * Rules:
 * - Evaluate-time is exact-match (missing row = deny).
 * - `manage` is a grant-time shortcut: enabling it also inserts MANAGE_EXPAND actions.
 * - export / import / view_confidential / view_* never come from manage.
 * - Owner role still bypasses checks at runtime (test with a non-Owner user).
 */

'use strict';

const RESOURCES = Object.freeze([
  'asset', 'license', 'employee', 'contract', 'provider',
  'line', 'consumable', 'maintenance', 'stock_count', 'report',
  'audit', 'dashboard', 'settings', 'user_management',
  'integration', 'document', 'handover_document', 'catalog', 'handover', 'onboarding',
  'hr_request',
]);

/** Full union of actions (legacy rows + matrix). */
const ACTIONS = Object.freeze([
  'read', 'create', 'update', 'delete', 'assign', 'unassign',
  'export', 'import', 'manage', 'approve', 'view_confidential',
  'view_history', 'view_inventory', 'view_handover',
  'download', 'upload',
]);

/**
 * Only these actions are offered / accepted for each resource.
 * `approve` is intentionally omitted (unused).
 */
const ACTIONS_BY_RESOURCE = Object.freeze({
  asset: Object.freeze([
    'read', 'create', 'update', 'delete', 'assign', 'unassign', 'export', 'import', 'manage',
  ]),
  license: Object.freeze([
    'read', 'create', 'update', 'delete', 'assign', 'unassign', 'view_confidential', 'manage',
  ]),
  line: Object.freeze([
    'read', 'create', 'update', 'delete', 'assign', 'unassign', 'view_confidential', 'manage',
  ]),
  employee: Object.freeze([
    'read', 'create', 'update', 'delete',
    'view_inventory', 'view_history', 'view_handover', 'manage',
  ]),
  handover: Object.freeze(['read', 'create', 'update']),
  document: Object.freeze(['read', 'download', 'upload', 'delete']),
  // Employee zimmet / handover PDF archive (separate from general document:* for licenses, contracts, …)
  handover_document: Object.freeze(['read', 'download', 'upload', 'delete']),
  contract: Object.freeze([
    'read', 'create', 'update', 'delete', 'view_confidential', 'manage',
  ]),
  provider: Object.freeze([
    'read', 'create', 'update', 'delete', 'manage',
  ]),
  consumable: Object.freeze([
    'read', 'create', 'update', 'delete', 'manage',
  ]),
  maintenance: Object.freeze([
    'read', 'create', 'update', 'delete', 'view_confidential', 'manage',
  ]),
  stock_count: Object.freeze([
    'read', 'create', 'update', 'delete', 'manage',
  ]),
  catalog: Object.freeze([
    'read', 'create', 'update', 'delete',
  ]),
  onboarding: Object.freeze([
    'read', 'create', 'update',
  ]),
  hr_request: Object.freeze([
    'read', 'create', 'update',
  ]),
  report: Object.freeze(['read', 'export']),
  dashboard: Object.freeze(['read']),
  audit: Object.freeze(['read']),
  settings: Object.freeze(['manage']),
  user_management: Object.freeze([
    'read', 'create', 'update', 'delete',
  ]),
  integration: Object.freeze([
    'read', 'update', 'manage',
  ]),
});

/**
 * When `manage` is enabled (unconstrained), also insert these ops.
 * Explicit toggles remain for export/import/view_confidential/view_*.
 */
const MANAGE_EXPAND = Object.freeze({
  asset: Object.freeze(['read', 'update', 'delete', 'assign', 'unassign']),
  license: Object.freeze(['read', 'update', 'delete', 'assign', 'unassign']),
  line: Object.freeze(['read', 'update', 'delete', 'assign', 'unassign']),
  employee: Object.freeze(['read', 'update', 'delete']),
  contract: Object.freeze(['read', 'update', 'delete']),
  provider: Object.freeze(['read', 'update', 'delete']),
  consumable: Object.freeze(['read', 'update', 'delete']),
  maintenance: Object.freeze(['read', 'update', 'delete']),
  stock_count: Object.freeze(['read', 'update', 'delete']),
});

const OPS_COVERED_BY_MANAGE = Object.freeze([
  'read', 'create', 'update', 'delete', 'assign', 'unassign',
]);

function actionsForResource(resource) {
  return ACTIONS_BY_RESOURCE[resource] || [];
}

function isValidResourceAction(resource, action) {
  const allowed = ACTIONS_BY_RESOURCE[resource];
  if (!allowed) return false;
  return allowed.includes(action);
}

/** Plain JSON for GET /api/auth/iam-schema and FE matrix. */
function getIamSchema() {
  return {
    resources: [...RESOURCES],
    actions: [...ACTIONS],
    actionsByResource: Object.fromEntries(
      Object.entries(ACTIONS_BY_RESOURCE).map(([k, v]) => [k, [...v]])
    ),
    manageExpand: Object.fromEntries(
      Object.entries(MANAGE_EXPAND).map(([k, v]) => [k, [...v]])
    ),
    tips: {
      ownerBypass: 'Owner always has full access. Test matrix changes as a user assigned to that group.',
      manage: 'manage enables read/update/delete/(assign). Not create, export, import, costs, or employee view_*. Toggle create separately for Add buttons.',
      document: 'General files (providers, contracts, licenses, repair paperwork). read = listed (blurred if no download). download = open. upload / delete = mutate. Not employee zimmet scans.',
      handover_document: 'Employee zimmet / handover PDF archive only. Also needs employee:view_handover for the Documents tab. Independent from document:*.',
      report: 'report:read = Reports page. report:export = CSV/print. Each preset also needs that module read (e.g. maintenance:read).',
      integration: 'read = view blurred secrets. update = custom-field values on forms. manage = SMTP, webhooks, API keys, field defs.',
      consumable: 'read = stock list. create = new item. update = adjust stock. manage = read+update+delete (not create).',
      maintenance: 'read = logs & reports. create = send to repair. update = close/notes. view_confidential = costs.',
      handover: 'handover:create = make zimmet form. employee:view_handover + handover_document:* = Documents tab / scans.',
      assign: 'license:assign / line:assign / asset:assign|unassign control employee-card and list assign actions.',
    },
  };
}

module.exports = {
  RESOURCES,
  ACTIONS,
  ACTIONS_BY_RESOURCE,
  MANAGE_EXPAND,
  OPS_COVERED_BY_MANAGE,
  actionsForResource,
  isValidResourceAction,
  getIamSchema,
};
