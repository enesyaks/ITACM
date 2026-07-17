-- Editable transactional email templates (onboarding welcome, …).
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS email_templates JSONB NOT NULL DEFAULT '{}'::jsonb;
