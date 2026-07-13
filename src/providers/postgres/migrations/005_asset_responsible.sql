-- Site ownership for Network/Server gear (separate from personal zimmet assignment).
ALTER TABLE assets ADD COLUMN IF NOT EXISTS responsible_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS responsible_employee_name TEXT;
CREATE INDEX IF NOT EXISTS idx_assets_responsible ON assets (responsible_employee_id)
  WHERE responsible_employee_id IS NOT NULL;
