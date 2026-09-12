-- Which legal entity is hiring, named by HR when the onboarding ticket is filed.
--
-- The employee record does not exist yet at filing time, so the company cannot
-- be written to employees.company_id there. It is parked on the request and
-- applied when IT acknowledges and the employee is created. On a single-company
-- install this is simply the default company and nobody is asked.
--
-- ON DELETE SET NULL, not CASCADE: dissolving an entity must not erase the HR
-- tickets that were filed under it.
ALTER TABLE hr_requests
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
