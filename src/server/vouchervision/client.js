/*
 * VoucherVisionGO HTTP client.
 *
 * Submits one image (or one rasterised PDF page) at a time to the sync
 * `/process` endpoint. Form-field shape and auth-header selection are
 * faithful ports of VoucherVisionGO-client/VoucherVision.py:116-216 — the
 * server is strict about the wire format (booleans must be the literal
 * string 'true', `engines` must be a repeated multipart field).
 *
 * No DB or filesystem knowledge — callers hand in bytes and get back the
 * parsed JSON result dict.
 *
 * Network primitives are Node 18 globals (`fetch`, `FormData`, `Blob`,
 * `AbortController`) — no extra HTTP dep.
 */

const config = require('../config');

const ERR_4XX = 'vv-client-bad-request';
const ERR_RETRYABLE = 'vv-client-retryable';

function pickAuthHeader(apiKey) {
  // Python: Bearer if the token looks like a JWT (has dots and is long),
  // otherwise X-API-Key. Reconstructing the same heuristic so a single
  // VV_API_KEY env var works for both shapes.
  if (apiKey && apiKey.length > 100 && apiKey.includes('.')) {
    return { Authorization: `Bearer ${apiKey}` };
  }
  return { 'X-API-Key': apiKey };
}

// Merge per-call flag overrides onto the base config. Only a whitelist of
// boolean submission flags may be overridden — used to force ocr_only +
// skip_label_collage for PDF / notebook pages (document pages have no single
// specimen label, so the collage step 500s: "No collage could be created").
function withOptions(vv, options) {
  if (!options) return vv;
  const merged = { ...vv };
  for (const k of ['ocrOnly', 'skipLabelCollage', 'notebookMode']) {
    if (options[k] !== undefined) merged[k] = options[k];
  }
  return merged;
}

function buildFormFields(vv) {
  // Returns an array of [name, value] pairs. `engines` is intentionally
  // emitted as one entry per engine — the server treats it as a list.
  const fields = [];
  if (vv.prompt)   fields.push(['prompt', vv.prompt]);
  if (vv.llmModel) fields.push(['llm_model', vv.llmModel]);

  if (vv.engines) {
    for (const e of String(vv.engines).split(',').map(s => s.trim()).filter(Boolean)) {
      fields.push(['engines', e]);
    }
  }

  // Wire quirk: booleans must be the literal string 'true' (and the field
  // is OMITTED when false — the server checks for presence + value).
  if (vv.ocrOnly)          fields.push(['ocr_only', 'true']);
  if (vv.notebookMode)     fields.push(['notebook_mode', 'true']);
  if (vv.skipLabelCollage) fields.push(['skip_label_collage', 'true']);
  if (vv.includeWfo)       fields.push(['include_wfo', 'true']);
  if (vv.includeCop90)     fields.push(['include_cop90', 'true']);

  if (vv.vertexProject) {
    fields.push(['vertex_project', vv.vertexProject]);
    fields.push(['vertex_region', vv.vertexRegion || 'global']);
  }
  return fields;
}

async function postWithTimeout(url, init, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function classifyError(res) {
  // 4xx is a permanent rejection from the server's perspective — bad request,
  // bad auth, unsupported format. No point retrying.
  if (res.status >= 400 && res.status < 500) return ERR_4XX;
  return ERR_RETRYABLE;
}

async function attemptSubmit({ bytes, filename, mimeType, options }) {
  const vv = withOptions(config.vouchervision, options);
  const url = vv.apiBaseUrl.replace(/\/+$/, '') + vv.endpoint;

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType || 'application/octet-stream' }), filename);
  for (const [k, v] of buildFormFields(vv)) form.append(k, v);

  const headers = {
    Accept: 'application/json',
    ...pickAuthHeader(vv.apiKey),
  };

  const res = await postWithTimeout(url, { method: 'POST', headers, body: form }, vv.submitTimeoutMs);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`VV /process ${res.status}: ${text.slice(0, 300)}`);
    err.kind = classifyError(res);
    err.status = res.status;
    throw err;
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await res.text().catch(() => '');
    const err = new Error(`VV /process returned non-JSON (${ct}): ${text.slice(0, 200)}`);
    err.kind = ERR_RETRYABLE;
    throw err;
  }

  return res.json();
}

/*
 * Submit one image-like payload (image bytes or a rasterised PDF page) to
 * /process. Retries network errors and 5xx up to `maxRetries` with
 * exponential backoff (5s, 30s, 150s...). 4xx fails immediately.
 *
 * `options` may override the ocr_only / skip_label_collage / notebook_mode
 * flags for this one submission (PDF and notebook pages need ocr_only +
 * skip_label_collage). Returns the parsed JSON dict on success; throws on
 * terminal failure.
 */
async function submit({ bytes, filename, mimeType, options }) {
  const vv = config.vouchervision;
  const maxAttempts = (vv.maxRetries ?? 2) + 1;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await attemptSubmit({ bytes, filename, mimeType, options });
    } catch (err) {
      lastErr = err;
      if (err.kind === ERR_4XX) throw err;
      if (attempt === maxAttempts) throw err;
      const backoffMs = 5000 * Math.pow(6, attempt - 1); // 5s, 30s, 180s...
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

/*
 * GET /auth-check. Returns true on 200, false otherwise. Used at boot to log
 * one diagnostic line; never blocks startup.
 */
async function authCheck() {
  const vv = config.vouchervision;
  if (!vv.apiBaseUrl || !vv.apiKey) return false;
  try {
    const url = vv.apiBaseUrl.replace(/\/+$/, '') + '/auth-check';
    const res = await postWithTimeout(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...pickAuthHeader(vv.apiKey) },
    }, 10000);
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { submit, authCheck };
