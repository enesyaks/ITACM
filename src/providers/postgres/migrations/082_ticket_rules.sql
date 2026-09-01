-- Service-desk automation rules: "when a ticket is opened, if <conditions>
-- then <actions>". Rules are evaluated in `position` order at creation time
-- only — never on the edits they themselves make — so a rule can neither
-- cascade into another evaluation pass nor loop.
--
-- conditions: [{ field, op, value }]  — field/op validated in ticketRuleService
-- actions:    { setCategory, setPriority, setImpact, setUrgency,
--               setAssigneeUserId, addNote }
--
-- match_count / last_matched_at are bookkeeping: they answer "is this rule
-- actually doing anything?" without digging through the audit log.
CREATE TABLE IF NOT EXISTS ticket_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  position        INTEGER NOT NULL DEFAULT 0,
  match_all       BOOLEAN NOT NULL DEFAULT true,
  conditions      JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions         JSONB NOT NULL DEFAULT '{}'::jsonb,
  stop_on_match   BOOLEAN NOT NULL DEFAULT false,
  match_count     INTEGER NOT NULL DEFAULT 0,
  last_matched_at TIMESTAMPTZ,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_rules_order ON ticket_rules (position, created_at);
