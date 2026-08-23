-- Managed ticket category list. Previously the category was free text and the
-- picker only offered values already used on tickets. This stores an admin-curated
-- list so the ticket forms can present a proper dropdown (merged with any legacy
-- free-text categories still on existing tickets).
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ticket_categories_json JSONB;
