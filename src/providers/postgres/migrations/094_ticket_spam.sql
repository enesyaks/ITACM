-- "This was an advert" as a resolution, so junk mail can be recorded and shut
-- at the same moment.
--
-- Bulk mail reaching a support address had exactly two fates: it was skipped and
-- left no trace at all, or — with the filter off — it opened a normal ticket
-- with a normal SLA clock, so a newsletter counted against the desk's response
-- time and somebody had to close it by hand. Neither is what a desk wants: the
-- message should be on record (it arrived, this is what it was) without ever
-- being work.
--
-- The code is what makes that visible in reporting: a ticket resolved 'spam'
-- can be excluded from every average the desk is judged by, rather than being
-- indistinguishable from a real request somebody closed quickly.
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_resolution_code_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_resolution_code_check
  CHECK (resolution_code IN ('fixed', 'workaround', 'no_fault', 'duplicate',
                             'not_reproducible', 'user_education', 'spam'));
