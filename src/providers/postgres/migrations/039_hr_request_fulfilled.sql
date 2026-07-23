-- Close the loop on an HR onboard ticket.
--
-- Acknowledging a ticket provisions the employee + a scheduled onboarding, but
-- until the kit is actually handed over the request is not really done. Record
-- that final step so HR can tell "IT picked it up" apart from "the person has
-- their equipment".
--
-- Idempotent: safe to re-apply.

ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;
ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS fulfilled_handover_id UUID REFERENCES handovers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hr_requests_fulfilled
  ON hr_requests (fulfilled_at) WHERE fulfilled_at IS NOT NULL;
