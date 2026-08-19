-- Canned responses (quick replies) for the service desk. Array of { title, body }.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ticket_canned_json JSONB NOT NULL DEFAULT '[]'::jsonb;
