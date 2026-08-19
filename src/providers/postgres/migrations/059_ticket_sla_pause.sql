-- SLA clock-stop: while a ticket sits in 'pending' (waiting on the requester) the
-- resolution SLA is paused. sla_paused_at records when the pause began; on resume
-- the elapsed pause is added back to resolve_due_at, and the column is cleared.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_paused_at TIMESTAMPTZ;
