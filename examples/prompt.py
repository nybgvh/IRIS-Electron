"""Prompt builder for drafting IUCN Red List assessment sections from
herbarium specimen OCR records.

Usage:
    from prompt import RedListPrompt

    # all *.json in a directory
    prompt_text = RedListPrompt(json_dir).build()

    # or specific files
    prompt_text = RedListPrompt(json_dir, json_files=[...]).build()

    response = client.models.generate_content(
        model="gemini-3.1-pro-preview",
        contents=prompt_text,
    )
"""

import json
from pathlib import Path


class RedListPrompt:
    """Builds the full plain-text LLM prompt for a set of specimen JSON records."""

    # keys the model should return; matched to the numbered sections below
    RETURN_SCHEMA = {
        "Taxonomy": "",
        "Geographic_Range": "",
        "Habitat": "",
        "Ecology": "",
        "Use_and_Trade": "",
        "Threats_and_Conservation_Actions": "",
    }

    # fields pulled from each record's "formatted_json" block
    RECORD_FIELDS = (
        "catalogNumber",
        "scientificName",
        "country",
        "stateProvince",
        "locality",
        "habitat",
        "specimenDescription",
        "minimumElevationInMeters",
        "maximumElevationInMeters",
        "collectionDate",
        "additionalText",
    )

    # PDF / notebook pages are processed OCR-only, so they have no structured
    # formatted_json to break down into the fields above. For those records we
    # hand the model the entire OCR text instead — the raw page text still
    # informs the assessment. Only these keys make up an OCR-only record (plus
    # filename + tag).
    RECORD_FIELDS_OCR_ONLY = (
        "ocr_text",
    )

    def __init__(self, json_dir, json_files=None):
        """
        json_dir:   directory containing the specimen *.json files.
        json_files: optional explicit list of files to use; if omitted, every
                    *.json in json_dir is loaded (sorted for stable ordering).
        """
        self.json_dir = Path(json_dir)
        if json_files is None:
            self.json_files = sorted(self.json_dir.glob("*.json"))
        else:
            self.json_files = [Path(f) for f in json_files]
        self.records = self._load_records()

    def _load_records(self):
        records = []
        for json_file in self.json_files:
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            formatted = data.get("formatted_json") or {}
            if not isinstance(formatted, dict):
                formatted = {}
            ocr = data.get("ocr")
            # Citation tag the model copies verbatim to reference this specimen
            # inline (keyed by catalog number, else the filename stem).
            tag = "#{" + str(formatted.get("catalogNumber") or json_file.stem) + "}"

            # OCR-only records (PDF / notebook pages) have no structured
            # extraction — give the model the whole OCR text instead of empty
            # key/value fields.
            if self._is_ocr_only(formatted, ocr):
                record = {"filename": json_file.name, "ocr_only": True}
                for field in self.RECORD_FIELDS_OCR_ONLY:
                    record[field] = ocr if field == "ocr_text" else formatted.get(field)
                record["tag"] = tag
                records.append(record)
                continue

            record = {"filename": json_file.name}
            for field in self.RECORD_FIELDS:
                record[field] = formatted.get(field)
            record["ocr_text"] = ocr
            record["tag"] = tag
            records.append(record)
        return records

    def _is_ocr_only(self, formatted, ocr):
        """OCR-only when there are no usable structured fields but OCR text
        exists (PDF / notebook pages return an empty formatted_json)."""
        has_structured = any(
            formatted.get(k) not in (None, "") for k in self.RECORD_FIELDS
        )
        has_ocr = bool(ocr and str(ocr).strip())
        return not has_structured and has_ocr

    def build(self):
        """Return the complete plain-text prompt, ready to send to the LLM."""
        schema_json = json.dumps(self.RETURN_SCHEMA, indent=2)
        records_json = json.dumps(self.records, indent=2)

        return f"""
You are extracting specific Red List assessment information from herbarium specimen OCR records.

Use only information present in the records.

Do not invent information.


If information is not available, explicitly state:
"No information available from specimen records."

Write in clear scientific language suitable for a draft IUCN Red List assessment.

Combine information across specimens and avoid repeating identical observations.

When a statement in any section is grounded in a specific specimen, cite that specimen by inserting its exact "tag" value inline (for example #{{ABC12345}}), copied verbatim from that record. Cite the relevant specimens wherever a claim depends on particular collections so each can be traced back to its specimen. Do not invent tags; only use tags that appear in the records below.

Return your final answer formatted as a json object in this format, matching the json key to the section name:

{schema_json}

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

{records_json}


Return your final answer formatted as a json object in this format, matching the json key to the section name:

{schema_json}
"""

    def __str__(self):
        return self.build()
