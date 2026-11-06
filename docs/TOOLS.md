# Catalogo dei tool

18 tool MCP, tutti prefissati `maps_`. L'elenco esposto può essere ridotto con il comando `mcp-google-api tools <list|*>` (vedi [CONFIGURATION.md](CONFIGURATION.md)).

## Ricerca e dettaglio locali (Places API — New)

### `maps_search_places`

Text Search (New) con **filtri server-side** — è il tool principale per ricerche strutturate.

| Parametro | Tipo | Note |
| --- | --- | --- |
| `query` | string (obbligatorio) | Query testuale libera |
| `priceLevels` | enum array | Filtro economico cumulativo lato API: `PRICE_LEVEL_FREE`, `PRICE_LEVEL_INEXPENSIVE`, `PRICE_LEVEL_MODERATE`, `PRICE_LEVEL_EXPENSIVE`, `PRICE_LEVEL_VERY_EXPENSIVE` |
| `minRating` | number 1.0–5.0 | Filtro rating applicato dall'API |
| `includedType` | string | **Un solo tipo per chiamata** (contratto Text Search), es. `restaurant`, `cafe`, `bakery` |
| `strictTypeFiltering` | boolean | Matching rigoroso di `includedType` |
| `openNow` | boolean | Solo locali attualmente aperti |
| `locationBias` | oggetto | `{ latitude, longitude, radius? }` (raggio in metri, default 5000) |
| `pageSize` | 1–20 | Tetto risultati per chiamata (tradotto in `maxResultCount`). Nota SDK: il proto di `@googlemaps/places` (fino a 3.1.0) non include `page_size`/`page_token` → **paginazione oltre 20 risultati/chiamata non disponibile**; per più risultati usare query diverse |
| `pageToken` | string | Token della pagina successiva |
| `languageCode` | string | Lingua risultati (`it`, `en`, …) |
| `includeRaw` | boolean | Allega il payload originale: `raw_place` per ogni risultato, `raw_response` dell'intera pagina e la `field_mask` realmente inviata |

Output: `{ results[], nextPageToken?, field_mask, raw_response? }`. Ogni risultato include `place_id`, `name`, `address`, `location`, `primary_type`, `types`, `business_status`, `google_maps_uri`, `price_level`, **`price_range` (struttura Money originale: `startPrice`/`endPrice` → `currencyCode`/`units`/`nanos`)**, `rating`, `total_ratings`, `regular_opening_hours`, `current_opening_hours`.

### `maps_search_nearby`

Search Nearby (New) attorno a un centro (`center.value` indirizzo/landmark/coordinate, `radius` in metri), con filtro `keyword` (tipo), `openNow`, `minRating` (post-filtro).

### `maps_place_details`

Place Details (New) per `placeId`: contatti, sito, orari (regular + current con `periods`), recensioni con attribuzione, foto (`maxPhotos` 0–10), `price_range`, `business_status`, `types`. Con `includeRaw: true` allega `raw_place` e `field_mask`.

### `maps_explore_area`

Esplora una zona per categorie (default `restaurant`, `cafe`, `tourist_attraction`) con i top-N per tipo.

### `maps_compare_places`

Confronta fino a N locali da una query: tipo, orari, contatti, prezzi, opzioni.

### `maps_search_along_route`

Cerca locali lungo un percorso (origine → destinazione).

### `maps_local_rank_tracker`

Traccia il rank di un locale su una griglia di punti (ARP/ATRP/Solv) per una keyword.

## Geocoding

- `maps_geocode` — indirizzo/nome → coordinate + `place_id`
- `maps_reverse_geocode` — coordinate → indirizzo
- `maps_batch_geocode` — fino a 25 richieste batch

## Navigazione

- `maps_directions` — percorso A→B con tappe, modalità, evitamenti
- `maps_distance_matrix` — matrice origini/destinazioni (Routes API)
- `maps_plan_route` — pianificazione multi-tappa con ottimizzazione tappe intermedie

## Ambiente

- `maps_elevation` — quota di punti o profilo di un tracciato
- `maps_timezone` — fuso orario e ora locale
- `maps_weather` — meteo corrente/previsioni
- `maps_air_quality` — qualità dell'aria
- `maps_static_map` — mappa statica (immagine PNG)

## Convenzioni comuni

- Coordinate in input: `{ latitude, longitude }` oppure stringa `"lat,lng"` dove indicato.
- Tutti i tool restituiscono JSON in `content[0].text`; errori con `isError: true`.
- I campi grezzi dell'API (es. `price_range` Money) sono **conservati verbatim**, mai convertiti in numeri semplici.
