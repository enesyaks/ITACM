-- Per-contract sensitivity: Public (all IT users) vs Confidential (Owner/Admin only).
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'Public';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contracts_visibility_check'
  ) THEN
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_visibility_check
      CHECK (visibility IN ('Public', 'Confidential'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contracts_visibility ON contracts (visibility);
