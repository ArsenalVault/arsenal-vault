/*
 * ArsenalDB — Firearms Detail View
 *
 * Stateless HTML builders and async renderers for the firearm detail view.
 * Covers: detail shell, tab bar, info tab, custody tab.
 *
 * Rules:
 *  — No mutable state. No imports from firearms.module.js.
 *  — No event wiring. That belongs in firearms.module.js.
 *  — Async functions write to a DOM element passed in by the caller.
 *  — Pure HTML builder functions return strings, not DOM nodes.
 *
 * Imported by firearms.module.js only.
 *
 * Service, Documents, and Transfer tabs live in their own sub-modules
 * and are re-exported from here so firearms.module.js requires no changes:
 *
 *  firearms.detail.service.js   → loadServiceTab
 *  firearms.detail.documents.js → loadDocumentsTab
 *  firearms.detail.transfer.js  → loadTransferTab
 *
 * Note on _esc(): each detail sub-module carries its own private copy
 * of this helper. There is no shared utility module in the current
 * codebase. All copies are identical — if the escaping logic ever
 * changes, update all copies together (this file + the three sub-modules).
 */

import * as CustodyService              from '../services/custody.service.js';
import Logger                           from '../core/logger.js';
import { toDisplayDate, toDisplayDateTime } from '../utils/datetime.js';

// Re-export tab loaders so firearms.module.js can still use
// `import * as Detail from './firearms.detail.js'` without changes.
export { loadServiceTab }   from './firearms.detail.service.js';
export { loadDocumentsTab } from './firearms.detail.documents.js';
export { loadTransferTab }  from './firearms.detail.transfer.js';


// ── Private: escape helper ────────────────────────────────

function _esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


// ── Detail Shell ──────────────────────────────────────────

/**
 * HTML for the detail view loading skeleton.
 * Rendered immediately while the record is fetched from DB.
 * The heading and edit button are updated in place after load.
 *
 * @param   {string} activeTab - Currently active tab name
 * @returns {string} HTML
 */
export function detailShellHTML(activeTab = 'info') {
  return `
    <div class="fw-detail-header">
      <button class="fw-back-btn" id="fw-detail-back">← Back</button>
      <div class="fw-detail-heading">Loading…</div>
      <button class="fw-edit-btn" id="fw-detail-edit" disabled>Edit</button>
    </div>
    <div class="fw-tabs-bar" role="tablist">
      ${tabBtnHTML('info',      'Info',      activeTab === 'info')}
      ${tabBtnHTML('custody',   'Custody',   activeTab === 'custody')}
      ${tabBtnHTML('service',   'Service',   activeTab === 'service')}
      ${tabBtnHTML('documents', 'Documents', activeTab === 'documents')}
      ${tabBtnHTML('transfer',  'Transfer',  activeTab === 'transfer')}
      ${tabBtnHTML('range',     'Range',     activeTab === 'range')}
    </div>
    <div id="fw-tab-content" class="fw-tab-content">
      <div class="fw-loading">Loading…</div>
    </div>`;
}

/**
 * HTML for a single tab button in the tab bar.
 *
 * @param   {string}  name
 * @param   {string}  label
 * @param   {boolean} active
 * @returns {string} HTML
 */
export function tabBtnHTML(name, label, active) {
  return `<button class="fw-tab-btn ${active ? 'fw-tab-btn--active' : ''}"
    role="tab" aria-selected="${active}" data-tab="${name}">${_esc(label)}</button>`;
}


// ── Info Tab ──────────────────────────────────────────────

/**
 * HTML for the Info tab content. Read-only field display.
 *
 * @param   {object} r       Firearm record
 * @param   {object} nameMap Storage location id → name map
 * @returns {string} HTML
 */
export function infoTabHTML(r, nameMap = {}) {
  const currency = (val) =>
    val != null
      ? `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      : null;

  const gain = (r.currentValue != null && r.purchasePrice != null)
    ? Number(r.currentValue) - Number(r.purchasePrice)
    : null;

  const gainStr = gain != null
    ? `${gain >= 0 ? '+' : ''}$${Math.abs(gain).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    : null;

  const gainStyle = gain == null ? ''
    : gain >= 0 ? 'style="color:var(--color-ok)"'
    : 'style="color:var(--color-danger)"';

  const nfaSection = r.isNFA ? `
    <div class="fw-info-group">
      <div class="fw-info-group-label">NFA</div>
      ${_row('Form', r.nfaForm)}
    </div>` : '';

  const hasPhysical = r.barrelLength || r.overallLength || r.weight ||
                      r.capacity || r.finishColor || r.stockGrips;
  const physicalSection = hasPhysical ? `
    <div class="fw-info-group">
      <div class="fw-info-group-label">Physical</div>
      ${r.barrelLength  ? _row('Barrel Length',  `${r.barrelLength}"`)  : ''}
      ${r.overallLength ? _row('Overall Length', `${r.overallLength}"`) : ''}
      ${r.weight        ? _row('Weight',         `${r.weight} oz`)      : ''}
      ${r.capacity      ? _row('Capacity',       r.capacity)            : ''}
      ${r.finishColor   ? _row('Finish',         r.finishColor)         : ''}
      ${r.stockGrips    ? _row('Stock / Grips',  r.stockGrips)          : ''}
    </div>` : '';

  return `
    <div class="fw-info-tab">

      <div class="fw-info-group">
        <div class="fw-info-group-label">Identity</div>
        ${_row('Make',   r.make)}
        ${_row('Model',  r.model)}
        ${r.variant        ? _row('Variant',         r.variant)         : ''}
        ${_row('Type',     r.type)}
        ${r.action         ? _row('Action',          r.action)          : ''}
        ${_row('Caliber',  r.caliber)}
        ${_monoRow('Serial Number', r.serialNumber)}
        ${r.serialLocation ? _row('Serial Location', r.serialLocation)  : ''}
      </div>

      <div class="fw-info-group">
        <div class="fw-info-group-label">Acquisition</div>
        ${_row('Date',           toDisplayDate(r.acquisitionDate))}
        ${_row('Method',         r.acquisitionMethod)}
        ${_row('Condition',      r.condition)}
        ${_row('Purchase Price', currency(r.purchasePrice))}
        ${r.currentValue != null ? `
          <div class="fw-info-row">
            <div class="fw-info-label">Current Value</div>
            <div class="fw-info-value">
              ${_esc(currency(r.currentValue))}
              ${gainStr ? `<span class="fw-gain" ${gainStyle}>(${gainStr})</span>` : ''}
            </div>
          </div>` : _row('Current Value', null)}
      </div>

      <div class="fw-info-group">
        <div class="fw-info-group-label">Status</div>
        ${_row('Status',   r.status)}
        ${_row('NFA Item', r.isNFA ? 'Yes' : 'No')}
        ${r.storageLocationId
          ? _row('Storage Location', nameMap[r.storageLocationId] ?? '—')
          : ''}
        ${r.collectionTag     ? _row('Collection',       r.collectionTag)     : ''}
      </div>

      ${nfaSection}
      ${physicalSection}

      ${r.notes ? `
        <div class="fw-info-group">
          <div class="fw-info-group-label">Notes</div>
          <div class="fw-info-notes">${_esc(r.notes)}</div>
        </div>` : ''}

    </div>`;
}

function _row(label, value) {
  const display = (value === null || value === undefined || value === '')
    ? '<span class="fw-field-empty">—</span>'
    : _esc(String(value));
  return `
    <div class="fw-info-row">
      <div class="fw-info-label">${_esc(label)}</div>
      <div class="fw-info-value">${display}</div>
    </div>`;
}

function _monoRow(label, value) {
  const display = (value === null || value === undefined || value === '')
    ? '<span class="fw-field-empty">—</span>'
    : `<span class="fw-mono">${_esc(String(value))}</span>`;
  return `
    <div class="fw-info-row">
      <div class="fw-info-label">${_esc(label)}</div>
      <div class="fw-info-value">${display}</div>
    </div>`;
}


// ── Custody Tab ───────────────────────────────────────────

/**
 * Load and render custody events into a container element.
 * Async — updates the element in place after fetching events.
 *
 * @param {HTMLElement} containerEl
 * @param {string}      gunId
 * @param {Function}    isStale     Returns true if render is outdated
 */
export async function loadCustodyTab(containerEl, gunId, isStale = () => false) {
  try {
    const events = await CustodyService.getChain(gunId);

    if (isStale()) return;   // sub-view changed or unmounted while events were loading

    if (events.length === 0) {
      containerEl.innerHTML = `
        <div class="fw-tab-placeholder">
          <div class="fw-tab-placeholder-label">No custody events</div>
          <div class="fw-tab-placeholder-sub">Events are recorded automatically</div>
        </div>`;
      return;
    }

    containerEl.innerHTML = `
      <div class="fw-custody-list">
        ${events.map(custodyEventHTML).join('')}
      </div>`;

  } catch (err) {
    Logger.error('FirearmsDetail', 'Failed to load custody chain', err);
    if (isStale()) return;
    containerEl.innerHTML = '<div class="fw-error">Failed to load custody history.</div>';
  }
}

/**
 * HTML for a single custody event card.
 *
 * @param   {object} event  ChainOfCustodyEvent record
 * @returns {string} HTML
 */
export function custodyEventHTML(event) {
  const TYPE_LABELS = {
    INTAKE:           'Added to Inventory',
    TRANSFER_OUT:     'Transferred Out',
    TRANSFER_IN:      'Transferred In',
    STOLEN_REPORTED:  'Stolen — Reported',
    STOLEN_RECOVERED: 'Recovered',
    NFA_SUBMITTED:    'NFA Form Submitted',
    NFA_APPROVED:     'NFA Approved',
    MANUAL_NOTE:      'Manual Note',
    FIELD_CORRECTION: 'Record Correction',
  };

  const label = TYPE_LABELS[event.eventType] || event.eventType;

  return `
    <div class="fw-custody-event">
      <div class="fw-custody-meta">
        <span class="fw-custody-badge">${_esc(label)}</span>
        ${event.isSystemGenerated ? '<span class="fw-custody-auto">AUTO</span>' : ''}
      </div>
      <div class="fw-custody-date">${toDisplayDateTime(event.occurredAt)}</div>
      ${event.notes ? `<div class="fw-custody-notes">${_esc(event.notes)}</div>` : ''}
    </div>`;
}
