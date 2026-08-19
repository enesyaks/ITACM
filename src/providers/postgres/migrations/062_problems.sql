-- ITIL Problem Management. A problem groups one or more incidents under a single
-- root-cause investigation; once root_cause + workaround are documented and the
-- status is 'known_error', it is effectively a Known Error record.
CREATE TABLE IF NOT EXISTS problems (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number           TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'investigating', 'known_error', 'resolved', 'closed')),
  priority         TEXT NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  root_cause       TEXT,
  workaround       TEXT,
  assignee_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_name  TEXT,
  resolved_at      TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_problems_status ON problems (status, created_at DESC);

CREATE SEQUENCE IF NOT EXISTS problem_seq START 1001;

-- An incident can belong to at most one problem.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS problem_id UUID REFERENCES problems(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_problem ON tickets (problem_id);
