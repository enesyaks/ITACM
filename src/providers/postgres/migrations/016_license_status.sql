-- License lifecycle: renew / cancel tracking.
-- Active licenses may still be expired by date; cancelled are hidden from alerts.

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE licenses DROP CONSTRAINT IF EXISTS licenses_status_check;
ALTER TABLE licenses
  ADD CONSTRAINT licenses_status_check CHECK (status IN ('active', 'cancelled'));

ALTER TABLE licenses ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS cancelled_note TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS renewed_at TIMESTAMPTZ;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS renewed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_licenses_status_exp
  ON licenses (status, expiration_date);
