const { query } = require('./pool');
const { HttpError } = require('../../utils/httpError');

function normalizeSerial(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
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

function conflictFromUniqueViolation(err, data) {
  const hay = (String(err.constraint || "") + " " + String(err.detail || "")).toLowerCase();
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
  assertSerialAvailable,
  conflictFromUniqueViolation,
};
