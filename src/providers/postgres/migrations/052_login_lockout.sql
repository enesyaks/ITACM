-- Per-account brute-force lockout.
--
-- Failed logins are tracked on the user itself (not just per-IP), so a whole
-- office behind one NAT IP never locks colleagues out, and the lock state
-- survives a server restart. Additive and idempotent — existing rows default
-- to "no failures, not locked", so nothing is disrupted.
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until       TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_at     TIMESTAMPTZ;
