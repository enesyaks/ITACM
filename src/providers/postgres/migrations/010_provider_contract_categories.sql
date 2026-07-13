-- Catalog-managed provider/contract categories + allow free-text (drop fixed CHECKs).

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS provider_categories JSONB;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS contract_categories JSONB;

ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_category_check;
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_category_check;
