-- Delegated ("connect your mailbox") OAuth2 for email-to-ticket and outbound mail
-- — the Jira-style flow where an operator clicks Connect, signs in at the provider
-- once, and ITACM stores a refresh token instead of anyone typing a password or an
-- app secret per mailbox.
--
-- mail_oauth_apps: the ONE OAuth application ITACM is registered as, per provider
--   (Microsoft / Google) — client id, encrypted client secret, tenant, redirect.
--   Set once by whoever runs ITACM.
-- mail_oauth_conn: the mailbox that was connected — provider, address and the
--   encrypted refresh token. One shared connection serves both IMAP and SMTP.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS mail_oauth_apps JSONB;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS mail_oauth_conn JSONB;
