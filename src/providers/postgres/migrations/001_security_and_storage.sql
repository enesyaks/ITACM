-- One-time onboarding token (public only while onboarded = false).
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS setup_token TEXT;

-- Document files on disk; legacy rows keep BYTEA in content.
ALTER TABLE handover_documents ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE handover_documents ALTER COLUMN content DROP NOT NULL;

ALTER TABLE maintenance_documents ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE maintenance_documents ALTER COLUMN content DROP NOT NULL;

-- Search performance (pg_trgm for ILIKE filters).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_assets_employee ON assets (current_employee_id) WHERE current_employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_location ON assets (location) WHERE location IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_tag_trgm ON assets USING gin (asset_tag gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_assets_serial_trgm ON assets USING gin (serial_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_employees_name_trgm ON employees USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_employees_email_trgm ON employees USING gin (email gin_trgm_ops);

-- Backfill setup_token for existing instances that haven't onboarded yet.
UPDATE app_settings SET setup_token = encode(gen_random_bytes(24), 'hex')
WHERE id = 1 AND setup_token IS NULL AND onboarded = FALSE;
