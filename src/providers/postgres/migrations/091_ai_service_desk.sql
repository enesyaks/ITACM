-- Expose the service desk to the AI assistant's advanced_query views.
--
-- The ai schema shipped with hardware, people, licences and contracts but not a
-- single ITIL table — so "kaç kayıt açılmış" (how many tickets were opened) had
-- nowhere to land, and the model fell back to ai.audit_log grouped by action,
-- answering with auth.verify_token / auth.login counts. The service desk is the
-- most-used module on a busy install; it belongs in the assistant's world.
--
-- Deliberately NOT exposed:
--   * ticket/problem/change free-text bodies (description, root_cause,
--     workaround, implementation_plan, rollback_plan, resolution_note) — the
--     analytics questions never need them and they are the fields most likely to
--     carry a person's own account of an incident.
--   * ticket_comments entirely: migration 080 gave comments a staff-only
--     visibility flag, and a view has no way to honour the per-viewer half of
--     that rule.
--   * csat_comment, for the same reason as the bodies. The numeric rating stays,
--     since "average CSAT" is a question worth answering.
--
-- Names are resolved the way ai.assets already resolves current_employee_name:
-- a display name, never the underlying user row.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'ai') THEN
    RAISE NOTICE 'itacm: ai schema absent — service desk not exposed to advanced_query';
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
             t.created_at, t.updated_at
      FROM public.tickets t
      LEFT JOIN public.employees e ON e.id = t.requester_employee_id
      LEFT JOIN public.users     u ON u.id = t.assignee_user_id
      LEFT JOIN public.assets    a ON a.id = t.asset_id
  $v$;

  EXECUTE $v$
    CREATE OR REPLACE VIEW ai.problems AS
      SELECT p.id, p.number, p.title, p.status, p.priority,
             u.username AS assignee_name,
             p.created_by_name, p.resolved_at, p.closed_at,
             p.created_at, p.updated_at
      FROM public.problems p
      LEFT JOIN public.users u ON u.id = p.assignee_user_id
  $v$;

  EXECUTE $v$
    CREATE OR REPLACE VIEW ai.changes AS
      SELECT c.id, c.number, c.title, c.type, c.status, c.risk,
             u.username AS assignee_name,
             c.requested_by_name, c.approver_name, c.approved_at,
             c.scheduled_start, c.scheduled_end, c.completed_at, c.closed_at,
             c.created_at, c.updated_at
      FROM public.changes c
      LEFT JOIN public.users u ON u.id = c.assignee_user_id
  $v$;

  -- The read-only role holds SELECT on whatever existed when it was provisioned.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'itacm_ai_ro') THEN
    EXECUTE 'GRANT SELECT ON ai.tickets, ai.problems, ai.changes TO itacm_ai_ro';
  END IF;
END $$;
