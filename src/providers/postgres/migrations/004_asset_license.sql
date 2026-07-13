-- Optional software license linked to an asset (network/server appliances, etc.).
ALTER TABLE assets ADD COLUMN IF NOT EXISTS license_id UUID REFERENCES licenses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_assets_license ON assets (license_id) WHERE license_id IS NOT NULL;
