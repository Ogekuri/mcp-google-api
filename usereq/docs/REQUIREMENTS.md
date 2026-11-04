# mcp-google-map Requirements

## 1. Introduction

### 1.1 Document Rules
This document MUST follow these authoring rules (LLM-first, normative SRS):
- This document MUST be written and maintained in English.
- Use RFC 2119 keywords exclusively (MUST, MUST NOT, SHOULD, SHOULD NOT, MAY). Do not use "shall".
- In requirements sections, every bullet MUST be a requirement and MUST start with a unique, stable Requirement ID (e.g., **REQ-001**).
- Requirement IDs MUST be stable: never renumber, reuse, or repurpose an ID. Only the dedicated reorganization workflow may renumber and it MUST emit an old→new ID mapping.
- Requirement ID prefixes MUST be consistent; this document uses: PRJ (project function), CTN (project constraint), DES (design/implementation constraint), REQ (observable function), TST (test requirement), PKG (packaging and publication).
- Each requirement MUST be atomic, single-sentence, and testable; target <= 35 words per requirement; split any compound behavior into separate IDs.
- Write for other LLM Agents and automated parsers (high semantic density; no filler).
- On every change to this document:
  - Keep the first line as a level-1 title beginning with `# `.
  - Do NOT add YAML front matter or in-document revision history; use git history / CHANGELOG.md for change tracking.

### 1.2 Project Scope
`mcp-google-map` (v0.0.0, GPL-3.0) is a Model Context Protocol (MCP) server exposing 18 Google Maps tools (geocoding, Places API (New), Routes, Weather, Air Quality, Time Zone, Elevation, Static Maps) to AI agents over stdio or Streamable HTTP, plus a standalone CLI (`doctor`, `exec`, `batch-geocode`, `setup`, `snippet`, `enable`, `disable`, `auto-update <enable|disable|1|0>`, `install`, `uninstall`, `show`, `api-key`). Boundaries: read-only Google API queries only; no persistence, no caching layer, no user management, no write operations.

Project file/folder structure (evidence: repository tree):

```
mcp-google-map/
├── .github/workflows/           # GitHub Actions: ci.yml (push/PR checks), release.yml (tag releases)
├── docs/                        # Usage docs (CONFIGURATION.md, TOOLS.md)
├── scripts/                     # Shell helpers: build.sh, setup.sh, start-http.sh, start-mcp.sh, test.sh
├── src/
│   ├── cli.ts                   # yargs entry: doctor, exec, batch-geocode, server start
│   ├── config.ts                # serverConfigs registry, tool annotations, filterTools()
│   ├── index.ts                 # Logger (stderr) + public re-exports
│   ├── core/
│   │   └── BaseMcpServer.ts     # MCP server: stdio + Streamable HTTP, per-session state
│   ├── services/
│   │   ├── NewPlacesService.ts  # Places API (New) client + response transforms
│   │   ├── PlacesSearcher.ts    # Facade: 18 operations incl. composite tools
│   │   ├── RoutesService.ts     # Routes API REST client (fetch)
│   │   └── toolclass.ts         # Legacy GoogleMapsTools client (other Maps APIs)
│   ├── tools/
│   │   └── maps/                # 18 MCP tool modules (NAME/DESCRIPTION/SCHEMA/ACTION)
│   ├── resources/
│   │   └── skills/              # LLM agent skills: manifest.json, README.md, <skill-id>/SKILL.md, <skill-id>/DEBUG.md
│   └── utils/
│       ├── apiKeyManager.ts     # ApiKeyManager singleton (key resolution priority)
│       ├── autoUpdate.ts        # npm registry update check (stderr-only)
│       ├── clientSnippets.ts    # MCP-client registration snippet renderer
│       ├── configResolver.ts    # typed runtime config resolution + secret masking
│       ├── requestContext.ts    # AsyncLocalStorage request context (apiKey, sessionId)
│       └── toolProfiles.ts      # tool -> Google API dependency profiles
├── tests/                       # node:test unit suites + smoke.test.ts (live e2e)
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

Components and libraries (evidence: `package.json` `dependencies`/`devDependencies`, direct imports in `src/`):
- `@modelcontextprotocol/sdk` ^1.32.0 — McpServer, StdioServerTransport, StreamableHTTPServerTransport (`src/core/BaseMcpServer.ts`).
- `@googlemaps/places` ^2.1.0 — PlacesClient for Places API (New) (`src/services/NewPlacesService.ts`).
- `@googlemaps/google-maps-services-js` ^3.4.0 — legacy Client for geocode/reverse-geocode/timezone/elevation (`src/services/toolclass.ts`).
- `express` ^4.21.2 — HTTP server hosting `/mcp` (`src/core/BaseMcpServer.ts`).
- `yargs` ^17.7.2 — CLI command parsing (`src/cli.ts`).
- `zod` ^3.25.0 — tool input schemas (`src/tools/maps/*.ts`, `src/config.ts`).
- `dotenv` ^16.4.7 — `.env` loading (`src/cli.ts`, `src/services/toolclass.ts`).
- Dev toolchain: `typescript` ^5.7.3, `tsup` ^8.4.0 (ESM build), `tsx` ^4.19.2 (test runner).

## 2. Project Requirements

### 2.1 Project Functions
- **PRJ-001**: MUST expose 18 Google Maps MCP tools: maps_geocode, maps_reverse_geocode, maps_search_nearby, maps_search_places, maps_place_details, maps_directions, maps_distance_matrix, maps_elevation, maps_timezone, maps_weather, maps_explore_area, maps_plan_route, maps_compare_places, maps_air_quality, maps_static_map, maps_batch_geocode, maps_search_along_route, maps_local_rank_tracker.
- **PRJ-002**: MUST serve tool calls over both stdio transport and Streamable HTTP transport at endpoint path `/mcp`.
- **PRJ-003**: MUST provide a standalone CLI with commands: `doctor`, `exec <tool> [params]`, `batch-geocode`, `setup`, `snippet`, `enable <cli>`, `disable <cli>`, `auto-update <enable|disable|1|0>`, `install`, `uninstall`, `show`, `api-key <key>`, server start via `start` or `run`, and management flags `--upgrade`, `--uninstall`, `--ver`, `--version`.
- **PRJ-004**: MUST provide composite tools (explore-area, plan-route, compare-places, search-along-route, local-rank-tracker) that chain geocoding, search, details, and routing calls internally.
- **PRJ-005**: MUST support per-request and per-session Google Maps API keys so concurrent HTTP clients use isolated credentials.
- **PRJ-006**: MUST allow restricting exposed tools via the `GOOGLE_MAPS_ENABLED_TOOLS` comma-separated allowlist environment variable resolved through the central typed configuration.
- **PRJ-007**: MUST provide CLI batch geocoding of address files or stdin with bounded concurrency and JSON summary output.
- **PRJ-008**: MUST report machine-readable JSON results on stdout and diagnostics on stderr in all CLI modes except the human-readable `show` report tables and the `api-key`/`auto-update` operation reports.
- **PRJ-015**: MUST provide CLI commands `enable <cli>`, `disable <cli>`, `install`, `uninstall`, and `show` managing MCP-server registration and packaged skill installation across supported CLI agents.
- **PRJ-009**: MUST provide machine-readable tool/API dependency profiles covering all 18 tools, including the tool dependencies of composite tools.
- **PRJ-010**: MUST provide a `snippet` CLI command that prints valid MCP-client registration snippets without modifying any client configuration file.
- **PRJ-011**: MUST provide a non-interactive `setup` CLI command that verifies local readiness without prompts or Google API calls.
- **PRJ-012**: MUST ship LLM agent skills as self-contained English `SKILL.md` resources under `src/resources/skills/<skill-id>/`, exactly one skill per directory, plus an optional `<skill-id>/DEBUG.md` debug overlay.
- **PRJ-013**: MUST maintain `src/resources/skills/manifest.json` indexing every skill (id, name, version, language, path, description, optional `debug` overlay path) plus `src/resources/skills/README.md` authoring conventions enabling new skills without source-code changes.
- **PRJ-014**: MUST ship the `eatspot-discovery` skill dedicated to discovering bars, pastry shops, restaurants, cafes, and bakeries.

### 2.2 Project Constraints
- **CTN-001**: MUST declare all tools read-only, non-destructive, idempotent, and open-world via MCP tool annotations (evidence: `MAPS_TOOL_ANNOTATIONS`, `src/config.ts`).
- **CTN-002**: MUST require a Google Maps API key from the persisted user settings (REQ-142) or a per-request HTTP header before any tool call executes.
- **CTN-003**: MUST reserve stdio-mode stdout exclusively for JSON-RPC frames, dropping non-JSON stdout writes.
- **CTN-004**: MUST default Places API result language to English (`languageCode: "en"`).
- **CTN-005**: MUST run on Node.js `>= 22`, declared in `package.json` `engines` and enforced identically by the `doctor` local check.
- **CTN-006**: MUST build and run as ECMAScript Modules only (`"type": "module"`, tsup ESM output).
- **CTN-007**: MUST load `.env` from the current working directory first, then from the package installation directory, unless an explicit `--env-file` is given.
- **CTN-008**: MUST NOT use any database or file-based persistence; all state is in-memory per process, except user-authorized local configuration files and the automatic-update idle cache under `~/.cache/mcp-google-map/`.
- **CTN-009**: MUST support a global `--env-file <path>` CLI option that loads exactly the given file before command execution and fails when it is missing.

### 2.3 Packaging and Publication
- **PKG-001**: MUST keep `README.md` free of placeholder markers and of badges that do not match the Node.js runtime declared in `package.json` `engines`.
- **PKG-002**: MUST resolve every `README.md` navigation-menu anchor to an existing section heading in the same document.
- **PKG-003**: MUST document in `README.md` a prebuilt-package-first Quick Start and installation paths: npm install, one-shot `npx`, and from-source build via cross-platform npm commands.
- **PKG-004**: MUST run a GitHub Actions CI workflow on push and pull_request across Linux, macOS, and Windows that installs dependencies with the lockfile, typechecks, and runs unit tests excluding live e2e tests.
- **PKG-005**: MUST define a `prepublishOnly` script in `package.json` that runs the version guard, typecheck, unit tests, and build before any `npm publish`.
- **PKG-006**: MUST set one identical non-`0.0.0` semantic version across `package.json`, `package-lock.json`, and the `README.md` title for every published release.
- **PKG-007**: MUST print only the distribution package name `mcp-google-map` in user-facing doctor messages.
- **PKG-008**: MUST trigger the release workflow only on pushed tags matching `v[0-9]+.[0-9]+.[0-9]+` whose commit is reachable from `master`, building, verifying, and publishing the package.
- **PKG-009**: MUST gate release jobs on a branch check that requires the tagged commit on `origin/master` before any build or publish step.
- **PKG-010**: MUST publish the package to npm from the release workflow with provenance attestation and `--access public` using `NPM_TOKEN`.
- **PKG-011**: MUST generate the GitHub Release body from a commit-based changelog (`mode: COMMIT`) categorizing commits by conventional-commit title prefix, with the category set, ignore labels, transformer, ASC `mergedAt` sort, and compare-link template.
- **PKG-012**: MUST attach the npm package tarball (not raw sources) as the GitHub Release asset, failing the release on unmatched files.
- **PKG-013**: MUST disable GitHub auto-generated release notes when the commit-based changelog is used.
- **PKG-014**: MUST pin the release Node.js version and disable dependency caching in release builds.
- **PKG-015**: MUST document in `README.md` and `docs/CONFIGURATION.md` MCP-client registration for pi CLI and OpenClaw with complete working stdio examples, including post-change reload notes.
- **PKG-016**: MUST document configuration prerequisites in `README.md` and `docs/CONFIGURATION.md`: single Google Maps API key configured via `api-key`, enabled Google services, minimal operational subset, `GOOGLE_MAPS_ENABLED_TOOLS`, and post-install `doctor` verification.
- **PKG-017**: MUST fail `npm publish` via the `prepublishOnly` guard when the `package.json` version is `0.0.0`-based or carries a prerelease or build suffix.
- **PKG-018**: MUST document in `README.md` the migration of the HTTP default bind from `0.0.0.0` to loopback `127.0.0.1`, including the `--host 0.0.0.0` opt-in.
- **PKG-019**: MUST provide a single `npm run verify` pipeline (typecheck, unit tests, build) and keep helper scripts free of implicit chained install/build steps.
- **PKG-020**: MUST document developer setup using lockfile-based `npm ci` and cross-platform npm commands in `README.md`.
- **PKG-021**: MUST install the packed tarball into a temporary environment and run the installed `doctor` local smoke check without Google API calls in the release workflow before publishing.
- **PKG-022**: MUST keep every documented example consistent with supported CLI flags, headers, and transports.
- **PKG-023**: MUST document `enable`, `disable`, `install`, `uninstall`, and `show` commands with supported CLI targets in README.md.
- **PKG-024**: MUST ship `src/resources/skills` inside the published npm package so `install` and `show` resolve manifest skills from installed packages.
- **PKG-025**: MUST document the `api-key` command as the only API-key configuration path and the stdio startup key guard in README.md.
- **PKG-026**: MUST restrict GitHub Actions package build and tarball packing to the release workflow triggered by a version tag gated on master (PKG-008, PKG-009).

## 3. Requirements

### 3.1 Design and Implementation
- **DES-001**: MUST organize code in three layers: tool modules (`src/tools/maps/`), facade (`PlacesSearcher`), and API clients (`GoogleMapsTools`, `NewPlacesService`, `RoutesService`).
- **DES-002**: MUST export each tool module as `{ NAME, DESCRIPTION, SCHEMA, ACTION }` where SCHEMA is a zod object record and ACTION is an async handler.
- **DES-003**: MUST instantiate a new `PlacesSearcher` per tool invocation using `getCurrentApiKey()` from the request context.
- **DES-004**: MUST create a dedicated `McpServer` instance and `StreamableHTTPServerTransport` per HTTP session initialization (`src/core/BaseMcpServer.ts`).
- **DES-005**: MUST implement API key resolution priority: `X-Google-Maps-API-Key` header, then `Authorization: Bearer`, then session key, then default key (`ApiKeyManager.getApiKey`).
- **DES-006**: MUST propagate per-request API keys via `AsyncLocalStorage` (`runWithContext`/`getCurrentApiKey`) with fallback to the startup default key configured from the persisted settings.
- **DES-007**: MUST have facade methods return `{ success: false, error }` objects instead of throwing, except composite methods (`resolveLocation`, `planRoute`, `comparePlaces`, `exploreArea` data errors) which throw.
- **DES-008**: MUST have every tool ACTION return `{ content: [{ type: "text", ... }], isError }`; failures set `isError: true` with the error text.
- **DES-009**: MUST call Routes API via native `fetch` against `https://routes.googleapis.com` with `X-Goog-Api-Key` and `X-Goog-FieldMask` headers (`RoutesService`).
- **DES-010**: MUST restrict Google API responses via explicit field-mask constants per operation (`NewPlacesService.placeFieldMask`, `searchNearbyFieldMask`, `searchTextFieldMask`, `RoutesService.COMPUTE_ROUTES_FIELD_MASK`, `COMPUTE_ROUTE_MATRIX_FIELD_MASK`).
- **DES-011**: MUST map Google API error codes 403/gRPC-7 to an "API key invalid or API not enabled" message and 429/gRPC-8 to a quota-exceeded message.
- **DES-012**: MUST map legacy travel-mode names driving/walking/bicycling/transit to Routes API DRIVE/WALK/BICYCLE/TRANSIT, defaulting unknown modes to DRIVE.
- **DES-013**: MUST prefer place IDs over coordinates when converting resolved locations to Routes waypoints, because Routes snaps coordinates to roads (`toRouteWaypoint`, `src/services/PlacesSearcher.ts`).
- **DES-014**: MUST implement doctor self-checks decoupled from server startup with injectable tool runner, Node version, and configuration dependencies for testing (`runDoctor`, `src/cli.ts`).
- **DES-015**: MUST resolve runtime configuration (host, port, enabled tools, env file) in one typed resolver consumed by CLI commands; the API key and update flag resolve from the persisted settings.
- **DES-016**: MUST mask secret values via a single masking helper in every diagnostic, doctor, and setup report.
- **DES-017**: MUST implement per-CLI target adapters for pi, openclaw, codex, antigravity, and claude resolving each MCP configuration file and skills destination directory from an injectable home root.
- **DES-018**: MUST persist `{ "enabled": [<cli>...], "apiKey": "", "autoUpdate": true }` JSON at `~/.config/mcp-google-map/config.json`, tolerating missing or malformed content and writing atomically; `apiKey` follows DES-023 and `autoUpdate` follows DES-024.
- **DES-021**: MUST derive the enabled-CLI settings directory from the distribution program name `mcp-google-map`; shared or generic directories such as `~/.config/skills/` MUST NOT be used.
- **DES-019**: MUST apply MCP-server registration through read-modify-write preserving every unrelated configuration entry, with atomic temporary-file replacement.
- **DES-020**: MUST synchronize packaged skills into CLI skills destinations copying packaged content files with overwrite and pruning stale files inside managed skill directories only, excluding any declared debug overlay file.
- **DES-022**: MUST implement the idle-gated version check and self-upgrade commands in a dedicated module with injectable clock, filesystem, fetch, logger, and child-process dependencies.
- **DES-023**: MUST persist the user-configured Google Maps API key as the `apiKey` field of the DES-018 settings file, reusing atomic write and malformed-content tolerance; unset keys persist and load as the empty string, and the legacy install placeholder value loads as unset.
- **DES-024**: MUST persist the automatic-update enablement as the boolean `autoUpdate` field of the DES-018 settings file; missing or malformed content loads as enabled.

### 3.2 Functions

#### HTTP Server, Sessions, and Tool Registry
- **REQ-001**: MUST register all configured tools on `tools/list` with zod-derived JSON input schemas and their annotations (`BaseMcpServer.createMcpServer`).
- **REQ-002**: MUST create a new session with `randomUUID()` when POST `/mcp` receives an initialize request without a session ID.
- **REQ-003**: MUST respond HTTP 400 with JSON-RPC error code -32000 to POST `/mcp` requests that carry no valid session ID and are not initialize requests.
- **REQ-004**: MUST respond HTTP 400 to GET or DELETE `/mcp` requests whose `mcp-session-id` header is missing or unknown.
- **REQ-005**: MUST delete the stored session context when the session transport emits `onclose`.
- **REQ-006**: MUST overwrite the stored session API key when a later request on that session supplies a header-based key.
- **REQ-007**: MUST serve GET `/mcp` for server-to-client SSE notifications and DELETE `/mcp` for session termination through one shared handler.
- **REQ-008**: MUST bind the HTTP server to `--host` (default `MCP_SERVER_HOST` or `127.0.0.1`) and port `--port` (default `MCP_SERVER_PORT` or 3000).
- **REQ-009**: MUST skip starting a server instance, log remediation guidance, and mark startup failed when its port value is unset or invalid.
- **REQ-094**: MUST start stdio mode directly from the built `dist` artifact, failing with build remediation guidance instead of implicit builds.
- **REQ-095**: MUST exit non-zero from HTTP startup when zero server instances are listening.
- **REQ-096**: MUST close all HTTP sessions and the listening socket on SIGINT or SIGTERM before exiting.
- **REQ-010**: MUST return the full tool set when `GOOGLE_MAPS_ENABLED_TOOLS` is unset, empty, or `*`.
- **REQ-011**: MUST return the named tool subset when `GOOGLE_MAPS_ENABLED_TOOLS` matches at least one tool name, trimming whitespace and ignoring empty items.
- **REQ-012**: MUST return the full tool set and log an error when `GOOGLE_MAPS_ENABLED_TOOLS` matches zero tools.
- **REQ-013**: MUST attach annotations `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true` to every registered tool.
- **REQ-014**: MUST suppress stdout string writes not beginning with `{` after any transport connect, preserving JSON-RPC framing in stdio mode.
- **REQ-015**: MUST log all diagnostics to stderr via the `Logger` wrapper (`src/index.ts`).

#### API Key Handling
- **REQ-016**: MUST resolve the request API key from the `X-Google-Maps-API-Key` header with top priority when present.
- **REQ-017**: MUST resolve the request API key from a `Bearer` token in the `Authorization` header when no `X-Google-Maps-API-Key` header is present.
- **REQ-018**: MUST fall back to the session API key, then the startup default key configured from the persisted settings, when no header key is supplied.
- **REQ-019**: MUST abort tool construction with error "Google Maps API Key is required" when the resolved key is empty in any API client constructor.
- **REQ-020**: SHOULD validate API key format as 20-50 characters of `[A-Za-z0-9_-]` via `ApiKeyManager.isValidApiKeyFormat`.

#### Geocoding Tools
- **REQ-021**: MUST return `{ location, formatted_address, place_id }` of the first geocoding result for `maps_geocode`, failing when zero results are returned.
- **REQ-022**: MUST return `{ formatted_address, place_id, address_components }` of the first reverse-geocoding result for `maps_reverse_geocode`, failing when zero results are returned.
- **REQ-023**: MUST geocode 1-50 addresses concurrently for `maps_batch_geocode`, returning per-address success/error entries plus `total`, `succeeded`, `failed` counts.

#### Places Tools
- **REQ-024**: MUST search nearby places inside a circle restriction of radius (default 1000 m) with `maxResultCount` capped at 20 for `maps_search_nearby`.
- **REQ-025**: MUST treat the `maps_search_nearby` `keyword` parameter as a single Places API (New) included type, not free text (`NewPlacesService.searchNearby` sets `includedTypes`).
- **REQ-026**: MUST apply `openNow` and `minRating` filters for `maps_search_nearby` client-side after the API response, not server-side (`PlacesSearcher.searchNearby`).
- **REQ-027**: MUST forward `openNow`, `minRating`, `includedType`, `strictTypeFiltering`, and `priceLevels` as server-side Places Text Search filters for `maps_search_places`, serving the `eatspot-discovery` skill (REQ-100-REQ-108).
- **REQ-028**: MUST apply location bias for `maps_search_places` as a circle with radius defaulting to 5000 m when unspecified.
- **REQ-029**: MUST translate `pageSize` or `maxResultCount` (default 10) into the single request field `maxResultCount` clamped into 1-20 for `maps_search_places`, because the SDK proto lacks `pageSize`.
- **REQ-030**: MUST attach `raw_place` per result and the full `raw_response` when `maps_search_places` runs with `includeRaw: true`, backing the `eatspot-discovery` audit (REQ-107).
- **REQ-031**: MUST return place details with contact info, hours, price data, parking, accessibility, dining, serves, atmosphere, payment, review and generative summaries, reviews with attribution URIs, and photo metadata for `maps_place_details`.
- **REQ-032**: MUST resolve at most `maxPhotos` photo URLs via Places photo media (maxWidthPx 800) for `maps_place_details`, silently skipping failed photos, and omit photos when `maxPhotos` is 0.
- **REQ-033**: MUST include `raw_place` and the applied field mask when `maps_place_details` runs with `includeRaw: true`, backing `eatspot-discovery` re-verification (REQ-100).
- **REQ-034**: MUST derive the legacy place ID from the `places/{id}` resource name, falling back to the `id` field (`extractLegacyPlaceId`).
- **REQ-035**: MUST compute open-now status from `currentOpeningHours.openNow`, then `regularOpeningHours.openNow`, then period arithmetic using `utcOffsetMinutes` when available, else machine local time (`isCurrentlyOpen`).
- **REQ-081**: MUST return `nextPageToken` in `maps_search_places` output when the Places API response includes one.

#### Routing Tools
- **REQ-036**: MUST compute directions for `maps_directions` via Routes `computeRoutes`, returning routes, summary, and total distance/duration in value and text form.
- **REQ-037**: MUST set `routingPreference: "TRAFFIC_AWARE"` only for DRIVE mode in route and matrix requests.
- **REQ-038**: MUST reject `avoid_tolls`/`avoid_highways` with an error unless travel mode is driving (`buildRouteModifiers`).
- **REQ-039**: MUST send `arrivalTime` instead of `departureTime` when both are provided to Routes (`computeRoutes` else-branch).
- **REQ-040**: MUST report a transit-specific regional-coverage error naming Japan and India when a transit route is not found.
- **REQ-041**: MUST rebuild the Routes distance matrix from flat elements into 2D `distances`/`durations` arrays indexed by origin/destination, leaving `ROUTE_NOT_FOUND` cells null.
- **REQ-042**: MUST fail the whole distance-matrix request when every origin/destination pair is `ROUTE_NOT_FOUND` in transit mode, and add a `warning` field for partial transit failures.
- **REQ-043**: MUST echo the input origin/destination strings as `origin_addresses`/`destination_addresses` in distance-matrix results because Routes does not resolve addresses.

#### Environment Tools
- **REQ-044**: MUST return current weather conditions (temperature, feels-like, humidity, wind, conditions, UV, precipitation, visibility, pressure, cloud cover, day/night) by default for `maps_weather`.
- **REQ-045**: MUST clamp daily forecast days to 1-10 (default 5) and hourly forecast hours to 1-240 (default 24) for `maps_weather`.
- **REQ-046**: MUST replace raw errors with an unsupported-location message listing known unsupported countries when the Weather API rejects the location.
- **REQ-047**: MUST include `HEALTH_RECOMMENDATIONS` by default and `POLLUTANT_CONCENTRATION` only when requested for `maps_air_quality`.
- **REQ-048**: MUST return the primary AQI index fields plus all secondary indexes, health recommendations, and pollutant concentrations when present for `maps_air_quality`.
- **REQ-049**: MUST return timezone ID, name, raw offset, DST offset, and ISO local time computed from the requested epoch (default now) for `maps_timezone`, failing on non-OK status.
- **REQ-050**: MUST return elevation plus echoed location per requested point in input order for `maps_elevation`, failing on non-OK status.

#### Static Map Tool
- **REQ-051**: MUST return a PNG image content block (base64) plus a text summary with byte size and dimensions for `maps_static_map`.
- **REQ-052**: MUST default `maps_static_map` size to `600x400` and maptype to `roadmap`, encoding center, markers, and path descriptors as query parameters.
- **REQ-053**: MUST reject static map requests whose assembled URL exceeds 16384 characters with a message advising fewer markers or path points.

#### Composite Tools
- **REQ-054**: MUST resolve each location string at most once for composite tools: coordinate strings pass range validation (lat ±90, lng ±180) and use geocoding only for a display address whose failure is tolerated; other strings try geocoding then Places Text Search (`resolveLocation`).
- **REQ-055**: MUST throw a combined error naming both geocoding and text-search failures when a location string resolves by neither method.
- **REQ-056**: MUST explore an area by searching each type sequentially (default types: restaurant, cafe, tourist_attraction; default radius 1000 m) and enriching the top N (default 3) results with phone and website for `maps_explore_area`.
- **REQ-057**: MUST require at least 2 stops for `maps_plan_route`, throwing otherwise.
- **REQ-058**: MUST enable Routes waypoint optimization for `maps_plan_route` only when `optimize !== false`, stops > 3, and mode is not transit.
- **REQ-059**: MUST reorder `maps_plan_route` output stops according to `optimizedIntermediateWaypointIndex` when optimization applies, keeping first and last stops fixed.
- **REQ-060**: MUST return one leg per ordered stop pair with formatted distance/duration for `maps_plan_route`, substituting `"unknown"` values and an explanatory note when a leg is missing.
- **REQ-061**: MUST report `maps_plan_route` totals as kilometers rounded to one decimal and duration rounded to whole minutes.
- **REQ-062**: MUST compare up to `limit` (default 5) text-search results for `maps_compare_places`, enriching each with details fields including parking, serves, atmosphere, and dining options.
- **REQ-063**: MUST add driving `distance` and `drive_time` per compared place from a distance matrix when `maps_compare_places` receives `userLocation`.
- **REQ-064**: MUST compute routes with default mode walking to obtain the encoded polyline, then run Places Text Search with `searchAlongRouteParameters` for `maps_search_along_route`, capping results at 20 (default 5).
- **REQ-065**: MUST generate a gridSize×gridSize grid (default 3, schema range 3-7) around the center with spacing (default 1000 m, range 100-10000) using 111320 m per latitude degree and cosine-corrected longitude degrees for `maps_local_rank_tracker`.
- **REQ-066**: MUST scan each grid point of `maps_local_rank_tracker` via location-biased Text Search (radius spacing/2, maxResultCount 20) with concurrency 5, recording rank (1-based or null) and top-3 competitor names.
- **REQ-067**: MUST compute `maps_local_rank_tracker` metrics: ARP (mean found rank), ATRP (mean rank counting missing as 21), SoLV (percent of points ranking in top 3), and `found_in` count, each rounded to one decimal.
- **REQ-068**: MUST return a flat single-keyword response for `maps_local_rank_tracker` with one keyword, and a `keywords` array response for two or three keywords.
- **REQ-069**: SHOULD resolve the target business display name for `maps_local_rank_tracker` via place details while tolerating lookup failure with an empty name.

#### CLI
- **REQ-070**: MUST verify Node >= 22 per `package.json` `engines`, non-zero package version, and API key presence in `doctor` local mode without network calls, exiting 0 only when no check fails.
- **REQ-071**: MUST add a skipped `live-api` check in `doctor` when `--live` is absent or no API key is configured, making no billable calls.
- **REQ-072**: MUST probe Geocoding, Places (New), and Routes APIs independently via geocode, search-places, and directions calls in `doctor --live` mode, failing only the probes that error.
- **REQ-089**: MUST report effective configuration with per-field sources and masked secrets in `doctor` local mode.
- **REQ-090**: MUST report the Google APIs required by each enabled tool from the tool/API profiles in `doctor` local mode without network calls.
- **REQ-091**: MUST probe a `--probes`-selected subset of Geocoding, Places (New), and Routes in `doctor --live`, probing all three when `--probes` is absent.
- **REQ-073**: MUST execute a named tool with JSON parameters for `exec`, accepting short, snake_case, and `maps_`-prefixed aliases per the `EXEC_TOOLS` mapping.
- **REQ-074**: MUST exit 1 with a JSON error on stderr for `exec` when no API key is configured, when the tool reports `{ success: false }`, when parameters are not valid JSON, or when the tool name is unknown.
- **REQ-075**: MUST write successful `exec` results as pretty-printed JSON to stdout with exit code 0.
- **REQ-076**: MUST read one address per line for `batch-geocode` from `--input` file or stdin when `--input -`, rejecting empty input with exit 1.
- **REQ-077**: MUST bound `batch-geocode` concurrency between 1 and 50 (default 20), print a JSON summary with counts and per-address results, and write progress to stderr only when `--output` is set.
- **REQ-078**: MUST write `batch-geocode` results to `--output` file when given, otherwise stdout, and exit 1 when any address failed.
- **REQ-079**: MUST start the MCP server from the `start` and `run` commands in stdio mode when `--stdio` is passed, otherwise in HTTP mode, applying `--env-file` before startup.
- **REQ-080**: MUST log a warning instead of failing when the `start` or `run` server-start command runs in HTTP mode without an API key.
- **REQ-087**: MUST run `setup` non-interactively: no prompts, no Google API calls, no writes unless an explicit write option is passed.
- **REQ-088**: MUST create `.env` from `.env.example` in `setup` only with explicit write authorization and only when the target file is absent, never overwriting existing files.
- **REQ-092**: MUST print valid JSON MCP-client registration snippets for stdio and HTTP to stdout in `snippet`, writing no file.
- **REQ-093**: MUST embed literal placeholder values in snippets by default; `--env-key` MUST emit variable references documented as client-specific.
- **REQ-129**: MUST print the `--help` text on stdout and exit 0 when no command argument is supplied, without starting any server.
- **REQ-130**: MUST print the application version adjacent to the first `mcp-google-map` line in help output.
- **REQ-131**: MUST list in the help text the management commands `--upgrade`, `--uninstall`, `--ver`, and `--version`, each with a description.
- **REQ-142**: `start`/`run` MUST resolve the effective API key exclusively from the persisted settings key (REQ-136), treating empty and placeholder values as unset.
- **REQ-143**: `start`/`run` with `--stdio` MUST exit 1 before creating any server when REQ-142 resolves no key, printing a stderr JSON error naming the `api-key` command.

#### Automatic Update Check
- **REQ-082**: MUST run an automatic update check by default at server startup in stdio and HTTP modes, comparing the running version against the latest `mcp-google-map` version published on the npm registry, subject to the idle cache gate (REQ-121).
- **REQ-083**: MUST skip the automatic update check and make no registry network calls when the persisted settings `autoUpdate` field is false (DES-024).
- **REQ-084**: MUST report a newer available npm version on stderr only, including current version, latest version, and an upgrade command.
- **REQ-085**: MUST NOT block server startup on the automatic update check and MUST tolerate registry, network, and malformed-response failures with stderr diagnostics only.
- **REQ-086**: MUST document the `auto-update` command and the settings `autoUpdate` field in `README.md` and `docs/CONFIGURATION.md`, stating that the automatic update check is enabled by default.

#### Self-Upgrade and Version Reporting
- **REQ-120**: MUST provide top-level `--ver` and `--version` commands that force one online latest-version check bypassing the idle gate and print the installed version to stdout with exit code 0.
- **REQ-121**: MUST gate the automatic update check with an idle cache file at `~/.cache/mcp-google-map/check_version_idle-time.json`, skipping the registry request while its `idle_time_epoch` is in the future.
- **REQ-122**: MUST persist cache fields `last_success_epoch`, `last_success_human`, `idle_time_epoch`, and `idle_time_human` (ISO-8601 UTC) after each executed check, tolerating missing or malformed cache content.
- **REQ-123**: MUST set the idle window to 3600 seconds when a newer version is found and 86400 seconds otherwise.
- **REQ-124**: MUST report each executed check on stderr only: `Available Version: <latest> | Installed Version: <current>` plus an upgrade command when newer and an error notice on failure; it MUST emit no output when no newer version exists.
- **REQ-125**: MUST implement `--upgrade` to run `npm install -g mcp-google-map@latest` as a child process with inherited stdio, propagating its exit code.
- **REQ-126**: MUST, after a successful `--upgrade` with at least one enabled CLI, run the upgraded package's `install` child command without `--debug-skills` with captured stdout, refreshing skills and MCP registrations without echoing the child JSON summary.
- **REQ-127**: MUST implement `--uninstall` to run `npm uninstall -g mcp-google-map` as a child process with inherited stdio, propagating its exit code.
- **REQ-128**: MUST print the manual package-manager command and return exit code 1 when a management child process fails to spawn.
- **REQ-132**: MUST print on stdout a human-readable summary after a successful `--upgrade` package update stating the starting version, the updated version, and the post-upgrade install outcome.
- **REQ-133**: MUST list in the `--upgrade` summary one entry per processed CLI with its name and per-CLI install result.
- **REQ-134**: MUST print `unknown` as the updated version in the `--upgrade` summary when the post-upgrade latest-version probe fails.
- **REQ-135**: MUST derive the `--upgrade` summary CLI list from persisted enabled settings when the child `install` output is absent or unparseable.
- **REQ-144**: `--upgrade` MUST first run one online npm-registry latest-version check comparing the installed version, bypassing the idle cache gate, before spawning any child process.
- **REQ-145**: When the pre-upgrade check reports no newer version, `--upgrade` MUST print on stdout that the installed version is the latest available including the version number, terminate with exit code 0, and spawn no child process.
- **REQ-146**: `--upgrade` MUST proceed with the REQ-125 package update, the REQ-126 post-upgrade install, and the REQ-132 summary exactly when the pre-upgrade check reports a newer available version.
- **REQ-147**: When the pre-upgrade check cannot determine a newer version (installed version unknown or probe failure), `--upgrade` MUST proceed with the package update.
- **REQ-148**: The `auto-update <value>` command MUST accept `enable`, `disable`, `1`, and `0` case-insensitively, resolving to the boolean automatic-update enablement.
- **REQ-149**: `auto-update` MUST persist the resolved boolean into the DES-018 settings `autoUpdate` field with an atomic write before printing any result.
- **REQ-150**: `auto-update` MUST print on stdout a human-readable confirmation naming the resulting automatic-update state and exit 0.
- **REQ-151**: `auto-update` MUST reject a missing or non-accepted value with a human-readable stderr error listing the accepted values, exiting non-zero without persisting anything.

#### Skill Resources
- **REQ-097**: Each skill MUST provide a `SKILL.md` with YAML front matter `name` (1-64 lowercase ASCII letters, digits, hyphens, matching the directory name) and non-empty `description`.
- **REQ-098**: Each `SKILL.md` MUST be written in English, be self-contained, and reference only mcp-google-map tool names defined by PRJ-001.
- **REQ-099**: Adding a skill MUST require only a new `src/resources/skills/<skill-id>/SKILL.md` directory plus one synchronized `manifest.json` entry.
- **REQ-100**: The `eatspot-discovery` skill MUST mandate that every Google Maps data value originates from an executed mcp-google-map tool call and MUST forbid presenting fabricated, simulated, or reconstructed data as API-verified.
- **REQ-101**: The `eatspot-discovery` skill MUST assign a defined workflow role to each of the 18 mcp-google-map tools across discovery, enrichment, routing, context, composite, and audit support.
- **REQ-102**: The `eatspot-discovery` skill MUST define default meal budgets (breakfast EUR 10, lunch EUR 30, dinner EUR 40), user-amount precedence, cumulative `priceLevels` mapping, and numeric `price_range.endPrice` priority over `price_level`.
- **REQ-103**: The `eatspot-discovery` skill MUST define five quality grades A-E from `rating` and `user_ratings_total` thresholds plus per-grade `minRating` mapping (4.5 for A-B, 4.0 for C-E).
- **REQ-104**: The `eatspot-discovery` skill MUST classify venues by `primary_type`/`types` preserving raw values and MUST verify meal-window compatibility through `regular_opening_hours`/`current_opening_hours`.
- **REQ-105**: The `eatspot-discovery` skill MUST define geographic modes (3 km, 10 km, 20 km) and progressive grade search A through E stopping at five fully validated venues.
- **REQ-106**: The `eatspot-discovery` skill MUST define output sections: search summary, validated venues, and notes and limitations.
- **REQ-107**: The `eatspot-discovery` skill MUST instruct `includeRaw: true` for auditable `raw_place`/`raw` payload capture and MUST document that `pageToken` is forwarded but has no server-side effect.
- **REQ-108**: The `eatspot-discovery` skill MUST retain a binding anti-fabrication regression case where a high-rating over-budget venue is excluded.
- **REQ-109**: The `eatspot-discovery` skill MUST obtain its economic and quality filtering via REQ-027 and its audit payloads via REQ-030 and REQ-033.
- **REQ-152**: A `manifest.json` skill entry MAY declare an optional `debug` path, relative to the skill directory, naming that skill's debug instructions file.
- **REQ-153**: The `eatspot-discovery` skill MUST keep all debug-generation instructions in a dedicated packaged debug file and MUST keep `SKILL.md` free of them.
- **REQ-154**: `install` MUST accept a `--debug-skills` boolean option defaulting to disabled.
- **REQ-155**: `install` without `--debug-skills` MUST synchronize skill content files only, excluding every declared debug file.
- **REQ-156**: `install` with `--debug-skills` MUST append the declared debug file content to the installed `SKILL.md` of every skill declaring one.
- **REQ-157**: `install` MUST rewrite each installed `SKILL.md` from the packaged content before any debug append so repeated runs never duplicate the overlay.
- **REQ-158**: `show` MUST report `OK` for a skill whose installed `SKILL.md` equals the packaged content or that content plus the declared debug file content.
- **REQ-159**: `api-key` MUST run its post-persist install operation without the debug overlay.
- **REQ-160**: The `eatspot-discovery` debug file MUST define the debug output section, the per-call JSON register schema, bounded raw capture, and provenance rules for every executed tool call.

#### CLI Configuration Management
- **REQ-110**: MUST resolve CLI names pi, openclaw, codex, antigravity, claude case-insensitively; unsupported names MUST fail listing supported names.
- **REQ-111**: `enable <cli>` MUST add and `disable <cli>` MUST remove the resolved CLI name in the persisted enabled set; both MUST be idempotent.
- **REQ-112**: MUST resolve MCP configuration files: pi `~/.pi/agent/mcp.json`, openclaw `~/.openclaw/openclaw.json`, codex `~/.codex/config.toml` (`mcp_servers` table), antigravity `~/.gemini/settings.json`, claude `~/.claude.json` (JSON `mcpServers` map).
- **REQ-113**: MUST resolve skills directories: pi `~/.pi/agent/skills`, openclaw `~/.openclaw/workspace/skills`, codex `~/.codex/skills`, antigravity `~/.gemini/config/skills`, claude `~/.claude/skills`.
- **REQ-114**: `install` MUST register per enabled CLI the stdio entry `mcp-google-map` launching `npx -y mcp-google-map start --stdio` with no API-key environment setup, and install every manifest skill.
- **REQ-115**: `uninstall` MUST remove per enabled CLI the `mcp-google-map` MCP entry and managed skill directories; absent entries MUST count as removed without failure.
- **REQ-116**: `install` and `uninstall` MUST process enabled CLIs only, report per-CLI counts, continue on per-CLI failures, and exit 1 when any failure occurs.
- **REQ-117**: `show` MUST print a CLI Configuration table with columns CLI, Enabled, MCP Config Path, Skills Config Path covering all five supported CLIs in registry order.
- **REQ-118**: `show` MUST print an Installation Status table with columns Type, Name, CLI, Enabled, Installed listing the server and each manifest skill per enabled CLI with OK, MISSING, or STALE status.
- **REQ-119**: `install` and `uninstall` with zero enabled CLIs MUST print the enable hint and exit 0; `show` MUST always print the CLI Configuration table.
- **REQ-136**: `api-key <key>` MUST persist the supplied Google Maps API key into the DES-018 user settings file before running any install operation.
- **REQ-137**: `api-key` MUST reject empty, whitespace-only, or REQ-020-invalid keys with a human-readable stderr error and non-zero exit, persisting nothing.
- **REQ-138**: after persisting, `api-key` MUST run the install operation for every enabled CLI, applying REQ-116 and REQ-119 semantics.
- **REQ-139**: `api-key` MUST print on stdout a human-readable report stating the configured key masked per DES-016 and one line per processed CLI with its install result.

### 3.3 Known Limitations (True State)
- **LIM-001**: `maps_search_nearby` may return fewer than 20 results when client-side `openNow`/`minRating` filters discard matches post-query.
- **LIM-002**: `GoogleMapsTools.parseCoordinates` validates only numeric parsing, not geographic ranges; range rejection happens only in composite `resolveLocation` (`src/services/toolclass.ts`).
- **LIM-004**: `maps_static_map` passes `size` through without enforcing the documented 640x640 maximum; only the 16384-character URL limit is enforced.
- **LIM-005**: Transit routing has regional coverage gaps; the server surfaces Google's regional limitations (notably Japan and India) as errors or warnings rather than fallbacks.
- **LIM-006**: No explicit performance optimizations identified beyond bounded concurrency batching (grid scan concurrency 5 in `scanKeywordGrid`; CLI semaphore clamp 1-50).
- **LIM-007**: `maps_search_places` `pageToken` is copied into the request but silently dropped by `@googlemaps/places` SDK protos (verified up to v3.1.0), so pagination requests have no server-side effect.

## 4. Test Requirements
- **TST-001**: MUST verify REQ-073/REQ-074/REQ-075 by running `npm test` (`tests/cliExec.unit.test.ts`): injected runners assert stdout JSON on success, stderr JSON plus exit code 1 on failure responses, thrown errors, and alias resolution; pass when all assertions hold.
- **TST-002**: MUST verify REQ-070/REQ-071/REQ-072/REQ-089/REQ-090/REQ-091 by running `npm test` (`tests/cliExec.unit.test.ts`, `tests/doctorExt.unit.test.ts`): local mode makes zero API calls, engines floor enforced, config diagnostics masked, tool profiles reported, probes selectable and independent; pass when reports match expectations.
- **TST-003**: MUST verify REQ-024-REQ-030 and REQ-081 by running `npm test` (`tests/placesFilters.unit.test.ts`): mocked `PlacesClient` assertions confirm forwarded filters, field masks, priceRange preservation, `pageSize`→`maxResultCount` translation, `nextPageToken`, `pageToken` forwarding, raw payloads, and legacy array contract.
- **TST-004**: MUST verify REQ-054/REQ-055/REQ-057 by running `npm test` (`tests/locationResolution.unit.test.ts`): mocked clients assert resolved waypoints, geocode→text-search fallback, thrown errors on unresolvable stops, and coordinate handling without API calls.
- **TST-005**: MUST verify REQ-058 by running `npm test` (`tests/planRoute.unit.test.ts`): 2-4 stop scenarios assert optimization is applied or skipped per thresholds and ordering is preserved when disabled.
- **TST-006**: MUST verify REQ-036-REQ-043 by running `npm test` (`tests/routesWaypoints.unit.test.ts`): mocked `fetch` asserts structured waypoint forwarding, two-intermediate optimization minimum, string compatibility, matrix rebuild, and waypoint-aware error labels.
- **TST-007**: MUST verify REQ-005/REQ-006 (session key isolation) by running `npm test` (`tests/apiKeyIsolation.unit.test.ts`): two sessions with distinct header keys retain distinct context keys despite a server default.
- **TST-008**: MUST verify REQ-031/REQ-034 (attribution retention) by running `npm test` (`tests/placeAttribution.unit.test.ts`): mocked details responses keep source and disclosure metadata through the facade.
- **TST-009**: MUST verify REQ-056 defaults by running `npm test` (`tests/exploreArea.unit.test.ts`): default type set contains only valid Places API (New) type names and caller-supplied types are preserved.
- **TST-010**: SHOULD verify end-to-end behavior against live Google APIs by running `npm run test:e2e` (`tests/smoke.test.ts`) with a real API key; pass requires all live tool calls to succeed. This test is excluded from `npm test`.
- **TST-011**: MUST verify REQ-082/REQ-083/REQ-084/REQ-085 by running `npm test` (`tests/autoUpdate.unit.test.ts`): injected fetch and logger assert disabled short-circuit without fetch, newer-version stderr notice, and startup-failure tolerance.
- **TST-012**: MUST verify REQ-089/CTN-009/DES-015/DES-016 by running `npm test` (`tests/configResolver.unit.test.ts`): typed resolution, per-field sources, explicit env-file precedence and missing-file failure, masked secrets.
- **TST-013**: MUST verify PRJ-009/REQ-090 by running `npm test` (`tests/toolProfiles.unit.test.ts`): all 18 tools mapped to Google APIs with composite tool dependencies included.
- **TST-014**: MUST verify PRJ-010/REQ-092/REQ-093 by running `npm test` (`tests/snippet.unit.test.ts`): snippets parse as JSON, default placeholders, `--env-key` references, no file writes.
- **TST-015**: MUST verify PRJ-011/REQ-087/REQ-088 by running `npm test` (`tests/setupCommand.unit.test.ts`): no prompts, no network, authorized creation only, existing files preserved.
- **TST-016**: MUST verify REQ-009/REQ-095/REQ-096 by running `npm test` (`tests/httpLifecycle.unit.test.ts`): invalid port marks startup failed, zero listening instances exit non-zero, signals close sessions and socket.
- **TST-017**: MUST verify REQ-079/REQ-129/REQ-130/REQ-131 by running `npm test` (`tests/cliSpawn.unit.test.ts`): spawned CLI asserts `start` boots the HTTP server from an explicit env file, and no command prints help with the version header and management commands on stdout with exit 0.
- **TST-018**: MUST verify REQ-152/REQ-154/REQ-155/REQ-156/REQ-157/REQ-158 by running `npm test` (`tests/skillDebugInstall.unit.test.ts`): temp-directory installs assert plain mode excludes the debug file, debug mode appends it once across reruns, and `show` reports OK for both modes.
- **TST-019**: MUST verify REQ-153/REQ-160 by running `npm test` (`tests/eatspotSkillContract.unit.test.ts`): the packaged `SKILL.md` carries no debug section while the packaged debug file carries the register, capture, and provenance rules.
- **TST-020**: MUST verify PKG-008/PKG-009/PKG-021/PKG-026 by running `npm test` (`tests/ciContract.unit.test.ts`): CI excludes package build/pack/smoke steps; the release workflow builds, verifies, and publishes only behind the master tag gate.
