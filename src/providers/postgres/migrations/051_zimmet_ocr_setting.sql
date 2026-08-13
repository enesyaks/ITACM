-- Zimmet import OCR as an Owner-facing setting instead of env-only.
--
-- NULL means "inherit the ZIMMET_OCR env default" (so an existing deployment
-- that set the variable keeps working untouched); TRUE/FALSE is an explicit
-- toggle from Integrations → Zimmet import, which then wins over the env.
-- Same three-state pattern as app_settings.update_check.

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS zimmet_ocr boolean;
