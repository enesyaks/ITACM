-- Editable ticket workflow: the allowed status transition map is no longer
-- hard-coded. Stored as { transitions: { <from>: [<to>, ...] } }; NULL/absent
-- means "use the built-in defaults" so existing installs keep today's behaviour.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ticket_workflow_json JSONB;
