'use strict';

/**
 * Service-request templates. Each template carries an ordered approval chain of
 * org levels (resolved at request time via orgService.resolveApprover). Employees
 * pick a template in the portal; the request then routes through those approvers
 * before the service desk fulfils it.
 */
const { query } = require('./pool');
const { mapRow, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

// Approval levels that resolveApprover understands.
const LEVELS = new Set(['manager', 'manager2', 'department']);

// An element is an org-level string ('manager') → single-approver step, or an
// object { levels:[...], mode:'any'|'all' } → parallel step.
function cleanLevels(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const el of input.slice(0, 5)) {
    if (el && typeof el === 'object' && Array.isArray(el.levels)) {
      const levels = el.levels.map(String).filter((l) => LEVELS.has(l));
      if (levels.length) out.push({ levels, mode: el.mode === 'all' ? 'all' : 'any' });
    } else if (LEVELS.has(String(el))) {
      out.push(String(el));
    }
  }
  return out;
}

async function listTemplates({ enabledOnly = false } = {}) {
  const { rows } = await query(
    `SELECT id, name, description, category, approval_levels AS "approvalLevels", enabled, sort_order AS "sortOrder", created_at AS "createdAt"
       FROM request_templates ${enabledOnly ? 'WHERE enabled = true' : ''}
      ORDER BY sort_order, name`
  );
  return mapRows(rows);
}

async function getTemplate(id) {
  if (!isUuid(id)) throw HttpError.notFound('Template not found');
  const { rows } = await query('SELECT * FROM request_templates WHERE id = $1', [id]);
  if (!rows[0]) throw HttpError.notFound('Template not found');
  return mapRow(rows[0]);
}

async function createTemplate(body) {
  const name = String((body && body.name) || '').trim().slice(0, 160);
  if (!name) throw HttpError.badRequest('A template name is required');
  const { rows } = await query(
    `INSERT INTO request_templates (name, description, category, approval_levels, enabled, sort_order)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING id`,
    [name,
      body.description ? String(body.description).trim().slice(0, 2000) : null,
      body.category ? String(body.category).trim().slice(0, 120) : null,
      JSON.stringify(cleanLevels(body.approvalLevels)),
      body.enabled !== false,
      Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0]
  );
  return getTemplate(rows[0].id);
}

async function updateTemplate(id, body) {
  await getTemplate(id);
  const sets = [];
  const vals = [];
  const set = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
  if (body.name !== undefined) { const n = String(body.name).trim().slice(0, 160); if (!n) throw HttpError.badRequest('A template name is required'); set('name', n); }
  if (body.description !== undefined) set('description', body.description ? String(body.description).trim().slice(0, 2000) : null);
  if (body.category !== undefined) set('category', body.category ? String(body.category).trim().slice(0, 120) : null);
  if (body.approvalLevels !== undefined) set('approval_levels', JSON.stringify(cleanLevels(body.approvalLevels)));
  if (body.enabled !== undefined) set('enabled', !!body.enabled);
  if (body.sortOrder !== undefined) set('sort_order', Number(body.sortOrder) || 0);
  if (sets.length) { vals.push(id); await query(`UPDATE request_templates SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals); }
  return getTemplate(id);
}

async function deleteTemplate(id) {
  if (!isUuid(id)) throw HttpError.notFound('Template not found');
  await query('DELETE FROM request_templates WHERE id = $1', [id]);
  return { id, deleted: true };
}

module.exports = { listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, LEVELS };
