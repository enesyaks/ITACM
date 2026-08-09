const { query } = require('./pool');
const { HttpError } = require('../../utils/httpError');

function normalizeSerial(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** IMEI — strip spaces/dashes; empty → null. Digits-only when provided. */
function normalizeImei(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const digits = String(value).replace(/[\s\-]/g, "").trim();
  return digits === "" ? null : digits;
}

function assertImeiFormat(imei) {
  const v = normalizeImei(imei);
  if (v == null) return null;
  if (!/^\d{14,16}$/.test(v)) {
    throw HttpError.badRequest("IMEI must be 14–16 digits", { code: "INVALID_IMEI" });
  }
  return v;
}

async function findSerialOwner(serialNumber, { excludeId, client } = {}) {
  const sn = normalizeSerial(serialNumber);
  if (!sn) return null;
  const run = client ? client.query.bind(client) : query;
  const params = [sn];
  let sql =
    "SELECT id, asset_tag FROM assets WHERE lower(btrim(serial_number)) = lower(btrim($1::text))";
  if (excludeId) {
    sql += " AND id <> $2";
    params.push(excludeId);
  }
  sql += " LIMIT 1";
  const { rows } = await run(sql, params);
  return rows[0] || null;
}

async function assertSerialAvailable(serialNumber, opts = {}) {
  const owner = await findSerialOwner(serialNumber, opts);
  if (!owner) return;
  throw HttpError.conflict("This serial number is already registered", {
    code: "DUPLICATE_SERIAL",
    assetId: owner.id,
    assetTag: owner.asset_tag,
  });
}

/** Match against primary or secondary IMEI on any asset. */
async function findImeiOwner(imei, { excludeId, client } = {}) {
  const v = normalizeImei(imei);
  if (!v) return null;
  const run = client ? client.query.bind(client) : query;
  const params = [v];
  // The OR MUST be parenthesised: `a OR b AND id <> $2` binds as
  // `a OR (b AND id <> $2)`, so without the parens the imei branch never
  // excluded the asset itself — editing a phone reported its own IMEI as a
  // duplicate.
  let sql =
    "SELECT id, asset_tag FROM assets WHERE (lower(btrim(imei)) = lower(btrim($1::text)) "
    + "OR lower(btrim(imei2)) = lower(btrim($1::text)))";
  if (excludeId) {
    sql += " AND id <> $2";
    params.push(excludeId);
  }
  sql += " LIMIT 1";
  const { rows } = await run(sql, params);
  return rows[0] || null;
}

async function assertImeiAvailable(imei, opts = {}) {
  const owner = await findImeiOwner(imei, opts);
  if (!owner) return;
  throw HttpError.conflict("This IMEI is already registered", {
    code: "DUPLICATE_IMEI",
    assetId: owner.id,
    assetTag: owner.asset_tag,
  });
}

/** Reject when primary and secondary IMEI on the same payload are identical. */
function assertImeiPairDistinct(imei, imei2) {
  const a = normalizeImei(imei);
  const b = normalizeImei(imei2);
  if (a && b && a === b) {
    throw HttpError.badRequest("Primary and secondary IMEI must be different", {
      code: "DUPLICATE_IMEI_PAIR",
    });
  }
}

function conflictFromUniqueViolation(err, data) {
  const hay = (String(err.constraint || "") + " " + String(err.detail || "")).toLowerCase();
  if (hay.includes("imei")) {
    throw HttpError.conflict("This IMEI is already registered", {
      code: "DUPLICATE_IMEI",
      imei: data.imei ?? data.imei2 ?? null,
      assetTag: data.asset_tag ?? null,
    });
  }
  if (hay.includes("serial")) {
    throw HttpError.conflict("This serial number is already registered", {
      code: "DUPLICATE_SERIAL",
      serialNumber: data.serial_number ?? null,
      assetTag: data.asset_tag ?? null,
    });
  }
  const tag = data.asset_tag != null ? String(data.asset_tag) : "";
  throw HttpError.conflict(`Asset tag "${tag}" is already registered`);
}

module.exports = {
  normalizeSerial,
  normalizeImei,
  assertImeiFormat,
  assertImeiPairDistinct,
  assertSerialAvailable,
  assertImeiAvailable,
  conflictFromUniqueViolation,
};
