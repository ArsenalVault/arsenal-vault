/*
 * ArsenalDB — PersonService
 *
 * Manages person records: individual buyers/sellers, FFL dealers,
 * corporations, and the single owner record (the app user).
 *
 * Implemented in this slice (Tranche C):
 *  — displayName(record)   pure helper — no service call
 *  — create(data)
 *  — getAll()              sorted via _sortKey — handles all nullable fields
 *  — getById(id)
 *  — getOwner()
 *  — update(id, changes)
 *  — deletePerson(id)      guarded: owner cannot be deleted; transfer refs block
 *  — createSnapshot(id)    no DB write; used by TransferService at completion
 *
 * Address fields are present in the record model and in createSnapshot()
 * but are not exposed in the Tranche C UI. They will be null until
 * the Transfer tranche adds address input.
 */

import StorageEngine  from '../core/storage.js';
import MemoryCache    from '../core/cache.js';
import Logger         from '../core/logger.js';
import { generateId } from '../utils/uuid.js';
import { nowISO }     from '../utils/datetime.js';


// ── Constants ─────────────────────────────────────────────

export const PERSON_TYPES = Object.freeze(['Individual', 'FFL', 'Corporation']);


// ── Cache keys ────────────────────────────────────────────

const CK = {
  list:          'persons:list',
  single: (id) => `persons:single:${id}`,
  owner:         'persons:owner',
};

function _invalidateAll(id) {
  MemoryCache.invalidate(CK.list);
  MemoryCache.invalidate(CK.owner);
  if (id) MemoryCache.invalidate(CK.single(id));
}


// ── Private: deterministic sort key ──────────────────────
//
// Handles all nullable field combinations without comparison errors.
// Individual: "lastName firstName" (either may be null/empty)
// FFL / Corporation: businessName
//
// Lowercase ensures case-insensitive ordering.
// The sort key is computed at query time — it is not stored on the record.

function _sortKey(r) {
  if (r.personType === 'Individual') {
    return `${r.lastName || ''} ${r.firstName || ''}`.trim().toLowerCase();
  }
  return (r.businessName || '').toLowerCase();
}


// ── Private: name validation ──────────────────────────────

function _validateName(data) {
  if (data.personType === 'Individual') {
    const hasName = (data.firstName || '').trim() || (data.lastName || '').trim();
    if (!hasName) throw new Error('First name or last name is required for an Individual.');
  } else {
    if (!(data.businessName || '').trim()) {
      throw new Error('Business name is required for FFL and Corporation records.');
    }
  }
}


// ── Public: displayName ───────────────────────────────────

/**
 * Compute a display name from a person record. Pure function — no service call.
 * Single authoritative definition used by all rendering code.
 *
 * @param   {object} record
 * @returns {string}
 */
export function displayName(record) {
  if (!record) return 'Unknown';
  if (record.personType === 'Individual') {
    const name = [record.firstName, record.lastName].filter(Boolean).join(' ');
    return name || 'Unnamed';
  }
  return record.businessName || 'Unnamed';
}


// ── Public: create ────────────────────────────────────────

/**
 * Create a new person record.
 *
 * @param   {object}  data
 * @param   {string}  data.personType       One of PERSON_TYPES
 * @param   {boolean} [data.isOwner]        At most one owner allowed
 * @param   {string}  [data.firstName]
 * @param   {string}  [data.lastName]
 * @param   {string}  [data.businessName]
 * @param   {string}  [data.fflNumber]
 * @param   {string}  [data.phone]
 * @param   {string}  [data.email]
 * @param   {string}  [data.addressLine1]
 * @param   {string}  [data.addressLine2]
 * @param   {string}  [data.city]
 * @param   {string}  [data.state]
 * @param   {string}  [data.zipCode]
 * @returns {Promise<object>}
 * @throws  If name is missing or a second owner is attempted
 */
export async function create(data) {
  _validateName(data);

  if (data.isOwner) {
    const existing = await getOwner();
    if (existing) throw new Error('An owner record already exists.');
  }

  const now    = nowISO();
  const record = {
    id:           generateId(),
    personType:   data.personType,
    isOwner:      data.isOwner === true,
    firstName:    (data.firstName  || '').trim() || null,
    lastName:     (data.lastName   || '').trim() || null,
    businessName: (data.businessName || '').trim() || null,
    fflNumber:    (data.fflNumber  || '').trim() || null,
    phone:        (data.phone        || '').trim() || null,
    email:        (data.email        || '').trim() || null,
    addressLine1: (data.addressLine1 || '').trim() || null,
    addressLine2: (data.addressLine2 || '').trim() || null,
    city:         (data.city         || '').trim() || null,
    state:        (data.state        || '').trim() || null,
    zipCode:      (data.zipCode      || '').trim() || null,
    notes:        null,
    createdAt:    now,
    updatedAt:    now,
  };

  await StorageEngine.put('person', record);
  _invalidateAll(null);

  Logger.info('PersonService', `Created: "${displayName(record)}" (${record.id})`);
  return record;
}


// ── Public: getAll ────────────────────────────────────────

/**
 * Return all person records sorted by _sortKey ascending.
 * Cached under 'persons:list'.
 *
 * @returns {Promise<object[]>}
 */
export async function getAll() {
  const cached = MemoryCache.get(CK.list);
  if (cached) return cached;

  const records = await StorageEngine.getAll('person');
  records.sort((a, b) => _sortKey(a).localeCompare(_sortKey(b)));

  MemoryCache.set(CK.list, records);
  return records;
}


// ── Public: getById ───────────────────────────────────────

/**
 * Return a single person record by primary key, or null if not found.
 * Cached under 'persons:single:{id}'.
 *
 * @param   {string} id
 * @returns {Promise<object|null>}
 */
export async function getById(id) {
  const cached = MemoryCache.get(CK.single(id));
  if (cached) return cached;

  const record = await StorageEngine.get('person', id);
  if (record) MemoryCache.set(CK.single(id), record);
  return record || null;
}


// ── Public: getOwner ──────────────────────────────────────

/**
 * Return the person record where isOwner === true, or null if none exists.
 * Built from getAll() — no additional DB query.
 * Cached under 'persons:owner'.
 *
 * @returns {Promise<object|null>}
 */
export async function getOwner() {
  const cached = MemoryCache.get(CK.owner);
  if (cached !== undefined) return cached;

  const all   = await getAll();
  const owner = all.find(p => p.isOwner) || null;

  MemoryCache.set(CK.owner, owner);
  return owner;
}


// ── Public: update ────────────────────────────────────────

/**
 * Update a person record.
 * personType is not changeable — changing it would leave orphaned name fields.
 * All three cache keys are always invalidated — the updated record may be the owner.
 *
 * @param   {string} id
 * @param   {object} changes
 * @returns {Promise<object>}
 * @throws  If record not found, name becomes empty, or second owner attempted
 */
export async function update(id, changes) {
  const existing = await StorageEngine.get('person', id);
  if (!existing) throw new Error(`Person not found: ${id}`);

  // Merge — personType is immutable
  const merged = {
    ...existing,
    firstName:    'firstName'    in changes ? ((changes.firstName    || '').trim() || null) : existing.firstName,
    lastName:     'lastName'     in changes ? ((changes.lastName     || '').trim() || null) : existing.lastName,
    businessName: 'businessName' in changes ? ((changes.businessName || '').trim() || null) : existing.businessName,
    fflNumber:    'fflNumber'    in changes ? ((changes.fflNumber    || '').trim() || null) : existing.fflNumber,
    phone:        'phone'        in changes ? ((changes.phone        || '').trim() || null) : existing.phone,
    email:        'email'        in changes ? ((changes.email        || '').trim() || null) : existing.email,
    addressLine1: 'addressLine1' in changes ? ((changes.addressLine1 || '').trim() || null) : existing.addressLine1,
    addressLine2: 'addressLine2' in changes ? ((changes.addressLine2 || '').trim() || null) : existing.addressLine2,
    city:         'city'         in changes ? ((changes.city         || '').trim() || null) : existing.city,
    state:        'state'        in changes ? ((changes.state        || '').trim() || null) : existing.state,
    zipCode:      'zipCode'      in changes ? ((changes.zipCode      || '').trim() || null) : existing.zipCode,
    updatedAt:    nowISO(),
  };

  _validateName(merged);

  await StorageEngine.put('person', merged);
  _invalidateAll(id);

  Logger.info('PersonService', `Updated: "${displayName(merged)}" (${id})`);
  return merged;
}


// ── Public: deletePerson ──────────────────────────────────
// Named deletePerson — 'delete' is a reserved word in JavaScript.

/**
 * Delete a person record.
 * Blocked if: isOwner === true, or any transfer references this person.
 *
 * @param   {string} id
 * @returns {Promise<void>}
 * @throws  { code: 'PERSON_IS_OWNER' | 'PERSON_IN_USE', count?, message }
 */
export async function deletePerson(id) {
  const existing = await StorageEngine.get('person', id);
  if (!existing) throw new Error(`Person not found: ${id}`);

  if (existing.isOwner) {
    const err = new Error('The owner profile cannot be deleted.');
    err.code  = 'PERSON_IS_OWNER';
    throw err;
  }

  // Check transfer references via indexed lookups.
  // NOTE: fflPersonId references are NOT checked here because the transfer
  // store has no fflPersonId index in the current migration. This is a known
  // gap — an FFL person used in a transfer can technically be deleted without
  // guard. Deferred to a future migration slice.
  const [asSeller, asBuyer] = await Promise.all([
    StorageEngine.getAll('transfer', 'sellerId', id),
    StorageEngine.getAll('transfer', 'buyerId',  id),
  ]);
  const count = asSeller.length + asBuyer.length;

  if (count > 0) {
    const err = new Error(
      `Cannot delete — this person is referenced by ${count} transfer record(s).`
    );
    err.code  = 'PERSON_IN_USE';
    err.count = count;
    throw err;
  }

  await StorageEngine.remove('person', id);
  _invalidateAll(id);

  Logger.info('PersonService', `Deleted: ${id}`);
}


// ── Public: createSnapshot ────────────────────────────────

/**
 * Create an immutable point-in-time snapshot of a person record.
 * No DB write. Used by TransferService at transfer completion.
 *
 * Address fields are null in Tranche C — they will be populated
 * when address input is added in the Transfer tranche.
 *
 * @param   {string} id
 * @returns {Promise<object>}  Plain object; mutating it does not affect the DB record.
 * @throws  If record not found
 */
export async function createSnapshot(id) {
  const record = await getById(id);
  if (!record) throw new Error(`Cannot snapshot — person not found: ${id}`);

  return {
    personId:     record.id,
    personType:   record.personType,
    displayName:  displayName(record),
    firstName:    record.firstName,
    lastName:     record.lastName,
    businessName: record.businessName,
    fflNumber:    record.fflNumber,
    phone:        record.phone,
    email:        record.email,
    address: {
      line1:   record.addressLine1,
      line2:   record.addressLine2,
      city:    record.city,
      state:   record.state,
      zipCode: record.zipCode,
    },
    capturedAt: nowISO(),
  };
}
