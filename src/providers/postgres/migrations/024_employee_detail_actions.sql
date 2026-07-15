-- Employee detail granularity: view_history, view_inventory, view_handover
-- Grant to Owner + Admin for all resources (idempotent), and Helpdesk on employee.

INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, r.resource, a.action, NULL, NULL
FROM permission_groups g
CROSS JOIN (
  VALUES ('asset'), ('license'), ('employee'), ('contract'), ('provider'),
         ('line'), ('consumable'), ('maintenance'), ('stock_count'), ('report'),
         ('audit'), ('dashboard'), ('settings'), ('user_management'),
         ('integration'), ('document'), ('catalog'), ('handover'), ('onboarding')
) AS r(resource)
CROSS JOIN (
  VALUES ('view_history'), ('view_inventory'), ('view_handover')
) AS a(action)
WHERE g.name IN ('Owner', 'Admin')
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries pe
    WHERE pe.group_id = g.id AND pe.resource = r.resource AND pe.action = a.action
  );

-- Helpdesk: employee detail tabs (operational)
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, 'employee', a.action, NULL, NULL
FROM permission_groups g
CROSS JOIN (
  VALUES ('view_history'), ('view_inventory'), ('view_handover')
) AS a(action)
WHERE g.name = 'Helpdesk'
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries pe
    WHERE pe.group_id = g.id AND pe.resource = 'employee' AND pe.action = a.action
  );
