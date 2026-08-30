-- Amount-gated finance sign-off. When a template carries an amount_threshold, the
-- fixed final approver (an 'emp:<uuid>' step, e.g. finance) is only required when
-- the request's stated amount is at or above the threshold; below it, the request
-- routes through the org-level steps only. NULL = the fixed approver always applies.
ALTER TABLE request_templates ADD COLUMN IF NOT EXISTS amount_threshold NUMERIC;
