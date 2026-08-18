-- Single-provider SSO (OIDC) link.
--
-- Records which external identity — issuer + subject — a local user signs in as.
-- Invite-only: SSO never creates accounts, it only links an existing user on
-- their first SSO sign-in (matched by verified email), then matches by the
-- stable (iss, sub) pair afterwards. Additive; password login is unaffected and
-- users stay password-only until they link.
ALTER TABLE users ADD COLUMN IF NOT EXISTS oidc_iss TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oidc_sub TEXT;
-- One external identity maps to at most one local user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc
  ON users (oidc_iss, oidc_sub) WHERE oidc_sub IS NOT NULL;
