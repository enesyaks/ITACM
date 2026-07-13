-- Company IT providers (vendors / ISPs / MSPs) and their contracts.

CREATE TABLE IF NOT EXISTS providers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  category              TEXT NOT NULL DEFAULT 'Other'
                        CHECK (category IN (
                          'ISP', 'Telco', 'Cloud', 'Hardware', 'Software',
                          'MSP', 'Support', 'Security', 'Other'
                        )),
  status                TEXT NOT NULL DEFAULT 'Active'
                        CHECK (status IN ('Active', 'Inactive')),
  website               TEXT,
  phone                 TEXT,
  email                 TEXT,
  support_email         TEXT,
  support_phone         TEXT,
  support_portal        TEXT,
  account_number        TEXT,
  tax_id                TEXT,
  contact_name          TEXT,
  contact_role          TEXT,
  contact_email         TEXT,
  contact_phone         TEXT,
  notes                 TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_providers_status ON providers (status, name);
CREATE INDEX IF NOT EXISTS idx_providers_category ON providers (category, name);

CREATE TABLE IF NOT EXISTS contracts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id           UUID NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  title                 TEXT NOT NULL,
  contract_number       TEXT,
  category              TEXT NOT NULL DEFAULT 'Other'
                        CHECK (category IN (
                          'Connectivity', 'Support', 'License', 'Hardware',
                          'SaaS', 'MSP', 'Security', 'Other'
                        )),
  status                TEXT NOT NULL DEFAULT 'Active'
                        CHECK (status IN ('Draft', 'Active', 'Expired', 'Cancelled', 'Renewed')),
  start_date            DATE,
  end_date              DATE,
  renewal_date          DATE,
  notice_days           INTEGER CHECK (notice_days IS NULL OR notice_days >= 0),
  auto_renew            BOOLEAN NOT NULL DEFAULT false,
  cost_amount           NUMERIC(14, 2),
  cost_currency         TEXT NOT NULL DEFAULT 'TRY',
  billing_cycle         TEXT NOT NULL DEFAULT 'Annual'
                        CHECK (billing_cycle IN ('Monthly', 'Quarterly', 'Annual', 'One-time', 'Other')),
  owner_employee_id     UUID REFERENCES employees(id) ON DELETE SET NULL,
  owner_employee_name   TEXT,
  notes                 TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contracts_provider ON contracts (provider_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts (status, end_date);
CREATE INDEX IF NOT EXISTS idx_contracts_end ON contracts (end_date);
