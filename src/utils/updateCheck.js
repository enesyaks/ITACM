/**
 * Opt-in upstream update check.
 *
 * When UPDATE_CHECK is enabled the server asks the GitHub Releases API — at most
 * once a day — whether a release newer than the running version exists, and
 * caches the answer in memory. The result is surfaced to the UI via /api/config
 * (`updateAvailable`) so the Owner can be told an update is out even before the
 * instance is upgraded. Disabled by default: offline / air-gapped installs never
 * make any outbound request.
 *
 * This module NEVER throws to callers and never blocks the request path — the
 * refresh is fire-and-forget; the endpoint always returns whatever is cached.
 */
const config = require('../config');

const DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

// In-memory cache. `latest` is the newest upstream version string (no leading
// "v"), or null when unknown / up to date.
const cache = { latest: null, checkedAt: 0, inFlight: false };

/** Compare dotted numeric versions. >0 a newer, <0 a older, 0 equal. */
function compareVersions(a, b) {
  const parts = (v) => String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Normalize a git tag ("v1.2.0", "release-1.2.0") to a bare version ("1.2.0"). */
function tagToVersion(tag) {
  const m = String(tag || '').match(/(\d+(?:\.\d+){1,3})/);
  return m ? m[1] : '';
}

async function fetchLatestRelease() {
  const url = `https://api.github.com/repos/${config.updateRepo}/releases/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'itacm-update-check',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (config.updateToken) headers.Authorization = `Bearer ${config.updateToken}`;
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) return '';
    const json = await res.json();
    return tagToVersion(json && json.tag_name);
  } catch {
    return ''; // network error / timeout / abort — stay silent
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kick off a refresh if the check is enabled and the cache is stale. Non-blocking:
 * returns immediately; the cache is updated when the fetch resolves.
 */
function maybeRefresh() {
  if (!config.updateCheck) return;
  if (cache.inFlight) return;
  if (cache.checkedAt && Date.now() - cache.checkedAt < DAY_MS) return;
  cache.inFlight = true;
  fetchLatestRelease()
    .then((version) => {
      cache.checkedAt = Date.now();
      cache.latest = version || null;
    })
    .catch(() => { cache.checkedAt = Date.now(); })
    .finally(() => { cache.inFlight = false; });
}

/**
 * Current update status for the UI. Triggers a lazy refresh and returns the
 * cached verdict. `updateAvailable` is the newer version string, or null.
 */
function getUpdateInfo() {
  if (!config.updateCheck) return { enabled: false, updateAvailable: null };
  maybeRefresh();
  const current = config.appVersion;
  const latest = cache.latest;
  const updateAvailable = latest && compareVersions(latest, current) > 0 ? latest : null;
  return { enabled: true, current, latest, updateAvailable };
}

module.exports = { getUpdateInfo, compareVersions, tagToVersion, _cache: cache };
