-- Auto-escalation for stalled approvals. When a single-approver step sits pending
-- past app_settings.approvals.escalateDays, the scheduler reassigns it up to the
-- approver's manager (never auto-approves). escalated_at marks the last hop so the
-- next escalation only fires after another full interval.
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
