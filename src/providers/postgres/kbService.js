'use strict';

/**
 * Knowledge base for the service desk. Staff author articles; published ones are
 * searchable by employees in the portal (self-service deflection). Search is a
 * simple ILIKE over title/body/category — good enough for an SME-scale base.
 */
const { query } = require('./pool');
const { mapRow, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

const LIST_COLS = 'id, title, category, published, author_name AS "authorName", views, created_at AS "createdAt", updated_at AS "updatedAt"';

async function listArticles({ publishedOnly = false, search = '', category = '', limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (publishedOnly) where.push('published = true');
  if (category) { params.push(String(category).slice(0, 120)); where.push(`category = $${params.length}`); }
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim().slice(0, 160)}%`);
    const p = '$' + params.length;
    where.push(`(title ILIKE ${p} OR body ILIKE ${p} OR category ILIKE ${p})`);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
  const { rows } = await query(
    `SELECT ${LIST_COLS} FROM kb_articles ${whereSql} ORDER BY updated_at DESC LIMIT $${params.length}`,
    params
  );
  return mapRows(rows);
}

async function getArticle(id, { publishedOnly = false, countView = false } = {}) {
  if (!isUuid(id)) throw HttpError.notFound('Article not found');
  const { rows } = await query('SELECT * FROM kb_articles WHERE id = $1', [id]);
  const a = rows[0];
  if (!a || (publishedOnly && !a.published)) throw HttpError.notFound('Article not found');
  if (countView) query('UPDATE kb_articles SET views = views + 1 WHERE id = $1', [id]).catch(() => {});
  return mapRow(a);
}

async function createArticle(body, authorName) {
  const title = String((body && body.title) || '').trim().slice(0, 300);
  if (!title) throw HttpError.badRequest('A title is required');
  const { rows } = await query(
    `INSERT INTO kb_articles (title, body, category, published, author_name)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [title,
      body.body ? String(body.body).trim().slice(0, 40000) : null,
      body.category ? String(body.category).trim().slice(0, 120) : null,
      !!body.published, authorName || null]
  );
  return getArticle(rows[0].id);
}

async function updateArticle(id, body) {
  await getArticle(id);
  const sets = [];
  const vals = [];
  const set = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
  if (body.title !== undefined) { const tt = String(body.title).trim().slice(0, 300); if (!tt) throw HttpError.badRequest('A title is required'); set('title', tt); }
  if (body.body !== undefined) set('body', body.body ? String(body.body).trim().slice(0, 40000) : null);
  if (body.category !== undefined) set('category', body.category ? String(body.category).trim().slice(0, 120) : null);
  if (body.published !== undefined) set('published', !!body.published);
  if (sets.length) { set('updated_at', new Date()); vals.push(id); await query(`UPDATE kb_articles SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals); }
  return getArticle(id);
}

async function deleteArticle(id) {
  if (!isUuid(id)) throw HttpError.notFound('Article not found');
  await query('DELETE FROM kb_articles WHERE id = $1', [id]);
  return { id, deleted: true };
}

module.exports = { listArticles, getArticle, createArticle, updateArticle, deleteArticle };
