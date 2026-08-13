-- Zimmet import: per-item failure reason + OCR provenance (phase 2).
--
-- 049 carries these columns for a fresh database, but the runner keys on the
-- filename: any database that already applied 049 would never see them. This
-- migration is the catch-up and is a no-op where 049 already created them.

ALTER TABLE zimmet_import_items ADD COLUMN IF NOT EXISTS error text;

-- The form had no text layer and its name was read by OCR — worth flagging in
-- review, since OCR output is less trustworthy than an embedded text layer.
ALTER TABLE zimmet_import_items ADD COLUMN IF NOT EXISTS via_ocr boolean NOT NULL DEFAULT false;

-- commit() marks an item that could not be attached, so 'failed' must be legal.
ALTER TABLE zimmet_import_items DROP CONSTRAINT IF EXISTS zimmet_import_items_status_check;
ALTER TABLE zimmet_import_items ADD CONSTRAINT zimmet_import_items_status_check
  CHECK (status IN ('pending', 'attached', 'skipped', 'failed'));

-- The staging purge sweeps abandoned pending batches by age.
CREATE INDEX IF NOT EXISTS idx_zib_pending ON zimmet_import_batches (status, created_at);
