/*
 * ArsenalDB — Firearms Detail: Service Tab
 *
 * Renders maintenance history and cleaning status for one firearm.
 * Extracted from firearms.detail.js.
 *
 * Rules (inherited from firearms.detail.js):
 *  — No mutable state.
 *  — No imports from firearms.module.js.
 *  — No event wiring.
 *  — Async functions write to a DOM element passed in by the caller.
 *
 * Exported:
 *  loadServiceTab(containerEl, gunId, isStale)
 *
 * Imported by firearms.detail.js, which re-exports loadServiceTab
 * so firearms.module.js requires no changes.
 *
 * Note on _esc(): each detail sub-module carries its own private copy
 * of this helper. There is no shared utility module in the current
 * codebase. All copies are identical — if the escaping logic ever
 * changes, update all copies together.
 */

import * as MaintenanceService          from '../services/maintenance.service.js';
import Logger                           from '../core/logger.js';
import { toDisplayDate as _toDisplayDate } from '../utils/datetime.js';


// ── Private: escape helper ────────────────────────────────

function _esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


// ── Service Tab ───────────────────────────────────────────

/**
 * Load and render maintenance history into a container element.
 *
 * @param {HTMLElement} containerEl
 * @param {string}      gunId
 * @param {Function}    isStale      Returns true if render is outdated
 */
export async function loadServiceTab(containerEl, gunId, isStale = () => false) {
  try {
    const [events, overdueStatus] = await Promise.all([
      MaintenanceService.getByGun(gunId),
      MaintenanceService.getOverdueStatus(gunId),
    ]);

    if (isStale()) return;

    const statusHTML = _overdueStatusHTML(overdueStatus);

    if (events.length === 0) {
      containerEl.innerHTML = `
        ${statusHTML}
        <div class="fw-tab-placeholder">
          <div class="fw-tab-placeholder-label">No maintenance records</div>
          <div class="fw-tab-placeholder-sub">Create a work order in the Service tab</div>
        </div>`;
      return;
    }

    containerEl.innerHTML = `
      ${statusHTML}
      <div class="fw-maint-list">
        ${events.map(_maintenanceEventHTML).join('')}
      </div>`;

  } catch (err) {
    Logger.error('FirearmsDetail', 'Failed to load service tab', err);
    if (isStale()) return;
    containerEl.innerHTML = '<div class="fw-error">Failed to load maintenance history.</div>';
  }
}


// ── Service Tab: private HTML builders ────────────────────

function _overdueStatusHTML(s) {
  if (s.status === 'unknown') {
    return `<div class="fw-maint-status fw-maint-status--unknown">⚠ No cleaning record found</div>`;
  }
  if (s.status === 'overdue') {
    return `<div class="fw-maint-status fw-maint-status--overdue">⚠ Cleaning overdue — ${s.daysAgo} days since last clean</div>`;
  }
  if (s.status === 'due_soon') {
    return `<div class="fw-maint-status fw-maint-status--warn">◎ Cleaning due soon — ${s.daysAgo} days since last clean</div>`;
  }
  return `<div class="fw-maint-status fw-maint-status--ok">✓ Cleaning current — ${s.daysAgo} days ago</div>`;
}

function _maintenanceEventHTML(e) {
  const statusColor = e.status === 'Complete'   ? 'var(--color-ok)'
                    : e.status === 'InProgress' ? 'var(--color-warn)'
                    : 'var(--color-text-muted)';

  return `
    <div class="fw-maint-event">
      <div class="fw-maint-event-top">
        <span class="fw-maint-type">${_esc(e.eventType)}</span>
        <span class="fw-maint-status-dot" style="color:${statusColor}">${_esc(e.status)}</span>
      </div>
      ${e.performedAt ? `<div class="fw-maint-date">Performed: ${_toDisplayDate(e.performedAt)}</div>` : ''}
      ${e.performedBy ? `<div class="fw-maint-by">By: ${_esc(e.performedBy)}</div>` : ''}
      ${e.notes       ? `<div class="fw-maint-notes">${_esc(e.notes)}</div>` : ''}
    </div>`;
}
