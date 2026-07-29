-- Straight-line depreciation: per-asset salvage (residual) value.
--
-- The purchase cost (assets.cost) and lifecycle already exist; this adds the
-- optional floor the book value depreciates toward. NULL/0 means the asset
-- depreciates all the way to zero over its lifecycle. Idempotent.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS salvage_value NUMERIC(12, 2);
