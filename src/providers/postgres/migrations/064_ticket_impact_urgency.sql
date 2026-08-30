-- ITIL prioritization: priority is derived from Impact × Urgency. Both nullable
-- for tickets created before this (their stored priority stays authoritative
-- until impact/urgency are set).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS impact  TEXT CHECK (impact  IN ('low', 'medium', 'high'));
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS urgency TEXT CHECK (urgency IN ('low', 'medium', 'high'));
