/**
 * Penetration tests: what a low-privileged identity can reach.
 *
 * Written as a hostile caller, not as the app. Every case asks "if I hold this
 * role and I know a UUID I am not supposed to know, what happens?" — because a
 * ticket id travels in mail links, in URLs and over shoulders, and the answer
 * must not depend on the caller not having seen one.
 *
 * The service layer is called directly: the HTTP layer's requirePermission is
 * one gate, and a check that lives ONLY there is one route away from being
 * missed. What is pinned here is the second gate — row ownership — which is the
 * one that has to hold when a route is added tomorrow.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

test('privilege boundaries', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const svc = require('../../src/providers/postgres/ticketService');
  const perm = require('../../src/providers/postgres/permissionService');
  const { isHrAllowedPath } = require('../../src/utils/hrPolicy');
  const { isPortalAllowedPath } = require('../../src/utils/portalPolicy');

  const { rows: [ownerRow] } = await query('SELECT id, username, email FROM users ORDER BY created_at LIMIT 1');
  const OWNER = { uid: ownerRow.id, id: ownerRow.id, username: ownerRow.username, email: ownerRow.email, role: 'Owner' };

  let n = 0;
  /** A login of the given role, wired to its own employee record. */
  const makeActor = async (role) => {
    n += 1;
    const email = `pt_${role.toLowerCase()}_${Date.now()}_${n}@test.local`;
    const emp = await db.makeEmployee({ email });
    const { rows: [u] } = await query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, 'not-a-real-hash', $3) RETURNING id`,
      [`pt_${role}_${Date.now()}_${n}`, email, role]
    );
    return { user: { uid: u.id, id: u.id, username: `pt_${role}`, email, role }, emp };
  };

  const victimTicket = async () => {
    const victim = await db.makeEmployee();
    const tk = await svc.createTicket(
      { subject: `Gizli ${Date.now()}${Math.random()}`, description: 'iç bilgi' },
      OWNER, { asEmployee: victim }
    );
    return { tk, victim };
  };

  /* ---------------- HR: the role whose reach widened today ---------------- */

  await t.test('HR cannot read a ticket that is not its own, knowing the id', async () => {
    const hr = await makeActor('HR');
    const { tk } = await victimTicket();
    await assert.rejects(() => svc.getMyTicket(tk.id, hr.user), (e) => e.status === 403,
      'a ticket id is not a capability');
  });

  await t.test('HR cannot comment on somebody else\'s ticket', async () => {
    const hr = await makeActor('HR');
    const { tk } = await victimTicket();
    await assert.rejects(() => svc.addMyComment(tk.id, { body: 'merhaba' }, hr.user),
      (e) => e.status === 403);
  });

  await t.test('HR cannot rate somebody else\'s resolved ticket', async () => {
    const hr = await makeActor('HR');
    const { tk } = await victimTicket();
    await query(
      "UPDATE tickets SET impact='low', category='X', assignee_user_id=$2, status='resolved', resolved_at=now() WHERE id=$1",
      [tk.id, ownerRow.id]
    );
    await assert.rejects(() => svc.submitMyCsat(tk.id, { score: 1 }, hr.user), (e) => e.status === 403);
  });

  await t.test('HR sees only its own tickets in the self-service list', async () => {
    const hr = await makeActor('HR');
    const { tk } = await victimTicket();
    const mine = await svc.createTicket({ subject: 'Kendi talebim' }, OWNER, { asEmployee: hr.emp });
    const list = await svc.listMyTickets(hr.user);
    const ids = list.map((x) => x.id);
    assert.ok(ids.includes(mine.id), 'its own ticket is there');
    assert.ok(!ids.includes(tk.id), 'and nobody else\'s');
  });

  await t.test('HR holds no staff ticket permission at all', async () => {
    const hr = await makeActor('HR');
    for (const [res, act] of [['ticket', 'read'], ['ticket', 'update'], ['ticket', 'assign'],
      ['asset', 'read'], ['employee', 'read'], ['settings', 'read'], ['user_management', 'read'],
      ['audit', 'read'], ['integration', 'manage']]) {
      assert.equal(await perm.checkPermission(hr.user, res, act), false, `${res}:${act} must stay denied`);
    }
    assert.equal(await perm.checkPermission(hr.user, 'hr_request', 'create'), true, 'its own screen still works');
  });

  await t.test('the HR path allow-list still covers only self-service and HR', async () => {
    for (const p of ['/api/me/tickets', '/api/me/kb', '/api/me/notifications', '/api/hr/requests', '/api/config']) {
      assert.equal(isHrAllowedPath(p), true, `${p} is what the HR screens call`);
    }
    for (const p of ['/api/tickets', '/api/tickets/x/links', '/api/assets', '/api/employees',
      '/api/users', '/api/settings', '/api/audit', '/api/integrations/notifications',
      '/api/mex/tickets',
      // A prefix test is only as honest as the string it is given.
      '/api/me/../tickets', '/api/me/..%2ftickets', '/api/me/%2e%2e/tickets',
      '/api/me/%252e%252e/tickets', '/api/hr/../settings', '/api/me/./../users']) {
      assert.equal(isHrAllowedPath(p), false, `${p} must stay out of reach`);
    }
  });

  /* ---------------- Portal: the untrusted self-service login ---------------- */

  await t.test('Portal cannot read or touch a ticket that is not its own', async () => {
    const p = await makeActor('Portal');
    const { tk } = await victimTicket();
    await assert.rejects(() => svc.getMyTicket(tk.id, p.user), (e) => e.status === 403);
    await assert.rejects(() => svc.addMyComment(tk.id, { body: 'x' }, p.user), (e) => e.status === 403);
  });

  await t.test('the Portal path allow-list did not widen when HR gained these screens', async () => {
    for (const path of ['/api/tickets', '/api/hr/requests', '/api/assets', '/api/employees', '/api/settings']) {
      assert.equal(isPortalAllowedPath(path), false, `${path} must stay out of reach`);
    }
    assert.equal(isPortalAllowedPath('/api/me/tickets'), true);
  });

  await t.test('a self-service reader never receives internal notes or the activity log', async () => {
    const p = await makeActor('Portal');
    const tk = await svc.createTicket({ subject: 'Kendi' }, OWNER, { asEmployee: p.emp });
    await svc.addComment(tk.id, { body: 'DAHILI NOT', internal: true }, OWNER);
    await svc.addComment(tk.id, { body: 'herkese acik' }, OWNER);

    const view = await svc.getMyTicket(tk.id, p.user);
    const bodies = (view.comments || []).map((c) => c.body);
    assert.ok(!bodies.some((b) => /DAHILI/.test(b)), 'an internal note must never reach the requester');
    assert.ok(bodies.some((b) => /herkese acik/.test(b)));
    assert.equal(view.activity, undefined, 'nor the desk\'s own audit trail');
  });

  /* ---------------- Today's new write paths ---------------- */

  await t.test('linking cannot hand an assignee to somebody who may not assign', async () => {
    // A Helpdesk login with ticket:update but NOT ticket:assign.
    const agent = await makeActor('Helpdesk');
    assert.equal(await perm.hasResourceAction(agent.user, 'ticket', 'update'), true);
    const canAssign = await perm.hasResourceAction(agent.user, 'ticket', 'assign');

    const emp = await db.makeEmployee();
    const master = await svc.createTicket({ subject: 'Ana' }, OWNER, { asEmployee: emp });
    const dup = await svc.createTicket({ subject: 'Kopya' }, OWNER, { asEmployee: emp });
    await query('UPDATE tickets SET assignee_user_id = $2 WHERE id = $1', [master.id, ownerRow.id]);

    await svc.linkTickets(master.id, [dup.id], agent.user);

    const child = await svc.getTicket(dup.id, OWNER);
    if (!canAssign) {
      assert.equal(child.assigneeUserId, null, 'an owner must not travel through a caller who may not assign');
    } else {
      assert.equal(child.assigneeUserId, ownerRow.id);
    }
    assert.equal(child.linkedToNumber, master.number, 'the link itself still holds either way');
  });

  await t.test('a link cycle cannot be turned into an endless cascade', async () => {
    // linkTickets refuses to build one (a master may not itself be linked), but
    // it is not one transaction, so two simultaneous calls could in principle
    // leave A -> B -> A. Carrying fields down is recursive, so the cycle is
    // written here by hand and the recursion has to end on its own.
    const emp = await db.makeEmployee();
    const a1 = await svc.createTicket({ subject: 'A' }, OWNER, { asEmployee: emp });
    const b1 = await svc.createTicket({ subject: 'B' }, OWNER, { asEmployee: emp });
    await query('UPDATE tickets SET linked_to_id = $2 WHERE id = $1', [b1.id, a1.id]);
    await query('UPDATE tickets SET linked_to_id = $2 WHERE id = $1', [a1.id, b1.id]);

    const done = await Promise.race([
      svc.updateTicket(a1.id, { impact: 'high', urgency: 'high', category: 'Ag' }, OWNER).then(() => 'returned'),
      new Promise((r) => setTimeout(() => r('HUNG'), 10000)),
    ]);
    assert.equal(done, 'returned', 'the cascade converges instead of ping-ponging');

    const after = await svc.getTicket(b1.id, OWNER);
    assert.equal(after.impact, 'high', 'and the other side of the cycle still took the change');
  });

  await t.test('a manager named on an HR ticket must be a real, active employee', async () => {
    const hrSvc = require('../../src/providers/postgres/hrRequestService');
    const gone = await db.makeEmployee({ status: 'Inactive' });
    const live = await db.makeEmployee();
    const base = {
      fullName: 'Yeni Personel', eventDate: '2026-10-01', items: [{ category: 'Laptop', qty: 1 }],
    };
    await assert.rejects(
      () => hrSvc.createOnboardRequest({ ...base, managerEmployeeId: gone.id }, OWNER),
      (e) => e.status === 400, 'somebody who has left cannot be handed a new report'
    );
    await assert.rejects(
      () => hrSvc.createOnboardRequest({ ...base, managerEmployeeId: '11111111-1111-1111-1111-111111111111' }, OWNER),
      (e) => e.status === 400, 'nor a uuid that is nobody'
    );
    const ok = await hrSvc.createOnboardRequest({ ...base, managerEmployeeId: live.id }, OWNER);
    assert.equal(ok.managerEmployeeId, live.id);
  });
});
