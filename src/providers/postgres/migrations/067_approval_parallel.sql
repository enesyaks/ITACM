-- Parallel approvers within one step. A single-approver step keeps using
-- approver_employee_id (unchanged); a multi-approver step tracks each approver's
-- decision in step_state, with step_mode deciding when the step passes.
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS step_state JSONB;      -- [{employeeId,name,status}]
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS step_mode  TEXT CHECK (step_mode IN ('any', 'all'));
