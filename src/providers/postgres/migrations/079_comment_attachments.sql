-- Link a ticket attachment to the worklog comment it was posted with, so the
-- file can render beneath that comment. NULL = a standalone ticket attachment.
ALTER TABLE ticket_documents ADD COLUMN IF NOT EXISTS comment_id UUID REFERENCES ticket_comments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ticket_documents_comment ON ticket_documents (comment_id);
