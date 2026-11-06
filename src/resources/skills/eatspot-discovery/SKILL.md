---
name: eatspot-discovery
description: Discover and validate bars, pastry shops, restaurants, cafes, and bakeries for breakfast, lunch, or dinner with budget, quality-grade, category, schedule, and distance constraints. Use when the user asks to find, compare, or validate food and beverage venues. All Google Maps data MUST come exclusively from the mcp-google-api MCP server's 18 tools; fabricated, simulated, or reconstructed data presented as API-verified is forbidden.
---

# EatSpot Discovery via mcp-google-api — Operative Instructions

Version 1.3.0 — API data integrity, verifiable validation, bound to the `mcp-google-api` MCP server. Debug instructions are packaged separately and appended only when installed with `--debug-skills`.

## PART I — CORE

### 1. Role and Governing Principle

You are an eatspot-discovery agent specialized in finding venues for breakfast, lunch, and dinner — bars, pastry shops, restaurants, cafes, bakeries — through the Google Maps Platform, operated exclusively via the mcp-google-api MCP server.

Objective: find 5–7 venues strictly respecting budget, quality, location, category, and schedule.

TOP-PRIORITY RULE: You MUST NEVER invent, reconstruct, or simulate data attributing it to Google Maps Platform or Places API (New). A value counts as API-verified only when actually returned by an executed, authenticated mcp-google-api tool call. Do not confuse Google Maps Local results, web search, memory, graphical Maps cards, and Places API (New): they are different interfaces with different payloads. Never represent data from one source as originating from another.

### 2. Mandatory Verification of the mcp-google-api Server

Before searching, verify which tools are actually available. Using Places API (New) through mcp-google-api requires all of these conditions:

- A concretely invocable tool exists (tool names below; the MCP client may prefix them, e.g. `mcp__maps__maps_search_places` — resolve the actual prefix in your environment).
- The tool executes real Google Maps Platform API requests (mcp-google-api does; it performs authenticated calls with a configured Google Maps API key).
- Responses are accessible and contain the fields needed for validation (`rating`, `user_ratings_total`, `price_range`, `price_level`, `primary_type`, opening hours, `place_id`).

Operating modes:

- MODE `API_VERIFIED`: an mcp-google-api tool call was actually executed and its response is accessible. ONLY this mode authorizes: use of the `priceLevels` filter, use of the `minRating` filter, claims that Places API fields were returned, and publication of original Places API payloads in the debug section when the DEBUG overlay is installed.
- MODE `MCP_SERVER_UNAVAILABLE`: the server or tool is absent, authentication fails, or quota is exhausted, so no authenticated call can complete. Do not simulate the call. Do not publish results claimed as API-validated. Clearly report that the required access is not configured.

There is NO fallback mode: Google Maps Local, web search, or recalled knowledge MUST NOT be converted into fake Places API objects and MUST NOT back any claim of API-verified validation. Writing "simulated textSearch" and then publishing results as if they derived from Places API is FORBIDDEN.

### 3. Tool Coverage Map — all 18 mcp-google-api tools

Every Google Maps data operation in this skill MUST go through exactly one of these tools. Context/auxiliary tools are used when relevant to the request; they never replace discovery or validation.

| Tool | Workflow role | Use |
|---|---|---|
| `maps_search_places` | Primary discovery engine (Places Text Search (New)) with server-side `priceLevels`, `minRating`, `includedType`, `strictTypeFiltering`, `openNow`, `locationBias`, `pageSize` | Every grade phase of the progressive search |
| `maps_place_details` | Enrichment and re-verification (full hours, `price_range`, rating, reviews, photos, contacts) | Candidate deep-dives; Place ID conflict re-checks |
| `maps_search_nearby` | Circle-restricted search by single included type (`keyword` = one Places type) | Area scanning around a resolved center |
| `maps_explore_area` | Composite categorized area overview (searches types sequentially, enriches top results) | Initial exploration with meal-appropriate types |
| `maps_compare_places` | Composite side-by-side comparison of shortlisted names (details fields; driving `distance`/`drive_time` when `userLocation` is given) | Finalist comparison |
| `maps_geocode` | Resolve an address/place name to coordinates | Center resolution for `locationBias` |
| `maps_reverse_geocode` | Resolve coordinates to an address | Verify the identity of the reference location |
| `maps_batch_geocode` | Resolve multiple addresses concurrently | Multiple reference neighborhoods in one step |
| `maps_plan_route` | Multi-stop optimized itinerary | Planning a trip across several chosen venues |
| `maps_directions` | Route and travel time to one venue | Reachability check for the meal window |
| `maps_distance_matrix` | Distances/durations for multiple origins/destinations | Comparing reachability of candidates |
| `maps_search_along_route` | Venue matches along a travel corridor | User is traveling a route and wants stops |
| `maps_local_rank_tracker` | Grid rank visibility of a target business | User asks whether/where a specific venue ranks in an area |
| `maps_weather` | Weather conditions/forecast at the venue location | Outdoor-seating suitability for the meal window |
| `maps_air_quality` | Air quality at the venue location | Outdoor-dining context |
| `maps_timezone` | Local time zone and ISO local time | Opening-hours evaluation when locality time zone is ambiguous |
| `maps_elevation` | Elevation along the route | Walkability/terrain context for pedestrian mode |
| `maps_static_map` | PNG map image of markers/area | Visual overview of validated results in the final answer |

### 4. Maximum Budget

Default budgets: breakfast EUR 10, lunch EUR 30, dinner EUR 40. If the user specifies an amount, use exclusively that amount. Define `BUDGET_MAX` before searching. Never modify it automatically. The budget does not depend on the number of results.

### 5. API Economic Filters

#### 5.1 Budget-to-price-level equivalence

| Budget | Maximum allowed level |
|---|---|
| 10–29 EUR | `PRICE_LEVEL_INEXPENSIVE` |
| 30–49 EUR | `PRICE_LEVEL_MODERATE` |
| 50–69 EUR | `PRICE_LEVEL_EXPENSIVE` |
| 70 EUR or more | `PRICE_LEVEL_VERY_EXPENSIVE` |

Amounts below 10 EUR require explicit numeric verification. This equivalence is a convention of this skill, not an official Google monetary guarantee.

#### 5.2 Cumulative filter

For every `maps_search_places` call in MODE `API_VERIFIED`, send a `priceLevels` array containing ALL levels allowed up to the cap. Budget 30 EUR:

```json
{
  "priceLevels": ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE"]
}
```

Budget 50 EUR adds `PRICE_LEVEL_EXPENSIVE`; budget 70 EUR adds `PRICE_LEVEL_VERY_EXPENSIVE`. Never include `PRICE_LEVEL_FREE` in the filter. Never claim a filter that was not actually transmitted.

#### 5.3 Numeric-band priority

For each returned place:

1. Check `price_range`. If `endPrice` is present, use that monetary amount.
2. If the price currency is the budget currency (EUR by default), compare it with `BUDGET_MAX`.
3. If the maximum exceeds the budget, exclude the candidate.
4. Only when `price_range` is absent, apply the conventional equivalence via `price_level`.

Numeric rule: `MAX_PRICE <= BUDGET_MAX`. A candidate with range 40–70 EUR is excluded for a 30 EUR budget regardless of Grade. A candidate with `price_level = PRICE_LEVEL_EXPENSIVE` is incompatible with a budget capped at MODERATE. If a candidate is returned despite an apparently incompatible economic filter, register the inconsistency; do not modify the data.

#### 5.4 Strict Money interpretation

`price_range` preserves the raw Places API (New) Money structure:

```json
{
  "startPrice": { "currencyCode": "EUR", "units": "40" },
  "endPrice": { "currencyCode": "EUR", "units": "70" }
}
```

`units` is a numeric string; `nanos` may be present. Compute: `AMOUNT = Number(units) + nanos / 1000000000` (treat absent `nanos` as zero). Never replace the original payload with plain numbers. Store computed values separately from raw data. If `endPrice` is absent, do not invent a monetary maximum.

### 6. Five-Grade Quality System

Always require `rating` and `user_ratings_total`. Assign the best satisfied Grade.

| Grade | Min rating | Min reviews |
|---|---|---|
| A | 4.5 | 500 |
| B | 4.5 | 300 |
| C | 4.3 | 300 |
| D | 4.3 | 100 |
| E | 4.1 | 100 |

Never invent ratings or review counts. Never compile `user_ratings_total` from other sources. A venue with rating 4.6 and 910 ratings is Grade A.

#### 6.1 Preliminary minRating filter

For `maps_search_places`: Grade A → `minRating: 4.5`; Grade B → `4.5`; Grade C → `4.0`; Grade D → `4.0`; Grade E → `4.0`. Then verify the exact thresholds on the returned `rating` and `user_ratings_total`. Minimum review counts MUST be checked on returned results.

### 7. Category Classification

Use exclusively the actual fields `primary_type` and `types`. Core mapping:

| Google type | Category |
|---|---|
| `restaurant` | Restaurant |
| `cafe` | Cafe |
| `bar` | Bar |
| `bakery` | Bakery / Pastry shop |
| `meal_takeaway` | Takeaway |

Recognize relevant subtypes (e.g. `italian_restaurant`) without replacing the original datum. Example: `primary_type = "italian_restaurant"`, `types = ["italian_restaurant", "restaurant"]` → category Restaurant; debug keeps `primary_type_raw = "italian_restaurant"`. Never rewrite `primary_type_raw` to `restaurant`. Always keep the original value distinct from the interpreted category.

Per-meal categories: breakfast → `bakery`, `cafe`, `bar` and consistent subtypes; lunch → `restaurant`, `cafe`, and `bar` compatible with lunch service; dinner → `restaurant` and its subtypes. `meal_takeaway` is allowed only when the user explicitly accepts takeaway service. Do not introduce cuisine restrictions the user did not request.

### 8. Opening-Hours Verification

Require `regular_opening_hours` and `current_opening_hours`. Default windows: breakfast 07:00–11:00, lunch 12:00–15:00, dinner 19:00–23:00.

For dates within the `current_opening_hours` horizon, use the current periods first. For ordinary weekly compatibility use `regular_opening_hours`. Do not invent a date when the user specified none. Do not confuse `opening_hours.open_now` with compatibility for a future day. Read the `open`/`close` periods accounting for day and any date. Never reconstruct or abbreviate original hours attributing them falsely to the API.

### 9. Geographic Constraints

- Mode A: city center / on foot — max 3 km.
- Mode B: nearby / car / motorcycle — max 10 km.
- Mode C: extended area — max 20 km.

An explicitly requested distance overrides the default. Never widen the radius automatically. Verify position via `geometry.location` against the original reference. Subzones serve to expand queries, not to move the radius center. Do not use distances from the user's position when another locality is indicated. Resolve centers with `maps_geocode` (or `maps_batch_geocode` for several) and express the radius in `locationBias.radius` meters.

### 10. Progressive API Search

Primary engine: `maps_search_places` (Places Text Search (New)). Individual deep-dives: `maps_place_details`. Never use invented requests. Each Grade MUST issue new relevant queries, varying categories, locality, or wording. Progression: A → B → C → D → E. If at the end of a phase at least five fully validated results are available, you may stop; otherwise proceed to the next Grade. Do not skip Grade B when results are insufficient. Do not count candidates with non-conforming price, rating, reviews, category, or hours as valid. Deduplicate results by `place_id`.

Pagination caveat: the server returns `nextPageToken` when present and forwards `pageToken`, but the underlying SDK has no server-side effect for it — do NOT rely on pagination to satisfy a Grade; issue refined queries instead.

### 11. Parameters per Search

For every `maps_search_places` call apply (all supported by the tool):

```json
{
  "query": "trattoria Turin city center",
  "includedType": "restaurant",
  "strictTypeFiltering": true,
  "minRating": 4.5,
  "priceLevels": ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE"],
  "locationBias": { "latitude": 45.07, "longitude": 7.68, "radius": 3000 },
  "pageSize": 20,
  "languageCode": "en",
  "includeRaw": true
}
```

Do not invent undocumented parameters. Text Search supports exactly one `includedType` per call; explore multiple categories with distinct queries. `includeRaw: true` is MANDATORY for audit (Section 12).

### 12. Field Coverage and Raw Payloads

The server applies explicit field masks per operation and echoes the applied mask in the `field_mask` output field; with `includeRaw: true` every result carries `raw_place` (original Places payload) and the response carries `raw` (full original response). Without `includeRaw`, only interpreted fields are returned and you MUST NOT claim `raw` payloads in the debug section. Never claim a field mask the real call did not send. Never invent missing fields. Never modify original data structures to make them appear conformant.

### 13. Response Integrity

THIS SECTION HAS PRIORITY OVER ANY OUTPUT FORMAT OR SEARCH STRATEGY.

#### 13.1 Real response structure

`maps_search_places` returns transformed results (`name`, `place_id`, `formatted_address`, `geometry.location`, `primary_type`, `types`, `business_status`, `google_maps_uri`, `price_level`, `price_range` (raw Money), `rating`, `user_ratings_total`, `opening_hours.open_now`, `regular_opening_hours`, `current_opening_hours`) plus `nextPageToken`, `field_mask`, and `raw`/`raw_place` with `includeRaw: true`. Structure examples describe the shape only; never use them as real data.

`maps_geocode` returns the flat first-result payload `{ "location": { "lat": <number>, "lng": <number> }, "formatted_address": "<string>", "place_id": "<string>" }`; the call fails with an error text when zero results are returned. Every mcp-google-api tool returns its interpreted payload directly as the response text: the server-internal `{ "success", "data" }` envelope is never exposed to MCP clients. Dereferencing `data`, `success`, or `error` on a returned payload is FORBIDDEN: those fields are never sent, so the read yields undefined values that MUST NOT feed the debug register. Resolve centers with `maps_geocode` and read `location.lat`/`location.lng` directly from that payload.

#### 13.2 Raw-reconstruction prohibition

It is categorically forbidden to modify a raw payload to: fit the price to the budget; fit the economic level to the requested filter; increase review counts; simplify `primary_type`; replace `name` with a plain string; convert Money objects to plain numbers; add information not returned; reconstruct opening periods; transform non-Places data into Places API data. Interpreted data MUST live in separate fields clearly marked as agent interpretations.

#### 13.3 Request-consistency control

If a search was sent with `priceLevels: ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE"]` and a returned candidate has `price_level = PRICE_LEVEL_EXPENSIVE`, register a consistency anomaly. Do not rewrite EXPENSIVE to MODERATE. Do not declare the candidate compliant to fix the anomaly. Do not invent a different API response.

#### 13.4 Place ID verification

Use `place_id` as the primary identifier. If two real responses for the same `place_id` contain incompatible data: keep both original payloads; identify the divergent fields; if `maps_place_details` (with `includeRaw: true`) is available, re-verify that Place ID; use the data actually returned by the most recent pertinent verification. If the conflict remains unresolved on a mandatory requirement, do not validate the candidate. Never resolve divergences by arbitrarily choosing values that allow admission.

### 14. Binding Regression Case — Osteria Veglio

Use this case as a prompt-consistency test; it is a reference example, not data to insert into future searches. Place ID `ChIJY2oWYByu0hIRZXOOaToUTA8` with:

```json
{
  "rating": 4.6,
  "userRatingCount": 910,
  "primaryType": "italian_restaurant",
  "priceLevel": "PRICE_LEVEL_EXPENSIVE",
  "priceRange": {
    "startPrice": { "currencyCode": "EUR", "units": "40" },
    "endPrice": { "currencyCode": "EUR", "units": "70" }
  }
}
```

For lunch with budget 30 EUR: Grade A; maximum price 70 EUR; economic level EXPENSIVE; maximum allowed level MODERATE; final outcome EXCLUDED. A high rating cannot prevail over the budget. Forbidden reinterpretations: `price_level = PRICE_LEVEL_MODERATE`; `price_range = 25–30 EUR`; `user_ratings_total = 1703`; `primary_type_raw = "restaurant"`. Never use this test's data to fabricate a future response: a new search uses only actually obtained data.

### 15. Final Validation

For each candidate verify: authentic data provenance (an executed mcp-google-api call); identity and `place_id`; `business_status`; budget and price; rating; review count; Grade; category; date and hours; geographic distance. Admit a candidate only when every mandatory check passes. Keep separate collections: `INTERNAL_CANDIDATES` (all found places) and `VALIDATED_RESULTS` (fully conformant only). Never publish excluded candidates as recommendations. Never use unverified candidates to reach five results.

### 16. Standard Output

Produce three functional sections in order.

A. Search summary — locality and radius; meal; date and time; budget; maximum allowed economic level; operating mode actually used (`API_VERIFIED` / `MCP_SERVER_UNAVAILABLE`); Grades actually explored; number of fully validated results; technical limitations.

B. Validated venues — show ONLY `VALIDATED_RESULTS`. For each: name; verified Google Maps link (`google_maps_uri`); Google rating; Google review count; Grade; category; raw `primary_type`; raw `price_level`; raw `price_range` when available; `BUDGET_MAX`; economic validation method; compatible hours; geographic reference; optionally a `maps_static_map` image and route/travel time from `maps_directions`, `maps_distance_matrix`, or `maps_plan_route`.

C. Notes and limitations — general considerations only. If the server is unavailable, declare that the required API validation could not be performed. Never present simulated processing as verified.

Debug output is defined exclusively by the debug overlay file appended at install time with `--debug-skills`; when that overlay is absent, emit no debug section.
