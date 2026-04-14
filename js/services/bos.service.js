/*
 * ArsenalDB — BosService
 *
 * Generates a print-ready Bill of Sale HTML document from a completed
 * transfer record. Uses browser print (window.print) — no PDF library.
 *
 * generate(transfer, firearm)
 *   Pure function. All formatting is done here — the UI layer stays dumb.
 *   Returns { html: string }.
 *
 * print(transfer, firearm)
 *   Calls generate(), opens a new window, writes the document, triggers
 *   the print dialog after 300 ms. Throws on popup block — no hidden
 *   status branching, no silent failure.
 *
 * Not implemented in D2a:
 *  — Storing the BOS to DocumentService (D2b)
 *  — Legal boilerplate / compliance attestation
 *  — Signature capture
 */


import * as DocumentService from './document.service.js';


// ── Private: HTML escape ──────────────────────────────────

function _e(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


// ── Private: formatting helpers ───────────────────────────
// All BOS formatting lives here — not in the calling UI code.

function _formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return iso; }
}

function _formatCurrency(amount) {
  if (amount == null) return null;
  return '$' + Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function _formatToday() {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}


// ── Private: field HTML builders ──────────────────────────

/**
 * A labeled field. If value is null/empty, renders a blank ruled line
 * suitable for handwriting on a printed copy.
 */
function _field(label, value, opts = {}) {
  const width = opts.wide ? 'bos-field bos-field--wide' : 'bos-field';
  if (value) {
    return `<div class="${width}">
      <div class="bos-field-label">${_e(label)}</div>
      <div class="bos-field-value">${_e(String(value))}</div>
    </div>`;
  }
  return `<div class="${width}">
    <div class="bos-field-label">${_e(label)}</div>
    <div class="bos-field-blank"></div>
  </div>`;
}

/** Two or three fields side-by-side. */
function _row(...fields) {
  return `<div class="bos-row">${fields.join('')}</div>`;
}

/** A labeled section container. */
function _section(label, content) {
  return `
    <div class="bos-section">
      <div class="bos-section-label">${_e(label)}</div>
      ${content}
    </div>`;
}


// ── Private: document CSS ─────────────────────────────────

function _css() {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 11pt;
      line-height: 1.5;
      color: #111;
      background: #fff;
      padding: 1.8cm 2cm;
      max-width: 21cm;
      margin: 0 auto;
    }

    /* ── Print button (screen only) ─── */
    .bos-print-btn {
      display: block;
      margin: 0 auto 24pt;
      padding: 8pt 28pt;
      background: #111;
      color: #fff;
      border: none;
      cursor: pointer;
      font-size: 10pt;
      font-family: inherit;
      letter-spacing: 0.05em;
    }

    /* ── Title block ─── */
    .bos-title {
      font-size: 22pt;
      font-weight: bold;
      text-align: center;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 4pt;
    }
    .bos-subtitle {
      font-size: 10pt;
      text-align: center;
      color: #555;
      margin-bottom: 28pt;
    }

    /* ── Section ─── */
    .bos-section { margin-bottom: 20pt; }
    .bos-section-label {
      font-size: 8pt;
      font-weight: bold;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #555;
      border-bottom: 1pt solid #999;
      padding-bottom: 3pt;
      margin-bottom: 10pt;
    }

    /* ── Fields ─── */
    .bos-row { display: flex; gap: 20pt; margin-bottom: 8pt; }
    .bos-field { flex: 1; }
    .bos-field--wide { flex: 2; }
    .bos-field-label { font-size: 8pt; color: #666; margin-bottom: 2pt; }
    .bos-field-value { font-size: 11pt; }
    .bos-field-blank {
      border-bottom: 0.75pt solid #999;
      min-height: 18pt;
      margin-top: 2pt;
    }

    /* ── Consideration ─── */
    .bos-consideration {
      font-size: 12pt;
      font-weight: bold;
      padding: 8pt 0;
    }
    .bos-consideration-sub {
      font-size: 9pt;
      color: #555;
      margin-top: 2pt;
    }

    /* ── Notes ─── */
    .bos-notes-text {
      font-size: 10pt;
      white-space: pre-wrap;
      color: #333;
      padding: 6pt 0;
      line-height: 1.6;
    }

    /* ── Signature blocks ─── */
    .bos-signatures {
      display: flex;
      gap: 48pt;
      margin-top: 40pt;
    }
    .bos-sig-block { flex: 1; }
    .bos-sig-line {
      border-bottom: 1pt solid #111;
      height: 36pt;
      margin-bottom: 5pt;
    }
    .bos-sig-label { font-size: 9pt; font-weight: bold; }
    .bos-sig-date {
      margin-top: 10pt;
      border-bottom: 0.75pt solid #999;
      height: 18pt;
    }
    .bos-sig-date-label { font-size: 8pt; color: #666; margin-top: 3pt; }

    /* ── Footer ─── */
    .bos-footer {
      margin-top: 28pt;
      padding-top: 8pt;
      border-top: 0.5pt solid #ccc;
      font-size: 8pt;
      color: #999;
      text-align: center;
    }

    /* ── Print media ─── */
    @media print {
      .bos-print-btn { display: none; }
      body { padding: 1cm 1.5cm; }
    }`;
}


// ── Public: generate ──────────────────────────────────────

/**
 * Generate a complete, self-contained BOS HTML document.
 * Pure function — no DB calls, no async, no side effects.
 *
 * Reads exclusively from embedded snapshots (transfer.sellerSnapshot,
 * transfer.buyerSnapshot) and the firearm record — never from live
 * person records. The snapshots represent the parties at the moment
 * of transfer and are legally the correct source of truth.
 *
 * All formatting (currency, dates, labels) is done here.
 * The calling UI layer passes data and receives HTML — nothing more.
 *
 * @param   {object} transfer  Completed transfer record with snapshots embedded
 * @param   {object} firearm   Firearm record
 * @returns {{ html: string }}
 * @throws  If transfer is not Complete or snapshots are missing
 */
export function generate(transfer, firearm) {
  if (transfer.status !== 'Complete') {
    throw new Error(
      `BosService.generate: transfer status is "${transfer.status}" — ` +
      `only Complete transfers can produce a bill of sale.`
    );
  }
  if (!transfer.sellerSnapshot || !transfer.buyerSnapshot) {
    throw new Error(
      'BosService.generate: transfer is missing seller or buyer snapshot. ' +
      'This transfer record may be corrupted.'
    );
  }

  const seller     = transfer.sellerSnapshot;
  const buyer      = transfer.buyerSnapshot;
  const dateStr    = _formatDate(transfer.transferDate) || '—';
  const generatedAt = _formatToday();

  // ── Firearm section ─────────────────────────────────────
  const nfaNote = firearm.isNFA
    ? '<div class="bos-row"><div class="bos-field"><div class="bos-field-value" style="color:#b00">⚠ NFA-regulated item</div></div></div>'
    : '';

  const firearmSection = _section('Firearm', `
    ${_row(
      _field('Make',          firearm.make),
      _field('Model',         firearm.model),
      _field('Type',          firearm.type)
    )}
    ${_row(
      _field('Caliber',       firearm.caliber),
      _field('Serial Number', firearm.serialNumber, { wide: true })
    )}
    ${nfaNote}
  `);

  // ── Seller section ──────────────────────────────────────
  const sellerSection = _section('Seller', `
    ${_row(
      _field('Name',  seller.displayName, { wide: true }),
      _field('Phone', seller.phone),
      _field('Email', seller.email, { wide: true })
    )}
  `);

  // ── Buyer section ───────────────────────────────────────
  const buyerSection = _section('Buyer', `
    ${_row(
      _field('Name',  buyer.displayName, { wide: true }),
      _field('Phone', buyer.phone),
      _field('Email', buyer.email, { wide: true })
    )}
  `);

  // ── Consideration section ───────────────────────────────
  let considerationBody;
  if (transfer.transferType === 'Sale' && transfer.salePrice != null) {
    const formatted = _formatCurrency(transfer.salePrice);
    considerationBody = `
      <div class="bos-consideration">${_e(formatted)}</div>
      <div class="bos-consideration-sub">Cash sale — monetary consideration received</div>`;
  } else {
    const typeLabel = _e(transfer.transferType || 'Transfer');
    considerationBody = `
      <div class="bos-consideration">${typeLabel}</div>
      <div class="bos-consideration-sub">No monetary consideration</div>`;
  }
  const considerationSection = _section('Consideration', considerationBody);

  // ── Notes section (conditional) ─────────────────────────
  const notesSection = transfer.notes
    ? _section('Notes', `<div class="bos-notes-text">${_e(transfer.notes)}</div>`)
    : '';

  // ── Signature blocks ─────────────────────────────────────
  const signatures = `
    <div class="bos-signatures">
      <div class="bos-sig-block">
        <div class="bos-sig-line"></div>
        <div class="bos-sig-label">Seller Signature</div>
        <div class="bos-sig-date"></div>
        <div class="bos-sig-date-label">Date</div>
      </div>
      <div class="bos-sig-block">
        <div class="bos-sig-line"></div>
        <div class="bos-sig-label">Buyer Signature</div>
        <div class="bos-sig-date"></div>
        <div class="bos-sig-date-label">Date</div>
      </div>
    </div>`;

  // ── Assemble ─────────────────────────────────────────────
  const title = `${_e(firearm.make)} ${_e(firearm.model)}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Bill of Sale — ${title}</title>
  <style>${_css()}</style>
</head>
<body>
  <button class="bos-print-btn" onclick="window.print()">Print / Save as PDF</button>

  <div class="bos-title">Bill of Sale</div>
  <div class="bos-subtitle">${_e(transfer.transferType)} &nbsp;·&nbsp; ${_e(dateStr)}</div>

  ${firearmSection}
  ${sellerSection}
  ${buyerSection}
  ${considerationSection}
  ${notesSection}
  ${signatures}

  <div class="bos-footer">Generated by ArsenalDB &nbsp;·&nbsp; ${_e(generatedAt)}</div>
</body>
</html>`;

  return { html };
}


// ── Public: print ─────────────────────────────────────────

/**
 * Generate the BOS and open it for printing in a new browser window.
 *
 * Throws { code: 'POPUP_BLOCKED' } if window.open() returns null.
 * All other errors propagate directly from generate() (guard failures).
 * No hidden status branching — success completes, failure throws.
 *
 * The 300 ms delay before window.print() allows the browser to finish
 * rendering the document before the print dialog opens.
 *
 * @param {object} transfer  Completed transfer record
 * @param {object} firearm   Firearm record
 */
export function print(transfer, firearm) {
  const { html } = generate(transfer, firearm);

  const win = window.open('', '_blank');
  if (!win) {
    const err = new Error(
      'Popup blocked. Allow popups for this site to print the bill of sale.'
    );
    err.code = 'POPUP_BLOCKED';
    throw err;
  }

  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 300);
}


// ── Public: attachToRecord ────────────────────────────────

/**
 * Generate the BOS HTML, encode it, and attach it to the firearm's
 * document record via DocumentService.attachRaw().
 *
 * Each call creates a new document record — existing BOS records are
 * never replaced or superseded. The user may delete unwanted copies
 * via the Documents tab.
 *
 * fileSize is the byte count of the original HTML string BEFORE base64
 * encoding. This matches what was actually produced, not the encoded size.
 *
 * @param   {object} transfer  Completed transfer record with snapshots embedded
 * @param   {object} firearm   Firearm record
 * @returns {Promise<object>}  The created document record
 * @throws  From generate() if transfer is not Complete or snapshots missing
 */
export async function attachToRecord(transfer, firearm) {
  const { html } = generate(transfer, firearm);

  // Encode HTML to base64 data URL.
  // unescape(encodeURIComponent(...)) handles non-ASCII characters before btoa().
  const encoded  = btoa(unescape(encodeURIComponent(html)));
  const dataUrl  = `data:text/html;base64,${encoded}`;

  // fileSize: byte count of the original HTML string before encoding.
  // new TextEncoder().encode() gives the accurate UTF-8 byte length.
  const fileSize = new TextEncoder().encode(html).length;

  const title = `Bill of Sale \u2014 ${transfer.transferDate || 'unknown date'}`;

  return DocumentService.attachRaw(transfer.gunId, {
    data:         dataUrl,
    mimeType:     'text/html',
    fileSize,
    title,
    documentType: 'Bill of Sale',
    source:       'Generated',
    transferId:   transfer.id,
  });
}
