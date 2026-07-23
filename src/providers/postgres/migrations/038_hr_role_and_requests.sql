-- HR role + onboarding/offboarding request tables.
--
-- Supersedes the short-lived 037_hr_role_and_requests.sql (which collided with
-- 037_employee_email_lower_unique.sql). Fully idempotent, so it is safe to apply
-- on a database where the old 037 variant already ran.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('Owner', 'Admin', 'Helpdesk', 'Viewer', 'Portal', 'HR'));

CREATE TABLE IF NOT EXISTS hr_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT NOT NULL CHECK (type IN ('onboard', 'offboard')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'acknowledged', 'cancelled')),
  employee_id     UUID REFERENCES employees(id) ON DELETE SET NULL,
  full_name       TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  department      TEXT NOT NULL DEFAULT '',
  event_date      DATE NOT NULL,
  notes           TEXT NOT NULL DEFAULT '',
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Columns added after the first cut: the ticket is now a pure request, so the
-- job title travels on the ticket instead of being written straight into
-- employees, and provisioning/cancel/notify state is tracked here.
ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS title         TEXT NOT NULL DEFAULT '';
ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS onboarding_id UUID REFERENCES employee_onboardings(id) ON DELETE SET NULL;
ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS notified_at   TIMESTAMPTZ;
ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS notify_error  TEXT;
ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;
ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS cancelled_by  UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS cancel_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_hr_requests_status ON hr_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_requests_type ON hr_requests (type, status);
CREATE INDEX IF NOT EXISTS idx_hr_requests_created_by ON hr_requests (created_by, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_requests_pending_onboard_email
  ON hr_requests (lower(email)) WHERE type = 'onboard' AND status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_requests_pending_offboard_emp
  ON hr_requests (employee_id) WHERE type = 'offboard' AND status = 'pending' AND employee_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hr_request_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES hr_requests(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  qty         INT NOT NULL DEFAULT 1 CHECK (qty >= 1 AND qty <= 99),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_request_items_req ON hr_request_items (request_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_request_items_unique
  ON hr_request_items (request_id, category);
