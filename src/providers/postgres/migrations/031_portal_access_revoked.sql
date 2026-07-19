-- Allow portal revoke audit action used by revokePortalAccess().
ALTER TABLE user_admin_logs DROP CONSTRAINT IF EXISTS user_admin_logs_action_check;
ALTER TABLE user_admin_logs
  ADD CONSTRAINT user_admin_logs_action_check
  CHECK (action IN (
    'disabled',
    'enabled',
    'deleted',
    'role_changed',
    'ownership_granted',
    'ownership_transferred',
    'portal_access_granted',
    'portal_access_reset',
    'portal_access_revoked'
  ));
