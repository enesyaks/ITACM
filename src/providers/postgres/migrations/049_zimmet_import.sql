-- Staging tables for the bulk historical zimmet PDF import.
-- A batch holds the split forms of one upload session until the user reviews
-- name→employee matches and commits (attach to profiles) or discards.
-- Split PDF bytes live in `content` here until commit, then move to
-- handover_documents via documentService; rows are deleted on commit/discard.

CREATE TABLE IF NOT EXISTS zimmet_import_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'committed', 'discarded')),
  created_by      text,
  created_by_name text,
  source_files    jsonb NOT NULL DEFAULT '[]'::jsonb,
  item_count      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zimmet_import_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              uuid NOT NULL REFERENCES zimmet_import_batches(id) ON DELETE CASCADE,
  source_filename       text,
  page_from             integer NOT NULL,
  page_to               integer NOT NULL,
  page_count            integer NOT NULL,
  extracted_name        text,
  matched_employee_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
  matched_employee_name text,
  confidence            text NOT NULL DEFAULT 'none'
                          CHECK (confidence IN ('high', 'medium', 'none')),
  candidates            jsonb NOT NULL DEFAULT '[]'::jsonb,
  filename              text NOT NULL,
  mime                  text NOT NULL DEFAULT 'application/pdf',
  byte_size             integer NOT NULL,
  content               bytea,
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'attached', 'skipped')),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zii_batch ON zimmet_import_items (batch_id);

-- Allow imported historical zimmets as a distinct document kind.
ALTER TABLE handover_documents DROP CONSTRAINT IF EXISTS handover_documents_kind_check;
ALTER TABLE handover_documents ADD CONSTRAINT handover_documents_kind_check
  CHECK (kind = ANY (ARRAY['generated'::text, 'scan'::text, 'legacy_zimmet'::text]));
