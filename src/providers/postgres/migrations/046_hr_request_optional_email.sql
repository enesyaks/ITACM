-- HR may file an onboard request without an email — HR often does not know the
-- new hire's address yet, so IT supplies it when acknowledging the ticket.
--
-- The pending-onboard dedup index was built on lower(email) alone. With email
-- now optionally blank ('' — the column is NOT NULL DEFAULT ''), two e-mailless
-- pending requests would both hash to lower('') = '' and collide. Rebuild the
-- index so it only enforces uniqueness for requests that actually carry an
-- email; blank-email tickets are always allowed and are de-duplicated by IT
-- when the email is entered at acknowledge time.
--
-- Idempotent: safe to re-apply.

DROP INDEX IF EXISTS idx_hr_requests_pending_onboard_email;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_requests_pending_onboard_email
  ON hr_requests (lower(email))
  WHERE type = 'onboard' AND status = 'pending' AND email <> '';
