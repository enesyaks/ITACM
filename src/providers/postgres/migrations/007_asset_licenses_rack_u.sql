-- Multi-license links for appliances + numeric rack U placement.

CREATE TABLE IF NOT EXISTS asset_licenses (
  asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  PRIMARY KEY (asset_id, license_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_licenses_license ON asset_licenses (license_id);

-- Backfill from legacy single license_id
INSERT INTO asset_licenses (asset_id, license_id)
SELECT id, license_id FROM assets
 WHERE license_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Numeric rack coordinates (U1 at bottom of cabinet, industry standard)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS rack_u_start INTEGER
  CHECK (rack_u_start IS NULL OR (rack_u_start >= 1 AND rack_u_start <= 60));
ALTER TABLE assets ADD COLUMN IF NOT EXISTS rack_u_size INTEGER
  CHECK (rack_u_size IS NULL OR (rack_u_size >= 1 AND rack_u_size <= 20));

-- Best-effort parse of free-text rack_unit → start/size ("12" or "12-13")
UPDATE assets SET
  rack_u_start = CASE
    WHEN rack_unit ~ '^\s*(\d+)\s*[-–]\s*(\d+)\s*$' THEN
      LEAST(
        (regexp_match(rack_unit, '^\s*(\d+)\s*[-–]\s*(\d+)\s*$'))[1]::int,
        (regexp_match(rack_unit, '^\s*(\d+)\s*[-–]\s*(\d+)\s*$'))[2]::int
      )
    WHEN rack_unit ~ '^\s*\d+\s*$' THEN trim(rack_unit)::int
    ELSE NULL
  END,
  rack_u_size = CASE
    WHEN rack_unit ~ '^\s*(\d+)\s*[-–]\s*(\d+)\s*$' THEN
      ABS(
        (regexp_match(rack_unit, '^\s*(\d+)\s*[-–]\s*(\d+)\s*$'))[1]::int -
        (regexp_match(rack_unit, '^\s*(\d+)\s*[-–]\s*(\d+)\s*$'))[2]::int
      ) + 1
    WHEN rack_unit ~ '^\s*\d+\s*$' THEN 1
    ELSE NULL
  END
WHERE rack_u_start IS NULL
  AND rack_unit IS NOT NULL
  AND rack_unit ~ '^\s*\d+';
