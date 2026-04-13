/*
 * ArsenalDB — Firearms Detail: Documents Tab
 *
 * Renders the documents list and manages Attach File, Attach Photo,
 * and Add Note sub-states for one firearm.
 * Extracted from firearms.detail.js.
 *
 * Rules (inherited from firearms.detail.js):
 *  — No mutable state.
 *  — No imports from firearms.module.js.
 *  — No event wiring outside loadDocumentsTab.
 *  — Async functions write to a DOM element passed in by the caller.
 *  — Tab sub-state (list / attach / note) is managed via closures
 *    inside loadDocumentsTab and resets on every tab open.
 *
 * Exported:
 *  loadDocumentsTab(containerEl, gunId, isStale)
 *
 * Imported by firearms.detail.js, which re-exports loadDocumentsTab
 * so firearms.module.js requires no changes.
 *
 * Bug fixed in this extraction:
 *  _attachFormHTML() previously referenced `fflPersons` and
 *  `fflSelectOrMsg`, which are not in scope and caused a
 *  ReferenceError whenever Attach File or Attach Photo was tapped.
 *  Those orphaned lines have been removed. The function does not
 *  involve FFL logic and never did — the code was misplaced.
 *
 * Note on _esc(): local private copy. See firearms.detail.service.js
 * for the full note on why copies are used.
 */

import * as DocumentService from '../services/document.service.js';
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


// ── Documents Tab ─────────────────────────────────────────

/**
 * Load and render the Documents tab into containerEl.
 * Three states: list (default), attach form, note form.
 * State is managed by closure variables — not in firearms.module.js.
 * Switching tabs and returning resets to list.
 *
 * @param {HTMLElement} containerEl
 * @param {string}      gunId
 * @param {Function}    isStale      Returns true if tab is no longer active
 */
export async function loadDocumentsTab(containerEl, gunId, isStale = () => false) {

  // ── List state ──────────────────────────────────────────

  async function renderList() {
    let docs;
    try {
      docs = await DocumentService.getByGun(gunId);
    } catch (err) {
      Logger.error('FirearmsDetail', 'Failed to load documents', err);
      if (isStale()) return;
      containerEl.innerHTML = '<div class="fw-error">Failed to load documents.</div>';
      return;
    }

    if (isStale()) return;

    containerEl.innerHTML = _docListHTML(docs);

    containerEl.querySelector('#doc-attach-btn')
      ?.addEventListener('click', () => renderAttachForm(false));

    containerEl.querySelector('#doc-photo-btn')
      ?.addEventListener('click', () => renderAttachForm(true));

    containerEl.querySelector('#doc-note-btn')
      ?.addEventListener('click', renderNoteForm);

    // Expand/collapse is pure DOM — no re-render, no module state
    containerEl.querySelectorAll('[data-doc-toggle]').forEach(btn => {
      const noteBody = btn.closest('.fw-doc-card')?.querySelector('.fw-doc-note-body');
      if (!noteBody) return;
      btn.addEventListener('click', () => {
        const willShow = noteBody.hidden;
        noteBody.hidden = !willShow;
        btn.textContent = willShow ? 'Hide' : 'Show';
      });
    });

    containerEl.querySelectorAll('[data-doc-view]').forEach(btn => {
      btn.addEventListener('click', () => handleView(btn.dataset.docView));
    });

    containerEl.querySelectorAll('[data-doc-delete]').forEach(btn => {
      btn.addEventListener('click', () => handleDelete(btn.dataset.docDelete));
    });
  }

  // ── Note form state ─────────────────────────────────────

  function renderNoteForm() {
    if (isStale()) return;
    containerEl.innerHTML = _noteFormHTML();
    containerEl.querySelector('#doc-note-cancel')
      ?.addEventListener('click', () => renderList());
    containerEl.querySelector('#doc-note-submit')
      ?.addEventListener('click', handleAddNote);
  }

  async function handleAddNote() {
    const title     = containerEl.querySelector('#doc-note-title')?.value.trim() || '';
    const noteText  = containerEl.querySelector('#doc-note-text')?.value.trim()  || '';
    const type      = containerEl.querySelector('#doc-note-type')?.value || 'Manual';
    const errEl     = containerEl.querySelector('#doc-note-error');
    const submitBtn = containerEl.querySelector('#doc-note-submit');

    if (!title || !noteText) {
      if (errEl) errEl.textContent = 'Title and note text are both required.';
      return;
    }

    if (errEl) errEl.textContent = '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }

    try {
      await DocumentService.addNote(gunId, { title, notes: noteText, documentType: type });
    } catch (err) {
      Logger.error('FirearmsDetail', 'addNote failed', err);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Note'; }
      if (errEl) errEl.textContent = err.message;
      return;
    }

    if (isStale()) return;
    renderList();
  }

  // ── Attach form state ───────────────────────────────────

  function renderAttachForm(imageOnly = false) {
    if (isStale()) return;

    containerEl.innerHTML = _attachFormHTML(imageOnly);

    const fileInput = containerEl.querySelector('#doc-file');
    const sizeInfo  = containerEl.querySelector('#doc-size-info');
    const submitBtn = containerEl.querySelector('#doc-submit');

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) {
        sizeInfo.textContent = '';
        sizeInfo.className   = 'fw-doc-size-info';
        if (submitBtn) submitBtn.disabled = false;
        return;
      }
      _updateSizeFeedback(file, sizeInfo, submitBtn);
    });

    containerEl.querySelector('#doc-cancel')
      ?.addEventListener('click', () => renderList());

    containerEl.querySelector('#doc-submit')
      ?.addEventListener('click', handleAttach);
  }

  // ── Handlers ────────────────────────────────────────────

  async function handleView(docId) {
    let record;
    try {
      record = await DocumentService.getPayload(docId);
    } catch (err) {
      Logger.error('FirearmsDetail', `getPayload failed for ${docId}`, err);
      return;
    }

    if (isStale()) return;

    // Build a blob from the base64 data URL and open in a new tab.
    // Delay revocation 10 s — allows the browser to load the file.
    try {
      const base64 = record.data.split(',')[1];
      const binary = atob(base64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: record.mimeType });
      const url  = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      Logger.error('FirearmsDetail', 'Failed to open document', err);
    }
  }

  async function handleDelete(docId) {
    if (!confirm('Delete this document? This cannot be undone.')) return;

    try {
      await DocumentService.remove(docId, gunId);
    } catch (err) {
      Logger.error('FirearmsDetail', `remove failed for ${docId}`, err);
      return;
    }

    if (isStale()) return;
    renderList();
  }

  async function handleAttach() {
    const fileInput = containerEl.querySelector('#doc-file');
    const file      = fileInput?.files?.[0];
    if (!file) return;

    // Guard: submit should already be disabled for oversized files,
    // but check again before the service call as a safety net.
    if (file.size > DocumentService.MAX_SIZE_BYTES) return;

    const type      = containerEl.querySelector('#doc-type')?.value || 'Other';
    const titleRaw  = containerEl.querySelector('#doc-title')?.value.trim() || '';
    const errEl     = containerEl.querySelector('#doc-error');
    const submitBtn = containerEl.querySelector('#doc-submit');

    if (errEl) errEl.textContent = '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Attaching…'; }

    try {
      await DocumentService.attach(gunId, file, { documentType: type, title: titleRaw });
    } catch (err) {
      Logger.error('FirearmsDetail', 'Attach failed', err);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Attach Document'; }
      if (errEl) errEl.textContent = err.message;
      return;
    }

    if (isStale()) return;
    renderList();
  }

  // ── Initial render ──────────────────────────────────────

  await renderList();
}


// ── Documents Tab: private HTML builders ──────────────────

function _docListHTML(docs) {
  const header = `
    <div class="fw-doc-header">
      <span class="fw-doc-header-label">DOCUMENTS</span>
      <div class="fw-doc-header-btns">
        <button class="fw-doc-action-btn fw-doc-action-btn--secondary" id="doc-note-btn">Add Note</button>
        <button class="fw-doc-action-btn fw-doc-action-btn--secondary" id="doc-photo-btn">Attach Photo</button>
        <button class="fw-doc-action-btn" id="doc-attach-btn">Attach File</button>
      </div>
    </div>`;

  if (docs.length === 0) {
    return header + `
      <div class="fw-doc-empty">
        <div class="fw-doc-empty-text">No documents attached</div>
        <div class="fw-doc-empty-sub">Tap Attach File to add a receipt or form, or Add Note for text records</div>
      </div>`;
  }

  const cards = docs.map(doc =>
    doc.source === 'Manual'              ? _noteCardHTML(doc)
    : doc.mimeType?.startsWith('image/') ? _imageCardHTML(doc)
    : _fileCardHTML(doc)
  ).join('');

  return header + `<div class="fw-doc-list">${cards}</div>`;
}

function _fileCardHTML(doc) {
  return `
    <div class="fw-doc-card">
      <div class="fw-doc-card-top">
        <span class="fw-doc-badge">${_esc(doc.documentType)}</span>
        <div class="fw-doc-card-actions">
          <button class="fw-doc-btn fw-doc-btn--view"   data-doc-view="${_esc(doc.id)}">View</button>
          <button class="fw-doc-btn fw-doc-btn--delete" data-doc-delete="${_esc(doc.id)}">Delete</button>
        </div>
      </div>
      <div class="fw-doc-title">${_esc(doc.title)}</div>
      <div class="fw-doc-meta">
        <span>${_formatBytes(doc.fileSize)}</span>
        <span>${_toDocDate(doc.createdAt)}</span>
      </div>
    </div>`;
}

function _imageCardHTML(doc) {
  return `
    <div class="fw-doc-card">
      <div class="fw-doc-card-top">
        <span class="fw-doc-badge fw-doc-badge--image">Photo</span>
        <div class="fw-doc-card-actions">
          <button class="fw-doc-btn fw-doc-btn--view"   data-doc-view="${_esc(doc.id)}">View</button>
          <button class="fw-doc-btn fw-doc-btn--delete" data-doc-delete="${_esc(doc.id)}">Delete</button>
        </div>
      </div>
      <div class="fw-doc-title">${_esc(doc.title)}</div>
      <div class="fw-doc-meta">
        <span>${_formatBytes(doc.fileSize)}</span>
        <span>${_toDocDate(doc.createdAt)}</span>
      </div>
    </div>`;
}

function _noteCardHTML(doc) {
  return `
    <div class="fw-doc-card">
      <div class="fw-doc-card-top">
        <span class="fw-doc-badge">${_esc(doc.documentType)}</span>
        <div class="fw-doc-card-actions">
          <button class="fw-doc-btn fw-doc-btn--toggle" data-doc-toggle="${_esc(doc.id)}">Show</button>
          <button class="fw-doc-btn fw-doc-btn--delete" data-doc-delete="${_esc(doc.id)}">Delete</button>
        </div>
      </div>
      <div class="fw-doc-title">${_esc(doc.title)}</div>
      <div class="fw-doc-meta">
        <span>${_toDocDate(doc.createdAt)}</span>
      </div>
      <div class="fw-doc-note-body" hidden>${_esc(doc.notes ?? '')}</div>
    </div>`;
}

/**
 * HTML for the Attach File / Attach Photo form.
 *
 * imageOnly=true restricts the file input to images and changes the header.
 * This function has no FFL logic — FFL-related variables previously present
 * here were misplaced code that caused a ReferenceError on open. Removed.
 */
function _attachFormHTML(imageOnly = false) {
  const typeOpts = DocumentService.DOCUMENT_TYPES.map(t =>
    `<option value="${_esc(t)}">${_esc(t)}</option>`
  ).join('');

  return `
    <div class="fw-doc-header">
      <span class="fw-doc-header-label">${imageOnly ? 'ATTACH PHOTO' : 'ATTACH FILE'}</span>
    </div>
    <div class="fw-doc-form">
      <div class="fw-field">
        <label class="fw-label" for="doc-file">File <span class="fw-required">*</span></label>
        <input type="file" id="doc-file" class="fw-doc-file-input" ${imageOnly ? 'accept="image/*"' : 'accept="*/*"'}/>
        <div id="doc-size-info" class="fw-doc-size-info"></div>
      </div>
      <div class="fw-field">
        <label class="fw-label" for="doc-type">Document Type</label>
        <select class="fw-input fw-select" id="doc-type">
          ${typeOpts}
        </select>
      </div>
      <div class="fw-field">
        <label class="fw-label" for="doc-title">Title <span class="fw-doc-optional">(optional — defaults to filename)</span></label>
        <input class="fw-input" type="text" id="doc-title" autocomplete="off"
               placeholder="${imageOnly ? 'e.g. Gun room safe photo' : 'e.g. Glock 19 Purchase Receipt'}"/>
      </div>
      <div class="fw-doc-form-error" id="doc-error" aria-live="polite"></div>
      <div class="fw-doc-form-actions">
        <button class="fw-submit-btn" id="doc-submit">Attach Document</button>
        <button class="fw-cancel-btn" id="doc-cancel">Cancel</button>
      </div>
    </div>`;
}


// ── Documents Tab: private helpers ────────────────────────

function _updateSizeFeedback(file, sizeInfoEl, submitBtn) {
  const max  = DocumentService.MAX_SIZE_BYTES;
  const warn = DocumentService.WARN_SIZE_BYTES;

  if (file.size > max) {
    sizeInfoEl.className = 'fw-doc-size-info fw-doc-size-info--error';
    sizeInfoEl.textContent =
      `File too large: ${_formatBytes(file.size)} — maximum is ${_formatBytes(max)}`;
    if (submitBtn) submitBtn.disabled = true;
  } else if (file.size > warn) {
    sizeInfoEl.className = 'fw-doc-size-info fw-doc-size-info--warn';
    sizeInfoEl.textContent =
      `Large file: ${_formatBytes(file.size)} — may affect backup size`;
    if (submitBtn) submitBtn.disabled = false;
  } else {
    sizeInfoEl.className = 'fw-doc-size-info';
    sizeInfoEl.textContent = _formatBytes(file.size);
    if (submitBtn) submitBtn.disabled = false;
  }
}

function _formatBytes(bytes) {
  if (bytes == null)       return '';
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function _toDocDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso.slice(0, 10); }
}


// ── Note Form HTML builder ────────────────────────────────

function _noteFormHTML() {
  const typeOpts = DocumentService.DOCUMENT_TYPES.map(t =>
    `<option value="${_esc(t)}" ${t === 'Manual' ? 'selected' : ''}>${_esc(t)}</option>`
  ).join('');

  return `
    <div class="fw-doc-header">
      <span class="fw-doc-header-label">ADD NOTE</span>
    </div>
    <div class="fw-doc-form">
      <div class="fw-field">
        <label class="fw-label" for="doc-note-title">
          Title <span class="fw-required" aria-hidden="true"> *</span>
        </label>
        <input class="fw-input" type="text" id="doc-note-title" autocomplete="off"
               placeholder="e.g. Insurance coverage details"/>
      </div>
      <div class="fw-field">
        <label class="fw-label" for="doc-note-type">Document Type</label>
        <select class="fw-input fw-select" id="doc-note-type">
          ${typeOpts}
        </select>
      </div>
      <div class="fw-field">
        <label class="fw-label" for="doc-note-text">
          Note <span class="fw-required" aria-hidden="true"> *</span>
        </label>
        <textarea class="fw-input fw-textarea" id="doc-note-text" rows="5"
                  placeholder="Enter note text…"></textarea>
      </div>
      <div class="fw-doc-form-error" id="doc-note-error" aria-live="polite"></div>
      <div class="fw-doc-form-actions">
        <button class="fw-submit-btn" id="doc-note-submit">Save Note</button>
        <button class="fw-cancel-btn" id="doc-note-cancel">Cancel</button>
      </div>
    </div>`;
}
