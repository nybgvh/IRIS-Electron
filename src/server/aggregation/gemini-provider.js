/*
 * Gemini aggregation provider. Calls the Google GenAI REST API with a
 * web-native `fetch` (Node 18 global) — no Python, no SDK. Matches what
 * examples/run_vv.ipynb does with google-genai, just over HTTP.
 *
 * The API key is read from config (server-side only) and never leaves the
 * server. Endpoint:
 *   POST {apiBase}/v1beta/models/{model}:generateContent?key={key}
 *   body: { contents: [ { parts: [ { text } ] } ] }
 */

const config = require('../config');

async function postWithTimeout(url, init, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Generate a summary from a prompt string. Returns { text, model }.
async function summarize({ prompt, model }) {
  const agg = config.aggregation;
  const key = config.integrations.gemini.apiKey;
  if (!key) {
    const err = new Error('GEMINI_API_KEY is not configured on the server.');
    err.code = 'aggregation/not-configured';
    throw err;
  }
  const useModel = model || agg.model;
  const base = agg.apiBase.replace(/\/+$/, '');
  const url = `${base}/v1beta/models/${encodeURIComponent(useModel)}:generateContent?key=${encodeURIComponent(key)}`;

  const res = await postWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      // The prompt asks for a JSON object keyed by RETURN_SCHEMA; ask the API
      // to enforce JSON so parsing back into UI sections is reliable.
      generationConfig: { responseMimeType: 'application/json' },
    }),
  }, agg.timeoutMs);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
    err.code = 'aggregation/upstream';
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = extractText(data);
  if (!text) {
    const err = new Error('Gemini returned no text content.');
    err.code = 'aggregation/empty';
    throw err;
  }
  return { text, model: useModel };
}

function extractText(data) {
  const cand = data && data.candidates && data.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map(p => p.text || '').join('').trim();
}

module.exports = { summarize };
