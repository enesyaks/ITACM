-- Configurable prefix for auto-generated asset tags (e.g. IT-1001 → ACME-1001).
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS asset_tag_prefix TEXT;
UPDATE app_settings
   SET asset_tag_prefix = 'IT'
 WHERE id = 1 AND (asset_tag_prefix IS NULL OR btrim(asset_tag_prefix) = '');
