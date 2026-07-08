/*
 * RedListPrompt — builds the LLM prompt for drafting IUCN Red List assessment
 * sections from herbarium specimen records.
 *
 * This is a faithful JS port of examples/prompt.py (IRIS runs on Node, not
 * Python — so the editable source of truth for the prompt lives here). Keep
 * this file 1:1 with that class: RETURN_SCHEMA, RECORD_FIELDS, and the section
 * text are identical, so tuning the prompt is the same edit in either place.
 *
 * The one adaptation: instead of reading *.json files off disk, the records
 * come from IRIS's stored items (item-repo shape — `formatted` object +
 * `ocr_text`), since that's how IRIS persists the VoucherVision output.
 *
 * The model is asked to return a JSON object keyed by RETURN_SCHEMA so IRIS can
 * populate each UI section directly (see assessment-service).
 */

// keys the model should return; matched to the numbered sections below
const RETURN_SCHEMA = {
  Taxonomy: '',
  Geographic_Range: '',
  Habitat: '',
  Ecology: '',
  Use_and_Trade: '',
  Threats_and_Conservation_Actions: '',
};

// fields pulled from each record's "formatted_json" block
const RECORD_FIELDS = [
  'catalogNumber',
  'scientificName',
  'country',
  'stateProvince',
  'locality',
  'habitat',
  'specimenDescription',
  'minimumElevationInMeters',
  'maximumElevationInMeters',
  'collectionDate',
  'additionalText',
];

// PDF / notebook pages are processed OCR-only, so they have no structured
// formatted_json to break down into the fields above. For those records we hand
// the model the entire OCR text instead — the raw page text still informs the
// assessment. Only these keys make up an OCR-only record (plus filename + tag).
const RECORD_FIELDS_OCR_ONLY = [
  'ocr_text',
];

class RedListPrompt {
  /*
   * records: an array of IRIS item objects (from item-repo / vouchervision
   * records). Each carries `formatted` (parsed formatted_json) and `ocr_text`.
   * Pass items you want summarized — the caller selects them.
   */
  constructor(records) {
    this.records = (records || []).map((it) => RedListPrompt.recordFromItem(it));
  }

  // Map one stored IRIS item to the flat record shape the prompt expects.
  static recordFromItem(it) {
    let f = it.formatted;
    if (f == null && it.formatted_json) {
      try { f = JSON.parse(it.formatted_json); } catch (_) { f = {}; }
    }
    f = f || {};
    const filename = it.filename || (it.source_id ? `source-${it.source_id}` : 'record');
    const stem = String(filename).replace(/\.[^.]+$/, '');
    const ocr = it.ocr_text != null ? it.ocr_text : null;

    // Citation tag the model copies verbatim to reference this specimen inline.
    // Keyed by catalog number when present, else the filename stem — both are
    // what IRIS resolves back to the specimen (see assessment linkifier).
    const tag = '#{' + (f.catalogNumber || stem) + '}';

    // OCR-only records (PDF / notebook pages) have no structured extraction —
    // give the model the whole OCR text instead of empty key/value fields.
    if (RedListPrompt.isOcrOnly(it, f)) {
      const record = { filename, ocr_only: true };
      for (const field of RECORD_FIELDS_OCR_ONLY) {
        record[field] = field === 'ocr_text' ? ocr : (f[field] != null ? f[field] : null);
      }
      record.tag = tag;
      return record;
    }

    const record = { filename };
    for (const field of RECORD_FIELDS) record[field] = f[field] != null ? f[field] : null;
    record.ocr_text = ocr;
    record.tag = tag;
    return record;
  }

  // A record is OCR-only when it came from a PDF / notebook page (submitted
  // OCR-only) OR simply has no usable structured fields but does have OCR text.
  // Either way the assessment should lean on the raw OCR, not empty fields.
  static isOcrOnly(it, formatted) {
    const origin = it && it.metadata && it.metadata.origin;
    if (origin === 'pdf' || origin === 'notebook') return true;
    const f = formatted || it.formatted || {};
    const hasStructured = RECORD_FIELDS.some(k => f[k] != null && f[k] !== '');
    const hasOcr = it.ocr_text != null && String(it.ocr_text).trim() !== '';
    return !hasStructured && hasOcr;
  }

  build() {
    const schemaJson = JSON.stringify(RETURN_SCHEMA, null, 2);
    const recordsJson = JSON.stringify(this.records, null, 2);

    return `
You are extracting specific Red List assessment information from herbarium specimen OCR records.

Use only information present in the records.

Do not invent information.


If information is not available, explicitly state:
"No information available from specimen records."

Write in clear scientific language suitable for a draft IUCN Red List assessment.

Combine information across specimens and avoid repeating identical observations.

When a statement in any section is grounded in a specific specimen, cite that specimen by inserting its exact "tag" value inline (for example #{ABC12345}), copied verbatim from that record. Cite the relevant specimens wherever a claim depends on particular collections so each can be traced back to its specimen. Do not invent tags; only use tags that appear in the records below.

Return your final answer formatted as a json object in this format, matching the json key to the section name:

${schemaJson}

1. Taxonomy

Summarize:

* Accepted scientific name
* Identification history
* Taxonomic notes
* Any uncertainty in identification

Provide a short narrative summary.

2. Geographic Range

Summarize:

* Countries represented
* States, provinces, counties, and localities
* Distribution patterns evident from collections
* Elevation range
* Geographic concentrations of records
* Range limits suggested by specimen localities

Focus only on information directly supported by specimen records.

Provide:

* Narrative summary
* Key localities
* Elevation range

3. Habitat

Summarize habitats represented across records.

Focus on:

* Habitat descriptions
* Locality descriptions
* Elevation
* Substrate
* Vegetation
* Moisture conditions
* Environmental descriptions

Do not invent habitats.

Mention habitat patterns.

Mention unusual or rare habitats separately.

If habitat is unclear, say so.

Include likely IUCN Habitat Classification Scheme categories supported by the specimen data.

Provide:

* Narrative summary
* habitat patterns
* Unusual habitats
* IUCN habitat categories

4. Ecology

Summarize ecological information represented in the records.

Focus only on:

* Growth form
* Life history information
* Phenology (flowering, fruiting, sterile specimens)
* Associated vegetation
* Associated habitats
* Ecological observations
* Elevational preferences
* Substrate preferences
* Environmental tolerances
* Pollination observations
* Reproductive observations
* Population observations mentioned on labels

Do not infer ecological traits that are not mentioned.

Mention repeated ecological patterns.

Mention unusual ecological observations separately.

Provide:

* Narrative summary
* Phenology
* Ecological preferences
* Notable observations

5. Use and Trade

Extract any evidence related to human use.

Look for:

* Economic notes
* Ethnobotanical information
* Medicinal use
* Food use
* Ornamental use
* Timber use
* Fiber use
* Cultural use
* Cultivation
* Harvesting
* Trade
* References to local use
* References to collection for horticulture

Only report uses explicitly mentioned in the records.

Do not assume use based on the species.

If no evidence exists, state:
"No information available from specimen records."

Provide:

* Summary
* Documented uses
* Evidence from labels

6. Threats and Conservation Actions

Extract direct evidence of threats and conservation information.

For threats, look for:

* Habitat destruction
* Agriculture
* Grazing
* Logging
* Urbanization
* Mining
* Road construction
* Tourism
* Fire
* Scope
* Severity
* Virus
* Invasive species
* Collection pressure
* Habitat fragmentation
* Land conversion

Only include threats explicitly supported by locality or habitat descriptions.

Do not infer threats solely from species rarity.

For conservation actions, look for:

* Protected areas
* Nature reserves
* National parks
* Botanical gardens
* Ex situ collections
* Seed banking
* Conservation projects
* Monitoring efforts
* Restoration efforts

If evidence is lacking, state:
"No information available from specimen records."

Provide:

* Threat summary
* Conservation action summary
* Important data gaps
* IUCN Threat scheme classification

Records:

${recordsJson}


Return your final answer formatted as a json object in this format, matching the json key to the section name:

${schemaJson}
`;
  }
}

/*
 * Parse the model's answer into the RETURN_SCHEMA object. Primary path: the
 * model returns JSON (we ask for it, and request responseMimeType=json). Falls
 * back to plucking a ```json fenced block, then to a permissive scan so a
 * near-miss still populates the UI. Unknown keys are dropped; missing keys are
 * filled with ''.
 */
function parseSections(text) {
  const empty = { ...RETURN_SCHEMA };
  if (!text) return empty;

  let obj = tryParseJson(text);
  if (!obj) obj = tryParseJson(stripFences(text));
  if (!obj) return { ...empty, Taxonomy: String(text).trim() }; // last resort: keep the text visible

  const out = { ...empty };
  for (const key of Object.keys(RETURN_SCHEMA)) {
    if (obj[key] != null) out[key] = typeof obj[key] === 'string' ? obj[key] : JSON.stringify(obj[key]);
  }
  return out;
}

function tryParseJson(s) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : null;
  } catch (_) { return null; }
}

function stripFences(s) {
  const m = String(s).match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) return m[1].trim();
  // else: grab the outermost {...}
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  return first >= 0 && last > first ? s.slice(first, last + 1) : s;
}

module.exports = { RedListPrompt, RETURN_SCHEMA, RECORD_FIELDS, RECORD_FIELDS_OCR_ONLY, parseSections };
