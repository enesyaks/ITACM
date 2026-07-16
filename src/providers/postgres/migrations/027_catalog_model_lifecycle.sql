-- 027: Per-model lifecycle (months) on the product catalog.
-- Lets the same category (e.g. Laptop) carry different EOL windows per
-- brand/model — Apple MacBooks at 60 months while other laptops keep the
-- Laptop category default. NULL falls through to the category default.
-- Resolution order for an asset's EOL months:
--   asset.lifecycle_months
--   -> catalog_models.lifecycle_months
--   -> app_settings.lifecycles[category]
--   -> application default (DEFAULT_LIFECYCLES)
ALTER TABLE catalog_models ADD COLUMN IF NOT EXISTS lifecycle_months INTEGER;
