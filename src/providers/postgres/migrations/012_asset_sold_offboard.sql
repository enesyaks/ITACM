-- Sold status for disposed assets + history actions for offboarding.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_status_check;
ALTER TABLE assets ADD CONSTRAINT assets_status_check
  CHECK (status IN ('In Stock', 'Assigned', 'In Repair', 'Scrap', 'Sold'));

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
    'status_changed',
    'sold'
  ));
