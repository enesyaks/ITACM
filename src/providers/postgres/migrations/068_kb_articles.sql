-- ITIL Knowledge Management: a service-desk knowledge base. Staff author articles
-- (procedures, known-error fixes, how-tos); published ones are searchable by
-- employees in the portal for self-service deflection.
CREATE TABLE IF NOT EXISTS kb_articles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  body         TEXT,
  category     TEXT,
  published    BOOLEAN NOT NULL DEFAULT false,
  author_name  TEXT,
  views        INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kb_published ON kb_articles (published, updated_at DESC);
