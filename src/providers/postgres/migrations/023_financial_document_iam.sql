-- Tighten Helpdesk defaults: no document upload / no built-in financial view.
-- Financial fields now require view_confidential; invoices/PDFs require document:*.
-- Owner/Admin keep all entries from 022. Custom groups are unchanged.

DELETE FROM permission_entries pe
USING permission_groups g
WHERE pe.group_id = g.id
  AND g.name = 'Helpdesk'
  AND pe.resource = 'document';

-- Ensure Helpdesk cannot see costs via view_confidential (explicit, idempotent)
DELETE FROM permission_entries pe
USING permission_groups g
WHERE pe.group_id = g.id
  AND g.name = 'Helpdesk'
  AND pe.action = 'view_confidential';

-- Viewer: contracts/providers stay readable without costs/docs (no new rows needed)
;
