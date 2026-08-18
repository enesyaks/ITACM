-- Ticket SLA: per-priority response/resolution targets.
--
-- Due timestamps are computed on create (and recomputed when priority changes,
-- as long as that leg isn't already met). Breach markers are stamped once by the
-- scheduler sweep so each breach is logged to ticket_activity exactly once; the
-- UI badge is still derived live so it turns red the moment a target passes.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS response_due_at      TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolve_due_at       TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS response_breached_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolve_breached_at  TIMESTAMPTZ;

-- Scheduler sweep looks for still-open tickets whose due time has passed.
CREATE INDEX IF NOT EXISTS idx_tickets_response_due ON tickets (response_due_at)
  WHERE response_breached_at IS NULL AND first_response_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_resolve_due ON tickets (resolve_due_at)
  WHERE resolve_breached_at IS NULL AND resolved_at IS NULL;
