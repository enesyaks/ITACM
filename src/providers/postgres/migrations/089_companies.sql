-- Multi-company (holding) support.
--
-- Some customers run several legal entities under one roof: each has its own
-- staff, its own devices, its own letterhead. Until now ITACM had exactly one
-- identity — the single `app_settings` row — so every zimmet form and report
-- carried the same logo no matter whose device or whose employee it was.
--
-- `companies` becomes that identity, one row per entity, `parent_id` linking a
-- subsidiary to the group above it. `app_settings` stays as the group-level
-- default: any company column left NULL (terms, template, address) falls back
-- to it, so a single-company install behaves exactly as before.
--
-- Backfill: the existing app_settings branding becomes the first company and
-- every existing row is attached to it, so nothing is left company-less.

CREATE TABLE IF NOT EXISTS companies (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id            UUID REFERENCES companies(id) ON DELETE SET NULL,
  name                 TEXT NOT NULL,
  legal_name           TEXT,
  code                 TEXT,
  logo                 TEXT,
  address              TEXT,
  tax_office           TEXT,
  tax_no               TEXT,
  email                TEXT,
  phone                TEXT,
  -- NULL on any of these means "inherit the group default from app_settings".
  handover_terms       TEXT,
  handover_template_id TEXT,
  is_default           BOOLEAN NOT NULL DEFAULT FALSE,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  notes                TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Names and codes are unique case-insensitively so "Acme" and "ACME" cannot
-- both exist and confuse a zimmet form.
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name ON companies (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_code ON companies (lower(code)) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_parent ON companies (parent_id) WHERE parent_id IS NOT NULL;
-- At most one default company.
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_one_default ON companies ((is_default)) WHERE is_default;

-- Seed the first company from the existing branding. Logo and address are left
-- NULL on purpose: NULL means "inherit the group default", so a single-company
-- install keeps behaving exactly as before — change the logo on the Settings
-- screen and the zimmet form follows, with no company to edit at all.
INSERT INTO companies (name, is_default)
SELECT COALESCE(NULLIF(btrim(s.company_name), ''), 'IT Asset Control Pro'), TRUE
  FROM app_settings s
 WHERE s.id = 1
   AND NOT EXISTS (SELECT 1 FROM companies);

/* ------------------------- Owning company per record ------------------------ */

ALTER TABLE employees     ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE assets        ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE mobile_lines  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE licenses      ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE contracts     ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE consumables   ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE stock_counts  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_company    ON employees (company_id)    WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_company       ON assets (company_id)       WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lines_company        ON mobile_lines (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_licenses_company     ON licenses (company_id)     WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_company    ON contracts (company_id)    WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consumables_company  ON consumables (company_id)  WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_counts_company ON stock_counts (company_id) WHERE company_id IS NOT NULL;

-- Attach everything that exists today to the default company.
UPDATE employees    SET company_id = (SELECT id FROM companies WHERE is_default) WHERE company_id IS NULL;
UPDATE assets       SET company_id = (SELECT id FROM companies WHERE is_default) WHERE company_id IS NULL;
UPDATE mobile_lines SET company_id = (SELECT id FROM companies WHERE is_default) WHERE company_id IS NULL;
UPDATE licenses     SET company_id = (SELECT id FROM companies WHERE is_default) WHERE company_id IS NULL;
UPDATE contracts    SET company_id = (SELECT id FROM companies WHERE is_default) WHERE company_id IS NULL;
UPDATE consumables  SET company_id = (SELECT id FROM companies WHERE is_default) WHERE company_id IS NULL;
UPDATE stock_counts SET company_id = (SELECT id FROM companies WHERE is_default) WHERE company_id IS NULL;

/* ------------------------------ Zimmet receipts ----------------------------- */

-- The receipt is a legal document: it must reprint years later exactly as it was
-- issued, even after the employee moves or a device changes hands. So the header
-- company AND its branding are snapshotted onto the handover row, and each item
-- in `items` gets the owning company it was handed over from (written by
-- handoverService, see ownerCompanyName there).
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS company_id       UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS company_snapshot JSONB;
CREATE INDEX IF NOT EXISTS idx_handovers_company ON handovers (company_id) WHERE company_id IS NOT NULL;

UPDATE handovers SET company_id = (SELECT id FROM companies WHERE is_default) WHERE company_id IS NULL;

-- Cross-company handovers ("Firma A's laptop to a Firma B employee") produce one
-- document per owning company when the operator picks it.
ALTER TABLE handovers DROP CONSTRAINT IF EXISTS handovers_document_type_check;
ALTER TABLE handovers ADD CONSTRAINT handovers_document_type_check
  CHECK (document_type IN ('single', 'separate', 'per_company'));
