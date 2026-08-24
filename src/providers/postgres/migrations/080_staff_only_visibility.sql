-- Third visibility level for ticket notes & attachments: staff_only.
-- public (both flags false) → internal (staff + approvers, requester hidden)
-- → staff_only (IT team only; even approvers don't see it).
ALTER TABLE ticket_comments  ADD COLUMN IF NOT EXISTS staff_only BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ticket_documents ADD COLUMN IF NOT EXISTS staff_only BOOLEAN NOT NULL DEFAULT false;
