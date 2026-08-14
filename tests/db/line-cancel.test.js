/**
 * Cancelling a mobile line must detach it from its holder.
 *
 * The line status is edited through the generic update form (Active / Suspended
 * / Cancelled). "Cancelled" is terminal — a cancelled line can never be
 * assigned again (assignLine requires 'Active') — so leaving current_employee_id
 * set kept a dead number on the employee's profile forever. This is the
 * regression guard for that.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

test('mobile line cancellation', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const lineService = require('../../src/providers/postgres/lineService');

  async function assignedLine() {
    const emp = await db.makeEmployee();
    const line = await db.makeLine();
    await lineService.assignLine(line.id, emp.id, db.IT_USER);
    return { emp, line };
  }

  await t.test('cancelling drops the line off its holder', async () => {
    const { emp, line } = await assignedLine();
    const updated = await lineService.updateLine(line.id, { status: 'Cancelled' }, db.IT_USER);

    assert.equal(updated.status, 'Cancelled');
    assert.equal(updated.currentEmployeeId ?? updated.current_employee_id ?? null, null,
      'a cancelled line must not stay attached to the employee');

    const { rows: [row] } = await query(
      'SELECT current_employee_id, current_employee_name FROM mobile_lines WHERE id = $1', [line.id]
    );
    assert.equal(row.current_employee_id, null);
    assert.equal(row.current_employee_name, null);

    // The employee's line list no longer includes it.
    const { rows: [c] } = await query(
      'SELECT count(*)::int AS c FROM mobile_lines WHERE current_employee_id = $1', [emp.id]
    );
    assert.equal(c.c, 0);
  });

  await t.test('the handback is written to the line history', async () => {
    const { emp, line } = await assignedLine();
    await lineService.updateLine(line.id, { status: 'Cancelled' }, db.IT_USER);

    const { rows } = await query(
      `SELECT action_type, employee_id FROM mobile_line_history
        WHERE line_id = $1 AND action_type = 'line_unassigned'`, [line.id]
    );
    assert.equal(rows.length, 1, 'cancelling an assigned line must log the handback');
    assert.equal(rows[0].employee_id, emp.id);
  });

  await t.test('cancelling an unassigned line is fine and logs nothing', async () => {
    const line = await db.makeLine();
    const updated = await lineService.updateLine(line.id, { status: 'Cancelled' }, db.IT_USER);
    assert.equal(updated.status, 'Cancelled');

    const { rows: [h] } = await query(
      "SELECT count(*)::int AS c FROM mobile_line_history WHERE line_id = $1 AND action_type = 'line_unassigned'",
      [line.id]
    );
    assert.equal(h.c, 0, 'no holder → no handback record');
  });

  await t.test('a plain edit (rename operator) leaves the holder intact', async () => {
    const { emp, line } = await assignedLine();
    await lineService.updateLine(line.id, { operator: 'Vodafone' }, db.IT_USER);

    const { rows: [row] } = await query(
      'SELECT operator, current_employee_id FROM mobile_lines WHERE id = $1', [line.id]
    );
    assert.equal(row.operator, 'Vodafone');
    assert.equal(row.current_employee_id, emp.id, 'a non-cancel update must not detach the line');
  });

  await t.test('a suspended line stays with its holder (only Cancelled detaches)', async () => {
    const { emp, line } = await assignedLine();
    await lineService.updateLine(line.id, { status: 'Suspended' }, db.IT_USER);

    const { rows: [row] } = await query(
      'SELECT status, current_employee_id FROM mobile_lines WHERE id = $1', [line.id]
    );
    assert.equal(row.status, 'Suspended');
    assert.equal(row.current_employee_id, emp.id, 'suspend is temporary — the line is still theirs');
  });
});
