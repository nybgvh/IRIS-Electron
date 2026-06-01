/*
 * Configuration — the ONE place in the codebase that reads process.env.
 *
 * Why: every other module reads `config.foo` instead of `process.env.FOO`.
 * That makes the codebase trivially portable to the future web service
 * (different env names? wrap them here; the rest of the code doesn't move)
 * and makes it possible to see every knob the app responds to by reading
 * this single file.
 *
 * Loading: `src/main/index.js` calls dotenv to populate `process.env` from
 * the repo-root `.env` ONLY in unpackaged dev builds. Packaged builds
 * receive their configuration through the host environment (or fall back
 * to the defaults below — which is the normal case because the shipped
 * app needs no secrets, just the public server URL).
 *
 * Do NOT add API keys to defaults. Secrets either come from the dev's
 * `.env` (local) or are absent (production renderer talks to a server
 * that holds them).
 */

function str(name, fallback = '') {
  const v = process.env[name];
  return (v == null || v === '') ? fallback : String(v);
}

function bool(name, fallback = false) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
}

function int(name, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  // The IRIS web service URL. Unused in Phase 0 (main process IS the server),
  // here so the renderer can be pointed at a real backend later without code
  // changes. Public information — fine to bake in.
  serverUrl: str('IRIS_SERVER_URL', ''),

  storage: {
    // Absolute path to the uploads root. If empty, the host resolves to
    // <userData>/storage via src/main/paths.js. Repositories store paths
    // relative to this root, so changing it does not break existing rows
    // as long as the file tree is moved with it.
    root: str('IRIS_STORAGE_ROOT', ''),
  },

  db: {
    // Future: real connection string. Today: empty means
    // <userData>/iris.sqlite via src/main/paths.js.
    url: str('IRIS_DATABASE_URL', ''),
  },

  // Third-party integrations. Present in dev (.env) so devs can iterate
  // locally; absent in shipped builds. The server-side production
  // implementation reads these from its own environment, not from anything
  // bundled into the client.
  integrations: {
    gemini: { apiKey: str('GEMINI_API_KEY', '') },
    bhl:    { apiKey: str('BHL_API_KEY', '') },
    gbif:   {
      user:     str('GBIF_API_USER', ''),
      password: str('GBIF_API_PASSWORD', ''),
    },
  },

  // VoucherVisionGO submission pipeline. The server (this process, in Phase 0;
  // a real backend later) owns these values — the user never sets them. When
  // apiBaseUrl + apiKey are present the queue boots and every uploaded source
  // is submitted automatically. All other knobs match flags the Python client
  // exposes (see VoucherVisionGO-client/VoucherVision.py:116-137).
  vouchervision: {
    apiBaseUrl:       str('VV_API_BASE_URL', ''),
    apiKey:           str('VV_API_KEY', ''),
    endpoint:         str('VV_ENDPOINT', '/process'),

    prompt:           str('VV_PROMPT', ''),
    // Comma-separated list of OCR engine ids; parsed at use into repeated form fields.
    engines:          str('VV_ENGINES', ''),
    llmModel:         str('VV_LLM_MODEL', ''),

    ocrOnly:          bool('VV_OCR_ONLY', false),
    notebookMode:     bool('VV_NOTEBOOK_MODE', false),
    skipLabelCollage: bool('VV_SKIP_LABEL_COLLAGE', false),
    includeWfo:       bool('VV_INCLUDE_WFO', false),
    includeCop90:     bool('VV_INCLUDE_COP90', true),

    vertexProject:    str('VV_VERTEX_PROJECT', ''),
    vertexRegion:     str('VV_VERTEX_REGION', 'global'),

    // Queue / worker shape.
    concurrency:      int('VV_CONCURRENCY', 1),
    pageConcurrency:  int('VV_PAGE_CONCURRENCY', 4),
    pdfDpi:           int('VV_PDF_DPI', 150),
    submitTimeoutMs:  int('VV_TIMEOUT_MS', 300000),
    maxRetries:       int('VV_MAX_RETRIES', 2),
    tickIntervalMs:   int('VV_TICK_MS', 2000),
  },

  // Useful diagnostic getters.
  hasGemini: () => !!str('GEMINI_API_KEY'),
  hasBhl:    () => !!str('BHL_API_KEY'),
  hasGbif:   () => !!str('GBIF_API_USER') && !!str('GBIF_API_PASSWORD'),
  hasVouchervision: () => !!str('VV_API_BASE_URL') && !!str('VV_API_KEY'),
};
