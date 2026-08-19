-- ITIL Service Request Management: admin-editable request templates with an
-- org-resolved approval chain (e.g. ['manager','department']). A service-desk
-- request raised from a template routes through approvalService before the desk
-- fulfils it; tickets.approval_request_id links the two.
CREATE TABLE IF NOT EXISTS request_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT,
  approval_levels JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ordered org levels: ['manager','department']
  enabled         BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_templates_enabled ON request_templates (enabled, sort_order);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS approval_request_id UUID REFERENCES approval_requests(id) ON DELETE SET NULL;
