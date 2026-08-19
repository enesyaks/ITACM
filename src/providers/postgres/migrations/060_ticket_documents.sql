-- Ticket attachments. Mirrors maintenance_documents: bytes live on disk
-- (storage_path via docStorage); legacy `content` BYTEA kept for symmetry.
CREATE TABLE IF NOT EXISTS ticket_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  filename         TEXT NOT NULL,
  mime             TEXT NOT NULL,
  byte_size        INTEGER NOT NULL,
  content          BYTEA,
  storage_path     TEXT,
  uploaded_by      TEXT,
  uploaded_by_name TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_documents ON ticket_documents (ticket_id, created_at);
