-- Reminder nudges for approvals left pending too long. The scheduler resends a
-- notice to the current approver(s) once the request has sat for reminderDays
-- (app_settings.approvals.reminderDays; 0 = off), then stamps last_reminded_at so
-- the next nudge only fires after another full interval.
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;
