-- Active Directory / LDAP integration (083).
--
-- Config lives in app_settings.ldap_json (bind password encrypted with
-- secretCrypto, exactly like SMTP and the OIDC client secret).
--
-- Directory identity is stored on both people tables so a rename in AD never
-- creates a duplicate: `ldap_guid` is the stable, immutable object id
-- (objectGUID on AD, entryUUID on OpenLDAP) and is the join key; `ldap_dn` is
-- kept only for display and for resolving the manager reference, because a DN
-- changes whenever someone moves OU.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ldap_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS ldap_guid TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ldap_dn   TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ldap_synced_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_ldap_guid ON employees (ldap_guid) WHERE ldap_guid IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS ldap_guid TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ldap_dn   TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ldap_guid ON users (ldap_guid) WHERE ldap_guid IS NOT NULL;

-- Last run summary for the Integrations screen (one row, id = 1).
CREATE TABLE IF NOT EXISTS ldap_sync_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  trigger      TEXT NOT NULL DEFAULT 'manual',
  dry_run      BOOLEAN NOT NULL DEFAULT false,
  created      INTEGER NOT NULL DEFAULT 0,
  updated      INTEGER NOT NULL DEFAULT 0,
  deactivated  INTEGER NOT NULL DEFAULT 0,
  skipped      INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  actor_name   TEXT
);
CREATE INDEX IF NOT EXISTS idx_ldap_sync_runs_started ON ldap_sync_runs (started_at DESC);
