/*
 * Aggregation provider selector. Returns the provider named by
 * config.aggregation.provider. Every provider implements the same contract:
 *
 *   summarize({ prompt, model }) → Promise<{ text, model }>
 *
 * so the assessment service is provider-agnostic.
 */

const config = require('../config');

function get() {
  const name = (config.aggregation.provider || 'gemini').toLowerCase();
  switch (name) {
    case 'gemini': return require('./gemini-provider');
    case 'vvgo':   return require('./vvgo-provider');
    default:
      throw new Error(`Unknown aggregation provider: ${name}`);
  }
}

module.exports = { get };
