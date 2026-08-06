-- Secondary IMEI (dual-SIM phones/tablets). Nullable; unique when set.
-- Uniqueness is also enforced across imei + imei2 in application code.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS imei2 TEXT;

DO $$
DECLARE
  dup TEXT;
BEGIN
  SELECT lower(btrim(imei2)) INTO dup
    FROM assets
   WHERE imei2 IS NOT NULL AND btrim(imei2) <> ''
   GROUP BY 1
  HAVING COUNT(*) > 1
   LIMIT 1;
  IF dup IS NOT NULL THEN
    RAISE NOTICE
      'itacm: duplicate imei2 value(s) already exist (e.g. "%") — unique index skipped. Clean duplicates, then: CREATE UNIQUE INDEX idx_assets_imei2_unique ON assets (lower(btrim(imei2))) WHERE imei2 IS NOT NULL AND btrim(imei2) <> '''';',
      dup;
  ELSE
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_imei2_unique
        ON assets (lower(btrim(imei2)))
        WHERE imei2 IS NOT NULL AND btrim(imei2) <> ''
    $sql$;
  END IF;
END $$;

-- Refresh AI view (DROP required when inserting a column mid-list).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'ai') THEN
    EXECUTE 'DROP VIEW IF EXISTS ai.assets';
    EXECUTE $v$
      CREATE VIEW ai.assets AS
        SELECT id, asset_tag, serial_number, imei, imei2, brand, model, category, status,
               current_employee_id, current_employee_name, responsible_employee_name,
               location, mac_ethernet, mac_wifi, specs, notes, firmware_version,
               warranty_end_date, purchase_date, cost, salvage_value, lifecycle_months,
               infra_role, rack, mgmt_ip, created_at, updated_at
        FROM public.assets
    $v$;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'itacm_ai_ro') THEN
      EXECUTE 'GRANT SELECT ON ai.assets TO itacm_ai_ro';
    END IF;
  END IF;
END $$;
