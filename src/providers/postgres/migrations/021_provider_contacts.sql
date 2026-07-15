-- Multiple contacts per provider (cards in UI). Legacy contact_* columns stay as
-- denormalized primary for search/list compatibility.

CREATE TABLE IF NOT EXISTS provider_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  role          TEXT,
  email         TEXT,
  phone         TEXT,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_contacts_provider
  ON provider_contacts (provider_id, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_provider_contacts_primary
  ON provider_contacts (provider_id)
  WHERE is_primary;

-- Backfill one primary contact from legacy columns when present.
INSERT INTO provider_contacts (provider_id, name, role, email, phone, is_primary, sort_order)
SELECT
  p.id,
  NULLIF(trim(p.contact_name), ''),
  NULLIF(trim(p.contact_role), ''),
  NULLIF(trim(p.contact_email), ''),
  NULLIF(trim(p.contact_phone), ''),
  true,
  0
FROM providers p
WHERE NULLIF(trim(coalesce(p.contact_name, '')), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM provider_contacts c WHERE c.provider_id = p.id
  );
