/* API client + auth/session handling (local JWT). */
'use strict';

const Auth = {
  token: localStorage.getItem('itacm_token') || null,
  profile: JSON.parse(localStorage.getItem('itacm_profile') || 'null'),
  save(token, profile) {
    this.token = token;
    this.profile = profile;
    localStorage.setItem('itacm_token', token);
    localStorage.setItem('itacm_profile', JSON.stringify(profile));
  },
  clear() {
    this.token = null;
    this.profile = null;
    localStorage.removeItem('itacm_token');
    localStorage.removeItem('itacm_profile');
  },
  /** Legacy UI flags (now derived from IAM on the server). */
  can(perm) { return !!(this.profile && this.profile.permissions && this.profile.permissions[perm]); },
  /**
   * IAM resource+action check (from profile.iamPermissions).
   * Owner always allowed. Without an IAM list, falls back to role-derived flags only for known mappings.
   */
  canIam(resource, action) {
    if (!this.profile) return false;
    if (this.profile.role === 'Owner' || this.profile.permissions?.isOwner) return true;
    const list = this.profile.iamPermissions;
    if (!Array.isArray(list) || !list.length) {
      // Pre-IAM profile / offline: do not invent export rights
      if (action === 'export' || action === 'import') return false;
      return false;
    }
    return list.some((p) => p.resource === resource && p.action === action && p.allowed !== false);
  },
  /**
   * Ops check: exact action OR resource:manage (for read/create/update/delete/assign/unassign).
   * Never treats manage as export/import/view_confidential/view_*.
   */
  canIamOp(resource, action) {
    if (this.canIam(resource, action)) return true;
    const covered = ['read', 'create', 'update', 'delete', 'assign', 'unassign'];
    if (covered.includes(action) && this.canIam(resource, 'manage')) return true;
    return false;
  },
};

let AppConfig = { backend: 'postgres' };

async function loadAppConfig() {
  try {
    const res = await fetch('/api/config');
    const json = await res.json();
    if (json.success) AppConfig = json.data;
  } catch { /* offline default */ }
  return AppConfig;
}

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (Auth.token) headers.Authorization = 'Bearer ' + Auth.token;

  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let json = {};
  try { json = await res.json(); } catch { /* non-JSON */ }

  if (res.status === 401 && !path.startsWith('/auth/login')) {
    Auth.clear();
    window.dispatchEvent(new Event('itacm:logout'));
    throw new ApiError(401, json.error || 'Session expired');
  }
  if (!res.ok || json.success === false) {
    throw new ApiError(res.status, json.error || ('HTTP ' + res.status), json.details);
  }
  return json.data;
}

/* ---- login ---- */

async function loginWithPassword(email, password) {
  const data = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (data.mfaRequired) return data;
  Auth.token = data.token;
  const profile = await api('/auth/verify-token', { method: 'POST' });
  Auth.save(data.token, profile);
  return profile;
}

async function loginWithMfa({ mfaToken, code, backupCode }) {
  const body = { mfaToken };
  if (backupCode) body.backupCode = backupCode;
  else body.code = code;
  const data = await api('/auth/mfa/verify', { method: 'POST', body });
  Auth.token = data.token;
  const profile = await api('/auth/verify-token', { method: 'POST' });
  Auth.save(data.token, profile);
  return profile;
}

async function logout() {
  try {
    if (Auth.token) await api('/auth/logout', { method: 'POST' });
  } catch { /* still clear locally */ }
  Auth.clear();
  window.dispatchEvent(new Event('itacm:logout'));
}

/** Normalize employee list API ({ items, total } or legacy array). */
function employeeList(data) {
  if (Array.isArray(data)) return { items: data, total: data.length };
  return data || { items: [], total: 0 };
}
