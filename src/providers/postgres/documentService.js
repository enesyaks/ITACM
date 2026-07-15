/** Handover & maintenance document archive (filesystem + legacy BYTEA). */
const { query } = require('./pool');
const { mapRow, mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');
const docStorage = require('../../utils/docStorage');

function loadBuffer(row) {
  if (row.storage_path) {
    const buf = docStorage.readBuffer(row.storage_path);
    if (buf) return buf;
  }
  return row.content || null;
}

async function saveDocument({
  handoverId, employeeId, employeeName, kind, filename, mime, buffer, uploadedBy, uploadedByName,
}) {
  if (!employeeId || !filename || !buffer) {
    throw HttpError.badRequest('employeeId, filename and file content are required');
  }
  if (!isUuid(employeeId)) throw HttpError.notFound(`Employee ${employeeId} not found`);

  let resolvedName = (employeeName && String(employeeName).trim()) || null;
  if (!resolvedName) {
    const emp = await query('SELECT full_name FROM employees WHERE id = $1', [employeeId]);
    resolvedName = emp.rows[0] && emp.rows[0].full_name;
  }

  const { rows } = await query(
    `INSERT INTO handover_documents
       (handover_id, employee_id, employee_name, kind, filename, mime, byte_size, content, storage_path,
        uploaded_by, uploaded_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,$8,$9)
     RETURNING id`,
    [
      handoverId || null, employeeId, resolvedName || null, kind || 'scan',
      filename, mime || 'application/octet-stream', buffer.length,
      uploadedBy || null, uploadedByName || null,
    ]
  );
  const id = rows[0].id;
  let storagePath;
  try {
    storagePath = docStorage.writeBuffer('handover', id, buffer, {
      label: resolvedName || uploadedByName || 'handover',
      ownerId: employeeId,
      ownerLabel: resolvedName || uploadedByName || 'employee',
      originalFilename: filename,
    });
    await query('UPDATE handover_documents SET storage_path = $2 WHERE id = $1', [id, storagePath]);
  } catch (err) {
    await query('DELETE FROM handover_documents WHERE id = $1', [id]).catch(() => {});
    throw err;
  }

  return {
    id, handoverId: handoverId || null, employeeId, employeeName: resolvedName || null, kind: kind || 'scan',
    filename, mime: mime || 'application/octet-stream', byteSize: buffer.length,
    uploadedBy, uploadedByName, createdAt: new Date().toISOString(),
  };
}

async function listByEmployee(employeeId) {
  if (!isUuid(employeeId)) return [];
  const { rows } = await query(
    'SELECT id, handover_id, employee_id, employee_name, kind, filename, mime, byte_size, uploaded_by_name, created_at FROM handover_documents WHERE employee_id = $1 ORDER BY created_at DESC',
    [employeeId]
  );
  return mapRows(rows);
}

async function getDocument(docId) {
  if (!isUuid(docId)) throw HttpError.notFound(`Document ${docId} not found`);
  const { rows } = await query('SELECT * FROM handover_documents WHERE id = $1', [docId]);
  if (!rows[0]) throw HttpError.notFound(`Document ${docId} not found`);
  const buffer = loadBuffer(rows[0]);
  if (!buffer) throw HttpError.notFound(`Document file missing for ${docId}`);
  return { ...mapRow(rows[0]), buffer };
}

async function deleteDocument(docId) {
  if (!isUuid(docId)) throw HttpError.notFound(`Document ${docId} not found`);
  const { rows } = await query(
    'DELETE FROM handover_documents WHERE id = $1 RETURNING storage_path',
    [docId]
  );
  if (!rows[0]) throw HttpError.notFound(`Document ${docId} not found`);
  docStorage.deleteFile(rows[0].storage_path);
  return { id: docId, deleted: true };
}

/* ---- Maintenance repair paperwork ---- */

async function saveMaintenanceDoc({
  maintenanceId, assetId, assetTag, filename, mime, buffer, uploadedBy, uploadedByName,
}) {
  if (!assetId || !filename || !buffer) {
    throw HttpError.badRequest('assetId, filename and file content are required');
  }

  const { rows } = await query(
    `INSERT INTO maintenance_documents
       (maintenance_id, asset_id, asset_tag, filename, mime, byte_size, content, storage_path,
        uploaded_by, uploaded_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,$7,$8)
     RETURNING id`,
    [
      maintenanceId || null, assetId, assetTag || null,
      filename, mime || 'application/octet-stream', buffer.length,
      uploadedBy || null, uploadedByName || null,
    ]
  );
  const id = rows[0].id;
  let storagePath;
  try {
    storagePath = docStorage.writeBuffer('maintenance', id, buffer, {
      label: assetTag || uploadedByName || 'maintenance',
      ownerId: assetId,
      ownerLabel: assetTag || 'asset',
      originalFilename: filename,
    });
    await query('UPDATE maintenance_documents SET storage_path = $2 WHERE id = $1', [id, storagePath]);
  } catch (err) {
    await query('DELETE FROM maintenance_documents WHERE id = $1', [id]).catch(() => {});
    throw err;
  }

  return {
    id, maintenanceId: maintenanceId || null, assetId, assetTag, filename,
    mime: mime || 'application/octet-stream', byteSize: buffer.length,
    uploadedBy, uploadedByName, createdAt: new Date().toISOString(),
  };
}

async function listMaintenanceDocsByAsset(assetId) {
  if (!isUuid(assetId)) return [];
  const { rows } = await query(
    'SELECT id, maintenance_id, asset_id, asset_tag, filename, mime, byte_size, uploaded_by_name, created_at FROM maintenance_documents WHERE asset_id = $1 ORDER BY created_at DESC',
    [assetId]
  );
  return mapRows(rows);
}

async function listMaintenanceDocsByLog(maintenanceId) {
  if (!isUuid(maintenanceId)) return [];
  const { rows } = await query(
    'SELECT id, maintenance_id, asset_id, asset_tag, filename, mime, byte_size, uploaded_by_name, created_at FROM maintenance_documents WHERE maintenance_id = $1 ORDER BY created_at DESC',
    [maintenanceId]
  );
  return mapRows(rows);
}

async function getMaintenanceDoc(docId) {
  if (!isUuid(docId)) throw HttpError.notFound(`Document ${docId} not found`);
  const { rows } = await query('SELECT * FROM maintenance_documents WHERE id = $1', [docId]);
  if (!rows[0]) throw HttpError.notFound(`Document ${docId} not found`);
  const buffer = loadBuffer(rows[0]);
  if (!buffer) throw HttpError.notFound(`Document file missing for ${docId}`);
  return { ...mapRow(rows[0]), buffer };
}

async function deleteMaintenanceDoc(docId) {
  if (!isUuid(docId)) throw HttpError.notFound(`Document ${docId} not found`);
  const { rows } = await query(
    'DELETE FROM maintenance_documents WHERE id = $1 RETURNING storage_path',
    [docId]
  );
  if (!rows[0]) throw HttpError.notFound(`Document ${docId} not found`);
  docStorage.deleteFile(rows[0].storage_path);
  return { id: docId, deleted: true };
}

/* ---- Provider & contract paperwork ---- */

async function saveProviderDoc({
  providerId, providerName, filename, mime, buffer, uploadedBy, uploadedByName,
}) {
  if (!providerId || !filename || !buffer) {
    throw HttpError.badRequest('providerId, filename and file content are required');
  }
  if (!isUuid(providerId)) throw HttpError.notFound(`Provider ${providerId} not found`);

  const { rows } = await query(
    `INSERT INTO provider_documents
       (provider_id, provider_name, filename, mime, byte_size, content, storage_path,
        uploaded_by, uploaded_by_name)
     VALUES ($1,$2,$3,$4,$5,NULL,NULL,$6,$7)
     RETURNING id`,
    [
      providerId, providerName || null,
      filename, mime || 'application/octet-stream', buffer.length,
      uploadedBy || null, uploadedByName || null,
    ]
  );
  const id = rows[0].id;
  try {
    const storagePath = docStorage.writeBuffer('provider', id, buffer, {
      label: providerName || uploadedByName || 'provider',
      ownerId: providerId,
      ownerLabel: providerName || 'provider',
      originalFilename: filename,
    });
    await query('UPDATE provider_documents SET storage_path = $2 WHERE id = $1', [id, storagePath]);
  } catch (err) {
    await query('DELETE FROM provider_documents WHERE id = $1', [id]).catch(() => {});
    throw err;
  }

  return {
    id, providerId, providerName, filename,
    mime: mime || 'application/octet-stream', byteSize: buffer.length,
    uploadedBy, uploadedByName, createdAt: new Date().toISOString(),
  };
}

async function listProviderDocs(providerId) {
  if (!isUuid(providerId)) return [];
  const { rows } = await query(
    `SELECT id, provider_id, provider_name, filename, mime, byte_size,
            uploaded_by_name, created_at
     FROM provider_documents WHERE provider_id = $1 ORDER BY created_at DESC`,
    [providerId]
  );
  return mapRows(rows);
}

async function getProviderDoc(docId) {
  if (!isUuid(docId)) throw HttpError.notFound(`Document ${docId} not found`);
  const { rows } = await query('SELECT * FROM provider_documents WHERE id = $1', [docId]);
  if (!rows[0]) throw HttpError.notFound(`Document ${docId} not found`);
  const buffer = loadBuffer(rows[0]);
  if (!buffer) throw HttpError.notFound(`Document file missing for ${docId}`);
  return { ...mapRow(rows[0]), buffer };
}

async function deleteProviderDoc(docId) {
  if (!isUuid(docId)) throw HttpError.notFound(`Document ${docId} not found`);
  const { rows } = await query(
    'DELETE FROM provider_documents WHERE id = $1 RETURNING storage_path',
    [docId]
  );
  if (!rows[0]) throw HttpError.notFound(`Document ${docId} not found`);
  docStorage.deleteFile(rows[0].storage_path);
  return { id: docId, deleted: true };
}

async function saveContractDoc({
  contractId, providerId, contractTitle, providerName,
  filename, mime, buffer, uploadedBy, uploadedByName,
}) {
  if (!contractId || !providerId || !filename || !buffer) {
    throw HttpError.badRequest('contractId, providerId, filename and file content are required');
  }
  if (!isUuid(contractId) || !isUuid(providerId)) {
    throw HttpError.notFound('Contract or provider not found');
  }

  const { rows } = await query(
    `INSERT INTO contract_documents
       (contract_id, provider_id, contract_title, provider_name,
        filename, mime, byte_size, content, storage_path,
        uploaded_by, uploaded_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,$8,$9)
     RETURNING id`,
    [
      contractId, providerId, contractTitle || null, providerName || null,
      filename, mime || 'application/octet-stream', buffer.length,
      uploadedBy || null, uploadedByName || null,
    ]
  );
  const id = rows[0].id;
  try {
    const storagePath = docStorage.writeBuffer('contract', id, buffer, {
      label: contractTitle || providerName || uploadedByName || 'contract',
      ownerId: providerId,
      ownerLabel: providerName || 'provider',
      originalFilename: filename,
    });
    await query('UPDATE contract_documents SET storage_path = $2 WHERE id = $1', [id, storagePath]);
  } catch (err) {
    await query('DELETE FROM contract_documents WHERE id = $1', [id]).catch(() => {});
    throw err;
  }

  return {
    id, contractId, providerId, contractTitle, providerName, filename,
    mime: mime || 'application/octet-stream', byteSize: buffer.length,
    uploadedBy, uploadedByName, createdAt: new Date().toISOString(),
  };
}

async function listContractDocs(contractId) {
  if (!isUuid(contractId)) return [];
  const { rows } = await query(
    `SELECT id, contract_id, provider_id, contract_title, provider_name,
            filename, mime, byte_size, uploaded_by_name, created_at
     FROM contract_documents WHERE contract_id = $1 ORDER BY created_at DESC`,
    [contractId]
  );
  return mapRows(rows);
}

async function listContractDocsByProvider(providerId) {
  if (!isUuid(providerId)) return [];
  const { rows } = await query(
    `SELECT id, contract_id, provider_id, contract_title, provider_name,
            filename, mime, byte_size, uploaded_by_name, created_at
     FROM contract_documents WHERE provider_id = $1 ORDER BY created_at DESC`,
    [providerId]
  );
  return mapRows(rows);
}

async function getContractDoc(docId) {
  if (!isUuid(docId)) throw HttpError.notFound(`Document ${docId} not found`);
  const { rows } = await query('SELECT * FROM contract_documents WHERE id = $1', [docId]);
  if (!rows[0]) throw HttpError.notFound(`Document ${docId} not found`);
  const buffer = loadBuffer(rows[0]);
  if (!buffer) throw HttpError.notFound(`Document file missing for ${docId}`);
  return { ...mapRow(rows[0]), buffer };
}

async function deleteContractDoc(docId) {
  if (!isUuid(docId)) throw HttpError.notFound(`Document ${docId} not found`);
  const { rows } = await query(
    'DELETE FROM contract_documents WHERE id = $1 RETURNING storage_path',
    [docId]
  );
  if (!rows[0]) throw HttpError.notFound(`Document ${docId} not found`);
  docStorage.deleteFile(rows[0].storage_path);
  return { id: docId, deleted: true };
}

/* ---- License purchase proofs (invoice / contract scan) ---- */

async function saveLicenseDoc({
  licenseId, providerId, kind, filename, mime, buffer, uploadedBy, uploadedByName,
}) {
  if (!licenseId || !filename || !buffer) {
    throw HttpError.badRequest('licenseId, filename and file content are required');
  }
  if (!isUuid(licenseId)) throw HttpError.notFound(`License ${licenseId} not found`);
  const docKind = ['invoice', 'contract', 'other'].includes(kind) ? kind : 'invoice';

  const { rows } = await query(
    `INSERT INTO license_documents
       (license_id, provider_id, kind, filename, mime, byte_size, content, storage_path,
        uploaded_by, uploaded_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,$7,$8)
     RETURNING id`,
    [
      licenseId, providerId && isUuid(providerId) ? providerId : null, docKind,
      filename, mime || 'application/octet-stream', buffer.length,
      uploadedBy || null, uploadedByName || null,
    ]
  );
  const id = rows[0].id;
  try {
    const storagePath = docStorage.writeBuffer('license', id, buffer, {
      label: uploadedByName || docKind || 'license',
      ownerId: licenseId,
      ownerLabel: docKind || 'license',
      originalFilename: filename,
    });
    await query('UPDATE license_documents SET storage_path = $2 WHERE id = $1', [id, storagePath]);
  } catch (err) {
    await query('DELETE FROM license_documents WHERE id = $1', [id]).catch(() => {});
    throw err;
  }

  return {
    id, licenseId, providerId: providerId || null, kind: docKind, filename,
    mime: mime || 'application/octet-stream', byteSize: buffer.length,
    uploadedBy, uploadedByName, createdAt: new Date().toISOString(),
  };
}

async function listLicenseDocs(licenseId) {
  if (!isUuid(licenseId)) return [];
  const { rows } = await query(
    `SELECT id, license_id, provider_id, kind, filename, mime, byte_size,
            uploaded_by_name, created_at
     FROM license_documents WHERE license_id = $1 ORDER BY created_at DESC`,
    [licenseId]
  );
  return mapRows(rows);
}

async function getLicenseDoc(docId) {
  if (!isUuid(docId)) throw HttpError.notFound(`Document ${docId} not found`);
  const { rows } = await query('SELECT * FROM license_documents WHERE id = $1', [docId]);
  if (!rows[0]) throw HttpError.notFound(`Document ${docId} not found`);
  const buffer = loadBuffer(rows[0]);
  if (!buffer) throw HttpError.notFound(`Document file missing for ${docId}`);
  return { ...mapRow(rows[0]), buffer };
}

async function deleteLicenseDoc(docId) {
  if (!isUuid(docId)) throw HttpError.notFound(`Document ${docId} not found`);
  const { rows } = await query(
    'DELETE FROM license_documents WHERE id = $1 RETURNING storage_path',
    [docId]
  );
  if (!rows[0]) throw HttpError.notFound(`Document ${docId} not found`);
  docStorage.deleteFile(rows[0].storage_path);
  return { id: docId, deleted: true };
}

module.exports = {
  saveDocument, listByEmployee, getDocument, deleteDocument,
  saveMaintenanceDoc, listMaintenanceDocsByAsset, listMaintenanceDocsByLog,
  getMaintenanceDoc, deleteMaintenanceDoc,
  saveProviderDoc, listProviderDocs, getProviderDoc, deleteProviderDoc,
  saveContractDoc, listContractDocs, listContractDocsByProvider,
  getContractDoc, deleteContractDoc,
  saveLicenseDoc, listLicenseDocs, getLicenseDoc, deleteLicenseDoc,
};
