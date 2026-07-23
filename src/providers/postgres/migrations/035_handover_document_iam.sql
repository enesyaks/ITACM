-- Split employee zimmet / handover archive from general document:*.
-- New resource: handover_document (read / download / upload / delete).
-- Helpdesk gets zimmet-doc access by default (no general document:*).
-- Groups that already had document:* are backfilled so existing workflows keep working.

BEGIN;

-- Owner / Admin: full handover_document access
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, 'handover_document', a.action, NULL, NULL
FROM permission_groups g
CROSS JOIN (VALUES ('read'), ('download'), ('upload'), ('delete')) AS a(action)
WHERE g.name IN ('Owner', 'Admin')
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries pe
    WHERE pe.group_id = g.id AND pe.resource = 'handover_document' AND pe.action = a.action
  );

-- Helpdesk: operational zimmet archive (no delete — matches Helpdesk no-delete policy)
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, 'handover_document', a.action, NULL, NULL
FROM permission_groups g
CROSS JOIN (VALUES ('read'), ('download'), ('upload')) AS a(action)
WHERE g.name = 'Helpdesk'
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries pe
    WHERE pe.group_id = g.id AND pe.resource = 'handover_document' AND pe.action = a.action
  );

-- Backfill: any group that could use document:X also gets handover_document:X
-- (previously employee zimmet was gated by document:* + employee:view_handover).
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT pe.group_id, 'handover_document', pe.action, NULL, NULL
FROM permission_entries pe
WHERE pe.resource = 'document'
  AND pe.action IN ('read', 'download', 'upload', 'delete')
  AND pe.constraint_type IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries x
    WHERE x.group_id = pe.group_id
      AND x.resource = 'handover_document'
      AND x.action = pe.action
  );

COMMIT;
