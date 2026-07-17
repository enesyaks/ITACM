-- Allow ownership hand-off audit actions used by transferOwnership().
ALTER TABLE user_admin_logs DROP CONSTRAINT IF EXISTS user_admin_logs_action_check;
ALTER TABLE user_admin_logs
  ADD CONSTRAINT user_admin_logs_action_check
  CHECK (action IN (
    'disabled',
    'enabled',
    'deleted',
    'role_changed',
    'ownership_granted',
    'ownership_transferred'
  ));
