/*
 * PDF page rasteriser. Splits a PDF into per-page PNG buffers in memory so
 * the queue can submit each page through the VoucherVisionGO `/process`
 * endpoint individually — mirrors the Python client's local-split strategy
 * (VoucherVisionGO-client/VoucherVision.py:951-992) and lets us avoid the
 * server's async PDF lifecycle entirely.
 *
 * `pdf-to-img` is ESM-only (v4+); we bridge with dynamic import so the rest
 * of the CommonJS codebase doesn't change. This module is the ONLY place
 * that imports `pdf-to-img`, so swapping rasterisers later is a one-file
 * change.
 *
 * Scale ↔ DPI: PDF.js renders at 72 DPI when scale=1, so scale = dpi / 72.
 * Output is PNG (the library's native format); the server's Pillow stack
 * accepts it the same as JPG.
 */

const path = require('path');

let pdfFn = null;

async function getPdf() {
  if (pdfFn) return pdfFn;
  const mod = await import('pdf-to-img');
  pdfFn = mod.pdf;
  return pdfFn;
}

function dpiToScale(dpi) {
  const n = Number(dpi) || 150;
  return n / 72;
}

/*
 * Yields { pageNumber, buffer, filename, mimeType } for every page of the PDF
 * at `absPath`. `originalFilename` shapes the per-page filename so server
 * logs / response keys stay traceable to the source.
 *
 * Filename pattern matches the Python client:
 *   <basename-without-ext>__page_0001.png
 */
async function* renderPages(absPath, { dpi = 150, originalFilename } = {}) {
  const pdf = await getPdf();
  const doc = await pdf(absPath, { scale: dpiToScale(dpi) });
  const baseName = path.parse(originalFilename || path.basename(absPath)).name;

  let pageNumber = 0;
  for await (const buffer of doc) {
    pageNumber += 1;
    const paddedNum = String(pageNumber).padStart(4, '0');
    yield {
      pageNumber,
      buffer,
      filename: `${baseName}__page_${paddedNum}.png`,
      mimeType: 'image/png',
    };
  }
}

/*
 * Page count without rasterising. Useful for logging / progress estimation;
 * the queue uses this to decide whether to log "splitting N pages..." before
 * the slow loop starts.
 */
async function pageCount(absPath) {
  const pdf = await getPdf();
  const doc = await pdf(absPath);
  return doc.length;
}

module.exports = { renderPages, pageCount };
