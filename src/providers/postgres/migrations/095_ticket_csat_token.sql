-- Let the requester rate the resolution straight from the email.
--
-- CSAT could only be given inside the Portal, which means it could only be given
-- by someone who has an account there — and most requesters do not. Mail arrives
-- from the desk, the answer is read in a mail client, and asking the person to
-- go and log in somewhere to say "that worked" collects almost nothing. So the
-- rating travels with the mail that announces the resolution.
--
-- A random per-ticket token, like the handover acknowledgement link: it names
-- exactly one ticket, it carries no identity of its own, and it can be dropped
-- without touching the ticket. It is a bearer secret, so it is never returned by
-- any read API — only ever written into the mail that goes to the requester.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS csat_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_csat_token
  ON tickets (csat_token) WHERE csat_token IS NOT NULL;
