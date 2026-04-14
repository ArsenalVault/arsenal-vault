/*
 * ArsenalDB — TransferService
 *
 * Manages firearm transfer records and their state machine.
 *
 * State machine (D1 transitions):
 *  Draft → Complete   via complete()
 *  Draft → Cancelled  via cancel()
 *
 *  Pending is defined in STATUS for model completeness but no D1 transition
 *  leads to it. FFL / consignment workflows (D2) will use Pending.
 *
 * Atomic completion:
 *  complete() performs all async data prep before the transaction,
 *  then writes to transfer + firearm + custody_event in one atomic
 *  StorageEngine.transaction() call. If the transaction fails, all
 *  three stores remain unchanged.
 *
 * updateDraft() is not implemented in D1.
 * The D1 UI creates and completes in one action with no intermediate save.
 * updateDraft() will be added when D2 requires Draft editing.
 *
 * D4 additions:
 *  createDraft() — computes isInterstate from seller/buyer state at draft
 *    creation time. Value is frozen on the draft and not recomputed later.
 *    A false value means "not detected from available data", not a legal
 *    confirmation of intrastate status.
 *  createDraft() — includes fflSnapshot: null on all draft records so the
 *    field is always present in the record shape regardless of path taken.
 *  submitToFFL() — captures an immutable fflSnapshot via
 *    PersonService.createSnapshot() and stores it on the Pending record.
 */

import StorageEngine   from '../core/storage.js';
import MemoryCache     from '../core/cache.js';
import EventBus        from '../core/eventbus.js';
import Logger          from '../core/logger.js';
import { generateId }  from '../utils/uuid.js';
import { nowISO }      from '../utils/datetime.js';
import * as PersonService from './person.service.js';
import { logEventInTx, CUSTODY_EVENT_TYPES } from './custody.service.js';


// ── Constants ─────────────────────────────────────────────

export const STATUS = Object.freeze({
  DRAFT:     'Draft',
  PENDING:   'Pending',     // defined for model completeness; no D1 transition
  COMPLETE:  'Complete',
  CANCELLED: 'Cancelled',
});

export const TRANSFER_TYPES = Object.freeze([
  'Sale', 'Gift', 'Inheritance', 'Other',
]);
// Consignment and FFL deferred to D2.


// ── Cache keys ────────────────────────────────────────────

const CK = {
  byGun:  (gunId) => `transfers:gun:${gunId}`,
  single: (id)    => `transfers:single:${id}`,
};


// ── Private: invalidation ─────────────────────────────────

function _invalidate(id, gunId) {
  if (id)    MemoryCache.invalidate(CK.single(id));
  if (gunId) MemoryCache.invalidate(CK.byGun(gunId));
}


// ── Public: createDraft ───────────────────────────────────

/**
 * Create a new transfer record in Draft status.
 * Does not change firearm status — that happens at complete().
 *
 * salePrice is normalized to null when transferType !== 'Sale'.
 * This enforces the rule at the service layer regardless of what the UI sends.
 *
 * isInterstate is computed once from seller/buyer state fields at draft
 * creation time and frozen on the record. It is not recomputed at completion.
 * A false value means "not detected from available data" — it is not a legal
 * confirmation of intrastate status.
 *
 * fflSnapshot is always null on a Draft. It is populated by submitToFFL().
 *
 * @param   {object}  data
 * @param   {string}  data.gunId
 * @param   {string}  data.sellerId
 * @param   {string}  data.buyerId
 * @param   {string}  data.transferType    One of TRANSFER_TYPES
 * @param   {number}  [data.salePrice]     Normalized to null if type !== 'Sale'
 * @param   {string}  [data.notes]
 * @returns {Promise<object>}
 * @throws  If gunId/sellerId/buyerId missing, firearm not Active, or seller === buyer
 */
export async function createDraft(data) {
  if (!data.gunId)    throw new Error('TransferService: gunId is required');
  if (!data.sellerId) throw new Error('TransferService: sellerId is required');
  if (!data.buyerId)  throw new Error('TransferService: buyerId is required');

  if (data.sellerId === data.buyerId) {
    throw new Error('Seller and buyer must be different persons.');
  }

  // Firearm must be Active — revalidated again at complete()
  const firearm = await StorageEngine.get('firearm', data.gunId);
  if (!firearm)               throw new Error(`Firearm not found: ${data.gunId}`);
  if (firearm.status !== 'Active') {
    throw new Error(`Firearm is not Active (current status: ${firearm.status}).`);
  }

  // Normalize salePrice — stale values from hidden fields must not persist
  const salePrice = data.transferType === 'Sale'
    ? (data.salePrice != null ? Number(data.salePrice) : null)
    : null;

  // Compute isInterstate from person state fields at draft creation time.
  // Uses persons:single cache — typically a fast cache hit.
  // Frozen here; not recomputed at completion.
  const [seller, buyer] = await Promise.all([
    PersonService.getById(data.sellerId),
    PersonService.getById(data.buyerId),
  ]);
  const sellerState  = (seller?.state || '').trim().toUpperCase();
  const buyerState   = (buyer?.state  || '').trim().toUpperCase();
  const isInterstate = !!(sellerState && buyerState && sellerState !== buyerState);

  const now = nowISO();
  const record = {
    id:             generateId(),
    gunId:          data.gunId,
    status:         STATUS.DRAFT,
    transferType:   data.transferType || 'Other',
    sellerId:       data.sellerId,
    buyerId:        data.buyerId,
    sellerSnapshot: null,
    buyerSnapshot:  null,
    salePrice,
    isInterstate,
    fflPersonId:    null,
    fflSnapshot:    null,
    transferDate:   null,
    bosDocumentId:  null,
    notes:          data.notes?.trim() || null,
    createdAt:      now,
    updatedAt:      now,
    completedAt:    null,
    cancelledAt:    null,
  };

  await StorageEngine.put('transfer', record);

  _invalidate(null, data.gunId);

  Logger.info('TransferService', `Draft created: ${record.id} (gun: ${record.gunId})`);
  return record;
}


// ── Private: _atomicComplete ─────────────────────────────
//
// Shared by complete() and completeFromFFL().
// Receives already-validated transfer and firearm records.
// All async prep, the atomic transaction, and post-tx side effects live here.
// Callers validate their own status preconditions before calling.

async function _atomicComplete(transfer, firearm, opts = {}) {
  const [sellerSnapshot, buyerSnapshot] = await Promise.all([
    PersonService.createSnapshot(transfer.sellerId),
    PersonService.createSnapshot(transfer.buyerId),
  ]);

  const now          = nowISO();
  const transferDate = opts.transferDate || now.slice(0, 10);

  const updatedTransfer = {
    ...transfer,
    status:         STATUS.COMPLETE,
    sellerSnapshot,
    buyerSnapshot,
    transferDate,
    completedAt:    now,
    updatedAt:      now,
  };

  const updatedFirearm = {
    ...firearm,
    status:    'Transferred',
    updatedAt: now,
  };

  const custodyFields = {
    gunId:             firearm.id,
    eventType:         CUSTODY_EVENT_TYPES.TRANSFER_OUT,
    occurredAt:        transferDate,
    fromPersonId:      transfer.sellerId,
    toPersonId:        transfer.buyerId,
    transferId:        transfer.id,
    isSystemGenerated: true,
  };

  await StorageEngine.transaction(
    ['transfer', 'firearm', 'custody_event'],
    'readwrite',
    (stores) => {
      stores.transfer.put(updatedTransfer);
      stores.firearm.put(updatedFirearm);
      logEventInTx(stores.custody_event, custodyFields);
    }
  );

  // Post-transaction — only reached if transaction committed
  _invalidate(transfer.id, transfer.gunId);
  MemoryCache.invalidate(`firearms:single:${transfer.gunId}`);
  MemoryCache.invalidatePrefix('firearms:list:');
  MemoryCache.invalidatePrefix('firearms:count:');

  EventBus.emit('firearm.updated', { id: transfer.gunId, status: 'Transferred' });
  EventBus.emit('transfer.completed', { id: transfer.id, gunId: transfer.gunId });

  Logger.info('TransferService', `Completed: ${transfer.id} (gun: ${transfer.gunId})`);
  return updatedTransfer;
}


// ── Public: complete ──────────────────────────────────────

/**
 * Complete a Draft transfer atomically (direct / private-party path).
 * Validates Draft status, then delegates to _atomicComplete().
 *
 * @param   {string} id
 * @param   {object} [opts]
 * @param   {string} [opts.transferDate]  ISO date; defaults to today
 * @returns {Promise<object>}
 */
export async function complete(id, opts = {}) {
  const transfer = await StorageEngine.get('transfer', id);
  if (!transfer) throw new Error(`Transfer not found: ${id}`);
  if (transfer.status !== STATUS.DRAFT) {
    throw new Error(
      `Cannot complete a transfer with status "${transfer.status}". ` +
      `Only Draft transfers can be completed.`
    );
  }

  const firearm = await StorageEngine.get('firearm', transfer.gunId);
  if (!firearm) throw new Error(`Firearm not found: ${transfer.gunId}`);
  if (firearm.status !== 'Active') {
    throw new Error(
      `Firearm is no longer Active (current status: ${firearm.status}). ` +
      `Transfer cannot be completed.`
    );
  }

  return _atomicComplete(transfer, firearm, opts);
}


// ── Public: cancel ────────────────────────────────────────

/**
 * Cancel a Draft or Pending transfer.
 * Complete and already-Cancelled transfers cannot be cancelled.
 * Firearm status is NOT changed — a cancelled draft leaves the firearm Active.
 * No custody event is written — a cancelled draft is not a custody event.
 *
 * @param   {string} id
 * @returns {Promise<object>}
 */
export async function cancel(id) {
  const transfer = await StorageEngine.get('transfer', id);
  if (!transfer) throw new Error(`Transfer not found: ${id}`);

  if (transfer.status === STATUS.COMPLETE) {
    throw new Error('A completed transfer cannot be cancelled.');
  }
  if (transfer.status === STATUS.CANCELLED) {
    throw new Error('Transfer is already cancelled.');
  }

  const updated = {
    ...transfer,
    status:      STATUS.CANCELLED,
    cancelledAt: nowISO(),
    updatedAt:   nowISO(),
  };

  await StorageEngine.put('transfer', updated);

  _invalidate(id, transfer.gunId);

  Logger.info('TransferService', `Cancelled: ${id}`);
  return updated;
}


// ── Public: getByGun ──────────────────────────────────────

/**
 * Return all transfer records for a firearm, most recent first.
 * Cached under 'transfers:gun:{gunId}'.
 *
 * @param   {string} gunId
 * @returns {Promise<object[]>}
 */
export async function getByGun(gunId) {
  const cached = MemoryCache.get(CK.byGun(gunId));
  if (cached) return cached;

  const records = await StorageEngine.getAll('transfer', 'gunId', gunId);
  records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  MemoryCache.set(CK.byGun(gunId), records);
  return records;
}


// ── Public: getById ───────────────────────────────────────

/**
 * Return a single transfer record by primary key, or null if not found.
 * Cached under 'transfers:single:{id}'.
 *
 * @param   {string} id
 * @returns {Promise<object|null>}
 */
export async function getById(id) {
  const cached = MemoryCache.get(CK.single(id));
  if (cached) return cached;

  const record = await StorageEngine.get('transfer', id);
  if (record) MemoryCache.set(CK.single(id), record);
  return record || null;
}


// ── Public: submitToFFL ───────────────────────────────────

/**
 * Submit a Draft transfer to an FFL dealer for facilitation.
 * Transitions the transfer from Draft → Pending.
 * Firearm status does NOT change — it remains Active while at the FFL.
 *
 * Captures an immutable fflSnapshot via PersonService.createSnapshot() and
 * stores it on the Pending record. The snapshot preserves the FFL dealer's
 * displayName, fflNumber, phone, email, and address at submission time.
 * Later edits to the FFL person record do not affect the stored snapshot.
 *
 * @param   {string} id
 * @param   {object} opts
 * @param   {string} opts.fflPersonId  Required — must be a person with personType 'FFL'
 * @returns {Promise<object>}
 * @throws  If not a Draft, fflPersonId missing, person not found, or person is not FFL type
 */
export async function submitToFFL(id, { fflPersonId } = {}) {
  const transfer = await StorageEngine.get('transfer', id);
  if (!transfer) throw new Error(`Transfer not found: ${id}`);
  if (transfer.status !== STATUS.DRAFT) {
    throw new Error(
      `Cannot submit a transfer with status "${transfer.status}" to FFL. ` +
      `Only Draft transfers can be submitted.`
    );
  }
  if (!fflPersonId) throw new Error('TransferService.submitToFFL: fflPersonId is required');

  const fflPerson = await PersonService.getById(fflPersonId);
  if (!fflPerson) throw new Error(`FFL person not found: ${fflPersonId}`);
  if (fflPerson.personType !== 'FFL') {
    throw new Error(
      `"${PersonService.displayName(fflPerson)}" is not an FFL dealer ` +
      `(personType: "${fflPerson.personType}"). ` +
      `Only persons with personType "FFL" can facilitate a transfer.`
    );
  }

  // Capture point-in-time snapshot before writing — preserves FFL dealer
  // details (fflNumber, address, contact) as they exist at submission time.
  const fflSnapshot = await PersonService.createSnapshot(fflPersonId);

  const updated = {
    ...transfer,
    status:      STATUS.PENDING,
    fflPersonId,
    fflSnapshot,
    updatedAt:   nowISO(),
  };

  await StorageEngine.put('transfer', updated);
  _invalidate(id, transfer.gunId);

  Logger.info('TransferService', `Submitted to FFL: ${id} (ffl: ${fflPersonId})`);
  return updated;
}


// ── Public: completeFromFFL ───────────────────────────────

/**
 * Complete a Pending transfer after FFL facilitation.
 * Validates Pending status, then delegates to _atomicComplete().
 * Identical atomic write to complete() — different precondition only.
 *
 * @param   {string} id
 * @param   {object} [opts]
 * @param   {string} [opts.transferDate]  ISO date; defaults to today
 * @returns {Promise<object>}
 */
export async function completeFromFFL(id, opts = {}) {
  const transfer = await StorageEngine.get('transfer', id);
  if (!transfer) throw new Error(`Transfer not found: ${id}`);
  if (transfer.status !== STATUS.PENDING) {
    throw new Error(
      `Cannot complete a transfer with status "${transfer.status}" via FFL. ` +
      `Only Pending transfers can be completed via FFL.`
    );
  }

  const firearm = await StorageEngine.get('firearm', transfer.gunId);
  if (!firearm) throw new Error(`Firearm not found: ${transfer.gunId}`);
  if (firearm.status !== 'Active') {
    throw new Error(
      `Firearm is no longer Active (current status: ${firearm.status}). ` +
      `Transfer cannot be completed.`
    );
  }

  return _atomicComplete(transfer, firearm, opts);
}
