-- Expand asset history for Network/Server (and general inventory) lifecycle events.
ALTER TABLE asset_history DROP CONSTRAINT IF EXISTS asset_history_action_type_check;
ALTER TABLE asset_history ADD CONSTRAINT asset_history_action_type_check
  CHECK (action_type IN (
    'assigned',
    'returned',
    'sent_to_repair',
    'repair_update',
    'created',
    'updated',
    'placed',
    'responsible_changed',
    'status_changed'
  ));
