# mcp-google-map Workflow Model

## Execution Units Index
| ID | Type | Parent | Role | Entrypoint(s) | Defining File(s) |
|---|---|---|---|---|---|
| PROC:main | process | - | Single Node.js ESM process hosting all runtime modes: MCP HTTP server, MCP stdio server, `exec` CLI, `doctor` CLI, `batch-geocode` CLI, `setup` CLI, `snippet` CLI | `yargs.parse()` command dispatch; `startServer(...)`; `runExecCommand(...)`; `runDoctor(...)`; `runSetup(...)`; `runSnippetCommand(...)`; `batch-geocode` command handler; `BaseMcpServer.startStdio()` | `src/cli.ts`, `src/core/BaseMcpServer.ts` |

- Threads: no explicit threads detected for `PROC:main` — `src/` contains no `worker_threads`, `cluster`, or `child_process` usage. All concurrency is event-loop based (`Promise.all`, `Promise.race`, async/await); Node.js libuv pool usage is an implicit runtime detail, not created by `src/` code.

## Execution Units

### PROC:main

- Type: process
- Role: MCP tool server and Google Maps API client facade; all repository logic executes in this process.
- Entrypoint(s):
  - Module load of `src/cli.ts` (dotenv load, yargs command registration, `yargs(...).parse()`).
  - Default command (`$0`) handler: stdio-server mode or `startServer(...)` (HTTP-server mode).
  - `exec <tool> [params]` handler → `runExecCommand(...)`.
  - `doctor` handler → `runDoctor(...)`.
  - `batch-geocode` handler → inline semaphore pipeline.
- Lifecycle / trigger:
  - Start: `node dist/cli.js [command] [options]`; module scope loads `.env` (cwd first, then package dir) and registers four yargs commands.
  - Server modes: HTTP mode persists via `app.listen(port, host)`; stdio mode persists via `StdioServerTransport` holding the stdin stream open. No signal handlers are registered in `src/`; server modes stop only when the transport closes or the process is killed. `BaseMcpServer.stopHttpServer()` is the internal HTTP stop path but is not wired to any entrypoint in `src/`.
  - CLI modes: run handler to completion; exit code set via `process.exitCode` (exec, doctor) or `process.exit(...)` (batch-geocode).
  - Loops/blocks: event loop blocks on stdin (stdio mode) or on the listening HTTP socket (HTTP mode); tool calls await outbound HTTPS requests; per-session state kept in `BaseMcpServer.sessions` (in-memory).

- Internal Call-Trace Tree:

  TRACE-A: module load and command dispatch [`src/cli.ts`]
  - `(module scope)`: computes `__dirname`; builds `serverConfigs` indirectly via import of `src/config.ts`
    - external: `fileURLToPath`/`dirname`
  - `loadEnvironment(extractEnvFileOption(process.argv))`: direct-run entry loads environment before command dispatch; explicit `--env-file <path>` loads exactly that file (missing -> JSON stderr error, exit 1, no implicit fallback); otherwise dotenv loads cwd `.env`, then package `.env` [`src/cli.ts`]
    - `extractEnvFileOption(argv)`: scans argv for `--env-file <path>` and `--env-file=<path>` forms
      - `applyExplicitEnvFile(path)`: existence-checked dotenv load [`src/utils/configResolver.ts`]
        - external: `existsSync`, dotenv config
    - external (implicit path): dotenv config on cwd/package `.env`
  - `yargs(...).parse()`: dispatches to the command handler selected by argv (global `--env-file` option declared for help)
    - external: yargs/hideBin

  TRACE-B: HTTP-server mode (default command, no `--stdio`) [`src/cli.ts`]
  - `$0` handler: applies `--apikey` to env; fires auto-update check; announces banners; delegates
    - `checkForUpdates(...)`: fire-and-forget npm update check (`void ... .catch(() => undefined)`; never blocks startup); skipped when `MCP_AUTO_UPDATE_DISABLED` is set [`src/utils/autoUpdate.ts`]
      - `isAutoUpdateDisabled(env)`: true when `MCP_AUTO_UPDATE_DISABLED` is `1`/`true`/`yes` case-insensitively; short-circuits before any network call
      - external: `fetch` → `https://registry.npmjs.org/mcp-google-map/latest` with `AbortSignal.timeout(2000)`; stderr-only diagnostics and upgrade notice via `Logger`
    - `startServer(port, apiKey, host)`: env overrides; iterates `serverConfigs` (one instance `MCP-Server`, port env `MCP_SERVER_PORT`); validates port (integer 1-65535; unset/invalid marks the instance failed with remediation guidance); boots each instance; on success calls `installShutdownHandlers(servers)`; returns `{ started, failed, servers }` and the `$0` handler exits 1 when `started === 0`
      - `installShutdownHandlers(servers)`: registers SIGINT/SIGTERM wrappers; one-shot orderly stop then exit 0 [`src/cli.ts`]
        - `createShutdownHandler(servers, exitHook?)`: awaits stop of every server (tolerant), then exit hook; repeated signals are no-ops
          - `stopHttpServer()`: closes every session transport, clears the session map, `closeAllConnections`, then closes the socket; idempotent [`src/core/BaseMcpServer.ts`]
      - `filterTools(tools)`: applies `GOOGLE_MAPS_ENABLED_TOOLS` allowlist; logs active count or zero-match error [`src/config.ts`]
        - `resolveEnabledToolNames(allToolNames, raw)`: unset/`*` -> full set; >=1 match -> subset; 0 matches -> full set + fallback flag [`src/utils/configResolver.ts`]
          - `Logger.log(...)` / `Logger.error(...)`: stderr diagnostics [`src/index.ts`]
      - `new BaseMcpServer(name, tools)`: stores name/tools; builds root MCP server
        - `createMcpServer()`: constructs `McpServer` (capabilities: logging, tools) and registers every `ToolConfig` (description, zod inputSchema, annotations, ACTION closure) [`src/core/BaseMcpServer.ts`]
      - `startHttpServer(port, host)`: express app with JSON body parsing; registers `/mcp` handlers; resolves only after the listener accepts (rejects on listen errors, e.g. EADDRINUSE); default host `127.0.0.1` (loopback)
        - `POST /mcp` handler closure: session + key routing per request [`src/core/BaseMcpServer.ts`]
          - `ApiKeyManager.getInstance()`: lazily builds singleton keyed on `GOOGLE_MAPS_API_KEY` [`src/utils/apiKeyManager.ts`]
          - `ApiKeyManager.getApiKey(req, sessionApiKey)`: header key → Bearer token → session key → default key
          - session-reuse branch: updates `context.apiKey` when request carries a header key
          - initialize branch (no session id + initialize body):
            - `createMcpServer()`: per-session MCP server instance (as above)
            - `connect(transport)`: connects SDK server; installs stdout guard that drops non-`{` string writes; logs readiness
            - `onsessioninitialized` closure: stores `SessionContext` in `this.sessions`
            - `onclose` closure: deletes session from `this.sessions`
          - invalid branch: replies HTTP 400, JSON-RPC error code -32000
          - `runWithContext(context, fn)`: opens AsyncLocalStorage scope `{ apiKey, sessionId }` around `transport.handleRequest` [`src/utils/requestContext.ts`]
        - `handleSessionRequest` closure (GET + DELETE): validates `mcp-session-id` against `this.sessions`; refreshes session key from headers; `runWithContext(...)` → `transport.handleRequest` [`src/core/BaseMcpServer.ts`]
          - `ApiKeyManager.getInstance()` / `ApiKeyManager.getApiKey(...)` [`src/utils/apiKeyManager.ts`]
          - `runWithContext(...)` [`src/utils/requestContext.ts`]
      - external: `express()`, `app.listen`, `isInitializeRequest`, `StreamableHTTPServerTransport`, `randomUUID`, `Promise.allSettled`

  TRACE-C: stdio-server mode (default command, `--stdio`) [`src/cli.ts`]
  - `$0` handler: applies `--apikey` to env; fires auto-update check (same `checkForUpdates` node as TRACE-B)
    - `filterTools(serverConfigs[0].tools)`: allowlist [`src/config.ts`]
    - `new BaseMcpServer(name, tools)` → `createMcpServer()` (as TRACE-B) [`src/core/BaseMcpServer.ts`]
    - `startStdio()`: creates `StdioServerTransport` and connects it; runs directly from the built `dist` artifact (`bin` entry `dist/cli.js`; artifact-missing remediation lives in the launcher scripts, not `src/`)
      - `connect(transport)`: SDK connect + stdout guard (drops non-`{` stdout writes to protect JSON-RPC framing) [`src/core/BaseMcpServer.ts`]
    - external: `StdioServerTransport`; SDK reads stdin JSON-RPC frames and invokes registered ACTION closures (TRACE-F)

  TRACE-D: exec CLI mode [`src/cli.ts`]
  - `exec` handler: API-key guard (stderr JSON + exit 1); parses JSON params; delegates
    - `runExecCommand(toolName, params, apiKey, runner?, streams?)`: runs tool; classifies result; routes JSON to streams; returns exit code
      - `execTool(toolName, params, apiKey)`: default runner; instantiates facade; switch-dispatches tool aliases to one facade method; throws on unknown tool
        - `new PlacesSearcher(apiKey)`: builds three API clients (TRACE-E) [`src/services/PlacesSearcher.ts`]
        - facade call per tool name (see Tool→Facade Dispatch Map; shared subtrees below)
      - `isExecFailureResponse(result)`: true when result is `{ success: false }`
      - `getExecFailureMessage(toolName, result)`: normalizes failure error text

  TRACE-E: facade construction (shared) [`src/services/PlacesSearcher.ts`]
  - `new PlacesSearcher(apiKey)`:
    - `new GoogleMapsTools(apiKey)`: legacy Maps client; throws "Google Maps API Key is required" when key empty [`src/services/toolclass.ts`]
    - `new NewPlacesService(apiKey)`: Places API (New) client; same empty-key throw [`src/services/NewPlacesService.ts`]
    - `new RoutesService(apiKey)`: Routes REST client; same empty-key throw [`src/services/RoutesService.ts`]

  TRACE-F: tool ACTION dispatch (both transports) [`src/tools/maps/<tool>.ts`]
  - `ACTION(params)`: per-tool handler registered on the MCP server; uniform contract
    - `getCurrentApiKey()`: reads AsyncLocalStorage store; falls back to `GOOGLE_MAPS_API_KEY` [`src/utils/requestContext.ts`]
    - `new PlacesSearcher(apiKey)`: TRACE-E
    - facade method per dispatch map (shared subtrees below)
    - result shaping: `{ success: false }` → `{ content: [text error], isError: true }`; success → `{ content: [text JSON], isError: false }`; thrown error → catch → `isError: true`
    - external: `JSON.stringify`

  Tool→Facade Dispatch Map (18 tools; ACTION files all under `src/tools/maps/`):
  | Tool NAME | Facade method | Backing service path |
  |---|---|---|
  | `maps_geocode` | `PlacesSearcher.geocode` | `GoogleMapsTools.geocode` |
  | `maps_reverse_geocode` | `PlacesSearcher.reverseGeocode` | `GoogleMapsTools.reverseGeocode` |
  | `maps_search_nearby` | `PlacesSearcher.searchNearby` | `GoogleMapsTools.getLocation` + `NewPlacesService.searchNearby` |
  | `maps_search_places` | `PlacesSearcher.searchText` | `NewPlacesService.searchTextFull` |
  | `maps_place_details` | `PlacesSearcher.getPlaceDetails` | `NewPlacesService.getPlaceDetails` + `NewPlacesService.getPhotoUri` |
  | `maps_directions` | `PlacesSearcher.getDirections` | `RoutesService.computeRoutes` |
  | `maps_distance_matrix` | `PlacesSearcher.calculateDistanceMatrix` | `RoutesService.computeRouteMatrix` |
  | `maps_elevation` | `PlacesSearcher.getElevation` | `GoogleMapsTools.getElevation` |
  | `maps_timezone` | `PlacesSearcher.getTimezone` | `GoogleMapsTools.getTimezone` |
  | `maps_weather` | `PlacesSearcher.getWeather` | `GoogleMapsTools.getWeather` |
  | `maps_air_quality` | `PlacesSearcher.getAirQuality` | `GoogleMapsTools.getAirQuality` |
  | `maps_static_map` | `PlacesSearcher.getStaticMap` | `GoogleMapsTools.getStaticMap` |
  | `maps_batch_geocode` | inline `Promise.all` → `PlacesSearcher.geocode` ×N | `GoogleMapsTools.geocode` ×N |
  | `maps_search_along_route` | `PlacesSearcher.searchAlongRoute` | `GoogleMapsTools.searchAlongRoute` (→ `RoutesService.computeRoutes` + Places Text Search fetch) |
  | `maps_explore_area` | `PlacesSearcher.exploreArea` | `resolveLocation` + `searchNearby` + `getPlaceDetails` |
  | `maps_plan_route` | `PlacesSearcher.planRoute` | `resolveLocation` + `RoutesService.computeRoutes` |
  | `maps_compare_places` | `PlacesSearcher.comparePlaces` | `searchText` + `getPlaceDetails` + `calculateDistanceMatrix` |
  | `maps_local_rank_tracker` | `PlacesSearcher.localRankTracker` | `getPlaceDetails` + `NewPlacesService.searchText` via `scanKeywordGrid` |

  Note: CLI `exec` accepts short, snake_case, and `maps_`-prefixed aliases (`EXEC_TOOLS` switch in `src/cli.ts`) resolving to the same facade methods.

  Shared facade subtrees (leaves = external boundaries):
  - `PlacesSearcher.geocode(address)`: wrap legacy geocode [`src/services/PlacesSearcher.ts`]
    - `GoogleMapsTools.geocode(address)`: normalize first geocode result [`src/services/toolclass.ts`]
      - `geocodeAddress(address)`: query + first-result extraction; throws on zero results
        - external: `@googlemaps/google-maps-services-js` `Client.geocode`
        - `extractErrorMessage(error)`: HTTP/Google status → actionable message [`src/services/toolclass.ts`]
  - `PlacesSearcher.reverseGeocode(lat, lng)`: wrap legacy reverse geocode [`src/services/PlacesSearcher.ts`]
    - `GoogleMapsTools.reverseGeocode(lat, lng)`: first-result address/components; throws on zero results [`src/services/toolclass.ts`]
      - external: `Client.reverseGeocode`; `extractErrorMessage(error)` on failure
  - `PlacesSearcher.searchNearby(params)`: resolve center + Places nearby + client-side filters [`src/services/PlacesSearcher.ts`]
    - `GoogleMapsTools.getLocation(center)`: coordinates passthrough or geocode [`src/services/toolclass.ts`]
      - `parseCoordinates(coordString)`: split/parse two floats; throws on malformed input
      - `geocodeAddress(value)`: as above (external `Client.geocode`; `extractErrorMessage`)
    - `NewPlacesService.searchNearby(params)`: circle-restricted nearby query, ≤20 results [`src/services/NewPlacesService.ts`]
      - external: `@googlemaps/places` `PlacesClient.searchNearby`
      - `transformSearchResult(place)`: snake_case result normalization; `extractLegacyPlaceId(place)`
        - `extractLegacyPlaceId(place)`: parse `places/{id}` resource name, fallback `id`
      - `extractErrorMessage(error)`: gRPC 7/403 → enable-API message; 8/429 → quota message
    - inline: `openNow` / `minRating` filtering and output mapping
  - `PlacesSearcher.searchText(params)`: text search with full filter surface [`src/services/PlacesSearcher.ts`]
    - `NewPlacesService.searchTextFull(params)`: request build (requested count translated to `maxResultCount` clamped 1-20 — SDK proto lacks `pageSize`; bias circle, server-side filters) + pagination token (`pageToken` forwarded but dropped by SDK protos) [`src/services/NewPlacesService.ts`]
      - external: `PlacesClient.searchText`
      - `transformSearchResult(place)` per result (as above); `extractErrorMessage(error)` on failure
    - inline: output mapping incl. `nextPageToken`, `fieldMask`, optional `raw_response`
  - `PlacesSearcher.getPlaceDetails(placeId, maxPhotos, includeRaw)`: details + optional photo URIs [`src/services/PlacesSearcher.ts`]
    - `NewPlacesService.getPlaceDetails(placeId, includeRaw)`: masked getPlace + full transform [`src/services/NewPlacesService.ts`]
      - external: `PlacesClient.getPlace`
      - `transformPlaceResponse(place)`: builds parking/accessibility/dining/serves/atmosphere maps, hours, reviews, photos
        - `extractLegacyPlaceId(place)`
        - `isCurrentlyOpen(openingHours, utcOffsetMinutes, currentOpeningHours)`: open-now flags → period arithmetic fallback
          - `getLocalTimeComponents(utcOffsetMinutes)`: UTC-shifted or machine-local day/minute components
          - `toDayNumber(value)` / `toMinutes(time)`: day-name/number and time → minutes normalization
        - `formatOpeningHours(openingHours)`: weekday description passthrough
      - `extractErrorMessage(error)` on failure
    - per photo when `maxPhotos > 0`: `NewPlacesService.getPhotoUri(photoName)`: photo media URI (maxWidthPx 800); failed photos skipped silently
      - external: `PlacesClient.getPhotoMedia`; `extractErrorMessage` on failure
  - `PlacesSearcher.getDirections(...)`: directions via Routes API [`src/services/PlacesSearcher.ts`]
    - `RoutesService.computeRoutes(params)`: waypoint build, modifiers, single POST, totals [`src/services/RoutesService.ts`]
      - `toWaypoint(location)`: string coordinate / address / structured waypoint normalization
      - `buildRouteModifiers(params, travelMode)`: avoid flags, DRIVE-only validation
      - external: `fetch` → `https://routes.googleapis.com/directions/v2:computeRoutes`
      - `parseDuration(duration)`: `"1234s"` → seconds
      - `formatDistance(meters)` / `formatDuration(seconds)`: human-readable totals
      - `describeWaypoint(waypoint)`: waypoint labeling for no-route errors (transit regional message path)
  - `PlacesSearcher.calculateDistanceMatrix(...)`: matrix via Routes API [`src/services/PlacesSearcher.ts`]
    - `RoutesService.computeRouteMatrix(params)`: flat element array → 2D distances/durations matrices [`src/services/RoutesService.ts`]
      - `toWaypoint(...)` per origin/destination; `buildRouteModifiers(...)`
      - external: `fetch` → `https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`
      - `parseDuration` / `formatDistance` / `formatDuration` per element; `ROUTE_NOT_FOUND` cells left null; transit warning/throw paths
  - `PlacesSearcher.getTimezone(lat, lng, ts?)`: wrap legacy timezone [`src/services/PlacesSearcher.ts`]
    - `GoogleMapsTools.getTimezone(lat, lng, ts?)`: epoch seconds (default now) + local-time composition [`src/services/toolclass.ts`]
      - external: `Client.timezone`; non-OK status → throw
  - `PlacesSearcher.getWeather(lat, lng, type, days?, hours?)`: wrap weather REST [`src/services/PlacesSearcher.ts`]
    - `GoogleMapsTools.getWeather(...)`: current/forecast URL selection with day/hour clamps [`src/services/toolclass.ts`]
      - external: `fetch` → `https://weather.googleapis.com/v1/...`; unsupported-location message path
  - `PlacesSearcher.getAirQuality(lat, lng, health?, pollutants?)`: wrap air quality REST [`src/services/PlacesSearcher.ts`]
    - `GoogleMapsTools.getAirQuality(...)`: extraComputations assembly + primary/secondary index extraction [`src/services/toolclass.ts`]
      - external: `fetch` → `https://airquality.googleapis.com/v1/currentConditions:lookup`
  - `PlacesSearcher.getStaticMap(params)`: wrap Static Maps REST [`src/services/PlacesSearcher.ts`]
    - `GoogleMapsTools.getStaticMap(params)`: query assembly, 16384-char URL guard, base64 encode [`src/services/toolclass.ts`]
      - external: `fetch` → `https://maps.googleapis.com/maps/api/staticmap`; `Buffer` base64
  - `PlacesSearcher.searchAlongRoute(params)`: route polyline + corridor text search [`src/services/PlacesSearcher.ts`]
    - `GoogleMapsTools.searchAlongRoute(params)`: two-step composite [`src/services/toolclass.ts`]
      - `new RoutesService(apiKey)` + `RoutesService.computeRoutes(...)` (as above) → encoded polyline
      - external: `fetch` → `https://places.googleapis.com/v1/places:searchText` with `searchAlongRouteParameters`
  - `PlacesSearcher.getElevation(locations)`: wrap legacy elevation [`src/services/PlacesSearcher.ts`]
    - `GoogleMapsTools.getElevation(locations)`: per-point elevation with input-order echo [`src/services/toolclass.ts`]
      - external: `Client.elevation`; non-OK status → throw
  - `PlacesSearcher.resolveLocation(input)`: single-shot location resolution for composites [`src/services/PlacesSearcher.ts`]
    - `parseCoordinateInput(input)`: coordinate regex + lat ±90 / lng ±180 range validation
    - `PlacesSearcher.geocode(input)` (as above; display address; failure tolerated on coordinate path)
    - `PlacesSearcher.searchText({ query })` (as above; fallback when geocoding yields nothing)
    - throws combined geocode+text-search error when both fail
  - `PlacesSearcher.exploreArea(params)`: categorized area overview [`src/services/PlacesSearcher.ts`]
    - `resolveLocation(...)` (as above)
    - per type: `PlacesSearcher.searchNearby(...)` (as above)
    - per top place: `PlacesSearcher.getPlaceDetails(...)` (as above)
  - `PlacesSearcher.planRoute(params)`: multi-stop optimized itinerary [`src/services/PlacesSearcher.ts`]
    - `resolveLocation(...)` per stop (as above)
    - `toRouteWaypoint(loc)`: placeId-preferred waypoint conversion
    - `RoutesService.computeRoutes(...)` (as above; intermediates + optimization flags)
    - `parseDuration` / `formatDistance` / `formatDuration` (imported from `src/services/RoutesService.ts`) for legs and totals
  - `PlacesSearcher.comparePlaces(params)`: search + details + optional drive distances [`src/services/PlacesSearcher.ts`]
    - `PlacesSearcher.searchText(...)` (as above)
    - `PlacesSearcher.getPlaceDetails(...)` per place (as above)
    - `PlacesSearcher.calculateDistanceMatrix(...)` when `userLocation` present (as above)
  - `PlacesSearcher.localRankTracker(params)`: grid rank tracking [`src/services/PlacesSearcher.ts`]
    - `PlacesSearcher.getPlaceDetails(placeId)`: target display name (failure tolerated)
    - `scanKeywordGrid(keyword, placeId, gridPoints, spacing)`: grid search + metrics [`src/services/PlacesSearcher.ts`]
      - `NewPlacesService.searchText(params)` per grid point (batched `Promise.all`, concurrency 5)
        - `NewPlacesService.searchTextFull(...)` (as above)
      - inline: ARP / ATRP / SoLV / `found_in` metric computation

  TRACE-G: doctor CLI mode [`src/cli.ts`]
  - `doctor` handler: reads installed package version from `package.json`; parses `--probes` before dispatch (invalid input -> JSON stderr error, exit 1)
    - external: `readFileSync`; fallback version `"0.0.0"`
    - `runDoctor(packageVersion, apiKey, live, runner?, options?)`: local checks (node >= `NODE_ENGINE_FLOOR` 22 per `engines`, non-zero version, key presence, config diagnostics, env-file status, tool/API profile); live branch probes three APIs sequentially by default or the selected `--probes` subset; assembles `DoctorReport`
      - `resolveRuntimeConfig(env, overrides)`: typed config snapshot with per-field sources (flag/environment/default) [`src/utils/configResolver.ts`]
      - `describeRuntimeConfig(config)` / `formatConfigDiagnostics(diagnostics)`: masked effective-configuration line (raw secret never printed) [`src/utils/configResolver.ts`]
        - `maskSecret(value)`: prefix/suffix masking helper
      - `resolveEnabledToolNames(allToolNames, raw)`: effective tool set + zero-match fallback flag [`src/utils/configResolver.ts`]
      - `describeToolsProfile(names)`: per-tool Google API union incl. composite tool dependencies [`src/utils/toolProfiles.ts`]
      - `parseDoctorProbes(raw)`: alias-mapped, deduped subset of `DOCTOR_PROBES` (undefined -> all three)
      - `execTool(check.tool, check.params, apiKey)`: probe runner (default) → facade subtrees as TRACE-D
      - external: `process.versions.node` read; stdout JSON write; `process.exitCode`

  TRACE-H: batch-geocode CLI mode [`src/cli.ts`]
  - `batch-geocode` handler: API-key guard (`console.error` + `process.exit(1)`); reads address lines; runs bounded-concurrency pipeline; emits summary; exits 1 on any failure
    - external: `createInterface` stdin reading (`--input -`) or `existsSync`/`readFileSync` file reading; empty input → exit 1
    - `new PlacesSearcher(apiKey)`: TRACE-E
    - `semaphore(tasks, limit)`: sliding-window concurrency limiter, limit clamped 1–50 (default 20)
      - task closure → `PlacesSearcher.geocode(address)` (as above) per line
    - external: `writeFileSync` (`--output`) or `console.log` stdout summary; `process.exit(failed > 0 ? 1 : 0)`

  TRACE-I: setup CLI mode [`src/cli.ts`]
  - `setup` handler: non-interactive onboarding; no prompts, no Google API calls, no writes without `--write-env`
    - `runSetup({ packageDir, targetDir, writeEnv }, deps?)`: checks node floor (`NODE_ENGINE_FLOOR` 22), `.env.example` presence, `.env` state in `targetDir`; with `--write-env` creates `.env` from the template only when absent (existing files never overwritten); api-key presence from resolved config; assembles `SetupReport { success, created, checks[] }` (masked)
      - `resolveRuntimeConfig(env)`: as TRACE-G [`src/utils/configResolver.ts`]
      - external: `existsSync`/`readFileSync`/`writeFileSync` (injectable for tests), `process.stdout` JSON write, `process.exitCode`

  TRACE-J: snippet CLI mode [`src/cli.ts`]
  - `snippet` handler: prints MCP-client registration snippets; writes no file
    - `runSnippetCommand(options, streams?)`: renders snippet, writes JSON to stdout and `[snippet]` notes to stderr; exit 1 on render error
      - `renderClientSnippet(options)`: stdio entry (launchers `npx`/`node`/`bin`; literal placeholder default, `${NAME}` reference with `--env-key`) or HTTP `{ url }` entry; target-file notes per client [`src/utils/clientSnippets.ts`]
      - external: `JSON.stringify`, process streams

- External Boundaries:
  - stdio: stdin/stdout JSON-RPC framing (stdio-server mode); stdout guard installed in `connect(...)`.
  - network (inbound): Express HTTP listener on `http://{host}:{port}/mcp` (POST/GET/DELETE; SSE for GET).
  - network (outbound): `https://routes.googleapis.com` (computeRoutes, computeRouteMatrix), `https://registry.npmjs.org` (automatic update check, fire-and-forget, disabled by `MCP_AUTO_UPDATE_DISABLED`), `https://places.googleapis.com/v1/places:searchText`, `@googlemaps/places` `PlacesClient` (searchNearby, searchText, getPlace, getPhotoMedia), `@googlemaps/google-maps-services-js` `Client` (geocode, reverseGeocode, timezone, elevation), `https://weather.googleapis.com`, `https://airquality.googleapis.com`, `https://maps.googleapis.com/maps/api/staticmap`.
  - filesystem: `.env` loads (dotenv; explicit `--env-file` loads exactly the given file), `package.json` version read (doctor/setup), setup `.env` scaffolding, batch-geocode input/output files.
  - OS/runtime: `process.env` reads/writes, `process.exit`/`process.exitCode`, `process.stdout`/`process.stderr`, `randomUUID` (node:crypto), `AsyncLocalStorage` (node:async_hooks), `Date`/`Math` local-time computations.

## Communication Edges
| ID | Direction | Mechanism | Endpoint / Channel | Payload / Data Shape | Declaration File Paths |
|---|---|---|---|---|---|
| EDGE-01 | external MCP client process (not modeled; counterpart of `PROC:main`) → `PROC:main` | stdio pipe (stdin), JSON-RPC 2.0 framing | stdin | MCP requests: `initialize`, `tools/list`, `tools/call` with zod-validated params | `src/core/BaseMcpServer.ts` |
| EDGE-02 | `PROC:main` → external MCP client process | stdio pipe (stdout), JSON-RPC 2.0 framing | stdout | MCP responses/notifications; tool results `{ content: [{ type: "text" \| "image", ... }], isError }`; non-`{`-prefixed stdout strings suppressed | `src/core/BaseMcpServer.ts` |
| EDGE-03 | external MCP client process → `PROC:main` | HTTP POST/GET/DELETE (Express) + SSE | `http://{host}:{port}/mcp` | JSON-RPC 2.0 body; headers `mcp-session-id`, `X-Google-Maps-API-Key`, `Authorization: Bearer`; 400 + JSON-RPC error `-32000` on invalid session | `src/core/BaseMcpServer.ts` |
| EDGE-04 | `PROC:main` → external MCP client process | HTTP response / SSE stream | `/mcp` | JSON-RPC responses; SSE event stream on GET; per-session isolation keyed by `mcp-session-id` | `src/core/BaseMcpServer.ts` |
| EDGE-05 | `PROC:main` request-handling path → `PROC:main` tool-ACTION path (intra-process) | `AsyncLocalStorage` context store | in-process `RequestContext { apiKey?, sessionId? }` | per-request API key + session id; read by `getCurrentApiKey()` inside every tool ACTION | `src/utils/requestContext.ts`, `src/core/BaseMcpServer.ts`, `src/tools/maps/*.ts` |
| EDGE-06 | `PROC:main` request-handling path → invoking shell / CI consumer (external) | process stdout/stderr | stdout / stderr | CLI JSON outputs: doctor `DoctorReport { success, version, live, checks[] }`; setup `SetupReport { success, created, checks[] }`; snippet registration JSON (stdout) + `[snippet]` notes (stderr); exec result JSON or `{ error }`; batch summary `{ total, succeeded, failed, results }`; `[INFO]`/`[ERROR]` diagnostics via `Logger` | `src/cli.ts`, `src/index.ts` |
| EDGE-07 | `PROC:main` startup path → external npm registry | HTTPS GET, fire-and-forget (not awaited; bounded by `AbortSignal.timeout(2000)`) | `https://registry.npmjs.org/mcp-google-map/latest` | Request: no body; Response: JSON `{ version }`; check skipped entirely when `MCP_AUTO_UPDATE_DISABLED` is `1`/`true`/`yes`; newer version reported on stderr only | `src/utils/autoUpdate.ts`, `src/cli.ts` |
