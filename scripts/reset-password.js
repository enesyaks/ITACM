#!/usr/bin/env node
/**
 * Owner / IT-user password + MFA recovery — SERVER-SIDE ONLY.
 *
 * There is deliberately NO network "forgot password" endpoint (that would be an
 * unauthenticated attack surface). Recovery requires shell access to the box /
 * container, which is itself proof you are the legitimate operator.
 *
 * Resets a user's password (forces a change on next login) and, with --clear-mfa,
 * removes their TOTP so a locked-out Owner who lost their authenticator can get
 * back in. Owner MFA is mandatory, so after --clear-mfa the Owner is prompted to
 * re-enrol on the next login.
 *
 * Usage (inside the running stack):
 *   docker compose exec api npm run reset-password -- owner@example.com
 *   docker compose exec api npm run reset-password -- owner@example.com --clear-mfa
 *   docker compose exec api npm run reset-password -- owner@example.com --password 'NewStrongPass123'
 *
 * Local (non-Docker), with DATABASE_URL set:
 *   npm run reset-password -- owner@example.com --clear-mfa
 */
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, query } = require('../src/providers/postgres/pool');

function parseArgs(argv) {
  const out = { email: null, clearMfa: false, password: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--clear-mfa') out.clearMfa = true;
    else if (a === '--password') out.password = argv[++i];
    else if (a.startsWith('--password=')) out.password = a.slice('--password='.length);
    else if (!a.startsWith('--') && !out.email) out.email = a.trim().toLowerCase();
  }
  return out;
}

/** URL-safe, no-ambiguous-chars temp password (~20 chars, well over the 8 min). */
function genPassword() {
  return crypto.randomBytes(15).toString('base64').replace(/[+/=]/g, '').slice(0, 18) + 'A9';
}

async function main() {
  const { email, clearMfa, password } = parseArgs(process.argv.slice(2));
  if (!email) {
    console.error('Usage: npm run reset-password -- <email> [--clear-mfa] [--password <newpass>]');
    process.exit(1);
  }
  if (password != null && String(password).length < 8) {
    console.error('[reset] --password must be at least 8 characters.');
    process.exit(1);
  }

  const { rows } = await query(
    'SELECT id, email, username, role, status FROM users WHERE lower(email) = $1',
    [email]
  );
  const user = rows[0];
  if (!user) {
    console.error(`[reset] No user found with email: ${email}`);
    process.exit(1);
  }

  const newPassword = password || genPassword();
  const hash = await bcrypt.hash(newPassword, 12);

  // Reset password, force a change on next login, re-enable the account, and
  // revoke every existing session (sessions_revoked_at). Clear MFA on request.
  const sets = [
    'password_hash = $2',
    'must_change_password = true',
    "status = 'Active'",
    "sessions_revoked_at = now()",
  ];
  if (clearMfa) {
    sets.push('mfa_enabled = false', 'mfa_secret = NULL', "mfa_backup_hashes = '{}'", 'mfa_pending_secret = NULL');
  }
  await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, [user.id, hash]);

  console.log('='.repeat(64));
  console.log(`[reset] Password reset for ${user.username || ''} <${user.email}> (${user.role}).`);
  if (password) {
    console.log('[reset] New password: (the one you supplied)');
  } else {
    console.log(`[reset] Temporary password: ${newPassword}`);
  }
  console.log('[reset] The user must change it on next login.');
  if (clearMfa) console.log('[reset] MFA was cleared — an Owner will be asked to re-enrol MFA on next login.');
  console.log('[reset] All existing sessions were revoked.');
  console.log('='.repeat(64));
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('[reset] failed:', err.message);
  process.exit(1);
});
