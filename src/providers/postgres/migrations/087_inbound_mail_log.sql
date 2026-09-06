-- A durable record of every inbound message the poller has already handled.
--
-- Until now the only guard against re-processing was the IMAP \Seen flag: the
-- poll fetches unseen mail and marks each seen afterwards. But that flag is not
-- reliable — iCloud and other providers reset it, another mail client reading
-- the mailbox clears it, and the flag write is best-effort so a failed one
-- leaves the message unseen. Every ~2 minutes the same email was then read again
-- and opened the SAME ticket over and over.
--
-- Keying on the RFC Message-ID (or a content hash when the header is missing)
-- makes de-duplication independent of the flag: a message logged here is never
-- turned into a ticket twice, whatever the mailbox does with \Seen.
--
-- The table also backs "release": a message a filter skipped is kept here with
-- its IMAP UID, so an operator can re-fetch it and open a ticket anyway.
CREATE TABLE IF NOT EXISTS inbound_mail_log (
  message_id    TEXT PRIMARY KEY,
  imap_uid      BIGINT,
  from_addr     TEXT,
  subject       TEXT,
  -- processing: claimed but not yet finished (a crash mid-poll leaves this, and
  -- it still blocks a duplicate — the message is not lost, it simply is not
  -- retried, which matches the old \Seen behaviour on failure).
  status        TEXT NOT NULL CHECK (status IN ('processing', 'created', 'appended', 'skipped', 'failed')),
  reason        TEXT,
  ticket_id     UUID,
  ticket_number TEXT,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The skip list and any housekeeping read newest-first.
CREATE INDEX IF NOT EXISTS inbound_mail_log_recent ON inbound_mail_log (processed_at DESC);
