-- Revoke all JWT sessions for a user after password change (compared to token iat).
ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_revoked_at TIMESTAMPTZ;
