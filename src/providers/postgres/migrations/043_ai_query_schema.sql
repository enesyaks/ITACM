-- Guarded read-only surface for the AI assistant's advanced-query (advanced_query) tool.
-- The AI never touches base tables. It queries ONLY the curated `ai` schema views,
-- executed under the low-privilege NOLOGIN role `itacm_ai_ro` via SET LOCAL ROLE in a
-- read-only transaction. Views run with the owner's rights (security_invoker off), so
-- the role sees exactly these columns — nothing more. Sensitive data is excluded here:
--   users/app_settings/login_logs/jwt_denylist/api_keys/permission_*/*_documents are NOT exposed,
--   and license_key, handover ack_token/ack_ip, provider account_number/tax_id are dropped.
--   Confidential-visibility contracts are filtered out.

CREATE SCHEMA IF NOT EXISTS ai;

CREATE OR REPLACE VIEW ai.assets AS
  SELECT id, asset_tag, serial_number, imei, imei2, brand, model, category, status,
         current_employee_id, current_employee_name, responsible_employee_name,
         location, mac_ethernet, mac_wifi, specs, notes, firmware_version,
         warranty_end_date, purchase_date, cost, salvage_value, lifecycle_months,
         infra_role, rack, mgmt_ip, created_at, updated_at
  FROM public.assets;

CREATE OR REPLACE VIEW ai.asset_history AS
  SELECT id, asset_id, asset_tag, employee_id, employee_name, action_type,
         notes, changed_by_name, "timestamp" AS at
  FROM public.asset_history;

CREATE OR REPLACE VIEW ai.employees AS
  SELECT id, full_name, email, department, title, status, active_asset_count,
         start_date, team_id, manager_employee_id, created_at
  FROM public.employees;

CREATE OR REPLACE VIEW ai.departments AS
  SELECT id, name, manager_employee_id, created_at FROM public.departments;

CREATE OR REPLACE VIEW ai.teams AS
  SELECT id, name, department_id, lead_employee_id, created_at FROM public.teams;

CREATE OR REPLACE VIEW ai.licenses AS
  SELECT id, software_name, vendor, total_seats, used_seats, status,
         expiration_date, purchase_type, purchase_date, purchase_amount,
         purchase_currency, provider_id, contract_id, created_at
  FROM public.licenses;

CREATE OR REPLACE VIEW ai.license_assignments AS
  SELECT id, license_id, software_name, employee_id, employee_name,
         assigned_by_name, assigned_at, revoked_at
  FROM public.license_assignments;

CREATE OR REPLACE VIEW ai.contracts AS
  SELECT id, provider_id, title, contract_number, category, status,
         start_date, end_date, renewal_date, notice_days, auto_renew,
         cost_amount, cost_currency, billing_cycle, owner_employee_name,
         visibility, created_at
  FROM public.contracts
  WHERE COALESCE(visibility, 'Public') <> 'Confidential';

CREATE OR REPLACE VIEW ai.providers AS
  SELECT id, name, category, status, website, phone, email,
         support_email, support_phone, contact_name, contact_role,
         created_at, updated_at
  FROM public.providers;

CREATE OR REPLACE VIEW ai.mobile_lines AS
  SELECT id, phone_number, operator, plan, sim_serial, monthly_cost, status,
         current_employee_id, current_employee_name, reserved_for_employee_id,
         created_at, updated_at
  FROM public.mobile_lines;

CREATE OR REPLACE VIEW ai.consumables AS
  SELECT id, item_name, total_stock, minimum_stock_alert_level, created_at
  FROM public.consumables;

CREATE OR REPLACE VIEW ai.maintenance AS
  SELECT id, asset_id, asset_tag, service_company, issue_description, cost,
         sent_date, return_date, previous_status, resolution_note
  FROM public.maintenance_logs;

CREATE OR REPLACE VIEW ai.stock_counts AS
  SELECT id, name, location, status, created_by_name, created_at, closed_at, summary
  FROM public.stock_counts;

CREATE OR REPLACE VIEW ai.handovers AS
  SELECT id, employee_id, employee_name, it_user_name, transaction_date,
         document_type, template_id, ack_at, ack_name
  FROM public.handovers;

CREATE OR REPLACE VIEW ai.catalog_models AS
  SELECT id, category, brand, model, lifecycle_months FROM public.catalog_models;

CREATE OR REPLACE VIEW ai.audit_log AS
  SELECT id, action, source, summary, actor_name, entity_type, entity_label, created_at
  FROM public.system_audit_log;

-- Low-privilege role used only via SET LOCAL ROLE for AI queries. NOLOGIN: not a
-- login account. Created defensively so the migration never hard-fails on a
-- non-superuser install (the feature simply stays unavailable there).
DO $$
BEGIN
  -- Roles are CLUSTER-wide, not per-database, and the migration advisory lock is
  -- per-database — so two ITACM databases provisioning on one Postgres server
  -- (staging beside production, or two instances started together) can both see
  -- "no such role" and both try to create it. The loser used to abort the whole
  -- migration and crash-loop that instance's first start. Own sub-block so the
  -- GRANTs below still run for the database that lost the race.
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'itacm_ai_ro') THEN
      CREATE ROLE itacm_ai_ro NOLOGIN;
    END IF;
  EXCEPTION
    WHEN duplicate_object OR unique_violation THEN
      RAISE NOTICE 'itacm_ai_ro already created by a concurrent provision — continuing';
  END;
  GRANT USAGE ON SCHEMA ai TO itacm_ai_ro;
  GRANT SELECT ON ALL TABLES IN SCHEMA ai TO itacm_ai_ro;
  ALTER DEFAULT PRIVILEGES IN SCHEMA ai GRANT SELECT ON TABLES TO itacm_ai_ro;
  EXECUTE format('GRANT itacm_ai_ro TO %I', current_user);
EXCEPTION
  WHEN insufficient_privilege OR feature_not_supported THEN
    RAISE NOTICE 'itacm_ai_ro not provisioned (insufficient privilege) — advanced_query will be disabled';
END $$;
