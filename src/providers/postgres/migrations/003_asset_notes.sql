-- Free-form note on each asset (shown when adding to handover basket).
ALTER TABLE assets ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
