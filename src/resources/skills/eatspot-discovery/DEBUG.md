# EatSpot Discovery — DEBUG Overlay

Appended to `SKILL.md` only when the skill is installed with `mcp-google-map install --debug-skills`.
Without that option this file is never installed, so the installed skill contains no debug instructions.
The overlay is additive: it never alters PART I — CORE of `SKILL.md`.

## PART II — DEBUG (temporary, removable)

### D1. Permanent activation

For every search set `DEBUG_ENABLED = TRUE`. The DEBUG section MUST always appear at the bottom of the response: zero results, one or more conformant results, interrupted searches, unavailable API. Part II Section D MUST be the last output section. The DEBUG MUST NOT modify filters or the search.

### D2. Mandatory provenance

Every raw datum MUST be tied to an actual call. Calling `raw` an object you reconstructed is forbidden. Distinguish `API_VERIFIED` and `MCP_SERVER_UNAVAILABLE`. If the origin is not the mcp-google-map server, do not simulate Places API fields or structures.

### D3. Call register

For every actually executed tool call record: progressive call id; tool name; Grade phase; real query and parameters; `field_mask` actually applied (read it from the tool's `field_mask` output); request status; original payload received; errors; validations performed. Do not invent calls or parameters. Do not add credentials or tokens. Do not reconstruct missing responses.

### D4. JSON format

Section D contains exactly one valid JSON array; each element represents one authentic executed call. Diagnostic schema:

```json
[
  {
    "call_id": 1,
    "source_mode": "API_VERIFIED",
    "tool": "maps_search_places",
    "phase_grade": "A",
    "request_sent": {},
    "field_mask_sent": [],
    "raw_response": null,
    "raw_accessibility": "NOT_ACCESSIBLE",
    "validations": [],
    "anomalies": [],
    "error": null
  }
]
```

This is only the schema, never a real call. In an actual entry: `request_sent` contains the effective parameters; `field_mask_sent` matches the real applied mask; `raw_response` contains the authentic payload (from `raw`/`raw_place` with `includeRaw: true`) or stays `null` when inaccessible; `validations` lists agent interpretations; `anomalies` lists discrepancies. If no call was executed, the array MUST be `[]`; never fabricate a call to avoid an empty array; Section C explains the unavailability.

### D5. Validations separate from raw data

For each actually returned candidate, record separately: `place_id`; `raw_place_index`; `rating_interpreted`; `user_ratings_total_interpreted`; `grade_assigned`; `primary_type_raw`; `category`; `price_level_raw`; `price_range_raw`; `max_price_computed`; `budget_max`; `economic_status`; `final_status`; `exclusion_reasons`. Never copy interpreted values into `raw_response`. Never alter original structures.

### D6. Error codes to detect

`MCP_SERVER_UNAVAILABLE`, `TOOL_CALL_SIMULATED`, `RAW_RESPONSE_RECONSTRUCTED`, `RAW_SCHEMA_NON_CONFORMANT`, `PLACE_ID_MISMATCH`, `PRICE_LEVEL_DIVERGENT`, `PRICE_RANGE_DIVERGENT`, `USER_RATING_COUNT_DIVERGENT`, `PRIMARY_TYPE_DIVERGENT`, `RESPONSE_INCOMPATIBLE_WITH_PRICE_LEVELS`, `PRICE_LEVELS_FILTER_NOT_APPLIED`, `PRICE_EXCEEDS_BUDGET`, `RATING_INSUFFICIENT`, `REVIEWS_INSUFFICIENT`, `GRADE_WRONG`, `HOURS_INCOMPATIBLE`, `OUT_OF_RADIUS`, `FIELD_MASK_INCOMPLETE`, `API_RESPONSE_NOT_ACCESSIBLE`. Register only ascertained anomalies; never invent error codes to mask missing data.

### D7. Critical test — Osteria Veglio

When a response for Place ID `ChIJY2oWYByu0hIRZXOOaToUTA8` arrives, verify value consistency without overwriting. If a response presents `price_level = PRICE_LEVEL_EXPENSIVE`, `price_range.endPrice.units = "70"`, `user_ratings_total = 910`, you MUST NOT publish `PRICE_LEVEL_MODERATE`, "maximum price 30 EUR", or "1703 reviews" as original values of that response. If two real calls conflict, register the conflict and re-verify with `maps_place_details`; never resolve by editing the payload.

### D8. API filter verification

For every `maps_search_places` call record: `priceLevels` actually sent; `minRating` actually sent; `includedType` actually used; `strictTypeFiltering` when present. If `priceLevels` admits only INEXPENSIVE and MODERATE, register as an anomaly any EXPENSIVE candidate in the response; do not force-normalize it; do not declare a call validly filtered when it was only simulated.

### D9. Completeness control and bounded capture

The debug MUST preserve all accessible payloads within response-size limits. Declare partial payloads and truncated records explicitly; never present a partial response as complete. Do not deduplicate raw records: deduplication concerns final selection, not the call register.

Bounded capture: before persisting any register entry, apply the strictest serialized-size limit in force in the execution environment (response limits, tool-result limits, intermediate-storage limits). When the serialized `raw_response` exceeds that limit, persist a declared truncation instead of the full payload: keep the validation-relevant segment — for `maps_search_places`, `raw_place` of ALL returned results (never a subset of results) plus each result's `name`, `place_id`, `rating`, and `user_ratings_total` — and add an explicit truncation declaration naming the omitted parts (reviews, photos, editorial summaries) and the kept ranges. The declaration is agent metadata inside the register entry (e.g. `"raw_response_note": "TRUNCATED: reviews/photos/editorial omitted; all N results kept"`); it MUST never be presented as API data.

Register-entry integrity: before emitting the final JSON array, verify that every referenced register entry exists and holds the recorded payload. When an entry is missing — interrupted capture, size-limit abort, or lost intermediate state — re-execute the tool call; never dereference fields of a missing entry and never reconstruct the payload. When re-execution is impossible, emit the entry with `raw_response: null`, `raw_accessibility: "NOT_ACCESSIBLE"`, anomaly `API_RESPONSE_NOT_ACCESSIBLE`, and the concrete interruption reason in `error`.

### D10. Final output

Produce in order: A. Search summary; B. Validated venues; C. Notes and limitations; D. DEBUG — GOOGLE PLACES API VIA mcp-google-map. Section D MUST end with one valid JSON array and nothing may follow it. Excluded candidates may appear only as technical data in Section D. The DEBUG does not modify functional logic. Removing Part II entirely MUST leave PART I — CORE fully operational.
