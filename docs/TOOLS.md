# Tool Catalog

18 MCP tools, all prefixed `maps_`. The exposed set can be reduced with the `mcp-google-api tools <list|*>` command (see [CONFIGURATION.md](CONFIGURATION.md)).

## Local search and details (Places API — New)

### `maps_search_places`

Text Search (New) with **server-side filters** — the primary tool for structured searches.

| Parameter | Type | Notes |
| --- | --- | --- |
| `query` | string (required) | Free-text query |
| `priceLevels` | enum array | Cumulative price filter applied by the API: `PRICE_LEVEL_FREE`, `PRICE_LEVEL_INEXPENSIVE`, `PRICE_LEVEL_MODERATE`, `PRICE_LEVEL_EXPENSIVE`, `PRICE_LEVEL_VERY_EXPENSIVE` |
| `minRating` | number 1.0–5.0 | Rating filter applied by the API |
| `includedType` | string | **One type per call** (Text Search contract), e.g. `restaurant`, `cafe`, `bakery` |
| `strictTypeFiltering` | boolean | Strict matching of `includedType` |
| `openNow` | boolean | Only currently open venues |
| `locationBias` | object | `{ latitude, longitude, radius? }` (radius in meters, default 5000) |
| `pageSize` | 1–20 | Result cap per call (translated into `maxResultCount`). SDK note: the `@googlemaps/places` proto (up to 3.1.0) does not include `page_size`/`page_token` → **pagination beyond 20 results per call is unavailable**; use different queries for more results |
| `pageToken` | string | Next-page token |
| `languageCode` | string | Result language (`it`, `en`, …) |
| `includeRaw` | boolean | Attaches the original payload: `raw_place` per result, the whole page `raw_response`, and the `field_mask` actually sent |

Output: `{ results[], nextPageToken?, field_mask, raw_response? }`. Each result includes `place_id`, `name`, `address`, `location`, `primary_type`, `types`, `business_status`, `google_maps_uri`, `price_level`, **`price_range` (original Money structure: `startPrice`/`endPrice` → `currencyCode`/`units`/`nanos`)**, `rating`, `total_ratings`, `regular_opening_hours`, `current_opening_hours`.

### `maps_search_nearby`

Search Nearby (New) around a center (`center.value` address/landmark/coordinates, `radius` in meters), with `keyword` (type), `openNow`, and `minRating` filters (post-filtering).

### `maps_place_details`

Place Details (New) for `placeId`: contact data, website, opening hours (regular + current with `periods`), reviews with attribution, photos (`maxPhotos` 0–10), `price_range`, `business_status`, `types`. With `includeRaw: true` it attaches `raw_place` and `field_mask`.

### `maps_explore_area`

Explores an area by category (defaults `restaurant`, `cafe`, `tourist_attraction`) with the top-N results per type.

### `maps_compare_places`

Compares up to N venues from one query: type, opening hours, contacts, prices, options.

### `maps_search_along_route`

Searches venues along a route (origin → destination).

### `maps_local_rank_tracker`

Tracks a venue rank over a grid of points (ARP/ATRP/Solv) for one keyword.

## Geocoding

- `maps_geocode` — address/name → coordinates + `place_id`
- `maps_reverse_geocode` — coordinates → address
- `maps_batch_geocode` — up to 25 batched requests

## Navigation

- `maps_directions` — route A→B with waypoints, travel mode, avoid flags
- `maps_distance_matrix` — origin/destination matrix (Routes API)
- `maps_plan_route` — multi-stop itinerary with intermediate waypoint optimization

## Environment

- `maps_elevation` — point elevation or elevation profile of a track
- `maps_timezone` — time zone and local time
- `maps_weather` — current weather and forecasts
- `maps_air_quality` — air quality
- `maps_static_map` — static map (PNG image)

## Common conventions

- Coordinates in input: `{ latitude, longitude }` or a `"lat,lng"` string where documented.
- Every tool returns JSON in `content[0].text`; failures set `isError: true`.
- Raw API fields (e.g. Money `price_range`) are **preserved verbatim**, never converted into plain numbers.
