-- Employee onboarding: start date, Reserved stock holds, scheduled zimmet.

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_status_check;
ALTER TABLE assets ADD CONSTRAINT assets_status_check
  CHECK (status IN ('In Stock', 'Assigned', 'In Repair', 'Scrap', 'Sold', 'Reserved'));

ALTER TABLE employees ADD COLUMN IF NOT EXISTS start_date DATE;

ALTER TABLE mobile_lines ADD COLUMN IF NOT EXISTS reserved_for_employee_id UUID REFERENCES employees(id);
CREATE INDEX IF NOT EXISTS idx_lines_reserved
  ON mobile_lines (reserved_for_employee_id) WHERE reserved_for_employee_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS employee_onboardings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id),
  start_date       DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  notes            TEXT NOT NULL DEFAULT '',
  created_by       TEXT,
  created_by_name  TEXT,
  completed_at     TIMESTAMPTZ,
  handover_id      UUID REFERENCES handovers(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_onboardings_one_scheduled
  ON employee_onboardings (employee_id) WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_onboardings_due
  ON employee_onboardings (start_date) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS onboarding_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   UUID NOT NULL REFERENCES employee_onboardings(id) ON DELETE CASCADE,
  asset_id        UUID REFERENCES assets(id),
  line_id         UUID REFERENCES mobile_lines(id),
  condition_note  TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (asset_id IS NOT NULL AND line_id IS NULL)
    OR (asset_id IS NULL AND line_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_items_asset
  ON onboarding_items (asset_id) WHERE asset_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_items_line
  ON onboarding_items (line_id) WHERE line_id IS NOT NULL;
