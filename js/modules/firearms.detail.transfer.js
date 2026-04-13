/*
 * ArsenalDB — Firearms Detail: Transfer Tab
 *
 * Renders the transfer list and manages the new-transfer form sub-state
 * for one firearm. Includes D5 advisory compliance signals.
 * Extracted from firearms.detail.js.
 *
 * Rules (inherited from firearms.detail.js):
 *  — No mutable state.
 *  — No imports from firearms.module.js.
 *  — No event wiring outside loadTransferTab.
 *  — Async functions write to a DOM element passed in by the caller.
 *  — Tab sub-state (list / form) is managed via closures inside
 *    loadTransferTab and resets on every tab open.
 *
 * Exported:
 *  loadTransferTab(containerEl, record, isStale)
 *
 * Imported by firearms.detail.js, which re-exports loadTransferTab
 * so firearms.module.js requires no changes.
 *
 * Bug fixed in this extraction:
 *  _xferFormHTML() previously referenced `fflSelectOrMsg` which was
 *  never defined in that function, causing a ReferenceError whenever
 *  Record Transfer was tapped. The FFL select/message construction is
 *  now defined inside _xferFormHTML() where `fflPersons` is available
 *  as a parameter.
 *
 * D5 advisory helpers:
 *  _computeFormAdvisories() — pure; reads live form state (pre-submit)
 *  _computeCardAdvisories() — pure; reads stored transfer fields only (post-submit)
 *  _advisoryPanelHTML()     — single source of truth for all advisory copy
 *
 *  Source-of-truth split is intentional and strict:
 *  Card advisory never reads live person records. It uses
 *  transfer.isInterstate (frozen at draft creation) and
 *  transfer.fflPersonId only.
 *
 * Note on _esc(): local private copy. See firearms.detail.service.js
 * for the full note on why copies are used.
 */

import * as TransferService from '../services/transfer.service.js';
import * as PersonService   from '../services/person.service.js';
import * as BosService      from '../services/bos.service.js';
import Logger               from '../core/logger.js';


// ── Private: escape helper ────────────────────────────────

function _esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


// ── Transfer Tab ──────────────────────────────────────────

/**
 * Load and render the Transfer tab.
 * Two closure-managed states: list and new-transfer form.
 * State resets to list on every tab open.
 *
 * @param {HTMLElement} containerEl
 * @param {object}      record     Full firearm record — needed for status check and advisories
 * @param {Function}    isStale    Returns true if tab is no longer active
 */
export async function loadTransferTab(containerEl, record, isStale = () => false) {

  // ── List state ──────────────────────────────────────────

  async function renderList({ alertMessage = null } = {}) {
    let transfers, owner, persons;
    try {
      [transfers, owner, persons] = await Promise.all([
        TransferService.getByGun(record.id),
        PersonService.getOwner(),
        PersonService.getAll(),
      ]);
    } catch (err) {
      Logger.error('FirearmsDetail', 'Failed to load transfer tab data', err);
      if (isStale()) return;
      containerEl.innerHTML = '<div class="fw-error">Failed to load transfer data.</div>';
      return;
    }

    if (isStale()) return;

    const nonOwnerPersons = persons.filter(p => !p.isOwner);
    const fflPersons      = nonOwnerPersons.filter(p => p.personType === 'FFL');

    // Pre-compute FFL dealer names for card rendering.
    // If fflPersonId references a missing person, degrade gracefully.
    const fflDealerMap = {};
    for (const t of transfers) {
      if (t.fflPersonId && !(t.fflPersonId in fflDealerMap)) {
        const p = persons.find(px => px.id === t.fflPersonId);
        fflDealerMap[t.fflPersonId] = p ? PersonService.displayName(p) : 'FFL dealer unavailable';
      }
    }

    // Determine blocking conditions for the Record Transfer button
    const isActive = record.status === 'Active';
    let blockReason = null;
    if (!isActive)                    blockReason = 'inactive';
    else if (!owner)                  blockReason = 'no-owner';
    else if (!nonOwnerPersons.length) blockReason = 'no-persons';

    containerEl.innerHTML = _xferListHTML(transfers, blockReason, alertMessage, fflDealerMap, record);

    // Wire Record Transfer button
    containerEl.querySelector('#xfer-new-btn')?.addEventListener('click', () => {
      renderForm(owner, nonOwnerPersons, fflPersons);
    });

    // Wire Draft card actions
    containerEl.querySelectorAll('[data-xfer-complete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const xferId = btn.dataset.xferComplete;
        btn.disabled = true;
        try {
          await TransferService.complete(xferId);
        } catch (err) {
          Logger.error('FirearmsDetail', `Retry complete failed for ${xferId}`, err);
          if (isStale()) return;
          await renderList({ alertMessage:
            `Could not complete the transfer: ${err.message}. You can cancel it and start over.`
          });
          return;
        }
        if (isStale()) return;
        await renderList();
      });
    });

    containerEl.querySelectorAll('[data-xfer-cancel]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const xferId = btn.dataset.xferCancel;
        btn.disabled = true;
        try {
          await TransferService.cancel(xferId);
        } catch (err) {
          Logger.error('FirearmsDetail', `Cancel failed for ${xferId}`, err);
          btn.disabled = false;
          return;
        }
        if (isStale()) return;
        await renderList();
      });
    });

    // Pending: Mark Complete — show inline date row (DOM-local, no re-render)
    containerEl.querySelectorAll('[data-xfer-pending-complete]').forEach(btn => {
      btn.addEventListener('click', () => {
        const card    = btn.closest('.fw-xfer-card');
        const actsDiv = card?.querySelector('.fw-xfer-card-acts');
        const dateRow = card?.querySelector('.fw-xfer-date-row');
        if (actsDiv) actsDiv.hidden = true;
        if (dateRow) dateRow.hidden = false;
      });
    });

    // Pending: Dismiss — collapse date row back to buttons
    containerEl.querySelectorAll('[data-xfer-pending-dismiss]').forEach(btn => {
      btn.addEventListener('click', () => {
        const card    = btn.closest('.fw-xfer-card');
        const actsDiv = card?.querySelector('.fw-xfer-card-acts');
        const dateRow = card?.querySelector('.fw-xfer-date-row');
        if (dateRow) dateRow.hidden = true;
        if (actsDiv) actsDiv.hidden = false;
      });
    });

    // Pending: Confirm — call completeFromFFL with chosen date
    containerEl.querySelectorAll('[data-xfer-pending-confirm]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const xferId       = btn.dataset.xferPendingConfirm;
        const card         = btn.closest('.fw-xfer-card');
        const dateInput    = card?.querySelector('.fw-xfer-date-input');
        const errEl        = card?.querySelector('.fw-xfer-card-err');
        const transferDate = dateInput?.value || new Date().toISOString().slice(0, 10);
        const dismissBtn   = card?.querySelector('[data-xfer-pending-dismiss]');
        btn.disabled       = true;
        if (dismissBtn) dismissBtn.disabled = true;
        try {
          await TransferService.completeFromFFL(xferId, { transferDate });
        } catch (err) {
          Logger.error('FirearmsDetail', `completeFromFFL failed for ${xferId}`, err);
          if (isStale()) return;
          if (errEl) errEl.textContent = err.message;
          btn.disabled = false;
          if (dismissBtn) dismissBtn.disabled = false;
          return;
        }
        if (isStale()) return;
        await renderList();
      });
    });

    // BOS generation — synchronous; no re-render on success
    containerEl.querySelectorAll('[data-xfer-bos]').forEach(btn => {
      btn.addEventListener('click', () => {
        const xferId = btn.dataset.xferBos;
        const t = transfers.find(tx => tx.id === xferId);
        if (!t) return;
        try {
          BosService.print(t, record);
        } catch (err) {
          if (err.code === 'POPUP_BLOCKED') {
            const orig = btn.textContent;
            btn.textContent = 'Popups blocked';
            setTimeout(() => { btn.textContent = orig; }, 2500);
          } else {
            Logger.error('FirearmsDetail', 'BOS generation failed', err);
          }
        }
      });
    });

    // Save BOS to document record — async, button-local feedback only
    containerEl.querySelectorAll('[data-xfer-save-bos]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const xferId = btn.dataset.xferSaveBos;
        const t = transfers.find(tx => tx.id === xferId);
        if (!t) return;
        const orig = btn.textContent;
        btn.disabled = true;
        try {
          await BosService.attachToRecord(t, record);
          btn.textContent = 'Saved \u2713';
          setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
        } catch (err) {
          Logger.error('FirearmsDetail', 'Save BOS failed', err);
          btn.textContent = 'Failed';
          setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
        }
      });
    });
  }

  // ── Form state ──────────────────────────────────────────

  function renderForm(owner, nonOwnerPersons, fflPersons = []) {
    if (isStale()) return;
    containerEl.innerHTML = _xferFormHTML(nonOwnerPersons, PersonService.displayName(owner), fflPersons);

    // ── Form advisory — updates on buyer change and FFL checkbox change ──
    // Reads live form state only. No service calls.
    // `record` is the firearm — available via closure from loadTransferTab.
    function updateFormAdvisory() {
      const buyerId     = containerEl.querySelector('#xfer-buyer')?.value || '';
      const buyerPerson = nonOwnerPersons.find(p => p.id === buyerId) || null;
      const viaFFL      = containerEl.querySelector('#xfer-via-ffl')?.checked === true;
      const signals     = _computeFormAdvisories(record, owner?.state, buyerPerson?.state, viaFFL);
      const advEl       = containerEl.querySelector('#xfer-form-advisory');
      if (advEl) advEl.innerHTML = _advisoryPanelHTML(signals, 'form');
    }

    // Initial render — shows NFA advisory before any buyer is selected
    updateFormAdvisory();

    // Toggle sale price visibility when type changes
    const typeSelect = containerEl.querySelector('#xfer-type');
    const priceWrap  = containerEl.querySelector('#xfer-price-wrap');
    typeSelect?.addEventListener('change', () => {
      if (priceWrap) priceWrap.hidden = typeSelect.value !== 'Sale';
    });

    // Toggle FFL section, submit label, and advisory
    const fflCheckbox = containerEl.querySelector('#xfer-via-ffl');
    const fflSection  = containerEl.querySelector('#xfer-ffl-section');
    const submitBtn   = containerEl.querySelector('#xfer-submit');
    fflCheckbox?.addEventListener('change', () => {
      const viaFFL = fflCheckbox.checked;
      if (fflSection) fflSection.hidden = !viaFFL;
      if (submitBtn)  submitBtn.textContent = viaFFL ? 'Submit to FFL' : 'Complete Transfer';
      updateFormAdvisory();
    });

    // Buyer select — update advisory when buyer changes
    containerEl.querySelector('#xfer-buyer')
      ?.addEventListener('change', updateFormAdvisory);

    containerEl.querySelector('#xfer-cancel')
      ?.addEventListener('click', () => renderList());

    containerEl.querySelector('#xfer-submit')
      ?.addEventListener('click', () => handleSubmit(owner));
  }

  // ── Submit handler ──────────────────────────────────────

  async function handleSubmit(owner) {
    const type    = containerEl.querySelector('#xfer-type')?.value || 'Other';
    const buyerId = containerEl.querySelector('#xfer-buyer')?.value || '';
    const dateVal = containerEl.querySelector('#xfer-date')?.value || '';
    const priceEl = containerEl.querySelector('#xfer-price');
    const notes   = containerEl.querySelector('#xfer-notes')?.value.trim() || null;
    const errEl   = containerEl.querySelector('#xfer-error');
    const btn     = containerEl.querySelector('#xfer-submit');

    // UI-layer normalization — service also enforces this
    const salePrice = type === 'Sale' && priceEl?.value.trim()
      ? Number(priceEl.value)
      : null;

    if (!buyerId) {
      if (errEl) errEl.textContent = 'Please select a buyer.';
      return;
    }

    const transferDate = dateVal || new Date().toISOString().slice(0, 10);

    const viaFFL = containerEl.querySelector('#xfer-via-ffl')?.checked === true;
    const fflId  = viaFFL ? (containerEl.querySelector('#xfer-ffl-dealer')?.value || '') : '';

    if (viaFFL && !fflId) {
      if (errEl) errEl.textContent = 'Please select an FFL dealer.';
      return;
    }

    if (errEl) errEl.textContent = '';
    if (btn) { btn.disabled = true; btn.textContent = viaFFL ? 'Submitting…' : 'Completing…'; }

    // Step 1: Create draft
    let draft;
    try {
      draft = await TransferService.createDraft({
        gunId:        record.id,
        sellerId:     owner.id,
        buyerId,
        transferType: type,
        salePrice,
        notes,
      });
    } catch (err) {
      Logger.error('FirearmsDetail', 'createDraft failed', err);
      if (errEl) errEl.textContent = err.message;
      if (btn) { btn.disabled = false; btn.textContent = viaFFL ? 'Submit to FFL' : 'Complete Transfer'; }
      return;
    }

    // Step 2: Direct complete or FFL submit
    if (!viaFFL) {
      // Direct path
      try {
        await TransferService.complete(draft.id, { transferDate });
      } catch (err) {
        Logger.error('FirearmsDetail', 'complete() failed after createDraft()', err);
        if (isStale()) return;
        await renderList({
          alertMessage:
            `A draft transfer was saved but could not be completed: ${err.message} ` +
            `You can retry or cancel it from the list below.`,
        });
        return;
      }
    } else {
      // FFL path — auto-cancel the draft if submitToFFL fails
      try {
        await TransferService.submitToFFL(draft.id, { fflPersonId: fflId });
      } catch (err) {
        Logger.error('FirearmsDetail', 'submitToFFL() failed after createDraft()', err);
        // Cancel the orphaned draft — keep fallback conservative
        try { await TransferService.cancel(draft.id); } catch (e) {
          Logger.error('FirearmsDetail', 'auto-cancel also failed', e);
        }
        if (isStale()) return;
        if (errEl) errEl.textContent = `Could not submit to FFL: ${err.message}. Please try again.`;
        if (btn) { btn.disabled = false; btn.textContent = 'Submit to FFL'; }
        return;
      }
    }

    if (isStale()) return;
    await renderList();
  }

  // ── Initial render ──────────────────────────────────────

  await renderList();
}


// ── Transfer Tab: HTML builders ───────────────────────────

/**
 * @param {object[]} transfers
 * @param {string|null} blockReason
 * @param {string|null} alertMessage
 * @param {object} fflDealerMap
 * @param {object|null} firearm   Firearm record — passed to _xferCardHTML for advisory
 */
function _xferListHTML(transfers, blockReason, alertMessage, fflDealerMap = {}, firearm = null) {
  const alert = alertMessage ? `
    <div class="fw-xfer-alert">${_esc(alertMessage)}</div>` : '';

  let actionArea;
  if (blockReason === 'inactive') {
    actionArea = `<div class="fw-xfer-header">
      <span class="fw-doc-header-label">TRANSFERS</span>
      <span class="fw-xfer-inactive">Firearm is not active</span>
    </div>`;
  } else if (blockReason === 'no-owner') {
    actionArea = `<div class="fw-xfer-header">
      <span class="fw-doc-header-label">TRANSFERS</span>
    </div>
    <p class="fw-xfer-blocked">
      Set up your owner profile in Settings before recording a transfer.
    </p>`;
  } else if (blockReason === 'no-persons') {
    actionArea = `<div class="fw-xfer-header">
      <span class="fw-doc-header-label">TRANSFERS</span>
    </div>
    <p class="fw-xfer-blocked">
      Add a buyer in Settings → Known Persons before recording a transfer.
    </p>`;
  } else {
    actionArea = `<div class="fw-xfer-header">
      <span class="fw-doc-header-label">TRANSFERS</span>
      <button class="fw-doc-action-btn" id="xfer-new-btn">Record Transfer</button>
    </div>`;
  }

  if (transfers.length === 0) {
    return alert + actionArea + `
      <div class="fw-xfer-empty">No transfers on record.</div>`;
  }

  const cards = transfers.map(t => _xferCardHTML(t, fflDealerMap, firearm)).join('');
  return alert + actionArea + `<div class="fw-xfer-list">${cards}</div>`;
}

/**
 * @param {object} t            Transfer record
 * @param {object} fflDealerMap Map of fflPersonId → display name
 * @param {object|null} firearm Firearm record — used for advisory strip on Draft/Pending cards
 */
function _xferCardHTML(t, fflDealerMap = {}, firearm = null) {
  const STATUS_COLORS = {
    Complete:  'var(--color-ok)',
    Draft:     'var(--color-text-muted)',
    Cancelled: 'var(--color-danger)',
    Pending:   'var(--color-warn)',
  };
  const color     = STATUS_COLORS[t.status] || 'var(--color-text-muted)';
  const buyerName = t.buyerSnapshot?.displayName || t.buyerId || '—';
  const dateStr   = t.transferDate
    ? new Date(t.transferDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  const priceStr  = (t.status === 'Complete' && t.transferType === 'Sale' && t.salePrice != null)
    ? ` · $${Number(t.salePrice).toLocaleString()}`
    : '';

  // Advisory strip: shown on actionable cards only (Draft, Pending).
  // Reads stored transfer fields and firearm.isNFA — never live person data.
  const advisoryHTML = (t.status === 'Draft' || t.status === 'Pending') && firearm
    ? _advisoryPanelHTML(_computeCardAdvisories(t, firearm), 'card')
    : '';

  let actions = '';
  if (t.status === 'Draft') {
    if (t.fflPersonId) {
      // FFL-path draft (edge case) — Cancel only; no direct complete
      actions = `
        <div class="fw-xfer-card-acts">
          <button class="fw-doc-btn fw-doc-btn--delete" data-xfer-cancel="${_esc(t.id)}">Cancel</button>
        </div>`;
    } else {
      actions = `
        <div class="fw-xfer-card-acts">
          <button class="fw-doc-btn fw-doc-btn--view"   data-xfer-complete="${_esc(t.id)}">Complete Now</button>
          <button class="fw-doc-btn fw-doc-btn--delete" data-xfer-cancel="${_esc(t.id)}">Cancel</button>
        </div>`;
    }
  } else if (t.status === 'Pending') {
    const fflName = fflDealerMap[t.fflPersonId] || 'FFL dealer unavailable';
    const today   = new Date().toISOString().slice(0, 10);
    actions = `
      <div class="fw-xfer-ffl-line">Via: ${_esc(fflName)}</div>
      <div class="fw-xfer-card-acts">
        <button class="fw-doc-btn fw-doc-btn--view" data-xfer-pending-complete="${_esc(t.id)}">Mark Complete</button>
        <button class="fw-doc-btn fw-doc-btn--delete" data-xfer-cancel="${_esc(t.id)}">Cancel</button>
      </div>
      <div class="fw-xfer-date-row" hidden>
        <label class="fw-xfer-date-label">Transfer Date</label>
        <input class="fw-input fw-xfer-date-input" type="date" value="${_esc(today)}"/>
        <div class="fw-xfer-date-btns">
          <button class="fw-doc-btn fw-doc-btn--view" data-xfer-pending-confirm="${_esc(t.id)}">Confirm</button>
          <button class="fw-doc-btn" data-xfer-pending-dismiss>Dismiss</button>
        </div>
      </div>
      <div class="fw-xfer-card-err" aria-live="polite"></div>`;
  } else if (t.status === 'Complete') {
    actions = `
      <div class="fw-xfer-card-acts">
        <button class="fw-doc-btn" data-xfer-bos="${_esc(t.id)}">Generate BOS</button>
        <button class="fw-doc-btn" data-xfer-save-bos="${_esc(t.id)}">Save BOS to Record</button>
      </div>`;
  }

  return `
    <div class="fw-xfer-card">
      <div class="fw-xfer-card-top">
        <span class="fw-xfer-badge" style="color:${color}">${_esc(t.status)}</span>
        <span class="fw-xfer-type">${_esc(t.transferType)}</span>
      </div>
      <div class="fw-xfer-buyer">To: ${_esc(buyerName)}</div>
      ${dateStr ? `<div class="fw-xfer-meta">${_esc(dateStr)}${priceStr}</div>` : ''}
      ${advisoryHTML}
      ${actions}
    </div>`;
}

/**
 * HTML for the Record Transfer form.
 *
 * Bug fixed: `fflSelectOrMsg` is now defined here, where `fflPersons`
 * is available as a parameter. Previously it was undefined in this
 * function scope, causing a ReferenceError on open.
 *
 * D5: includes `#xfer-form-advisory` div for live compliance signals.
 */
function _xferFormHTML(nonOwnerPersons, ownerName = 'Unknown', fflPersons = []) {
  const typeOpts = TransferService.TRANSFER_TYPES.map(t =>
    `<option value="${_esc(t)}" ${t === 'Sale' ? 'selected' : ''}>${_esc(t)}</option>`
  ).join('');

  const buyerOpts = nonOwnerPersons.map(p =>
    `<option value="${_esc(p.id)}">${_esc(PersonService.displayName(p))}</option>`
  ).join('');

  // Build FFL select or guidance message based on available FFL persons.
  const fflOpts = fflPersons.map(p =>
    `<option value="${_esc(p.id)}">${_esc(PersonService.displayName(p))}</option>`
  ).join('');
  const fflSelectOrMsg = fflPersons.length > 0
    ? `<select class="fw-input fw-select" id="xfer-ffl-dealer">
        <option value="">— Select FFL dealer —</option>
        ${fflOpts}
       </select>`
    : `<p class="fw-hint">Add an FFL dealer in Settings → Known Persons before using this option.</p>`;

  const today = new Date().toISOString().slice(0, 10);

  return `
    <div class="fw-doc-header">
      <span class="fw-doc-header-label">RECORD TRANSFER</span>
    </div>
    <div class="fw-xfer-form">
      <div class="fw-field">
        <label class="fw-label" for="xfer-type">Transfer Type</label>
        <select class="fw-input fw-select" id="xfer-type">${typeOpts}</select>
      </div>
      <div class="fw-field">
        <label class="fw-label">Seller</label>
        <div class="fw-xfer-seller fw-input">${_esc(ownerName)}</div>
      </div>
      <div class="fw-field">
        <label class="fw-label" for="xfer-buyer">Buyer <span class="fw-required">*</span></label>
        <select class="fw-input fw-select" id="xfer-buyer">
          <option value="">— Select buyer —</option>
          ${buyerOpts}
        </select>
      </div>
      <div class="fw-field">
        <label class="fw-checkbox-label">
          <input type="checkbox" id="xfer-via-ffl" name="xfer-via-ffl"/>
          <span class="fw-checkbox-text">Transfer via FFL dealer</span>
        </label>
      </div>
      <div class="fw-field" id="xfer-ffl-section" hidden>
        <label class="fw-label" for="xfer-ffl-dealer">
          FFL Dealer <span class="fw-required">*</span>
        </label>
        ${fflSelectOrMsg}
      </div>
      <div id="xfer-form-advisory" aria-live="polite"></div>
      <div class="fw-field" id="xfer-price-wrap">
        <label class="fw-label" for="xfer-price">Sale Price (optional)</label>
        <input class="fw-input" type="number" id="xfer-price" min="0" step="0.01"
               placeholder="0.00"/>
      </div>
      <div class="fw-field">
        <label class="fw-label" for="xfer-date">Transfer Date</label>
        <input class="fw-input" type="date" id="xfer-date" value="${_esc(today)}"/>
      </div>
      <div class="fw-field">
        <label class="fw-label" for="xfer-notes">Notes (optional)</label>
        <textarea class="fw-input fw-textarea" id="xfer-notes" rows="3"></textarea>
      </div>
      <div class="fw-field-error" id="xfer-error" aria-live="polite"></div>
      <div class="fw-form-actions">
        <button class="fw-submit-btn" id="xfer-submit">Complete Transfer</button>
        <button class="fw-cancel-btn" id="xfer-cancel">Cancel</button>
      </div>
    </div>`;
}


// ── Transfer Tab: Advisory helpers ────────────────────────
//
// D5: Advisory-only compliance signals.
// All functions are pure — no async, no DOM access, no side effects.
//
// Source-of-truth split:
//  _computeFormAdvisories — uses live form state (pre-submit)
//  _computeCardAdvisories — uses stored transfer fields only (post-submit)
//  _advisoryPanelHTML     — single source of truth for all advisory copy

/**
 * Compute advisory signals from live form state.
 * Called on form open, buyer-select change, and FFL-checkbox change.
 *
 * Interstate signal mirrors the createDraft() isInterstate rule exactly:
 * both normalized states must be non-empty and differ to produce a signal.
 * If either state is missing, no interstate signal is emitted.
 *
 * @param   {object}      firearm    Firearm record
 * @param   {string|null} ownerState owner.state — may be null
 * @param   {string|null} buyerState Selected buyer's state — null if no buyer selected
 * @param   {boolean}     viaFFL     FFL checkbox state
 * @returns {{ type: string, fflSelected?: boolean }[]}
 */
function _computeFormAdvisories(firearm, ownerState, buyerState, viaFFL) {
  const signals = [];

  if (firearm.isNFA === true) {
    signals.push({ type: 'nfa' });
  }

  const sellerNorm = (ownerState || '').trim().toUpperCase();
  const buyerNorm  = (buyerState || '').trim().toUpperCase();
  if (sellerNorm && buyerNorm && sellerNorm !== buyerNorm) {
    signals.push({ type: 'interstate', fflSelected: viaFFL === true });
  }

  return signals;
}

/**
 * Compute advisory signals from stored transfer fields only.
 * Never reads live person records.
 *
 * transfer.isInterstate is the value frozen at draft creation time.
 * It is not recomputed here. A false value means "not detected from
 * available data at draft creation" — not a confirmation of intrastate status.
 *
 * @param   {object} transfer Stored transfer record
 * @param   {object} firearm  Firearm record
 * @returns {{ type: string, fflSelected?: boolean }[]}
 */
function _computeCardAdvisories(transfer, firearm) {
  const signals = [];

  if (firearm.isNFA === true) {
    signals.push({ type: 'nfa' });
  }

  if (transfer.isInterstate === true) {
    signals.push({ type: 'interstate', fflSelected: !!transfer.fflPersonId });
  }

  return signals;
}

/**
 * Render advisory signals to HTML.
 * Single source of truth for all advisory copy in the Transfer tab.
 *
 * context 'form' uses "Seller and buyer" framing for the interstate line.
 * context 'card' uses "Interstate transfer" shorthand.
 *
 * Returns '' when signals array is empty — no wrapper div is rendered.
 *
 * @param   {{ type: string, fflSelected?: boolean }[]} signals
 * @param   {'form'|'card'} [context='card']
 * @returns {string} HTML
 */
function _advisoryPanelHTML(signals, context = 'card') {
  if (!signals.length) return '';

  return signals.map(s => {
    if (s.type === 'nfa') {
      return `<div class="fw-xfer-advisory fw-xfer-advisory--warn">` +
        `⚠ NFA-regulated item — verify transfer requirements before proceeding.` +
        `</div>`;
    }
    if (s.type === 'interstate') {
      if (s.fflSelected) {
        return `<div class="fw-xfer-advisory fw-xfer-advisory--ok">` +
          `◎ FFL dealer selected for this interstate transfer.` +
          `</div>`;
      }
      const copy = context === 'form'
        ? `◎ Seller and buyer are in different states. FFL dealer involvement is typical for interstate transfers.`
        : `◎ Interstate transfer — FFL dealer involvement is typical for transfers across state lines.`;
      return `<div class="fw-xfer-advisory fw-xfer-advisory--warn">${copy}</div>`;
    }
    return '';
  }).join('');
}
