-- Network/Server enrichment: role, rack, firmware, mgmt IP, parent device.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS infra_role TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS rack TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS rack_unit TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS firmware_version TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS firmware_updated_at TIMESTAMPTZ;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS mgmt_ip TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS parent_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assets_infra_role ON assets (infra_role) WHERE infra_role IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_parent ON assets (parent_asset_id) WHERE parent_asset_id IS NOT NULL;
