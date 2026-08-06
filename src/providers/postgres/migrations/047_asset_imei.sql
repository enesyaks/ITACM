-- Primary IMEI for phones/tablets (first IMEI on dual-SIM devices).
-- Nullable; unique when set (case-insensitive, trimmed), mirroring serial_number.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS imei TEXT;

DO $$
DECLARE
  dup TEXT;
BEGIN
  SELECT lower(btrim(imei)) INTO dup
    FROM assets
   WHERE imei IS NOT NULL AND btrim(imei) <> ''
   GROUP BY 1
  HAVING COUNT(*) > 1
   LIMIT 1;
  IF dup IS NOT NULL THEN
    RAISE NOTICE
      'itacm: duplicate imei value(s) already exist (e.g. "%") — unique index skipped. Clean duplicates, then: CREATE UNIQUE INDEX idx_assets_imei_unique ON assets (lower(btrim(imei))) WHERE imei IS NOT NULL AND btrim(imei) <> '''';',
      dup;
  ELSE
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_imei_unique
        ON assets (lower(btrim(imei)))
        WHERE imei IS NOT NULL AND btrim(imei) <> ''
    $sql$;
  END IF;
END $$;

-- Refresh AI read surface when the schema already exists from an earlier migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'ai') THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW ai.assets AS
        SELECT id, asset_tag, serial_number, imei, brand, model, category, status,
               current_employee_id, current_employee_name, responsible_employee_name,
               location, mac_ethernet, mac_wifi, specs, notes, firmware_version,
               warranty_end_date, purchase_date, cost, salvage_value, lifecycle_months,
               infra_role, rack, mgmt_ip, created_at, updated_at
        FROM public.assets
    $v$;
  END IF;
END $$;
