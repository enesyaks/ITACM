-- Which directory a person was synced from (084).
--
-- Deactivation ("turn off employees who disappeared from the directory")
-- compared the run's results against EVERY directory-linked employee, whichever
-- server they came from. Point the integration at a second directory — a test
-- instance, a migration to a new domain, a typo in the base DN — and everyone
-- from the first one is missing from that run, so they get deactivated.
--
-- `ldap_source` is a fingerprint of the server + search base, stamped on every
-- row a sync touches. Deactivation now only considers rows from the same
-- source, so a run against one directory can never sweep another's people.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ldap_source TEXT;
ALTER TABLE users     ADD COLUMN IF NOT EXISTS ldap_source TEXT;
CREATE INDEX IF NOT EXISTS idx_employees_ldap_source ON employees (ldap_source) WHERE ldap_source IS NOT NULL;
