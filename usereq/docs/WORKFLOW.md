# mcp-google-api Workflow Model

## Execution Units Index
| ID | Type | Parent | Role | Entrypoint(s) | Defining File(s) |
|---|---|---|---|---|---|
| PROC:main | process | - | Single Node.js ESM process hosting all runtime modes: MCP HTTP server, MCP stdio server, `exec` CLI, `doctor` CLI, `batch-geocode` CLI, `snippet` CLI, `enable`/`disable` CLI, `auto-update` CLI, `tools`/`host`/`port` config CLI, `api-key` CLI, `install`/`uninstall` CLI, `show` CLI, `--ver`/`--version`/`--upgrade`/`--uninstall` management CLI | `yargs` `cli.parse()` command dispatch (`$0` fallback prints help); `runManagementCommand(...)` pre-parse dispatch; `startServer(...)`; `runExecCommand(...)`; `runDoctor(...)`; `runSnippetCommand(...)`; `runEnableDisableCliCommand(...)`; `runAutoUpdateCommand(...)`; `runToolsCommand(...)`; `runHostCommand(...)`; `runPortCommand(...)`; `runApiKeyCommand(...)`; `runInstallUninstallCommand(...)`; `runShowCommand(...)`; `start`/`run` command handler; `batch-geocode` command handler; `BaseMcpServer.startStdio()` | `src/cli.ts`, `src/utils/upgradeManager.ts`, `src/core/BaseMcpServer.ts` |

- Threads: no explicit threads detected for `PROC:main` — `src/` contains no `worker_threads`, `cluster`, or `child_process` usage. All concurrency is event-loop based (`Promise.all`, `Promise.race`, async/await); Node.js libuv pool usage is an implicit runtime detail, not created by `src/` code.

## Execution Units

### PROC:main

- Type: process
- Role: MCP tool server and Google Maps API client facade; all repository logic executes in this process.
- Entrypoint(s):
  - Module load of `src/cli.ts` (yargs command registration, `yargs(...).parse()`).
  - `start` / `run` command handlers → `runServerCommand(...)` (stdio mode, or `startServer(...)` in HTTP mode).
  - Default `$0` fallback handler → prints the help text (version header + management commands) and starts nothing.
  - `exec <tool> [params]` handler → `runExecCommand(...)`.
  - `doctor` handler → `runDoctor(...)`.
  - `batch-geocode` handler → inline semaphore pipeline.
  - `enable <cli>` / `disable <cli>` handlers → `runEnableDisableCliCommand(...)`.
  - `tools <list|*>` / `host <host>` / `port <port>` handlers → `runToolsCommand(...)` / `runHostCommand(...)` / `runPortCommand(...)`.
  - `install` / `uninstall` handlers → `runInstallUninstallCommand(...)`.
  - `show` handler → `runShowCommand(...)`.
  - Pre-yargs management intercept (`--ver`, `--version`, `--upgrade`, `--uninstall`) → `runManagementCommand(...)` (TRACE-L).
- Lifecycle / trigger:
  - Start: `node dist/cli.js [command] [options]`; module scope registers the yargs commands (doctor, snippet, enable, disable, auto-update, tools, host, port, api-key, install, uninstall, show, exec, batch-geocode, default server-start).
  - Server modes: HTTP mode persists via `app.listen(port, host)`; stdio mode persists via `StdioServerTransport` holding the stdin stream open. No signal handlers are registered in `src/`; server modes stop only when the transport closes or the process is killed. `BaseMcpServer.stopHttpServer()` is the internal HTTP stop path but is not wired to any entrypoint in `src/`.
  - CLI modes: run handler to completion; exit code set via `process.exitCode` (exec, doctor) or `process.exit(...)` (batch-geocode).
  - Loops/blocks: event loop blocks on stdin (stdio mode) or on the listening HTTP socket (HTTP mode); tool calls await outbound HTTPS requests; per-session state kept in `BaseMcpServer.sessions` (in-memory).
  - Resources: `src/resources/skills/**` (`manifest.json`, `README.md`, `<skill-id>/SKILL.md`, `<skill-id>/DEBUG.md`) are inert LLM-agent instruction assets; no runtime module under `src/` imports them; they introduce no execution units, call-trace nodes, or communication edges. Debug overlays are install-time content only.

- Internal Call-Trace Tree:

  TRACE-A: module load and command dispatch [`src/cli.ts`]
  - `(module scope)`: computes `__dirname`; builds `serverConfigs` indirectly via import of `src/config.ts`; evaluates the entry gate guarding every dispatch path below
    - external: `fileURLToPath`/`dirname`
    - `isEntryMainModule()`: symlink-aware main-module detection comparing `realpathSync(process.argv[1])` with the real path of this module derived from `import.meta.url`; true for every symlinked launcher (npm global `bin/` links, `_npx` `.bin` shims, renamed aliases) and false for plain module imports, so the CLI never silently no-ops under a renamed bin and never dispatches on import [`src/cli.ts`]
      - external: `realpathSync`
    - `handleUndispatchedEntry(argv.slice(2))`: else-branch guard evaluated when the `isEntryMainModule()` entry gate does not match; for the registered stdio server-start argv shape (`start`/`run` plus `--stdio`) it emits the REQ-094 build-remediation JSON diagnostic on stderr (skipped dispatch, requested entry path, running module path, remediation commands) and returns exit code 1; any other argv shape keeps the legacy silent exit-0 no-op (plain imports, unrelated tooling) [`src/cli.ts`]
      - `describeUndispatchedServerStart(argv)`: pure server-start argv-shape detector returning the build-remediation guidance text (`npm run build` / `npm install -g mcp-google-api@latest`) for the skipped-dispatch case [`src/cli.ts`]
  - `parseManagementCommand(hideBin(process.argv))`: pre-yargs dispatch of the exact management-command argv shapes (single-token flags, or `--upgrade` paired with the `--develop` option or its equivalent `--dev` alias in either order, REQ-170); a match runs TRACE-L and skips yargs entirely, otherwise [`src/utils/upgradeManager.ts`]
  - `cli = yargs(...)` builder: `.scriptName("mcp-google-api")`, `.usage()` opening with `mcp-google-api v<version>` plus the `start|run` usage lines, `.epilog()` documenting the management flags `--ver`/`--version`/`--upgrade`/`--uninstall` and the `--upgrade` `--develop`/`--dev` upgrade-channel option (REQ-175); then `cli.parse()`: dispatches to the command handler selected by argv; the `$0` fallback handler prints the help text via `showHelp("log")` and starts no server
    - external: yargs/hideBin

  TRACE-B: HTTP-server mode (`start`/`run` command, no `--stdio`) [`src/cli.ts`]
  - server command handler `runServerCommand(argv)`: resolves the effective API key exclusively from the persisted settings key and injects it via `ApiKeyManager.setDefaultApiKey(...)` (REQ-142, DES-006); fires the idle-gated automatic update check only when the persisted `autoUpdate` setting is true (REQ-083, DES-024); announces the `MCP Google API server` banners (warning instead of failure when no key resolves, REQ-080; REQ-165); delegates with the flag-or-settings host and port (REQ-008)
    - `checkVersionIdle(...)`: fire-and-forget idle-gated npm update check (`void ... .catch(() => undefined)`; never blocks startup); not invoked at all when the persisted settings `autoUpdate` field is false (REQ-083, DES-024), otherwise skipped without network while the persisted idle deadline is still in the future [`src/utils/upgradeManager.ts`]
      - `loadIdleCache(cachePath, fs)`: tolerant read of `~/.cache/mcp-google-api/check_version_idle-time.json` (missing/malformed -> empty)
      - `probeLatestVersion(deps)`: logging-free registry probe returning `disabled` / `unknown-version` / `error` / `current` / `newer` [`src/utils/autoUpdate.ts`]
        - `isAutoUpdateDisabled(deps.env)`: injected-seam predicate honored only when the caller explicitly supplies a disable map; production call sites pass no environment, so the effective gate is the persisted settings `autoUpdate` field (REQ-083, DES-024) [`src/utils/autoUpdate.ts`]
        - `isNewerVersion(candidate, current)`: dotted-segment numeric comparison [`src/utils/autoUpdate.ts`]
        - external: `fetch` -> `https://registry.npmjs.org/mcp-google-api/latest` with `AbortSignal.timeout(2000)`
      - inline: idle-window selection (3600 s on newer, 86400 s otherwise) and stderr-only colored reporting (`Available Version: <latest> | Installed Version: <current>` plus upgrade command on newer; red error notices; no output when the installed version is current, REQ-124)
      - `persistIdleCache(cachePath, lastSuccess, idleUntil, fs, logger)`: rewrites the four cache fields (epochs + ISO-8601 UTC); write failures logged to stderr only
    - `startServer(port, apiKey, host)`: explicit listen port and bind host resolved by the caller from CLI flags over the persisted settings (REQ-008, DES-015); injects `ApiKeyManager.setDefaultApiKey(apiKey)` (DES-006); validates the port (integer 1-65535; invalid marks the instance failed with remediation guidance, REQ-009); boots the instance; on success calls `installShutdownHandlers(servers)`; returns `{ started, failed, servers }` and the `$0` handler exits 1 when `started === 0`
      - `installShutdownHandlers(servers)`: registers SIGINT/SIGTERM wrappers; one-shot orderly stop then exit 0 [`src/cli.ts`]
        - `createShutdownHandler(servers, exitHook?)`: awaits stop of every server (tolerant), then exit hook; repeated signals are no-ops
          - `stopHttpServer()`: closes every session transport, clears the session map, `closeAllConnections`, then closes the socket; idempotent [`src/core/BaseMcpServer.ts`]
      - `filterTools(tools)`: applies the persisted `enabledTools` settings allowlist; logs active count or zero-match error [`src/config.ts`]
        - `loadCliSettings()`: normalized settings read supplying the default allowlist raw value [`src/utils/cliSettings.ts`]
        - `resolveEnabledToolNames(allToolNames, raw)`: unset/`*` -> full set; >=1 match -> subset; 0 matches -> full set + fallback flag [`src/utils/configResolver.ts`]
          - `Logger.log(...)` / `Logger.error(...)`: stderr diagnostics [`src/index.ts`]
      - `new BaseMcpServer(name, tools)`: stores name/tools; builds root MCP server
        - `createMcpServer()`: constructs `McpServer` (capabilities: logging, tools) and registers every `ToolConfig` (description, zod inputSchema, annotations, ACTION closure) [`src/core/BaseMcpServer.ts`]
      - `startHttpServer(port, host)`: express app with JSON body parsing; registers `/mcp` handlers; resolves only after the listener accepts (rejects on listen errors, e.g. EADDRINUSE); default host `127.0.0.1` (loopback)
        - `POST /mcp` handler closure: session + key routing per request [`src/core/BaseMcpServer.ts`]
          - `ApiKeyManager.getInstance()`: lazily builds the singleton (no environment input; the default key is injected by the server-start path) [`src/utils/apiKeyManager.ts`]
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

  TRACE-C: stdio-server mode (`start`/`run` command, `--stdio`) [`src/cli.ts`]
  - server command handler `runServerCommand(argv)`: resolves the effective API key exclusively from the persisted settings key and injects it via `ApiKeyManager.setDefaultApiKey(...)` (REQ-142, DES-006); fires the idle-gated automatic update check only when the persisted `autoUpdate` setting is true (same `checkVersionIdle` node as TRACE-B); exits 1 with a stderr JSON error naming the `api-key` command before creating any server when no key resolves (REQ-143)
    - `isUnsetApiKey(value)` / `loadConfiguredApiKey()`: placeholder-aware unset classification and configuration-file key read [`src/utils/cliSettings.ts`]
    - `filterTools(serverConfigs[0].tools)`: allowlist [`src/config.ts`]
    - `new BaseMcpServer(name, tools)` → `createMcpServer()` (as TRACE-B) [`src/core/BaseMcpServer.ts`]
    - `startStdio()`: creates `StdioServerTransport` and connects it; runs directly from the built `dist` artifact (`bin` entry `bin/mcp-google-api.mjs` forwarding every argument to `dist/cli.js` with no implicit builds, PRJ-020, and JSON build-remediation guidance when the artifact is missing, PRJ-021; artifact-missing remediation lives in the launcher scripts and the installed-bin launcher, not `src/`)
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
    - `getCurrentApiKey()`: reads AsyncLocalStorage store; falls back to the `ApiKeyManager` startup default key configured from the persisted settings (DES-006) [`src/utils/requestContext.ts`]
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

  Note: CLI `exec` accepts exactly the canonical `maps_`-prefixed tool names (PRJ-001) via the `EXEC_TOOLS` switch in `src/cli.ts`, resolving each to its facade method.

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
  - `doctor` handler: reads installed package version from `package.json`; resolves the effective key from the optional `--apikey` flag over the persisted settings key; parses `--probes` before dispatch (invalid input -> JSON stderr error, exit 1)
    - external: `readFileSync`; fallback version `"0.0.0"`
    - `runDoctor(packageVersion, apiKey, live, runner?, options?)`: local checks (node >= `NODE_ENGINE_FLOOR` 24 per `engines`, non-zero version, key presence, settings-derived config diagnostics, tool/API profile); live branch probes three APIs sequentially by default or the selected `--probes` subset; assembles `DoctorReport`
      - `resolveRuntimeConfig(loadCliSettings())`: typed config snapshot from the persisted settings with per-field sources (flag/settings) [`src/utils/configResolver.ts`, `src/utils/cliSettings.ts`]
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

  TRACE-J: snippet CLI mode [`src/cli.ts`]
  - `snippet` handler: prints MCP-client registration snippets; writes no file
    - `runSnippetCommand(options, streams?)`: renders snippet, writes JSON to stdout and `[snippet]` notes to stderr; exit 1 on render error
      - `renderClientSnippet(options)`: stdio entry (launchers `npx`/`node`/`bin`; `{ command, args }` with no key or environment payload, REQ-093) or HTTP `{ url }` entry; target-file notes per client [`src/utils/clientSnippets.ts`]
      - external: `JSON.stringify`, process streams

  TRACE-K: CLI configuration-management modes (enable/disable/auto-update/tools/host/port/api-key/install/uninstall/show) [`src/cli.ts`]
  - `enable <cli>` / `disable <cli>` handlers: resolve the CLI adapter and update the persisted enabled set; idempotent; unsupported names exit 2 listing supported names
    - `runEnableDisableCliCommand(name, enable, { home?, streams? })`: adapter lookup, settings update, JSON result on stdout [`src/cli.ts`]
      - `resolveCliTarget(name)`: trim + lowercase registry lookup [`src/utils/cliTargets.ts`]
        - `CLI_TARGETS`: per-CLI adapters pi, openclaw, codex, antigravity, claude, copilot; MCP config file (JSON `mcpServers` or codex TOML `mcp_servers`) + skills destination per CLI
        - `supportedCliNames()`: ordered supported-name listing for diagnostics
      - `loadCliSettings(home)` / `saveCliSettings(settings, home)`: read and atomically persist `{ enabled: [...], apiKey? }` at `~/.config/mcp-google-api/config.json`, round-tripping the persisted API key [`src/utils/cliSettings.ts`]
        - `resolveCliSettingsPath(home)`: `<home>/.config/mcp-google-api/config.json`
        - external: `readFileSync`/`writeFileSync`/`renameSync` (atomic `.tmp` replace)
  - `api-key <key>` handler: validates the key, persists it, then refreshes every enabled CLI registration
    - `runApiKeyCommand(key, { home?, resourcesRoot, streams? })`: invalid input -> human-readable stderr error, exit 1, nothing persisted (REQ-137); success path saves the key atomically (REQ-136, DES-023), then runs the install loop (REQ-138) and prints the human-readable stdout report (masked configured key plus one line per processed CLI with its install result; REQ-139, human-readable exception to PRJ-008) [`src/cli.ts`]
      - `ApiKeyManager.getInstance().isValidApiKeyFormat(key)`: 20-50 `[A-Za-z0-9_-]` format gate [`src/utils/apiKeyManager.ts`]
      - `loadCliSettings(home)` / `saveCliSettings(settings, home)`: persist `apiKey` alongside the enabled set and the `autoUpdate` flag (as TRACE-K enable path) [`src/utils/cliSettings.ts`]
      - `installEnabledCliResources({ home, resourcesRoot })`: install loop without key embedding (subtree as TRACE-K install path) [`src/utils/cliInstaller.ts`]
  - `auto-update <state>` handler: resolves `enable|disable|1|0` and persists the boolean into the settings `autoUpdate` field
    - `runAutoUpdateCommand(state, { home?, streams? })`: missing or non-accepted value -> human-readable stderr error listing accepted values, exit 1, nothing persisted (REQ-151); success path saves atomically before printing (REQ-148, REQ-149, DES-024) and prints the human-readable confirmation on stdout (REQ-150) [`src/cli.ts`]
      - `loadCliSettings(home)` / `saveCliSettings(settings, home)`: read and atomically persist `autoUpdate` (as TRACE-K enable path) [`src/utils/cliSettings.ts`]
  - `tools <list|*>` / `host <host>` / `port <port>` handlers: persist the enabled-tool allowlist, HTTP bind host, and HTTP listen port into the settings file
    - `runToolsCommand(raw, { home?, streams? })`: validates names against the registered 18-tool registry (`*` = full set); unknown or empty input -> human-readable stderr error, exit 1, nothing persisted (REQ-167); valid input persists `enabledTools` atomically and prints a human-readable confirmation [`src/cli.ts`]
    - `runHostCommand(raw, { home?, streams? })`: non-empty hostname check (REQ-168); persists `host` atomically with a human-readable confirmation [`src/cli.ts`]
    - `runPortCommand(raw, { home?, streams? })`: integer 1-65535 check (REQ-169); persists `port` atomically with a human-readable confirmation [`src/cli.ts`]
      - `loadCliSettings(home)` / `saveCliSettings(settings, home)`: read and atomically persist `enabledTools`/`host`/`port` with default-normalizing loaders (as TRACE-K enable path) [`src/utils/cliSettings.ts`]
  - `install` / `uninstall` handlers: register or remove the stdio `mcp-google-api` entry and synchronize managed skills for every enabled CLI; registrations carry no key or environment payload (REQ-114) because the registered server reads its configuration file at startup (REQ-142); `install` accepts `--debug-skills` (disabled by default)
    - `runInstallUninstallCommand(operation, { home?, resourcesRoot, includeDebugSkills?, streams? })`: zero-enabled hint (exit 0), operation dispatch forwarding the debug-skills flag to install, human-readable per-CLI activity report on stdout (REQ-166), exit 1 on any per-CLI failure [`src/cli.ts`]
      - `installEnabledCliResources({ home, resourcesRoot, includeDebugSkills })` / `uninstallEnabledCliResources({ home, resourcesRoot })`: per-enabled-CLI loop, per-CLI error collection, remaining CLIs still run [`src/utils/cliInstaller.ts`]
        - `loadCliSettings(home)`: enabled set (as TRACE-K enable path)
        - `loadSkillsManifest(resourcesRoot)`: validated `manifest.json` entries including the optional per-skill `debug` overlay path [`src/utils/cliInstaller.ts`]
          - `resolveSkillsResourcesRoot(packageRoot)`: `<packageRoot>/src/resources/skills` existence check
          - external: `readFileSync`, `existsSync`
        - `buildServerRegistration()`: `{ command: "npx", args: ["-y", "mcp-google-api", "start", "--stdio"] }` with no `env` payload (REQ-114)
        - `applyServerRegistration(target, serverName, entry | undefined, home)`: format-dispatched write/remove [`src/utils/cliTargets.ts`]
          - `writeJsonMcpServerEntry(configPath, name, entry)` / `removeJsonMcpServerEntry(configPath, name)`: read-modify-write of the `mcpServers` map preserving unrelated keys; atomic `.tmp` + rename [`src/utils/cliTargets.ts`]
            - `readJsonConfig(path)` / `writeJsonConfig(path, value)`: tolerant read (missing -> `{}`; malformed -> throw) and atomic write
            - `readJsonMcpServerEntry(path, name)`: entry presence read for status checks
          - `writeTomlMcpServerSection(path, name, entry)` / `removeTomlMcpServerSection(path, name)`: codex `config.toml` `[mcp_servers.<name>]` table append/remove preserving other tables; atomic `.tmp` + rename [`src/utils/cliTargets.ts`]
            - `removeTomlSection(content, name)` / `hasTomlSection(content, name)`: line-oriented managed-table splice and detection
            - `registrationToTomlLines(entry)`: `command`/`args`/`env` table body serialization
          - `isServerRegistered(target, name, home)`: entry presence per format
        - `resolveSkillContentLayout(skill, includeDebug)`: debug overlay declaration plus append decision for one manifest skill [`src/utils/cliInstaller.ts`]
        - `syncSkillTree(source, destination, layout)` per manifest skill (install): copy content files with overwrite excluding the declared debug overlay, prune stale files strictly inside the managed skill directory, then append the overlay content to the installed `SKILL.md` only when debug skills were requested and the skill declares an overlay [`src/utils/cliTargets.ts`]
          - `listFilesRecursive(root)`: relative file enumeration
          - external: `cpSync` (with exclusion filter), `appendFileSync`, `mkdirSync`, `rmSync`
        - `removeSkillDir(skillDir)` per manifest skill (uninstall): managed-directory recursive delete [`src/utils/cliTargets.ts`]
          - external: `rmSync`
  - `show` handler: prints the human-readable CLI Configuration and Installation Status tables (exception to the PRJ-008 JSON rule)
    - `runShowCommand({ home?, resourcesRoot, streams? })`: report to stdout; JSON stderr error + exit 1 on manifest failure [`src/cli.ts`]
      - `buildCliShowReport({ home, resourcesRoot })`: two titled tables joined by a blank line [`src/utils/cliShow.ts`]
        - `renderAsciiTable(headers, rows)`: wrapped fixed-width ASCII grid [`src/utils/cliShow.ts`]
          - `wrapCell(text, width)`: word-boundary cell wrapping
        - `buildCliRows(home)`: one row per supported CLI in registry order (enabled yes/no, home-relative MCP config path, home-relative skills path)
          - `loadCliSettings(home)` (as TRACE-K enable path) [`src/utils/cliSettings.ts`]
          - `CLI_TARGETS` path resolvers [`src/utils/cliTargets.ts`]
        - `buildInstallRows(home, resourcesRoot)`: per enabled CLI one `Server` row plus one `Skill` row per manifest skill with OK/MISSING/STALE status
          - `loadSkillsManifest(resourcesRoot)` (as TRACE-K install path) [`src/utils/cliInstaller.ts`]
          - `isServerRegistered(target, name, home)`: server entry detection [`src/utils/cliTargets.ts`]
          - `compareSkillTree(source, destination, layout)`: packaged-vs-installed byte comparison accepting the plain or overlay-extended installed `SKILL.md` [`src/utils/cliTargets.ts`]
            - `listFilesRecursive(root)` [`src/utils/cliTargets.ts`]

  TRACE-L: management CLI modes (`--ver` / `--version` / `--upgrade` / `--uninstall`) [`src/utils/upgradeManager.ts`, dispatched from `src/cli.ts`]
  - pre-yargs intercept: `parseManagementCommand(hideBin(process.argv))` matches exactly one of the four flags or the `--upgrade` + `--develop`/`--dev` pair (REQ-170); `runManagementCommand(command, { currentVersion, channel })` — the upgrade channel resolved by `parseUpgradeChannel(hideBin(process.argv))` (`"develop"` when `--develop`/`--dev` is present, `"npm"` otherwise) — dispatches and maps the returned code to `process.exitCode` (failures of the async wrapper surface as JSON stderr errors with exit 1) [`src/cli.ts`]
    - `--ver` / `--version` -> `runVersionCommand(options, deps?)`: concurrent dual online probe bypassing the idle cache gate, then the three-line stdout report (installed version, `npmjs latest: <npm-latest>`, `GitHub latest: <github-latest>`; `unknown` placeholder for any undeterminable version); always returns 0 (REQ-120, REQ-161, REQ-162, REQ-163, REQ-164)
      - `probeLatestManifestVersion(deps)` with `deps.idleCheck`: logging-free npm packument-manifest probe bypassing the idle cache — `GET {registry}/{package}` with the abbreviated-manifest Accept header, latest resolved from `dist-tags.latest` (REQ-179, REQ-180); same injected `AutoUpdateCheckerDeps` surface and outcome discrimination as TRACE-B [`src/utils/autoUpdate.ts`]
      - `probeLatestGitHubVersion(deps.githubCheck)`: logging-free GitHub releases probe (`GET https://api.github.com/repos/Ogekuri/mcp-google-api/releases/latest`, `user-agent` header, `tag_name` leading-`v` strip; `error` outcome maps to `unknown`) [`src/utils/autoUpdate.ts`]
      - `resolveProbeLatestVersion(probe)`: `newer` -> registry latest version, `current` -> running version, every other outcome -> `unknown` [`src/utils/upgradeManager.ts`]
    - `--upgrade` -> `runUpgradeCommand(options, deps?)`: channel-selected package reinstall chained with the post-upgrade install and the human-readable stdout summary
      - develop channel (`options.channel === "develop"`, from `--develop`/`--dev`): no npm-registry probe and no already-latest skip path, always proceeding with the tagged GitHub update regardless of the installed version or the branch carrying the tag (REQ-172); `probeLatestGitHubVersion(deps.githubCheck)`: one forced GitHub releases probe bypassing the idle cache gate selecting the latest release `tag_name` (REQ-177) [`src/utils/autoUpdate.ts`]; on probe failure a stderr diagnostic carrying the probe message is emitted, no child process is spawned, and exit code 1 is returned (REQ-178); on success `runPackageManagerCommand(buildDevelopUpgradeCommand(tag), deps)` spawns `npm install -g github:Ogekuri/mcp-google-api#<tag>` with the raw `tag_name` and inherited stdio (REQ-171); the summary reports the probed latest GitHub release version (REQ-173)
        - `buildDevelopUpgradeCommand(tag)`: pure builder of `["npm", "install", "-g", "github:<GITHUB_UPGRADE_REPOSITORY>#<tag>"]` [`src/utils/upgradeManager.ts`]
      - npm channel (default): `probeLatestVersion(deps)`: forced pre-upgrade registry probe bypassing the idle cache gate (`{ ...deps.idleCheck, currentVersion: options.currentVersion }`); `current` -> stdout already-latest line (package name + installed version) and exit 0 without spawning any child process (REQ-144, REQ-145); `newer` -> proceed (REQ-146); `disabled`/`unknown-version`/`error` -> proceed (REQ-147) [`src/utils/autoUpdate.ts`]
      - `isUpgradeNecessary(status)`: pure decision table mapping the probe status to the proceed/skip outcome (`current` -> skip; every other status -> proceed) [`src/utils/upgradeManager.ts`]
      - `runPackageManagerCommand(PACKAGE_UPGRADE_COMMAND, deps)`: spawns `npm install -g mcp-google-api@latest` with inherited stdio (shell on win32); non-zero exit propagates unchanged without printing any summary
      - `resolveUpdatedVersion(options, deps)` (npm channel): one logging-free registry probe after the upgrade child succeeds, delegating the outcome-to-version mapping to `resolveProbeLatestVersion` (REQ-134); invoked only when the pre-upgrade probe did not resolve an npmjs latest version — when the pre-upgrade probe reported `newer`, the summary prints that probe's npmjs latest directly (REQ-181) [`src/utils/upgradeManager.ts`]
        - `probeLatestVersion(deps)`: logging-free registry probe (subtree as TRACE-B) [`src/utils/autoUpdate.ts`]
        - `resolveProbeLatestVersion(probe)`: `newer` -> latest version, `current` -> running version, every other outcome -> `unknown` [`src/utils/upgradeManager.ts`]
      - `runPostUpgradeSkillInstall(options, deps)`: zero enabled CLIs -> successful no-op without spawning; otherwise spawns the `mcp-google-api install` child — the globally installed bin of the just-upgraded package (`POST_UPGRADE_INSTALL_COMMAND`), never an unversioned `npx` spec whose cache/registry resolution could yield a stale copy starting the MCP server — with captured stdout (stderr inherited) so the upgraded package re-synchronizes skills and registrations without echoing the child activity report (REQ-126)
        - `loadCliSettings(home)`: enabled-CLI set read [`src/utils/cliSettings.ts`]
        - `parsePostUpgradeCliOutcomes(stdout)`: parses the child `install` activity report (`  <cli>: ...` lines under the `mcp-google-api install report:` header) into per-CLI outcomes; missing or unparseable output falls back to the persisted enabled list with the aggregate exit-code outcome (REQ-135) [`src/utils/upgradeManager.ts`]
      - `renderUpgradeSummary(previousVersion, updatedVersion, outcome)`: builds the human-readable stdout summary (starting -> updated version, install outcome, one entry per processed CLI; REQ-132, REQ-133) written to the injectable stdout sink [`src/utils/upgradeManager.ts`]
    - `--uninstall` -> `runUninstallCommand(deps)`: `runPackageManagerCommand(PACKAGE_UNINSTALL_COMMAND, deps)` spawning `npm uninstall -g mcp-google-api`
    - `runPackageManagerCommand(command, deps)` shared failure path: spawn error or thrown error -> stderr error plus the exact manual-command warning, exit code 1
      - external: `spawnSync` (node:child_process) with `stdio: "inherit"` and a neutral `cwd` (user home, never the caller's directory: a git-ref global install reconciled against the same-name source checkout corrupts npm reify) -> npm/npx child processes

- External Boundaries:
  - stdio: stdin/stdout JSON-RPC framing (stdio-server mode); stdout guard installed in `connect(...)`.
  - network (inbound): Express HTTP listener on `http://{host}:{port}/mcp` (POST/GET/DELETE; SSE for GET).
  - network (outbound): `https://routes.googleapis.com` (computeRoutes, computeRouteMatrix), `https://registry.npmjs.org` (idle-gated automatic update check via `GET {registry}/{package}/latest`, fire-and-forget, gated by the persisted settings `autoUpdate` field and skipped while the idle deadline is in the future; `--ver`/`--version` packument-manifest probe via `GET {registry}/{package}` with the abbreviated-manifest Accept header, and the forced npm-channel `--upgrade` pre-upgrade/post-update `/latest` probes, all bypassing the gate), `https://api.github.com/repos/Ogekuri/mcp-google-api/releases/latest` (`--ver`/`--version` latest-release probe and develop-channel `--upgrade` latest-release-tag probe, both forced with idle-gate bypass, REQ-161, REQ-177), `https://places.googleapis.com/v1/places:searchText`, `@googlemaps/places` `PlacesClient` (searchNearby, searchText, getPlace, getPhotoMedia), `@googlemaps/google-maps-services-js` `Client` (geocode, reverseGeocode, timezone, elevation), `https://weather.googleapis.com`, `https://airquality.googleapis.com`, `https://maps.googleapis.com/maps/api/staticmap`.
  - child processes (management modes): `npm install -g mcp-google-api@latest` (npm-channel `--upgrade`; spawned only after the forced pre-upgrade check reports a newer version or an undeterminable outcome), `npm install -g github:Ogekuri/mcp-google-api#<tag>` (`--upgrade --develop`/`--dev`; `<tag>` is the latest release `tag_name` from the forced GitHub releases probe REQ-177, spawned only on probe success REQ-178, REQ-170-REQ-173), and `npm uninstall -g mcp-google-api` (`--uninstall`) with inherited stdio, `mcp-google-api install` (post-upgrade skill refresh, executed via the upgraded package's global bin rather than an unversioned `npx` spec) with captured stdout (stderr inherited); all spawned via `spawnSync`.
  - filesystem: `package.json` version read (doctor/management), batch-geocode input/output files, CLI configuration-management read-modify-write (enabled set, configured API key, `autoUpdate` flag, `enabledTools` allowlist, HTTP `host`, and HTTP `port` at `~/.config/mcp-google-api/config.json`; per-CLI MCP configurations `~/.pi/agent/mcp.json`, `~/.openclaw/openclaw.json`, `~/.codex/config.toml`, `~/.gemini/settings.json`, `~/.claude.json`, `~/.copilot/mcp.json`; per-CLI skills directories `~/.pi/agent/skills`, `~/.openclaw/workspace/skills`, `~/.codex/skills`, `~/.gemini/config/skills`, `~/.claude/skills`, `~/.copilot/skills`; packaged skills tree `src/resources/skills`), automatic-update idle cache read/write at `~/.cache/mcp-google-api/check_version_idle-time.json`.
  - OS/runtime: `process.exit`/`process.exitCode`, `process.stdout`/`process.stderr`, `randomUUID` (node:crypto), `AsyncLocalStorage` (node:async_hooks), `Date`/`Math` local-time computations.

## Communication Edges
| ID | Direction | Mechanism | Endpoint / Channel | Payload / Data Shape | Declaration File Paths |
|---|---|---|---|---|---|
| EDGE-01 | external MCP client process (not modeled; counterpart of `PROC:main`) → `PROC:main` | stdio pipe (stdin), JSON-RPC 2.0 framing | stdin | MCP requests: `initialize`, `tools/list`, `tools/call` with zod-validated params | `src/core/BaseMcpServer.ts` |
| EDGE-02 | `PROC:main` → external MCP client process | stdio pipe (stdout), JSON-RPC 2.0 framing | stdout | MCP responses/notifications; tool results `{ content: [{ type: "text" \| "image", ... }], isError }`; non-`{`-prefixed stdout strings suppressed | `src/core/BaseMcpServer.ts` |
| EDGE-03 | external MCP client process → `PROC:main` | HTTP POST/GET/DELETE (Express) + SSE | `http://{host}:{port}/mcp` | JSON-RPC 2.0 body; headers `mcp-session-id`, `X-Google-Maps-API-Key`, `Authorization: Bearer`; 400 + JSON-RPC error `-32000` on invalid session | `src/core/BaseMcpServer.ts` |
| EDGE-04 | `PROC:main` → external MCP client process | HTTP response / SSE stream | `/mcp` | JSON-RPC responses; SSE event stream on GET; per-session isolation keyed by `mcp-session-id` | `src/core/BaseMcpServer.ts` |
| EDGE-05 | `PROC:main` request-handling path → `PROC:main` tool-ACTION path (intra-process) | `AsyncLocalStorage` context store | in-process `RequestContext { apiKey?, sessionId? }` | per-request API key + session id; read by `getCurrentApiKey()` inside every tool ACTION | `src/utils/requestContext.ts`, `src/core/BaseMcpServer.ts`, `src/tools/maps/*.ts` |
| EDGE-06 | `PROC:main` request-handling path → invoking shell / CI consumer (external) | process stdout/stderr | stdout / stderr | CLI JSON outputs: doctor `DoctorReport { success, version, live, checks[] }`; snippet registration JSON (stdout) + `[snippet]` notes (stderr); exec result JSON or `{ error }`; batch summary `{ total, succeeded, failed, results }`; enable/disable result `{ cli, enabled, message }`; api-key human-readable operation report (`API key configured (<masked>).` plus one `MCP connector installed` line per processed CLI), auto-update human-readable confirmation (`Auto-update check enabled/disabled.`), tools/host/port human-readable confirmations (`Enabled tools set to ...`, `HTTP bind host set to ...`, `HTTP port set to ...`), and install/uninstall human-readable per-CLI activity reports (`mcp-google-api <operation> report:` header, `  <cli>: MCP server registered/removed, N skill(s) installed/removed` lines, optional `Errors:` block, REQ-166) — human-readable exceptions to PRJ-008; management `--ver`/`--version` three-line stdout version report (installed version; `npmjs latest: <version>`; `GitHub latest: <version>`; `unknown` placeholder per undeterminable version; no stderr diagnostics); `--upgrade` human-readable stdout summary (starting -> updated version, post-upgrade install outcome, one entry per processed CLI; `unknown` updated version when the probe fails); post-upgrade `install` child stdout is captured and never echoed while stderr stays inherited; remaining child npm/npx output inherits stdio; human-readable `show` CLI Configuration + Installation Status tables (exception to PRJ-008); undispatched server-start launch JSON remediation diagnostic on stderr (skipped entry gate; requested entry, running module, `npm run build` / `npm install -g mcp-google-api@latest` remediation; REQ-094); `[INFO]`/`[ERROR]` diagnostics via `Logger` | `src/cli.ts`, `src/index.ts`, `src/utils/upgradeManager.ts` |
| EDGE-07 | `PROC:main` startup path → external npm registry | HTTPS GET, fire-and-forget (not awaited; bounded by `AbortSignal.timeout(2000)`; idle-gated) | `https://registry.npmjs.org/mcp-google-api/latest` | Request: no body; Response: JSON `{ version }`; the startup call site invokes the check only when the persisted settings `autoUpdate` field is true (REQ-083, DES-024; no production call site passes an environment disable map), skipped without network while the persisted `idle_time_epoch` is in the future; forced once per the npm-channel `--upgrade` pre-upgrade necessity probe (`/latest` endpoint) and once per `--ver`/`--version` (logging-free `probeLatestManifestVersion` against the packument `GET {registry}/{package}` with the abbreviated-manifest Accept header, latest resolved from `dist-tags.latest`, REQ-179, REQ-180, no cache write, paired concurrently with the EDGE-10 GitHub probe; the develop-channel `--upgrade` runs no registry probe); newer version reported on stderr only with current, latest, and upgrade command; idle cache refreshed at `~/.cache/mcp-google-api/check_version_idle-time.json` (3600 s window on newer, 86400 s otherwise) | `src/utils/autoUpdate.ts`, `src/utils/upgradeManager.ts`, `src/cli.ts` |
| EDGE-08 | `PROC:main` CLI configuration-management path (TRACE-K) → external CLI agent configuration files (not modeled; owned by external CLI processes) | filesystem read-modify-write (atomic `.tmp` + rename; JSON `mcpServers` upsert/remove; codex TOML `[mcp_servers.<name>]` append/remove; skill content-tree copy/prune/delete; optional debug overlay append to `SKILL.md`) | `~/.config/mcp-google-api/config.json`; `~/.pi/agent/mcp.json`, `~/.openclaw/openclaw.json`, `~/.codex/config.toml`, `~/.gemini/settings.json`, `~/.claude.json`, `~/.copilot/mcp.json`; skills directories `~/.pi/agent/skills`, `~/.openclaw/workspace/skills`, `~/.codex/skills`, `~/.gemini/config/skills`, `~/.claude/skills`, `~/.copilot/skills` | Settings `{ enabled: [<cli>...], apiKey: "", autoUpdate: true, enabledTools: "*", host: "127.0.0.1", port: 3000 }`; server entry `{ command: "npx", args: ["-y", "mcp-google-api", "start", "--stdio"] }` with no `env` payload (REQ-114); managed skill trees mirroring `src/resources/skills/<skill-id>/` content files, with the declared debug overlay file excluded as a standalone file and appended to the installed `SKILL.md` only when `install --debug-skills` is requested (the package and post-upgrade installs never append it; `show` reports OK for both modes); unrelated entries preserved byte-for-byte | `src/utils/cliSettings.ts`, `src/utils/cliTargets.ts`, `src/utils/cliInstaller.ts`, `src/utils/cliShow.ts`, `src/cli.ts` |
| EDGE-09 | `PROC:main` management path (TRACE-L) → external npm/npx child processes (not modeled) | synchronous child process spawn (`spawnSync`, `stdio: "inherit"`, shell on win32, neutral `cwd` = user home) | `npm install -g mcp-google-api@latest`; `npm install -g github:Ogekuri/mcp-google-api#<tag>` (`--upgrade --develop`/`--dev`; `<tag>` = latest release `tag_name` from the forced GitHub probe REQ-177, spawned only on probe success REQ-178); `npm uninstall -g mcp-google-api`; `mcp-google-api install` | Child exit code propagated as `process.exitCode`; spawn failures print the manual command hint on stderr and map to exit code 1; the `--upgrade`/`--uninstall` children inherit stdio while the post-upgrade `install` child runs with captured stdout (child human-readable activity report parsed into per-CLI outcomes, never echoed); the post-upgrade child is the upgraded package's own global bin, not an unversioned `npx` resolution | `src/utils/upgradeManager.ts`, `src/cli.ts` |
| EDGE-10 | `PROC:main` management path (TRACE-L, `--ver`/`--version` and develop-channel `--upgrade`) → external GitHub Releases API | HTTPS GET, awaited, bounded by `AbortSignal.timeout(2000)` | `https://api.github.com/repos/Ogekuri/mcp-google-api/releases/latest` | Request: no body; headers `accept: application/vnd.github+json`, `user-agent: mcp-google-api`; Response: JSON `{ tag_name }` with any leading `v` stripped to the version text; probe bypasses the idle cache gate and, in `--ver`/`--version`, runs concurrently with the npm-registry probe; failure outcomes render as `unknown` in the `GitHub latest:` stdout line; the develop-channel `--upgrade` runs the same forced probe first (REQ-177) and installs the raw `tag_name` ref on success (REQ-171) while a failed probe emits a stderr diagnostic and spawns no child process (REQ-178) | `src/utils/autoUpdate.ts`, `src/utils/upgradeManager.ts` |
