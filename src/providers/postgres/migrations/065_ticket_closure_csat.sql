-- ITIL closure: resolution categorization + note, and a CSAT rating the
-- requester gives on a resolved/closed ticket (1-5) with an optional comment.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_code TEXT
  CHECK (resolution_code IN ('fixed', 'workaround', 'no_fault', 'duplicate', 'not_reproducible', 'user_education'));
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS csat_rating  SMALLINT CHECK (csat_rating BETWEEN 1 AND 5);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS csat_comment TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS csat_at      TIMESTAMPTZ;
