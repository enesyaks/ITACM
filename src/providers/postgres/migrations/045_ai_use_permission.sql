-- Add the ai:use permission to the built-in Owner and Admin groups.
-- The AI assistant used to be open to every non-Portal/HR user; it now needs the
-- ai:use permission (matrix-controllable). Owner and Admin get it by default;
-- Helpdesk / Viewer / custom groups must be granted it explicitly in the matrix.
-- (Role-fallback users are handled in code by checkRoleFallback.)

INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, 'ai', 'use', NULL, NULL
FROM (VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid),  -- Owner
  ('00000000-0000-0000-0000-000000000002'::uuid)   -- Admin
) AS g(id)
WHERE NOT EXISTS (
  SELECT 1 FROM permission_entries pe
  WHERE pe.group_id = g.id AND pe.resource = 'ai' AND pe.action = 'use'
);
