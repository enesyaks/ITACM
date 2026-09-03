-- Refused sign-ins, kept for 7 days.
--
-- Deliberately NOT system_audit_log: that table is a permanent record, and the
-- middleware behind it drops anything that answered 4xx, so a refusal never
-- reached it. Failed attempts also want the opposite retention — they are useful
-- while investigating and noise afterwards, and a shared table cannot be purged
-- on one of two schedules.
--
-- `email` is whatever the attempt claimed, so it is NOT a foreign key: the rows
-- that matter most are the ones naming an account that does not exist.

CREATE TABLE IF NOT EXISTS login_failures (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT,
  reason      TEXT NOT NULL,
  method      TEXT NOT NULL DEFAULT 'password',
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The purge sweeps by age; the UI reads newest-first.
CREATE INDEX IF NOT EXISTS idx_login_failures_created_at
  ON login_failures (created_at DESC);

-- "Has this address been hammered?" is the other question asked of this table.
CREATE INDEX IF NOT EXISTS idx_login_failures_email
  ON login_failures (lower(email), created_at DESC) WHERE email IS NOT NULL;
