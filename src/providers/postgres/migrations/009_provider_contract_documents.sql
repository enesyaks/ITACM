-- Documents for providers (NDAs, account forms) and contracts (signed PDFs, SLAs).

CREATE TABLE IF NOT EXISTS provider_documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id        UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  provider_name      TEXT,
  filename           TEXT NOT NULL,
  mime               TEXT NOT NULL,
  byte_size          INTEGER NOT NULL CHECK (byte_size >= 0),
  content            BYTEA,
  storage_path       TEXT,
  uploaded_by        TEXT,
  uploaded_by_name   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provider_docs_provider
  ON provider_documents (provider_id, created_at DESC);

CREATE TABLE IF NOT EXISTS contract_documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id        UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  provider_id        UUID NOT NULL,
  contract_title     TEXT,
  provider_name      TEXT,
  filename           TEXT NOT NULL,
  mime               TEXT NOT NULL,
  byte_size          INTEGER NOT NULL CHECK (byte_size >= 0),
  content            BYTEA,
  storage_path       TEXT,
  uploaded_by        TEXT,
  uploaded_by_name   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contract_docs_contract
  ON contract_documents (contract_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contract_docs_provider
  ON contract_documents (provider_id, created_at DESC);
