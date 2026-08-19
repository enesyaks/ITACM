-- ITIL Change Enablement. A change (CHG-) carries type (standard/normal/emergency),
-- risk, implementation + rollback plans, a CAB approval decision, and a scheduled
-- window. Standard changes are pre-authorized (may skip approval).
CREATE TABLE IF NOT EXISTS changes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number              TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  description         TEXT,
  type                TEXT NOT NULL DEFAULT 'normal'
                        CHECK (type IN ('standard', 'normal', 'emergency')),
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected',
                                          'scheduled', 'implementing', 'completed', 'failed', 'closed', 'cancelled')),
  risk                TEXT NOT NULL DEFAULT 'medium' CHECK (risk IN ('low', 'medium', 'high')),
  implementation_plan TEXT,
  rollback_plan       TEXT,
  assignee_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_by_name   TEXT,
  approver_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  approver_name       TEXT,
  approval_note       TEXT,
  approved_at         TIMESTAMPTZ,
  scheduled_start     TIMESTAMPTZ,
  scheduled_end       TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_changes_status ON changes (status, created_at DESC);
CREATE SEQUENCE IF NOT EXISTS change_seq START 1001;
