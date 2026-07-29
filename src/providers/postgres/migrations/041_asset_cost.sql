-- Straight-line depreciation needs a purchase cost ON THE ASSET.
--
-- v1.2.0 shipped the depreciation feature + migration 040 (salvage_value) but
-- assumed an assets.cost column that never existed (the NUMERIC cost column
-- lives on maintenance_logs, not assets). Without this column the dashboard
-- and asset create/update fail with "column a.cost does not exist". Idempotent.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS cost NUMERIC(12, 2) NOT NULL DEFAULT 0;
