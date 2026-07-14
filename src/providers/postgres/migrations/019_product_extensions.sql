-- Product roadmap: notifications, custom fields, API keys, webhooks, handover ack, SAM installs

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS smtp_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS notify_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS webhooks_json JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS custom_field_defs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity        TEXT NOT NULL CHECK (entity IN ('asset', 'employee', 'contract')),
  field_key     TEXT NOT NULL,
  label         TEXT NOT NULL,
  field_type    TEXT NOT NULL DEFAULT 'text'
                  CHECK (field_type IN ('text', 'number', 'date', 'select')),
  options_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  required      BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity, field_key)
);
CREATE INDEX IF NOT EXISTS idx_custom_field_defs_entity ON custom_field_defs (entity, sort_order);

CREATE TABLE IF NOT EXISTS custom_field_values (
  entity        TEXT NOT NULL CHECK (entity IN ('asset', 'employee', 'contract')),
  entity_id     UUID NOT NULL,
  field_key     TEXT NOT NULL,
  value_text    TEXT,
  PRIMARY KEY (entity, entity_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_entity ON custom_field_values (entity, entity_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  key_prefix    TEXT NOT NULL,
  key_hash      TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'Helpdesk'
                  CHECK (role IN ('Owner', 'Admin', 'Helpdesk', 'Viewer')),
  scopes        TEXT[] NOT NULL DEFAULT ARRAY['*']::text[],
  created_by    TEXT,
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys (key_prefix) WHERE revoked_at IS NULL;

ALTER TABLE handovers ADD COLUMN IF NOT EXISTS ack_token TEXT;
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS ack_at TIMESTAMPTZ;
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS ack_name TEXT;
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS ack_ip TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_handovers_ack_token
  ON handovers (ack_token) WHERE ack_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS software_installs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname        TEXT,
  asset_tag       TEXT,
  asset_id        UUID REFERENCES assets(id) ON DELETE SET NULL,
  software_name   TEXT NOT NULL,
  version         TEXT,
  source          TEXT NOT NULL DEFAULT 'sync',
  dedupe_key      TEXT NOT NULL,
  seen_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_software_installs_dedupe ON software_installs (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_software_installs_name ON software_installs (lower(software_name));
CREATE INDEX IF NOT EXISTS idx_software_installs_asset ON software_installs (asset_id);
