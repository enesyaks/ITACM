-- Configurable SLA targets. Stored as { priority: { responseMins, resolveMins } };
-- missing keys fall back to the code defaults, so an empty object = defaults.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS sla_json JSONB NOT NULL DEFAULT '{}'::jsonb;
