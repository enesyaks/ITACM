'use strict';

/**
 * Persistent per-user in-app notifications (the bell menu). Kept deliberately
 * small: create one, list a user's recent ones, count unread, and mark read.
 * Creation is best-effort at the call sites (a failed notification must never
 * break the action that triggered it).
 */
const { query } = require('./pool');
const { mapRows, isUuid } = require('./rowMapper');

const LIST_COLS = 'id, type, title, body, link, read_at AS "readAt", created_at AS "createdAt"';

/** Create a notification for a specific user. Returns the row or null. */
async function create({ userId, type, title, body = null, link = null }) {
  if (!isUuid(userId) || !title) return null;
  const { rows } = await query(
    `INSERT INTO notifications (user_id, type, title, body, link)
     VALUES ($1,$2,$3,$4,$5) RETURNING ${LIST_COLS}`,
    [userId, String(type || 'info').slice(0, 60), String(title).slice(0, 300),
      body ? String(body).slice(0, 2000) : null, link ? String(link).slice(0, 300) : null]
  );
  return rows[0] || null;
}

/** Resolve an employee to their login (by email) and notify that user.
 *  If the payload carries a `linkPortal`, portal recipients get that link
 *  instead of `link` (staff-only views like #/approvals aren't reachable
 *  from the portal, so the router would bounce them to the home page). */
async function createForEmployee(employeeId, payload) {
  if (!isUuid(employeeId)) return null;
  const { rows } = await query(
    `SELECT u.id, u.role FROM employees e JOIN users u ON lower(u.email) = lower(e.email) WHERE e.id = $1 LIMIT 1`,
    [employeeId]
  );
  if (!rows[0]) return null;
  const { linkPortal, ...rest } = payload;
  const link = (rows[0].role === 'Portal' && linkPortal) ? linkPortal : rest.link;
  return create({ ...rest, link, userId: rows[0].id });
}

async function listForUser(userId, { limit = 30, unreadOnly = false } = {}) {
  if (!isUuid(userId)) return [];
  const { rows } = await query(
    `SELECT ${LIST_COLS} FROM notifications
      WHERE user_id = $1 ${unreadOnly ? 'AND read_at IS NULL' : ''}
      ORDER BY created_at DESC LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 30, 1), 100)]
  );
  return mapRows(rows);
}

async function unreadCount(userId) {
  if (!isUuid(userId)) return 0;
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]);
  return rows[0] ? rows[0].n : 0;
}

async function markRead(id, userId) {
  if (!isUuid(id) || !isUuid(userId)) return { updated: 0 };
  const { rowCount } = await query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL', [id, userId]);
  return { updated: rowCount };
}

async function markAllRead(userId) {
  if (!isUuid(userId)) return { updated: 0 };
  const { rowCount } = await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
  return { updated: rowCount };
}

/**
 * Retention: bound the notifications table so it can't grow forever. Removes
 * READ notifications older than 30 days, and ANY notification older than 90 days
 * (unread ones that stale out). Returns how many rows were deleted.
 */
async function pruneOld() {
  const { rowCount } = await query(
    `DELETE FROM notifications
       WHERE (read_at IS NOT NULL AND created_at < now() - interval '30 days')
          OR (created_at < now() - interval '90 days')`
  );
  return rowCount || 0;
}

module.exports = { create, createForEmployee, listForUser, unreadCount, markRead, markAllRead, pruneOld };
