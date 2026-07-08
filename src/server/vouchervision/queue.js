/*
 * VoucherVision job queue.
 *
 * Single-process, in-memory ticker backed by `vouchervision_records.status`
 * as the durable work list. On boot we resume any rows that are still
 * `pending` — there's no separate queue table.
 *
 * One tick:
 *   1. Read every `pending` record id (cheap; indexed nowhere yet but small).
 *   2. Skip ones already in `inFlight`.
 *   3. Up to `config.vouchervision.concurrency` jobs run at a time.
 *
 * Per-job (every queued record is an image — PDFs/notebooks are exploded into
 * per-page image items at upload time, see source-service.uploadPdfPages):
 *   - read bytes, POST /process, write JSON, mark complete
 *   - pages that originated from a PDF/notebook are submitted OCR-only with the
 *     label collage skipped (submitOptionsFor) so document pages don't 500
 *
 * Failure handling: client.submit already retries transient errors. Any
 * exception that escapes (4xx, exhausted retries) flips the record to `errored`
 * and stashes the error message in the on-disk JSON so we don't need a schema
 * change.
 */

const fs = require('fs');
const config = require('../config');
const client = require('./client');
const fileStore = require('../storage/file-store');
const image = require('../storage/image');
const vvRepo = require('../repositories/vouchervision-repo');
const sourceRepo = require('../repositories/source-repo');

let timer = null;
let running = false;
let stopped = true;
const inFlight = new Set();

function log(msg) {
  console.log(`[vv-queue] ${msg}`);
}

function logErr(msg, err) {
  console.error(`[vv-queue] ${msg}`, err && err.stack ? err.stack : err);
}


function finalizeError(record, err) {
  // Keep a provenance blob on disk (full error context) AND record the message
  // in the dedicated error_message column so the Library can show it directly.
  const message = String(err && err.message || err);
  const stub = JSON.stringify({
    error: message,
    error_kind: err && err.kind,
    error_status: err && err.status,
    record_id: record.id,
    source_id: record.source_id,
  }, null, 2);
  const rel = fileStore.saveVouchervisionJson(record.project_id, record.id, stub);
  vvRepo.setErrored(record.id, rel, message);
  log(`record ${record.id} errored: ${message}`);
}

/*
 * Split a VoucherVisionGO /process response dict into the pieces IRIS stores.
 * Handles formatted_json arriving as an object OR a JSON string (the Python
 * client does the same). Returns { ocr, formatted, scientificName, fullB64,
 * croppedB64 } — any of which may be null/empty.
 */
function extractArtifacts(dict) {
  const d = dict || {};
  let formatted = d.formatted_json;
  if (typeof formatted === 'string') {
    try { formatted = JSON.parse(formatted); } catch (_) { /* leave as string */ }
  }
  // OCR-only submissions (PDF / notebook pages) return an empty formatted_json
  // ("" or {}). Normalize that to null so the read models and UI cleanly treat
  // the record as "OCR present, no structured fields" instead of showing an
  // empty object.
  if (isEmptyFormatted(formatted)) formatted = null;
  const collage = d.collage_info || {};
  const scientificName = formatted && typeof formatted === 'object'
    ? (formatted.scientificName || formatted.scientific_name || null)
    : null;
  return {
    ocr: typeof d.ocr === 'string' ? d.ocr : (d.ocr == null ? null : String(d.ocr)),
    formatted: formatted ?? null,
    scientificName,
    fullB64: collage.base64image_input_resized || null,
    croppedB64: collage.base64image_text_collage || null,
  };
}

// True when the /process response carried no usable structured extraction —
// an empty string, whitespace, or an object with no keys.
function isEmptyFormatted(f) {
  if (f == null) return true;
  if (typeof f === 'string') return f.trim() === '';
  if (typeof f === 'object') return Object.keys(f).length === 0;
  return false;
}

// Decode a base64 image to a JPG on disk and return its relative path (or null).
async function saveDerivedImage(projectId, vvId, kind, b64) {
  if (!b64) return null;
  try {
    const jpeg = await image.base64ToJpeg(b64);
    if (!jpeg) return null;
    return fileStore.saveVouchervisionImage(projectId, vvId, kind, jpeg.buffer);
  } catch (err) {
    logErr(`derived image (${kind}) decode failed for record ${vvId}`, err);
    return null;
  }
}

// PDF / notebook pages are text documents with no single specimen label, so
// the server's label-collage step 500s ("No collage could be created"). Submit
// those OCR-only with the collage skipped (config-gated, on by default) so every
// page returns its text. Regular specimen images use the server defaults and
// still get formatted_json + collage. Origin is stamped on the source metadata
// at upload time (source-service.uploadPdfPages).
function submitOptionsFor(source) {
  const origin = source && source.metadata && source.metadata.origin;
  if (origin === 'pdf' || origin === 'notebook') {
    return {
      ocrOnly: config.vouchervision.pdfOcrOnly,
      skipLabelCollage: config.vouchervision.pdfSkipLabelCollage,
    };
  }
  return undefined;
}

async function processImage(record, source) {
  const abs = fileStore.resolve(source.storage_path);
  const bytes = fs.readFileSync(abs);
  const result = await client.submit({
    bytes,
    filename: source.filename,
    mimeType: source.mime_type || 'application/octet-stream',
    options: submitOptionsFor(source),
  });
  // Tag the result with the originating filename, same shape Python returns.
  result.filename = source.filename;

  const art = extractArtifacts(result);
  const fullPath = await saveDerivedImage(record.project_id, record.id, 'full', art.fullB64);
  const croppedPath = await saveDerivedImage(record.project_id, record.id, 'cropped', art.croppedB64);

  // The raw response stays on disk (cost/token analytics, provenance). Strip
  // the huge base64 blobs from it first — they're now JPGs on disk, no need to
  // keep two copies. Everything else is preserved.
  const forDisk = stripBase64(result);
  const rel = fileStore.saveVouchervisionJson(
    record.project_id, record.id, JSON.stringify(forDisk, null, 2)
  );

  vvRepo.setComplete(record.id, {
    storage_path: rel,
    ocr_text: art.ocr,
    formatted_json: art.formatted,
    scientific_name: art.scientificName,
    image_full_path: fullPath,
    image_cropped_path: croppedPath,
  });
  log(`record ${record.id} complete (image ${source.filename}` +
      `${fullPath ? ', +full' : ''}${croppedPath ? ', +cropped' : ''})`);
}

// Remove the base64 image fields from a /process dict before we persist it —
// the decoded JPGs are already on disk. Returns a shallow-ish copy.
function stripBase64(dict) {
  const copy = { ...dict };
  if (copy.collage_info && typeof copy.collage_info === 'object') {
    const { base64image_input_resized, base64image_text_collage, ...rest } = copy.collage_info;
    copy.collage_info = { ...rest, base64_stripped: true };
  }
  return copy;
}

async function processOne(row) {
  // Re-read the record so we don't act on a stale snapshot if it changed
  // between listPending and here.
  const record = vvRepo.findById(row.id);
  if (!record || record.status !== 'pending') return;
  const source = record.source_id ? sourceRepo.findById(record.source_id) : null;
  if (!source) {
    finalizeError(record, new Error('linked source not found'));
    return;
  }
  try {
    // Only image records reach the queue — PDFs/notebooks are exploded into
    // per-page image items at upload time (see source-service.uploadPdfPages).
    if (source.source_type === 'image') {
      await processImage(record, source);
    } else {
      finalizeError(record, new Error(`unsupported source_type: ${source.source_type}`));
    }
  } catch (err) {
    finalizeError(record, err);
  }
}

async function tick() {
  if (running || stopped) return;
  running = true;
  try {
    const pending = vvRepo.listPending();
    const ready = pending.filter(r => !inFlight.has(r.id));
    const slots = Math.max(0, config.vouchervision.concurrency - inFlight.size);
    const batch = ready.slice(0, slots);
    if (batch.length === 0) return;

    await Promise.all(batch.map(async (row) => {
      inFlight.add(row.id);
      try {
        await processOne(row);
      } finally {
        inFlight.delete(row.id);
      }
    }));
  } catch (err) {
    logErr('tick failure', err);
  } finally {
    running = false;
  }
}

function enqueue(_) {
  // Persistence happens in source-service via vvRepo.create; this is just a
  // wake signal so the next tick runs immediately instead of on the timer.
  if (stopped) return;
  setImmediate(() => { tick().catch(err => logErr('enqueue tick', err)); });
}

function start() {
  if (!stopped) return;
  stopped = false;
  const interval = config.vouchervision.tickIntervalMs;
  timer = setInterval(() => {
    tick().catch(err => logErr('interval tick', err));
  }, interval);
  // Don't keep the Electron event loop alive purely on the queue's behalf.
  if (timer.unref) timer.unref();
  // Resume work left pending by a previous run.
  setImmediate(() => { tick().catch(err => logErr('startup tick', err)); });
  log(`started (concurrency=${config.vouchervision.concurrency}, tick=${interval}ms)`);
}

function stop() {
  stopped = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  log('stopped');
}

module.exports = { start, stop, enqueue };
