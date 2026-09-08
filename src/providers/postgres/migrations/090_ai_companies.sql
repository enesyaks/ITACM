-- Expose the multi-company dimension to the AI assistant's advanced_query views.
--
-- Without this, "how many laptops does Acme own?" is unanswerable: the assistant
-- may only read the curated ai.* views, and none of them carried company_id.
-- New columns are appended at the END of each view — CREATE OR REPLACE VIEW
-- requires the leading column list to stay identical.
--
-- Wrapped in a namespace guard for the same reason migration 048 is: this runs
-- on every server start, and a hard failure here is a crash loop. An install
-- where the ai schema never provisioned simply keeps advanced_query disabled.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'ai') THEN
    RAISE NOTICE 'itacm: ai schema absent — company columns not exposed to advanced_query';
    RETURN;
  END IF;

  EXECUTE $v$
    CREATE OR REPLACE VIEW ai.companies AS
      SELECT id, parent_id, name, code, is_default, active, created_at
      FROM public.companies
  $v$;

  EXECUTE $v$
    CREATE OR REPLACE VIEW ai.assets AS
      SELECT id, asset_tag, serial_number, imei, imei2, brand, model, category, status,
             current_employee_id, current_employee_name, responsible_employee_name,
             location, mac_ethernet, mac_wifi, specs, notes, firmware_version,
             warranty_end_date, purchase_date, cost, salvage_value, lifecycle_months,
             infra_role, rack, mgmt_ip, created_at, updated_at,
             company_id
      FROM public.assets
  $v$;

  EXECUTE $v$
    CREATE OR REPLACE VIEW ai.employees AS
      SELECT id, full_name, email, department, title, status, active_asset_count,
             start_date, team_id, manager_employee_id, created_at,
             company_id
      FROM public.employees
  $v$;

  EXECUTE $v$
    CREATE OR REPLACE VIEW ai.licenses AS
      SELECT id, software_name, vendor, total_seats, used_seats, status,
             expiration_date, purchase_type, purchase_date, purchase_amount,
             purchase_currency, provider_id, contract_id, created_at,
             company_id
      FROM public.licenses
  $v$;

  -- The read-only role holds SELECT on whatever existed when it was provisioned;
  -- ai.companies is new, so grant it explicitly.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'itacm_ai_ro') THEN
    EXECUTE 'GRANT SELECT ON ai.companies TO itacm_ai_ro';
  END IF;
END $$;
