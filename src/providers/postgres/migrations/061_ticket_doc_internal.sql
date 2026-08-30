-- Mark a ticket attachment as internal (staff-only), mirroring internal notes.
-- Portal self-service never sees or downloads internal attachments.
ALTER TABLE ticket_documents ADD COLUMN IF NOT EXISTS internal BOOLEAN NOT NULL DEFAULT false;
