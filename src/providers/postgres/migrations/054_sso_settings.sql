-- UI-managed SSO configuration.
--
-- Lets an Owner configure OpenID Connect from Integrations → SSO instead of
-- env vars. The client secret is stored encrypted (enc:v1:…, same as SMTP).
-- Empty by default; when unset the app falls back to the SSO_* env vars.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS sso_json JSONB NOT NULL DEFAULT '{}'::jsonb;
