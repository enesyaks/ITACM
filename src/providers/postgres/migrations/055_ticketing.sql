-- ITIL service desk (optional module, off by default).
--
-- MVP: incidents + service requests, each with a worklog (comments) and an
-- activity trail. Categories/queues/SLA are plain fields for now; dedicated
-- tables come in a later phase. All additive and idempotent.

CREATE TABLE IF NOT EXISTS tickets (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number                 TEXT NOT NULL UNIQUE,
  type                   TEXT NOT NULL DEFAULT 'incident'
                           CHECK (type IN ('incident', 'request')),
  subject                TEXT NOT NULL,
  description            TEXT,
  status                 TEXT NOT NULL DEFAULT 'new'
                           CHECK (status IN ('new', 'open', 'in_progress', 'pending', 'resolved', 'closed', 'cancelled')),
  priority               TEXT NOT NULL DEFAULT 'medium'
                           CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  category               TEXT,
  requester_employee_id  UUID REFERENCES employees(id) ON DELETE SET NULL,
  requester_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  assignee_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  asset_id               UUID REFERENCES assets(id) ON DELETE SET NULL,
  created_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_name        TEXT,
  first_response_at      TIMESTAMPTZ,
  resolved_at            TIMESTAMPTZ,
  closed_at              TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_status    ON tickets (status, assignee_user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets (requester_employee_id);
CREATE INDEX IF NOT EXISTS idx_tickets_asset     ON tickets (asset_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created   ON tickets (created_at DESC);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name    TEXT,
  body           TEXT NOT NULL,
  internal       BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_comments ON ticket_comments (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS ticket_activity (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_activity ON ticket_activity (ticket_id, created_at);

-- Sequential per-type ticket numbers (INC-1001 / REQ-1001 …).
CREATE SEQUENCE IF NOT EXISTS ticket_incident_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS ticket_request_seq  START 1001;

-- Optional module toggle (off by default).
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ticketing_enabled BOOLEAN NOT NULL DEFAULT false;
