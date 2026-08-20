-- Attachments for knowledge-base articles (images shown inline, PDFs as links).
-- Reuses the vetted upload pipeline (uploadGuard sniff + docStorage on disk).
CREATE TABLE IF NOT EXISTS kb_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id       UUID NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  filename         TEXT NOT NULL,
  mime             TEXT NOT NULL,
  byte_size        INTEGER NOT NULL,
  content          BYTEA,
  storage_path     TEXT,
  uploaded_by      TEXT,
  uploaded_by_name TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kb_documents ON kb_documents (article_id, created_at);
