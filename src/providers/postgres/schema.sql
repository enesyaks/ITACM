-- ITACM — IT Asset Control Pro: PostgreSQL schema (idempotent).
-- Applied automatically on server startup (see migrate.js).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('Admin', 'Helpdesk', 'Viewer')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name          TEXT NOT NULL,
  email              TEXT NOT NULL UNIQUE,
  department         TEXT,
  title              TEXT,
  status             TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  active_asset_count INTEGER NOT NULL DEFAULT 0,
  start_date         DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS start_date DATE;

CREATE TABLE IF NOT EXISTS assets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag             TEXT NOT NULL UNIQUE,
  serial_number         TEXT NOT NULL,
  brand                 TEXT NOT NULL,
  model                 TEXT NOT NULL,
  category              TEXT NOT NULL,
  mac_ethernet          TEXT,
  mac_wifi              TEXT,
  specs                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                TEXT NOT NULL DEFAULT 'In Stock'
                        CHECK (status IN ('In Stock', 'Assigned', 'In Repair', 'Scrap', 'Sold', 'Reserved')),
  current_employee_id   UUID REFERENCES employees(id),
  current_employee_name TEXT,
  warranty_end_date     TIMESTAMPTZ,
  qr_code_string        TEXT NOT NULL,
  notes                 TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_status   ON assets (status, asset_tag);
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets (category);

CREATE TABLE IF NOT EXISTS licenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  software_name   TEXT NOT NULL,
  vendor          TEXT,
  license_key     TEXT NOT NULL,
  total_seats     INTEGER NOT NULL CHECK (total_seats >= 1),
  used_seats      INTEGER NOT NULL DEFAULT 0 CHECK (used_seats >= 0),
  expiration_date TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (used_seats <= total_seats)
);
CREATE INDEX IF NOT EXISTS idx_licenses_expiration ON licenses (expiration_date);

-- License renew / cancel lifecycle (also in 016_license_status.sql)
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE licenses DROP CONSTRAINT IF EXISTS licenses_status_check;
ALTER TABLE licenses ADD CONSTRAINT licenses_status_check CHECK (status IN ('active', 'cancelled'));
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS cancelled_note TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS renewed_at TIMESTAMPTZ;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS renewed_by TEXT;
CREATE INDEX IF NOT EXISTS idx_licenses_status_exp ON licenses (status, expiration_date);

CREATE TABLE IF NOT EXISTS consumables (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name                 TEXT NOT NULL,
  total_stock               INTEGER NOT NULL DEFAULT 0 CHECK (total_stock >= 0),
  minimum_stock_alert_level INTEGER NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS handovers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id),
  employee_name    TEXT NOT NULL,
  it_user_id       TEXT NOT NULL,
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  document_type    TEXT NOT NULL DEFAULT 'single' CHECK (document_type IN ('single', 'separate')),
  items            JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_handovers_employee ON handovers (employee_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_handovers_date     ON handovers (transaction_date DESC);

CREATE TABLE IF NOT EXISTS maintenance_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          UUID NOT NULL REFERENCES assets(id),
  asset_tag         TEXT NOT NULL,
  service_company   TEXT NOT NULL,
  issue_description TEXT NOT NULL,
  cost              NUMERIC(12, 2) NOT NULL DEFAULT 0,
  sent_date         TIMESTAMPTZ NOT NULL DEFAULT now(),
  return_date       TIMESTAMPTZ,
  previous_status   TEXT,
  previous_employee JSONB,
  resolution_note   TEXT
);
CREATE INDEX IF NOT EXISTS idx_maintenance_asset ON maintenance_logs (asset_id, sent_date DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_open  ON maintenance_logs (sent_date DESC) WHERE return_date IS NULL;

CREATE TABLE IF NOT EXISTS asset_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    UUID NOT NULL REFERENCES assets(id),
  asset_tag   TEXT NOT NULL,
  employee_id UUID,
  action_type TEXT NOT NULL CHECK (action_type IN ('assigned', 'returned', 'sent_to_repair')),
  notes       TEXT NOT NULL DEFAULT '',
  changed_by  TEXT NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_history_asset ON asset_history (asset_id, "timestamp" DESC);

-- Denormalized names so the audit trail is readable without joins
ALTER TABLE asset_history ADD COLUMN IF NOT EXISTS employee_name   TEXT;
ALTER TABLE asset_history ADD COLUMN IF NOT EXISTS changed_by_name TEXT;

-- Login auditing
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS login_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs (user_id, "timestamp" DESC);

-- Software (license) assignment to employees — "yazılım zimmeti"
CREATE TABLE IF NOT EXISTS license_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id       UUID NOT NULL REFERENCES licenses(id),
  software_name    TEXT NOT NULL,
  employee_id      UUID NOT NULL REFERENCES employees(id),
  employee_name    TEXT NOT NULL,
  assigned_by      TEXT NOT NULL,
  assigned_by_name TEXT,
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  revoked_by       TEXT
);
CREATE INDEX IF NOT EXISTS idx_lic_assign_emp ON license_assignments (employee_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lic_assign_lic ON license_assignments (license_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_history_employee ON asset_history (employee_id, "timestamp" DESC);

-- Company branding & onboarding (single-row settings table)
CREATE TABLE IF NOT EXISTS app_settings (
  id           INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name TEXT NOT NULL DEFAULT 'IT Asset Control Pro',
  company_logo TEXT,
  onboarded    BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Editable handover-form terms text (NULL → application default)
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS handover_terms TEXT;

-- Purchase date replaces warranty in the UI (column kept for compatibility)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS purchase_date TIMESTAMPTZ;
UPDATE assets SET purchase_date = created_at WHERE purchase_date IS NULL;

-- Product catalog: brand/model lists that feed the asset form dropdowns
CREATE TABLE IF NOT EXISTS catalog_models (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  brand    TEXT NOT NULL,
  model    TEXT NOT NULL,
  UNIQUE (category, brand, model)
);

-- Repair progress notes: free-form updates while a device is in service
ALTER TABLE maintenance_logs ADD COLUMN IF NOT EXISTS progress_notes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE asset_history DROP CONSTRAINT IF EXISTS asset_history_action_type_check;
ALTER TABLE asset_history ADD CONSTRAINT asset_history_action_type_check
  CHECK (action_type IN (
    'assigned',
    'returned',
    'sent_to_repair',
    'repair_update',
    'created',
    'updated',
    'placed',
    'responsible_changed',
    'status_changed',
    'sold'
  ));

-- Asset lifecycle statuses (existing DBs may still have an older CHECK)
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_status_check;
ALTER TABLE assets ADD CONSTRAINT assets_status_check
  CHECK (status IN ('In Stock', 'Assigned', 'In Repair', 'Scrap', 'Sold', 'Reserved'));

-- Category lifecycle durations (months); NULL -> application defaults
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS lifecycles JSONB;

-- Office locations list (array of strings stored as JSONB)
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS locations JSONB;

-- Physical location of each asset (denormalized string)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS location TEXT;

-- Optional per-asset lifecycle override in months (NULL -> use the model /
-- category default). EOL months resolve in this order:
--   asset.lifecycle_months -> catalog_models.lifecycle_months -> app_settings.lifecycles[category] -> app default
ALTER TABLE assets ADD COLUMN IF NOT EXISTS lifecycle_months INTEGER;

-- Optional per-model lifecycle (months) on the catalog, so e.g. Apple MacBooks
-- run a 5-year lifecycle while other laptops keep the Laptop category default.
-- NULL -> fall through to the category default.
ALTER TABLE catalog_models ADD COLUMN IF NOT EXISTS lifecycle_months INTEGER;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS default_location TEXT;

-- Hardware spec dropdown lists (cpu/ram/storage); NULL -> defaults
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS spec_options JSONB;

-- Owner role (highest privilege): relax the users.role CHECK constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('Owner', 'Admin', 'Helpdesk', 'Viewer'));

-- Document storage provider config (Owner-managed): local | sharepoint | gdrive
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS document_storage JSONB;

-- Customizable Zimmet Tutanağı (handover form) template (Owner-managed).
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS handover_template JSONB;
-- Multiple named templates (array). When set, takes precedence; handover_template
-- stays mirrored as the default for backward compatibility.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS handover_templates JSONB;

-- Which template was used when the handover was created (reprint/PDF).
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS template_id TEXT;

-- Per-employee handover document archive (generated PDFs + uploaded signed scans).
-- Bytes live on the filesystem (storage_path); content is legacy BYTEA fallback.
CREATE TABLE IF NOT EXISTS handover_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id      UUID REFERENCES handovers(id) ON DELETE SET NULL,
  employee_id      UUID NOT NULL,
  employee_name    TEXT,
  kind             TEXT NOT NULL CHECK (kind IN ('generated', 'scan')),
  filename         TEXT NOT NULL,
  mime             TEXT NOT NULL,
  byte_size        INTEGER NOT NULL,
  content          BYTEA,
  storage_path     TEXT,
  uploaded_by      TEXT,
  uploaded_by_name TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_docs_employee ON handover_documents (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_docs_handover ON handover_documents (handover_id);

-- Repair paperwork (service invoices, reports, photos) attached to a maintenance
-- log. Kept per asset so it stays accessible from the device after the repair is
-- closed. Bytes on filesystem (storage_path); content is legacy BYTEA fallback.
CREATE TABLE IF NOT EXISTS maintenance_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_id   UUID REFERENCES maintenance_logs(id) ON DELETE CASCADE,
  asset_id         UUID NOT NULL,
  asset_tag        TEXT,
  filename         TEXT NOT NULL,
  mime             TEXT NOT NULL,
  byte_size        INTEGER NOT NULL,
  content          BYTEA,
  storage_path     TEXT,
  uploaded_by      TEXT,
  uploaded_by_name TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maint_docs_asset ON maintenance_documents (asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maint_docs_log ON maintenance_documents (maintenance_id);

-- Who executed a handover, denormalised: reprints must show the ORIGINAL
-- assigner, not whoever happens to be logged in.
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS it_user_name TEXT;

-- IT users can be disabled (kept for audit) or deleted by an Owner.
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Active';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('Active', 'Disabled'));

-- MFA (TOTP) + JWT logout denylist — also 018_auth_mfa_revoke.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_hashes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_pending_secret TEXT;

CREATE TABLE IF NOT EXISTS jwt_denylist (
  jti         TEXT PRIMARY KEY,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jwt_denylist_exp ON jwt_denylist (expires_at);

-- Admin actions on IT accounts (disable/enable/delete) — permanent audit trail
-- that survives the account itself (no FK on purpose).
CREATE TABLE IF NOT EXISTS user_admin_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_email TEXT NOT NULL,
  target_name  TEXT,
  action       TEXT NOT NULL CHECK (action IN (
    'disabled', 'enabled', 'deleted', 'role_changed',
    'ownership_granted', 'ownership_transferred'
  )),
  detail       TEXT,
  by_name      TEXT NOT NULL,
  "timestamp"  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_admin_logs ON user_admin_logs (target_email, "timestamp" DESC);

-- Unified system audit log (API mutations + readable timeline)
CREATE TABLE IF NOT EXISTS system_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action       TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'system',
  summary      TEXT NOT NULL DEFAULT '',
  actor_id     UUID,
  actor_email  TEXT,
  actor_name   TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  entity_label TEXT,
  meta         JSONB,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_audit_created ON system_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_source ON system_audit_log (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_actor ON system_audit_log (actor_email, created_at DESC);

-- Company departments list (managed in Product Catalog, feeds the employee form)
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS departments JSONB;

-- Physical stock counts: a session collects scans (barcode/QR/manual) from any
-- signed-in device; closing it compares scans against the live inventory.
CREATE TABLE IF NOT EXISTS stock_counts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  location        TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  summary         JSONB
);
CREATE TABLE IF NOT EXISTS stock_count_scans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id        UUID NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  raw             TEXT NOT NULL,
  asset_id        UUID,
  asset_tag       TEXT,
  matched         BOOLEAN NOT NULL DEFAULT FALSE,
  scanned_by_name TEXT,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (count_id, raw)
);
CREATE INDEX IF NOT EXISTS idx_scans_count ON stock_count_scans (count_id, scanned_at DESC);

-- Mobile line (SIM / phone number) inventory — assignable to employees like
-- other zimmet types.
CREATE TABLE IF NOT EXISTS mobile_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number          TEXT NOT NULL UNIQUE,
  operator              TEXT,
  plan                  TEXT,
  sim_serial            TEXT,
  monthly_cost          NUMERIC(10, 2),
  status                TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended', 'Cancelled')),
  current_employee_id   UUID REFERENCES employees(id),
  current_employee_name TEXT,
  reserved_for_employee_id UUID REFERENCES employees(id),
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lines_employee ON mobile_lines (current_employee_id);
ALTER TABLE mobile_lines ADD COLUMN IF NOT EXISTS reserved_for_employee_id UUID REFERENCES employees(id);
CREATE INDEX IF NOT EXISTS idx_lines_reserved
  ON mobile_lines (reserved_for_employee_id) WHERE reserved_for_employee_id IS NOT NULL;

-- Mobile line assign / take-back audit (feeds employee history timeline)
CREATE TABLE IF NOT EXISTS mobile_line_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id         UUID NOT NULL REFERENCES mobile_lines(id) ON DELETE CASCADE,
  phone_number    TEXT NOT NULL,
  employee_id     UUID,
  employee_name   TEXT,
  action_type     TEXT NOT NULL CHECK (action_type IN ('line_assigned', 'line_unassigned')),
  notes           TEXT NOT NULL DEFAULT '',
  changed_by      TEXT,
  changed_by_name TEXT,
  "timestamp"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_line_history_employee ON mobile_line_history (employee_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_line_history_line ON mobile_line_history (line_id, "timestamp" DESC);

-- UI language default for the instance (per-browser override in localStorage)
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS company_address TEXT;
-- Default currency for costs (ISO 4217). Contracts can override per agreement.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS currency TEXT;

-- Link network/server appliances to a software license pool (optional)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS license_id UUID REFERENCES licenses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_assets_license ON assets (license_id) WHERE license_id IS NOT NULL;

-- Site owner for Network/Server (not personal zimmet)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS responsible_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS responsible_employee_name TEXT;
CREATE INDEX IF NOT EXISTS idx_assets_responsible ON assets (responsible_employee_id)
  WHERE responsible_employee_id IS NOT NULL;

-- Network/Server enrichment
ALTER TABLE assets ADD COLUMN IF NOT EXISTS infra_role TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS rack TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS rack_unit TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS firmware_version TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS firmware_updated_at TIMESTAMPTZ;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS mgmt_ip TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS parent_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_assets_infra_role ON assets (infra_role) WHERE infra_role IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_parent ON assets (parent_asset_id) WHERE parent_asset_id IS NOT NULL;

-- Many licenses per Network/Server appliance
CREATE TABLE IF NOT EXISTS asset_licenses (
  asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  PRIMARY KEY (asset_id, license_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_licenses_license ON asset_licenses (license_id);

ALTER TABLE assets ADD COLUMN IF NOT EXISTS rack_u_start INTEGER
  CHECK (rack_u_start IS NULL OR (rack_u_start >= 1 AND rack_u_start <= 60));
ALTER TABLE assets ADD COLUMN IF NOT EXISTS rack_u_size INTEGER
  CHECK (rack_u_size IS NULL OR (rack_u_size >= 1 AND rack_u_size <= 20));

-- Barcode/asset-label design: sizes (mm) + which fields to print
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS label_config JSONB;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS setup_token TEXT;

-- One-time hygiene for filenames stored BEFORE the upload guard sanitised them:
-- strip quotes and control characters so they can never disturb the
-- Content-Disposition header. New uploads are sanitised at the route.
UPDATE handover_documents SET filename = regexp_replace(filename, '["[:cntrl:]]', '', 'g')
 WHERE filename ~ '["[:cntrl:]]';
UPDATE maintenance_documents SET filename = regexp_replace(filename, '["[:cntrl:]]', '', 'g')
 WHERE filename ~ '["[:cntrl:]]';

-- IT providers (ISP / MSP / vendors) and commercial contracts
CREATE TABLE IF NOT EXISTS providers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  category              TEXT NOT NULL DEFAULT 'Other',
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

CREATE TABLE IF NOT EXISTS provider_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  role          TEXT,
  email         TEXT,
  phone         TEXT,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provider_contacts_provider
  ON provider_contacts (provider_id, sort_order, name);

CREATE TABLE IF NOT EXISTS contracts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id           UUID NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  title                 TEXT NOT NULL,
  contract_number       TEXT,
  category              TEXT NOT NULL DEFAULT 'Other',
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
  visibility            TEXT NOT NULL DEFAULT 'Public'
                        CHECK (visibility IN ('Public', 'Confidential')),
  notes                 TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contracts_provider ON contracts (provider_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts (status, end_date);
CREATE INDEX IF NOT EXISTS idx_contracts_end ON contracts (end_date);
CREATE INDEX IF NOT EXISTS idx_contracts_visibility ON contracts (visibility);

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

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS provider_categories JSONB;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS contract_categories JSONB;

-- License ↔ provider / contract purchase link + proofs (also migration 017)
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES providers(id) ON DELETE SET NULL;
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS purchase_type TEXT;
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

-- Employee onboarding (scheduled zimmet with Reserved stock)
CREATE TABLE IF NOT EXISTS employee_onboardings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id),
  start_date       DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  notes            TEXT NOT NULL DEFAULT '',
  created_by       TEXT,
  created_by_name  TEXT,
  completed_at     TIMESTAMPTZ,
  handover_id      UUID REFERENCES handovers(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboardings_one_scheduled
  ON employee_onboardings (employee_id) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_onboardings_due
  ON employee_onboardings (start_date) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS onboarding_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   UUID NOT NULL REFERENCES employee_onboardings(id) ON DELETE CASCADE,
  asset_id        UUID REFERENCES assets(id),
  line_id         UUID REFERENCES mobile_lines(id),
  condition_note  TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (asset_id IS NOT NULL AND line_id IS NULL)
    OR (asset_id IS NULL AND line_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_items_asset
  ON onboarding_items (asset_id) WHERE asset_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_items_line
  ON onboarding_items (line_id) WHERE line_id IS NOT NULL;

-- Product extensions (also migration 019_product_extensions.sql)
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS smtp_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS notify_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS webhooks_json JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS custom_field_defs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity        TEXT NOT NULL CHECK (entity IN ('asset', 'employee', 'contract')),
  field_key     TEXT NOT NULL,
  label         TEXT NOT NULL,
  field_type    TEXT NOT NULL DEFAULT 'text'
                  CHECK (field_type IN ('text', 'number', 'date', 'select')),
  options_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  required      BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity, field_key)
);
CREATE INDEX IF NOT EXISTS idx_custom_field_defs_entity ON custom_field_defs (entity, sort_order);

CREATE TABLE IF NOT EXISTS custom_field_values (
  entity        TEXT NOT NULL CHECK (entity IN ('asset', 'employee', 'contract')),
  entity_id     UUID NOT NULL,
  field_key     TEXT NOT NULL,
  value_text    TEXT,
  PRIMARY KEY (entity, entity_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_entity ON custom_field_values (entity, entity_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  key_prefix    TEXT NOT NULL,
  key_hash      TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'Helpdesk'
                  CHECK (role IN ('Owner', 'Admin', 'Helpdesk', 'Viewer')),
  scopes        TEXT[] NOT NULL DEFAULT ARRAY['*']::text[],
  created_by    TEXT,
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys (key_prefix) WHERE revoked_at IS NULL;

ALTER TABLE handovers ADD COLUMN IF NOT EXISTS ack_token TEXT;
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS ack_at TIMESTAMPTZ;
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS ack_name TEXT;
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS ack_ip TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_handovers_ack_token
  ON handovers (ack_token) WHERE ack_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS software_installs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname        TEXT,
  asset_tag       TEXT,
  asset_id        UUID REFERENCES assets(id) ON DELETE SET NULL,
  software_name   TEXT NOT NULL,
  version         TEXT,
  source          TEXT NOT NULL DEFAULT 'sync',
  dedupe_key      TEXT NOT NULL,
  seen_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_software_installs_dedupe ON software_installs (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_software_installs_name ON software_installs (lower(software_name));
CREATE INDEX IF NOT EXISTS idx_software_installs_asset ON software_installs (asset_id);
