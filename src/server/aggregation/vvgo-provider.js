/*
 * VoucherVisionGO aggregation provider — PLACEHOLDER.
 *
 * When VoucherVisionGO gains a server-side aggregate/summary endpoint, wire it
 * up here against the SAME { summarize({ prompt, model }) → { text, model } }
 * contract the Gemini provider implements. The assessment service and the UI
 * do not change — flip AGGREGATION_PROVIDER=vvgo and this takes over.
 *
 * NOTE: per the current constraint we do NOT modify VoucherVisionGO, so this
 * is intentionally unimplemented.
 */

async function summarize() {
  const err = new Error(
    'The VoucherVisionGO aggregate provider is not implemented yet. ' +
    'Set AGGREGATION_PROVIDER=gemini.'
  );
  err.code = 'aggregation/provider-unavailable';
  throw err;
}

module.exports = { summarize };
