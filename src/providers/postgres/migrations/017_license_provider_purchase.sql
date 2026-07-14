-- Link software licenses to the purchasing provider and optional contract,
-- plus invoice metadata and uploadable purchase proofs (invoice / contract scan).

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES providers(id) ON DELETE SET NULL;
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL;
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS purchase_type TEXT;
ALTER TABLE licenses DROP CONSTRAINT IF EXISTS licenses_purchase_type_check;
ALTER TABLE licenses
  ADD CONSTRAINT licenses_purchase_type_check
  CHECK (purchase_type IS NULL OR purchase_type IN ('contract', 'invoice'));
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS purchase_date DATE;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS purchase_amount NUMERIC(14, 2);
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS purchase_currency TEXT;

CREATE INDEX IF NOT EXISTS idx_licenses_provider ON licenses (provider_id)
  WHERE provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_licenses_contract ON licenses (contract_id)
  WHERE contract_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS license_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id       UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  provider_id      UUID REFERENCES providers(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL DEFAULT 'invoice'
                   CHECK (kind IN ('invoice', 'contract', 'other')),
  filename         TEXT NOT NULL,
  mime             TEXT,
  byte_size        INTEGER NOT NULL DEFAULT 0,
  content          BYTEA,
  storage_path     TEXT,
  uploaded_by      TEXT,
  uploaded_by_name TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_license_documents_license
  ON license_documents (license_id, created_at DESC);
