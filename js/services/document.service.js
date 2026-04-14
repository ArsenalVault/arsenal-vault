/*
 * ArsenalDB — DocumentService
 *
 * Manages file attachments linked to firearms (and eventually transfers).
 * The store holds full records including base64 file data. The service
 * exposes two distinct retrieval paths to keep list rendering lightweight:
 *
 *  getByGun(gunId)    — metadata only; data field is stripped via destructuring
 *  getPayload(id)     — full record with data; called only when user taps View
 *
 * Guardrail: getByGun() never mutates fetched records in place.
 * It returns new objects constructed via destructuring: const { data, ...rest } = record.
 *
 * Implemented in this slice (Tranche B1):
 *  — attach()      read file, write full record, invalidate cache
 *  — getByGun()    return metadata-only array, cached
 *  — getPayload()  return full record with data, never cached
 *  — remove()      delete record, invalidate cache
 *
 * Deferred (no stubs):
 *  — addNote(), getById(), update(), supersede(), generateBOS()
 */

import StorageEngine  from '../core/storage.js';
import MemoryCache    from '../core/cache.js';
import Logger         from '../core/logger.js';
import { generateId } from '../utils/uuid.js';
import { nowISO }     from '../utils/datetime.js';


// ── Constants — exported so UI can use them without duplication ────────────

export const DOCUMENT_TYPES = Object.freeze([
  'Receipt', 'NFA Form', 'Insurance', 'Manual', 'Bill of Sale', 'Other',
]);

// Hard reject above MAX, soft warn above WARN
export const MAX_SIZE_BYTES  = 2 * 1024 * 1024;   // 2 MB
export const WARN_SIZE_BYTES = 512 * 1024;         // 512 KB


// ── Cache key ─────────────────────────────────────────────

function _ck(gunId) { return `documents:gun:${gunId}`; }


// ── Private helpers ───────────────────────────────────────

/**
 * Read a File object as a base64 data URL.
 * Resolves with the full data URL string (e.g. "data:application/pdf;base64,...").
 *
 * @param   {File}    file
 * @returns {Promise<string>}
 */
function _readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader  = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`FileReader failed for "${file.name}"`));
    reader.readAsDataURL(file);
  });
}

/**
 * Format a byte count as a human-readable string.
 * Used in error messages and service-level responses.
 *
 * @param   {number} bytes
 * @returns {string}
 */
function _formatBytes(bytes) {
  if (bytes < 1024)          return `${bytes} B`;
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}


// ── Public: attach ────────────────────────────────────────

/**
 * Attach a file to a firearm record.
 *
 * Enforces a 2 MB hard limit — rejects if exceeded.
 * Warns if between 512 KB and 2 MB — resolves with a `warning` field.
 *
 * Title defaults to the file's name if not supplied or left blank.
 *
 * @param   {string} gunId
 * @param   {File}   file
 * @param   {object} metadata
 * @param   {string} metadata.documentType  One of DOCUMENT_TYPES
 * @param   {string} [metadata.title]       Defaults to file.name
 * @returns {Promise<object>}               The created record (includes `data`)
 * @throws  If file exceeds 2 MB or gunId/file are missing
 */
export async function attach(gunId, file, metadata = {}) {
  if (!gunId) throw new Error('DocumentService.attach: gunId is required');
  if (!file)  throw new Error('DocumentService.attach: file is required');

  if (file.size > MAX_SIZE_BYTES) {
    throw new Error(
      `File too large: ${_formatBytes(file.size)} — maximum is ${_formatBytes(MAX_SIZE_BYTES)}.`
    );
  }

  const warning = file.size > WARN_SIZE_BYTES
    ? `Large file (${_formatBytes(file.size)}) — may affect backup size and performance.`
    : null;

  const data = await _readAsDataURL(file);
  const now  = nowISO();

  const record = {
    id:           generateId(),
    gunId,
    transferId:   null,
    documentType: metadata.documentType || 'Other',
    title:        (metadata.title || '').trim() || file.name,
    source:       'UserUploaded',
    mimeType:     file.type || 'application/octet-stream',
    fileSize:     file.size,
    data,
    notes:        null,
    createdAt:    now,
  };

  await StorageEngine.put('document', record);

  MemoryCache.invalidate(_ck(gunId));

  Logger.info('DocumentService', `Attached: "${record.title}" (${record.id})`);

  return warning ? { ...record, warning } : record;
}


// ── Public: addNote ──────────────────────────────────

/**
 * Attach a manual text note to a firearm record.
 * No file involved — data is null, content lives in the notes field.
 *
 * Both title and notes are required and validated in the service.
 * The UI must not be the only enforcement point for these rules.
 *
 * @param   {string} gunId
 * @param   {object} metadata
 * @param   {string} metadata.title          Required, non-empty
 * @param   {string} metadata.notes          Required, non-empty
 * @param   {string} [metadata.documentType] Defaults to 'Manual'
 * @returns {Promise<object>}
 * @throws  If gunId, title, or notes are missing or blank
 */
export async function addNote(gunId, metadata = {}) {
  if (!gunId) throw new Error('DocumentService.addNote: gunId is required');

  const title = (metadata.title ?? '').trim();
  const notes = (metadata.notes ?? '').trim();

  if (!title) throw new Error('DocumentService.addNote: title is required');
  if (!notes) throw new Error('DocumentService.addNote: note text is required');

  const record = {
    id:           generateId(),
    gunId,
    transferId:   null,
    documentType: metadata.documentType || 'Manual',
    title,
    source:       'Manual',
    mimeType:     'text/plain',
    fileSize:     null,
    data:         null,
    notes,
    createdAt:    nowISO(),
  };

  await StorageEngine.put('document', record);

  MemoryCache.invalidate(_ck(gunId));

  Logger.info('DocumentService', `Note added: "${record.title}" (${record.id})`);
  return record;
}


// ── Public: getByGun ──────────────────────────────────────

/**
 * Return all document records for a firearm, metadata only, most recent first.
 *
 * GUARDRAIL: the `data` field is stripped from each record using destructuring
 * — { data, ...rest } = record — creating a NEW object. The fetched record
 * objects are never mutated in place.
 *
 * @param   {string} gunId
 * @returns {Promise<object[]>}  Records without the `data` field
 */
export async function getByGun(gunId) {
  const cached = MemoryCache.get(_ck(gunId));
  if (cached) return cached;

  const records = await StorageEngine.getAll('document', 'gunId', gunId);
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Destructuring creates new objects — original records are not mutated
  const metadata = records.map(({ data, ...rest }) => rest);

  MemoryCache.set(_ck(gunId), metadata);
  return metadata;
}


// ── Public: getPayload ────────────────────────────────────

/**
 * Fetch the full record for a single document, including the `data` field.
 * Called only when the user taps View — not used for list rendering.
 * Deliberately not cached: payloads are large and single-use.
 *
 * @param   {string} id
 * @returns {Promise<object>}  Full record with `data` field
 * @throws  If the record is not found
 */
export async function getPayload(id) {
  if (!id) throw new Error('DocumentService.getPayload: id is required');

  const record = await StorageEngine.get('document', id);
  if (!record) throw new Error(`Document not found: ${id}`);

  return record;
}


// ── Public: remove ────────────────────────────────────────

/**
 * Delete a document record by id.
 * gunId is required for cache invalidation — it is not used to locate the record.
 *
 * @param   {string} id
 * @param   {string} gunId
 * @returns {Promise<void>}
 */
export async function remove(id, gunId) {
  if (!id)    throw new Error('DocumentService.remove: id is required');
  if (!gunId) throw new Error('DocumentService.remove: gunId is required');

  await StorageEngine.remove('document', id);

  MemoryCache.invalidate(_ck(gunId));

  Logger.info('DocumentService', `Removed: ${id}`);
}


// ── Public: attachRaw ─────────────────────────────────────

/**
 * Write a programmatically generated document to the document store.
 * Accepts a preformed base64 data URL plus metadata.
 *
 * The caller is responsible for encoding the data URL correctly.
 * This method is responsible for validation, storage, and cache management.
 *
 * The MAX_SIZE_BYTES / WARN_SIZE_BYTES guards from attach() do NOT apply.
 * Those are designed for user-uploaded files of unpredictable size.
 * attachRaw() is called only for app-generated content whose size is
 * controlled by the app itself (e.g. a BOS HTML document).
 *
 * @param   {string} gunId
 * @param   {object} payload
 * @param   {string} payload.data          Preformed base64 data URL ('data:...')
 * @param   {string} payload.mimeType
 * @param   {number} payload.fileSize      Byte count of original content BEFORE base64
 * @param   {string} payload.title
 * @param   {string} payload.documentType  Set explicitly by caller
 * @param   {string} payload.source        Set explicitly by caller
 * @param   {string} [payload.transferId]
 * @returns {Promise<object>}
 * @throws  If gunId, data, or fileSize are missing or invalid
 */
export async function attachRaw(gunId, payload = {}) {
  if (!gunId) {
    throw new Error('DocumentService.attachRaw: gunId is required');
  }
  if (!payload.data || !String(payload.data).startsWith('data:')) {
    throw new Error(
      'DocumentService.attachRaw: payload.data must be a preformed base64 data URL ' +
      'starting with "data:"'
    );
  }
  if (!payload.fileSize || payload.fileSize <= 0) {
    throw new Error('DocumentService.attachRaw: payload.fileSize must be a positive integer');
  }

  const record = {
    id:           generateId(),
    gunId,
    transferId:   payload.transferId || null,
    documentType: payload.documentType,
    title:        payload.title,
    source:       payload.source,
    mimeType:     payload.mimeType,
    fileSize:     payload.fileSize,
    data:         payload.data,
    notes:        null,
    createdAt:    nowISO(),
  };

  await StorageEngine.put('document', record);

  MemoryCache.invalidate(_ck(gunId));

  Logger.info('DocumentService', `attachRaw: "${record.title}" (${record.id})`);
  return record;
}
