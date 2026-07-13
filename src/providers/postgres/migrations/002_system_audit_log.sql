-- Unified system audit log (append-only). Also readable alongside legacy history tables.
CREATE TABLE IF NOT EXISTS system_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action       TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'system',
  summary      TEXT NOT NULL DEFAULT '',
  actor_id     UUID,
  actor_email  TEXT,
  actor_name   TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  entity_label TEXT,
  meta         JSONB,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_audit_created ON system_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_source ON system_audit_log (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_actor ON system_audit_log (actor_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_action ON system_audit_log (action, created_at DESC);
