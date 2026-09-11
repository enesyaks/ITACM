-- HR names the new hire's manager when the onboarding ticket is filed.
--
-- The employee record does not exist yet at filing time, so the manager cannot
-- be written to employees.manager_employee_id there. It is parked on the
-- request and applied when IT acknowledges and the employee is created.
--
-- ON DELETE SET NULL, not CASCADE: a manager leaving must not erase the HR
-- ticket that names them.
ALTER TABLE hr_requests
  ADD COLUMN IF NOT EXISTS manager_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;
