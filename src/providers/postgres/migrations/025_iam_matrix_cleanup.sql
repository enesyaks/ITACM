-- IAM cleanup: drop nonsensical permission_entries (approve, assign on
-- non-assignable resources, view_* outside employee, etc.) so the matrix
-- matches ACTIONS_BY_RESOURCE in src/utils/iamSchema.js.
-- Does not remove valid Owner/Admin entries for intentional actions.

BEGIN;

-- 1) Global: remove unused action
DELETE FROM permission_entries WHERE action = 'approve';

-- 2) view_history / view_inventory / view_handover only on employee
DELETE FROM permission_entries
WHERE action IN ('view_history', 'view_inventory', 'view_handover')
  AND resource <> 'employee';

-- 3) assign / unassign only where they mean something
DELETE FROM permission_entries
WHERE action IN ('assign', 'unassign')
  AND resource NOT IN ('asset', 'license', 'line');

-- 4) export / import scope
DELETE FROM permission_entries
WHERE action = 'export' AND resource NOT IN ('asset', 'report');

DELETE FROM permission_entries
WHERE action = 'import' AND resource <> 'asset';

-- 5) view_confidential only on cost-bearing modules
DELETE FROM permission_entries
WHERE action = 'view_confidential'
  AND resource NOT IN ('license', 'line', 'contract', 'maintenance');

-- 6) manage not offered for handover / document / catalog / onboarding /
--    report / dashboard / audit / settings / user_management / integration
--    (settings & integration keep manage — those are their primary verb)
DELETE FROM permission_entries
WHERE action = 'manage'
  AND resource IN (
    'handover', 'document', 'catalog', 'onboarding',
    'report', 'dashboard', 'audit', 'user_management'
  );

-- 7) settings: keep manage only
DELETE FROM permission_entries
WHERE resource = 'settings' AND action <> 'manage';

-- 8) dashboard / audit / report: keep read (+ report export)
DELETE FROM permission_entries
WHERE resource IN ('dashboard', 'audit') AND action <> 'read';

DELETE FROM permission_entries
WHERE resource = 'report' AND action NOT IN ('read', 'export');

-- 9) handover: read / create / update only
DELETE FROM permission_entries
WHERE resource = 'handover' AND action NOT IN ('read', 'create', 'update');

-- 10) document: read / create / delete only
DELETE FROM permission_entries
WHERE resource = 'document' AND action NOT IN ('read', 'create', 'delete');

-- 11) catalog: CRUD only
DELETE FROM permission_entries
WHERE resource = 'catalog' AND action NOT IN ('read', 'create', 'update', 'delete');

-- 12) onboarding: read / create / update
DELETE FROM permission_entries
WHERE resource = 'onboarding' AND action NOT IN ('read', 'create', 'update');

-- 13) provider: no view_confidential
DELETE FROM permission_entries
WHERE resource = 'provider' AND action = 'view_confidential';

-- Ensure Helpdesk still has employee view_* (operational detail)
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, 'employee', a.action, NULL, NULL
FROM permission_groups g
CROSS JOIN (VALUES ('view_history'), ('view_inventory'), ('view_handover')) AS a(action)
WHERE g.name = 'Helpdesk'
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries pe
    WHERE pe.group_id = g.id AND pe.resource = 'employee' AND pe.action = a.action
  );

-- Owner / Admin already have employee view_* from 024; re-assert
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, 'employee', a.action, NULL, NULL
FROM permission_groups g
CROSS JOIN (VALUES ('view_history'), ('view_inventory'), ('view_handover')) AS a(action)
WHERE g.name IN ('Owner', 'Admin')
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries pe
    WHERE pe.group_id = g.id AND pe.resource = 'employee' AND pe.action = a.action
  );

COMMIT;
