-- Approval decision trail. Each approve/reject on any step appends an entry to
-- history so a completed request keeps the full audit ("who approved this
-- purchase, when"), not just the final decision. Shape per entry:
--   { at, level, decision, deciderName, deciderEmployeeId, approverName, note }
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::jsonb;
