-- document:download + document:upload (replaces vague create for uploads)
-- Backward compatible: copy existing read→download, create→upload.

BEGIN;

-- System groups: ensure Owner/Admin have the new actions on document
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, 'document', a.action, NULL, NULL
FROM permission_groups g
CROSS JOIN (VALUES ('download'), ('upload')) AS a(action)
WHERE g.name IN ('Owner', 'Admin')
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries pe
    WHERE pe.group_id = g.id AND pe.resource = 'document' AND pe.action = a.action
  );

-- Any group that could read documents can now explicitly download
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT pe.group_id, 'document', 'download', NULL, NULL
FROM permission_entries pe
WHERE pe.resource = 'document' AND pe.action = 'read' AND pe.constraint_type IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries x
    WHERE x.group_id = pe.group_id AND x.resource = 'document' AND x.action = 'download'
  );

-- Any group that could create/upload documents keeps ability under upload
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT pe.group_id, 'document', 'upload', NULL, NULL
FROM permission_entries pe
WHERE pe.resource = 'document' AND pe.action = 'create' AND pe.constraint_type IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries x
    WHERE x.group_id = pe.group_id AND x.resource = 'document' AND x.action = 'upload'
  );

-- Drop legacy document:create from matrix (upload is the verb now)
DELETE FROM permission_entries
WHERE resource = 'document' AND action = 'create';

COMMIT;
