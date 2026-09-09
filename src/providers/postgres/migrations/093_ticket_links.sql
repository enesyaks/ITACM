-- Duplicate tickets, linked to one master.
--
-- The same problem arrives twice all the time: a person writes in, hears
-- nothing for an hour and writes again; a floor loses its printer and four
-- people report it; an email thread forks. Until now each of those was a
-- separate ticket with its own SLA clock, and closing the one the desk actually
-- worked left the others sitting open — so the queue counted a problem two,
-- three, five times over, and somebody had to close the strays by hand and
-- remember which they were.
--
-- A ticket may name another as its master. The link is deliberately NOT a merge:
-- both keep their number, their requester and their own history, because the
-- second reporter asked a real question and deserves an answer under their own
-- reference. What the link buys is a single place to work and a single closing
-- act — resolving or closing the master carries its linked tickets with it.
--
-- One level only, enforced in the service: a master cannot itself be linked, so
-- "what closes this" is always one hop away and there is no chain to walk.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS linked_to_id UUID REFERENCES tickets(id) ON DELETE SET NULL;

-- The address a ticket arrived from, when it arrived by email.
--
-- A sender who matches an employee is identified by that row, but the intake
-- also opens tickets for addresses belonging to nobody in the system — a
-- customer, a supplier, someone using their private address. Those had no
-- identity at all, so "the same person wrote twice" could not be asked about
-- them. Stored raw and only for the email path: it says where the message came
-- from, not who the person is.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS requester_email TEXT;

-- "Which tickets close with this one" — small and always answered by the index.
CREATE INDEX IF NOT EXISTS idx_tickets_linked ON tickets (linked_to_id) WHERE linked_to_id IS NOT NULL;
-- Case-insensitive, because mail addresses arrive in whatever case was typed.
CREATE INDEX IF NOT EXISTS idx_tickets_requester_email ON tickets (lower(requester_email)) WHERE requester_email IS NOT NULL;

-- Surface the link to the assistant, so "how many of these were duplicates" is
-- answerable. Appended at the END — CREATE OR REPLACE VIEW requires the leading
-- column list to stay identical. The address itself is NOT exposed: it is a
-- personal identifier and no analytics question needs it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'ai') THEN
    RAISE NOTICE 'itacm: ai schema absent — ticket links not exposed to advanced_query';
    RETURN;
  END IF;

  EXECUTE $v$
    CREATE OR REPLACE VIEW ai.tickets AS
      SELECT t.id, t.number, t.type, t.subject, t.status, t.priority,
             t.impact, t.urgency, t.category, t.resolution_code,
             e.full_name  AS requester_name,
             e.department AS requester_department,
             u.username   AS assignee_name,
             a.asset_tag,
             t.first_response_at, t.resolved_at, t.closed_at,
             t.response_due_at, t.response_breached_at,
             t.resolve_due_at, t.resolve_breached_at,
             t.csat_rating, t.problem_id,
             t.created_at, t.updated_at,
             COALESCE(e.vip, FALSE) AS requester_vip,
             lt.number AS linked_to_number
      FROM public.tickets t
      LEFT JOIN public.employees e ON e.id = t.requester_employee_id
      LEFT JOIN public.users     u ON u.id = t.assignee_user_id
      LEFT JOIN public.assets    a ON a.id = t.asset_id
      LEFT JOIN public.tickets  lt ON lt.id = t.linked_to_id
  $v$;
END $$;
