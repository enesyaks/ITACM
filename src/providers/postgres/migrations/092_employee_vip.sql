-- VIP requesters.
--
-- Some people's downtime costs the business more than others' — an executive,
-- a trading desk, the one person who can sign off a shipment. The desk already
-- knows who they are; the system did not, so their tickets landed in the queue
-- at whatever priority the Impact × Urgency default produced.
--
-- The flag lives on the PERSON, not the ticket: it is a standing fact about
-- them, not a property of one request. It feeds the existing ITIL chain by
-- raising URGENCY (how fast this matters), which the priority matrix carries
-- into priority and from there into the SLA clock — rather than pinning a
-- priority from the side and leaving impact and urgency saying otherwise.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS vip BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial: VIPs are a small minority, and the only query worth an index is
-- "who are they".
CREATE INDEX IF NOT EXISTS idx_employees_vip ON employees (vip) WHERE vip;

-- Surface it to the assistant too, so "did we breach SLA on a VIP ticket" is
-- answerable. Appended at the END — CREATE OR REPLACE VIEW requires the leading
-- column list to stay identical.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'ai') THEN
    RAISE NOTICE 'itacm: ai schema absent — vip not exposed to advanced_query';
    RETURN;
  END IF;

  EXECUTE $v$
    CREATE OR REPLACE VIEW ai.employees AS
      SELECT id, full_name, email, department, title, status, active_asset_count,
             start_date, team_id, manager_employee_id, created_at,
             company_id,
             vip
      FROM public.employees
  $v$;

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
             COALESCE(e.vip, FALSE) AS requester_vip
      FROM public.tickets t
      LEFT JOIN public.employees e ON e.id = t.requester_employee_id
      LEFT JOIN public.users     u ON u.id = t.assignee_user_id
      LEFT JOIN public.assets    a ON a.id = t.asset_id
  $v$;
END $$;
