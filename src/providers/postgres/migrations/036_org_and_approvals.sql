-- Organization chart + approval workflow.
--
-- 1) Promotes the flat app_settings.departments name-list into a real
--    `departments` table so a manager can be attached (single source of truth:
--    settingsService now reads department names FROM this table).
-- 2) Adds `teams` (belong to a department, have a lead) and hierarchy columns on
--    employees (team_id + optional direct manager override).
-- 3) Adds the generic approval workflow tables. The engine ships PASSIVE — gated
--    by app_settings.approvals.enabled (default false), so nothing changes until
--    it is switched on for testing.

BEGIN;

-- ============================================================
-- Departments (promoted from app_settings.departments)
-- ============================================================
CREATE TABLE IF NOT EXISTS departments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL UNIQUE,
  manager_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed from the existing settings name-list so nothing disappears from forms.
INSERT INTO departments (name)
SELECT DISTINCT trim(value)
FROM app_settings,
     jsonb_array_elements_text(COALESCE(app_settings.departments, '[]'::jsonb)) AS value
WHERE app_settings.id = 1 AND trim(value) <> ''
ON CONFLICT (name) DO NOTHING;

-- Also seed from department names already sitting on employee records.
INSERT INTO departments (name)
SELECT DISTINCT trim(department)
FROM employees
WHERE department IS NOT NULL AND trim(department) <> ''
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- Teams (belong to a department, have a lead)
-- ============================================================
CREATE TABLE IF NOT EXISTS teams (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  department_id    UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  lead_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, name)
);
CREATE INDEX IF NOT EXISTS idx_teams_dept ON teams (department_id);

-- ============================================================
-- Employee hierarchy: primary team + optional direct-manager override
-- ============================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS manager_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_emp_team ON employees (team_id) WHERE team_id IS NOT NULL;

-- ============================================================
-- Approval workflow (generic; ships passive)
-- ============================================================
CREATE TABLE IF NOT EXISTS approval_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requester_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  requester_name        TEXT,
  approver_employee_id  UUID REFERENCES employees(id) ON DELETE SET NULL,
  approver_name         TEXT,
  levels                JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ordered ['manager','department']
  current_level         INTEGER NOT NULL DEFAULT 0,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,   -- data to replay the action on approve
  resource_ref          TEXT,
  summary               TEXT,
  decided_by            TEXT,
  decided_at            TIMESTAMPTZ,
  decision_note         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approvals_approver_status
  ON approval_requests (approver_employee_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_requester
  ON approval_requests (requester_employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_status
  ON approval_requests (status, created_at DESC);

-- Feature flag + per-action policy live here (default: disabled).
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS approvals JSONB;

COMMIT;
