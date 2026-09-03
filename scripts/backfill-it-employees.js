#!/usr/bin/env node
/**
 * Give every IT-role login the employee row the approval engine routes on.
 *
 * `role:it` approval steps resolve by joining users to employees on email
 * (approvalService.resolveRoleApprovers). Accounts created through the admin UI
 * already get that twin — createItUser() and upsertAdminTx() both call
 * ensureEmployeeForEmail(). Seeded, imported and restored installs can carry IT
 * logins that predate the twin, and those users are invisible to the step: the
 * chain silently drops to whatever else resolves.
 *
 * Prints what it would do and changes nothing until you pass --apply.
 *
 *   node scripts/backfill-it-employees.js
 *   node scripts/backfill-it-employees.js --apply
 */
require('dotenv').config();
const { pool, query } = require('../src/providers/postgres/pool');
const { ensureEmployeeForEmail } = require('../src/providers/postgres/employeeService');

// Mirrors approvalService.IT_TEAM_ROLES — the roles a `role:it` step accepts.
const IT_TEAM_ROLES = ['Owner', 'Admin', 'Helpdesk'];

(async () => {
  const apply = process.argv.includes('--apply');

  const { rows } = await query(
    `SELECT u.username, u.email, u.role
       FROM users u
      WHERE u.role = ANY($1)
        AND u.status <> 'Disabled'
        AND NOT EXISTS (SELECT 1 FROM employees e WHERE lower(e.email) = lower(u.email))
      ORDER BY u.role, u.email`,
    [IT_TEAM_ROLES]
  );

  if (!rows.length) {
    console.log('Every IT-role login already has an employee row. Nothing to do.');
    await pool.end();
    return;
  }

  console.log(`${rows.length} IT-role login(s) without an employee row:\n`);
  for (const u of rows) console.log(`  ${u.role.padEnd(9)} ${u.email}`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to create these rows.');
    await pool.end();
    return;
  }

  console.log('');
  let made = 0;
  for (const u of rows) {
    // Same call the admin UI makes, so a row created here is indistinguishable
    // from one the app would have made itself.
    const emp = await ensureEmployeeForEmail({
      fullName: u.username, email: u.email, department: 'IT', title: u.role,
    }).catch((err) => { console.warn(`  FAILED ${u.email}: ${err.message}`); return null; });
    if (emp) { made += 1; console.log(`  created  ${u.email} -> ${emp.fullName || emp.full_name}`); }
  }
  console.log(`\n${made} employee row(s) created. \`role:it\` approval steps can now route to them.`);
  await pool.end();
})().catch((err) => { console.error(err.message); process.exit(1); });
