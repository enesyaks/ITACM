-- Email-to-ticket (inbound IMAP): mailbox config lives in app_settings.imap_json
-- { enabled, host, port, secure, user, pass(encrypted), folder, defaultType,
--   defaultCategory, lastUid }. NULL/absent = feature off.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS imap_json JSONB;
