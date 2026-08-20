-- Approval delegation (out-of-office). When an approver has an active delegate,
-- requests that would route to them go to the delegate instead — so leave/travel
-- doesn't stall the chain. approval_delegate_until is an optional end date
-- (NULL = until cleared); past that date the delegation no longer applies.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS approval_delegate_id UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS approval_delegate_until DATE;
