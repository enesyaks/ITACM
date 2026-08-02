-- AI assistant configuration (provider, model, encrypted API key).
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS ai_json JSONB NOT NULL DEFAULT '{}'::jsonb;
