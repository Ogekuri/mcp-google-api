# Files Structure
```
.
└── src
    ├── cli.ts
    ├── config.ts
    ├── core
    │   └── BaseMcpServer.ts
    ├── index.ts
    ├── services
    │   ├── NewPlacesService.ts
    │   ├── PlacesSearcher.ts
    │   ├── RoutesService.ts
    │   └── toolclass.ts
    ├── tools
    │   └── maps
    │       ├── airQuality.ts
    │       ├── batchGeocode.ts
    │       ├── comparePlaces.ts
    │       ├── directions.ts
    │       ├── distanceMatrix.ts
    │       ├── elevation.ts
    │       ├── exploreArea.ts
    │       ├── geocode.ts
    │       ├── localRankTracker.ts
    │       ├── placeDetails.ts
    │       ├── planRoute.ts
    │       ├── reverseGeocode.ts
    │       ├── searchAlongRoute.ts
    │       ├── searchNearby.ts
    │       ├── searchPlaces.ts
    │       ├── staticMap.ts
    │       ├── timezone.ts
    │       └── weather.ts
    └── utils
        ├── apiKeyManager.ts
        ├── autoUpdate.ts
        ├── clientSnippets.ts
        ├── cliInstaller.ts
        ├── cliSettings.ts
        ├── cliShow.ts
        ├── cliTargets.ts
        ├── configResolver.ts
        ├── requestContext.ts
        └── toolProfiles.ts
```

# cli.ts | TypeScript | 1512L | 35 symbols | 20 imports | 46 comments
> Path: `src/cli.ts`

## Imports
```
import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import serverConfigs, { filterTools } from "./config.js";
import { BaseMcpServer } from "./core/BaseMcpServer.js";
import { Logger } from "./index.js";
import { PlacesSearcher } from "./services/PlacesSearcher.js";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createInterface } from "readline";
import { checkForUpdates } from "./utils/autoUpdate.js";
import {
import { describeToolsProfile } from "./utils/toolProfiles.js";
import { renderClientSnippet, type SnippetClient, type SnippetOptions } from "./utils/clientSnippets.js";
import { loadCliSettings, saveCliSettings } from "./utils/cliSettings.js";
import { resolveCliTarget, supportedCliNames } from "./utils/cliTargets.js";
import {
import { buildCliShowReport } from "./utils/cliShow.js";
```

## Definitions

### fn `export function extractEnvFileOption(argv: readonly string[]): string | undefined` (L50-61)
- @brief Extracts the explicit `--env-file <path>` value from a raw argv array.
- @details Scans for both `--env-file <path>` and `--env-file=<path>` forms
before any command parsing so the file loads before option defaults are
captured. First match wins. Complexity O(n) in argv length; pure.
- @param argv {readonly string[]} Raw process argument vector.
- @return {string | undefined} Path value when present; undefined otherwise.
- @satisfies CTN-009

### fn `function loadEnvironment(envFile: string | undefined): void` (L76-89)
- @brief Loads environment files for the current CLI invocation.
- @details Explicit mode (`envFile` set): loads exactly that file via
`applyExplicitEnvFile` and exits 1 with a JSON stderr error when missing —
no implicit fallback. Implicit mode: loads `.env` from the current working
directory first, then from the package installation directory (dotenv never
overrides already-set variables). Complexity O(file count).
- @param envFile {string | undefined} Explicit `--env-file` value; undefined selects implicit discovery.
- @return {void}
- @throws {never} Terminates the process via `process.exit(1)` on a missing explicit file.
- @see applyExplicitEnvFile
- @satisfies CTN-007, CTN-009

### iface `export interface ServerStartupOutcome` (L97-101)
- @brief Aggregated HTTP startup result across all configured server instances.
- @details `started`/`failed` count per instance; `servers` holds only the
instances that are listening, so a zero-length array with `started === 0`
is the reliable-failure signal consumed by the default command (REQ-095).

### fn `export async function startServer(` (L118-192)
- @brief Starts every configured HTTP MCP server instance and reports the outcome.
- @details Applies flag overrides to the environment, validates each instance
port (integer 1-65535), skips invalid instances with remediation guidance
while marking them failed (REQ-009), awaits `startHttpServer` so listen
errors are caught, installs SIGINT/SIGTERM handlers on success (REQ-096),
and returns the aggregate outcome. Default bind host is loopback
`127.0.0.1` (REQ-008). Complexity O(instances).
- @param port {number | undefined} `--port` override written to `MCP_SERVER_PORT`.
- @param apiKey {string | undefined} `--apikey` override written to `GOOGLE_MAPS_API_KEY`.
- @param host {string | undefined} `--host` override written to `MCP_SERVER_HOST`.
- @return {Promise<ServerStartupOutcome>} Per-run counts plus listening servers.
- @see installShutdownHandlers
- @satisfies REQ-008, REQ-009, REQ-096

- type `export type ShutdownExitHook = (code: number) => void;` (L195)
- @brief Exit hook signature used by the shutdown handler. */
### fn `export function createShutdownHandler(` (L209-223)
- @brief Builds a one-shot orderly shutdown handler for HTTP server instances.
- @details On first invocation it stops every given server via
`stopHttpServer()` (transport close + socket close, errors tolerated) and
then calls `exitHook(0)`; subsequent invocations are no-ops, so repeated
signals never double-stop. Complexity O(servers).
- @param servers {readonly BaseMcpServer[]} Listening server instances.
- @param exitHook {ShutdownExitHook} Terminal action; defaults to `process.exit`.
- @return {(signal: string) => Promise<void>} Reusable async signal handler.
- @see stopHttpServer
- @satisfies REQ-096

### fn `export function installShutdownHandlers(servers: readonly BaseMcpServer[]): void` (L235-239)
- @brief Registers SIGINT/SIGTERM handlers that orderly-stop the given servers.
- @details Wraps `createShutdownHandler` and attaches it to both signals so
Ctrl-C and terminate requests close all HTTP sessions and the listening
socket before process exit (REQ-096). Complexity O(1).
- @param servers {readonly BaseMcpServer[]} Listening server instances.
- @return {void}
- @see createShutdownHandler
- @satisfies REQ-096

- type `type ExecFailureResponse = {` (L264)
### iface `interface ExecOutput` (L269-271)

### iface `interface ExecStreams` (L273-276)

- type `type ExecToolRunner = (toolName: string, params: any, apiKey: string) => Promise<unknown>;` (L278)
- type `export type DoctorCheck = {` (L280)
- type `export type DoctorReport = {` (L286)
- type `type DoctorToolRunner = (toolName: string, params: any, apiKey: string) => Promise<unknown>;` (L293)
### fn `function isExecFailureResponse(result: unknown): result is ExecFailureResponse` (L295-302)

### fn `function getExecFailureMessage(toolName: string, result: ExecFailureResponse): string` (L304-312)

### fn `export async function execTool(toolName: string, params: any, apiKey: string): Promise<any>` (L314-448)

### fn `export async function runExecCommand(` (L458-463)

- type `export type DoctorProbeId = "geocoding" | "places-new" | "routes";` (L483)
- @brief Selectable live-probe identifier used by `doctor --live --probes`. */
### iface `export interface DoctorLiveProbe` (L486-491)
- @brief Static definition of one billable live probe executed by doctor. */

### iface `export interface DoctorProbesParseResult` (L523-526)
- @brief Parsed `--probes` CLI value: either valid probe ids or an error. */

### fn `export function parseDoctorProbes(raw: string | undefined): DoctorProbesParseResult` (L538-560)
- @brief Parses the raw `--probes` CLI string into validated probe ids.
- @details `undefined` input -> `{ probes: undefined }` (probe all three,
legacy `--live` behavior). Splits on commas, trims, lowercases, maps through
`DOCTOR_PROBE_ALIASES`, dedupes, and rejects unknown names or an empty list
with a remediation error. Complexity O(n) in items; pure.
- @param raw {string | undefined} Raw option value from argv.
- @return {DoctorProbesParseResult} Validated ids, or `error` describing the invalid input.
- @satisfies REQ-091

### iface `export interface DoctorOptions` (L568-573)
- @brief Injectable doctor dependencies for deterministic testing.
- @details `nodeVersion` overrides `process.versions.node`; `config` overrides
environment-derived runtime configuration; `allToolNames` overrides the
registered tool-name registry used by the profile check.

### fn `export async function runDoctor(` (L597-602)
- @brief Runs the readiness self-check decoupled from server startup.
- @details Local checks (zero network calls): Node major >=
`NODE_ENGINE_FLOOR` (22, aligned with `package.json` `engines`, REQ-070),
non-zero package version, API key presence (value hidden), effective
configuration diagnostics with masked secrets and per-field sources
(REQ-089, zero-match allowlist reported as fail), explicit env-file status,
and the per-tool Google API profile of the effective tool set (REQ-090).
Live branch: without `options.probes` runs all three probes (legacy
`--live`, REQ-072); with `options.probes` runs only the selected subset
(REQ-091); each probe fails independently. `success` is false when any
check fails; the caller maps it to the exit code.
- @param packageVersion {string} Installed package version ("0.0.0" = unknown).
- @param apiKey {string | undefined} Resolved API key; never printed.
- @param live {boolean} True to run billable live probes.
- @param runner {DoctorToolRunner} Injectable tool runner; defaults to `execTool`.
- @param options {DoctorOptions} Injectable Node version, config, tool registry, and probe subset.
- @return {Promise<DoctorReport>} JSON-serializable report with `checks` and aggregate `success`.
- @see resolveRuntimeConfig
- @see describeToolsProfile
- @satisfies REQ-070, REQ-071, REQ-072, REQ-089, REQ-090, REQ-091

### iface `export interface SetupCheck` (L708-712)
- @brief One named onboarding check result (`pass`, `fail`, or `skip`). */

### iface `export interface SetupReport` (L715-719)
- @brief JSON-serializable outcome of the `setup` command. */

### iface `export interface SetupFs` (L722-726)
- @brief Injectable filesystem surface used by `runSetup` (tests pass fakes). */

### iface `export interface SetupDeps` (L729-733)
- @brief Injectable dependencies for deterministic `runSetup` testing. */

### iface `export interface SetupOptions` (L736-740)
- @brief Inputs controlling `runSetup` behavior. */

### fn `export async function runSetup(options: SetupOptions, deps: SetupDeps = {}): Promise<SetupReport>` (L757-839)
- @brief Runs the non-interactive onboarding self-check with optional `.env` scaffolding.
- @details Zero prompts, zero Google API calls, zero writes unless `writeEnv`
is true (REQ-087). Checks: Node major >= `NODE_ENGINE_FLOOR` (22);
`.env.example` presence in `packageDir`; `.env` handling in `targetDir` —
with `writeEnv` the file is created from the template only when absent and
is never overwritten (REQ-088), without it the check reports the current
state; API key presence from the resolved configuration (value hidden).
`success` is false only when a check fails. Complexity O(1) filesystem ops.
- @param options {SetupOptions} Directories and the explicit write authorization flag.
- @param deps {SetupDeps} Injectable Node version, config, and fs surface.
- @return {Promise<SetupReport>} Report with `created` flag and named checks.
- @see resolveRuntimeConfig
- @satisfies PRJ-011, REQ-087, REQ-088

### fn `export function runSnippetCommand(` (L855-857)
- @brief Renders a client registration snippet and routes output per PRJ-008.
- @details Delegates JSON construction to `renderClientSnippet`, writes the
snippet JSON to `stdout` and each guidance note to `stderr` so stdout stays
pure JSON; never writes or edits any file. Rendering errors surface as a
JSON stderr error with exit code 1. Complexity O(1).
- @param options {SnippetOptions} Rendering options forwarded to `renderClientSnippet`.
- @param streams {ExecStreams} Injectable stdout/stderr sinks; defaults to process streams.
- @return {number} Exit code: 0 on success, 1 on a rendering error.
- @see renderClientSnippet
- @satisfies PRJ-010, REQ-092, REQ-093

### fn `export function runEnableDisableCliCommand(` (L891-894)
- @brief Enables or disables one supported CLI in the persisted settings.
- @details Resolves the CLI adapter case-insensitively; unsupported names
exit 2 with a JSON stderr error listing supported names (REQ-110).
Idempotent: enabling an enabled CLI and disabling a disabled CLI succeed
without rewriting the settings file (REQ-111). Success prints a JSON
result on stdout (PRJ-008).
- @param name {string} CLI name from the command line.
- @param enable {boolean} True to enable; false to disable.
- @param options {object} `{ home?, streams? }`; streams default to process streams.
- @return {number} Exit code: 0 on success, 2 for an unsupported CLI.
- @see loadCliSettings
- @see saveCliSettings
- @satisfies REQ-110, REQ-111

### fn `export function runInstallUninstallCommand(` (L936-938)
- @brief Shared handler for the `install` and `uninstall` commands.
- @details Runs the requested operation over every enabled CLI, prints the
aggregate JSON result on stdout, and exits 1 when any per-CLI failure was
collected (REQ-116). With zero enabled CLIs prints the enable hint and
exits 0 (REQ-119). Diagnostics ride in the JSON `errors` array so stdout
stays the single machine-readable channel (PRJ-008).
- @param operation {"install" | "uninstall"} Requested reciprocal operation.
- @param options {object} `{ home?, apiKey?, resourcesRoot, streams? }`.
- @return {number} Exit code: 0 on success or zero enabled CLIs, 1 on failures.
- @see installEnabledCliResources
- @see uninstallEnabledCliResources
- @satisfies REQ-114, REQ-115, REQ-116, REQ-119

### fn `export function runShowCommand(` (L984-985)
- @brief Prints the CLI Configuration and Installation Status tables.
- @details Delegates rendering to `buildCliShowReport` and writes the report
text to stdout (human-readable exception to PRJ-008). Manifest or render
failures surface as a JSON stderr error with exit code 1.
- @param options {object} `{ home?, resourcesRoot, streams? }`.
- @return {number} Exit code: 0 on success, 1 on a report failure.
- @see buildCliShowReport
- @satisfies REQ-117, REQ-118, REQ-119

### fn `const semaphore = async (tasks: (() => Promise<void>)[], limit: number) =>` (L1380-1392)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`extractEnvFileOption`|fn||50-61|export function extractEnvFileOption(argv: readonly strin...|
|`loadEnvironment`|fn||76-89|function loadEnvironment(envFile: string | undefined): void|
|`ServerStartupOutcome`|iface||97-101|export interface ServerStartupOutcome|
|`startServer`|fn||118-192|export async function startServer(|
|`ShutdownExitHook`|type||195||
|`createShutdownHandler`|fn||209-223|export function createShutdownHandler(|
|`installShutdownHandlers`|fn||235-239|export function installShutdownHandlers(servers: readonly...|
|`ExecFailureResponse`|type||264||
|`ExecOutput`|iface||269-271|interface ExecOutput|
|`ExecStreams`|iface||273-276|interface ExecStreams|
|`ExecToolRunner`|type||278||
|`DoctorCheck`|type||280||
|`DoctorReport`|type||286||
|`DoctorToolRunner`|type||293||
|`isExecFailureResponse`|fn||295-302|function isExecFailureResponse(result: unknown): result i...|
|`getExecFailureMessage`|fn||304-312|function getExecFailureMessage(toolName: string, result: ...|
|`execTool`|fn||314-448|export async function execTool(toolName: string, params: ...|
|`runExecCommand`|fn||458-463|export async function runExecCommand(|
|`DoctorProbeId`|type||483||
|`DoctorLiveProbe`|iface||486-491|export interface DoctorLiveProbe|
|`DoctorProbesParseResult`|iface||523-526|export interface DoctorProbesParseResult|
|`parseDoctorProbes`|fn||538-560|export function parseDoctorProbes(raw: string | undefined...|
|`DoctorOptions`|iface||568-573|export interface DoctorOptions|
|`runDoctor`|fn||597-602|export async function runDoctor(|
|`SetupCheck`|iface||708-712|export interface SetupCheck|
|`SetupReport`|iface||715-719|export interface SetupReport|
|`SetupFs`|iface||722-726|export interface SetupFs|
|`SetupDeps`|iface||729-733|export interface SetupDeps|
|`SetupOptions`|iface||736-740|export interface SetupOptions|
|`runSetup`|fn||757-839|export async function runSetup(options: SetupOptions, dep...|
|`runSnippetCommand`|fn||855-857|export function runSnippetCommand(|
|`runEnableDisableCliCommand`|fn||891-894|export function runEnableDisableCliCommand(|
|`runInstallUninstallCommand`|fn||936-938|export function runInstallUninstallCommand(|
|`runShowCommand`|fn||984-985|export function runShowCommand(|
|`semaphore`|fn||1380-1392|const semaphore = async (tasks: (() => Promise<void>)[], ...|


---

# config.ts | TypeScript | 204L | 2 symbols | 21 imports | 3 comments
> Path: `src/config.ts`

## Imports
```
import { resolveEnabledToolNames } from "./utils/configResolver.js";
import { Logger } from "./index.js";
import { ToolConfig } from "./core/BaseMcpServer.js";
import { SearchNearby, SearchNearbyParams } from "./tools/maps/searchNearby.js";
import { PlaceDetails, PlaceDetailsParams } from "./tools/maps/placeDetails.js";
import { Geocode, GeocodeParams } from "./tools/maps/geocode.js";
import { ReverseGeocode, ReverseGeocodeParams } from "./tools/maps/reverseGeocode.js";
import { DistanceMatrix, DistanceMatrixParams } from "./tools/maps/distanceMatrix.js";
import { Directions, DirectionsParams } from "./tools/maps/directions.js";
import { Elevation, ElevationParams } from "./tools/maps/elevation.js";
import { SearchPlaces, SearchPlacesParams } from "./tools/maps/searchPlaces.js";
import { Timezone, TimezoneParams } from "./tools/maps/timezone.js";
import { Weather, WeatherParams } from "./tools/maps/weather.js";
import { ExploreArea, ExploreAreaParams } from "./tools/maps/exploreArea.js";
import { PlanRoute, PlanRouteParams } from "./tools/maps/planRoute.js";
import { ComparePlaces, ComparePlacesParams } from "./tools/maps/comparePlaces.js";
import { AirQuality, AirQualityParams } from "./tools/maps/airQuality.js";
import { StaticMap, StaticMapParams } from "./tools/maps/staticMap.js";
import { BatchGeocode, BatchGeocodeParams } from "./tools/maps/batchGeocode.js";
import { SearchAlongRoute, SearchAlongRouteParams } from "./tools/maps/searchAlongRoute.js";
import { LocalRankTracker, LocalRankTrackerParams } from "./tools/maps/localRankTracker.js";
```

## Definitions

### iface `interface ServerInstanceConfig` (L33-37)

### fn `export function filterTools(tools: ToolConfig[]): ToolConfig[]` (L185-202)
- @brief Applies the `GOOGLE_MAPS_ENABLED_TOOLS` allowlist to a tool registry.
- @details Delegates allowlist semantics to `resolveEnabledToolNames` (unset,
empty, or `*` -> full set; >=1 match -> subset; 0 matches -> full set plus
stderr error). Logs the active-count line only when a strict subset is
selected, preserving legacy output. Complexity O(n + m).
- @param tools {ToolConfig[]} Full tool registry.
- @return {ToolConfig[]} Effective tool list (never empty for a non-empty input).
- @see resolveEnabledToolNames
- @satisfies PRJ-006, REQ-010, REQ-011, REQ-012

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`ServerInstanceConfig`|iface||33-37|interface ServerInstanceConfig|
|`filterTools`|fn||185-202|export function filterTools(tools: ToolConfig[]): ToolCon...|


---

# BaseMcpServer.ts | TypeScript | 245L | 4 symbols | 12 imports | 22 comments
> Path: `src/core/BaseMcpServer.ts`

## Imports
```
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response } from "express";
import { Server } from "http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Logger } from "../index.js";
import { ApiKeyManager } from "../utils/apiKeyManager.js";
import { runWithContext } from "../utils/requestContext.js";
```

## Definitions

### iface `export interface ToolConfig` (L17-23)

### iface `export interface SessionContext` (L25-28)

### class `export class BaseMcpServer` (L30-246)
- fn `const handleSessionRequest = async (req: Request, res: Response) =>` (L162-182)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`ToolConfig`|iface||17-23|export interface ToolConfig|
|`SessionContext`|iface||25-28|export interface SessionContext|
|`BaseMcpServer`|class||30-246|export class BaseMcpServer|
|`BaseMcpServer.handleSessionRequest`|fn||162-182|const handleSessionRequest = async (req: Request, res: Re...|


---

# index.ts | TypeScript | 11L | 0 symbols | 0 imports | 0 comments
> Path: `src/index.ts`


---

# NewPlacesService.ts | TypeScript | 660L | 3 symbols | 2 imports | 30 comments
> Path: `src/services/NewPlacesService.ts`

## Imports
```
import { PlacesClient } from "@googlemaps/places";
import { Logger } from "../index.js";
```

## Definitions

### class `export class NewPlacesService` (L4-303)

### fn `const toDayNumber = (value: any): number | undefined =>` (L561-572)

### fn `const toMinutes = (time: any): number | undefined =>` (L574-587)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`NewPlacesService`|class||4-303|export class NewPlacesService|
|`toDayNumber`|fn||561-572|const toDayNumber = (value: any): number | undefined =>|
|`toMinutes`|fn||574-587|const toMinutes = (time: any): number | undefined =>|


---

# PlacesSearcher.ts | TypeScript | 996L | 15 symbols | 3 imports | 33 comments
> Path: `src/services/PlacesSearcher.ts`

## Imports
```
import { GoogleMapsTools } from "./toolclass.js";
import { NewPlacesService } from "./NewPlacesService.js";
import {
```

## Definitions

### iface `interface SearchResponse` (L12-20)

### iface `interface PlaceDetailsResponse` (L22-27)

### iface `interface GeocodeResponse` (L29-37)

### iface `interface ReverseGeocodeResponse` (L39-47)

### iface `interface DistanceMatrixResponse` (L49-58)

### iface `interface DirectionsResponse` (L60-69)

### iface `interface TimezoneResponse` (L71-81)

### iface `interface WeatherResponse` (L83-87)

### iface `interface StaticMapResponse` (L89-97)

### iface `interface AirQualityResponse` (L99-103)

### iface `interface ElevationResponse` (L105-112)

### iface `interface ResolvedLocation` (L114-120)

### fn `function parseCoordinateInput(input: string): { lat: number; lng: number } | null` (L125-139)

### fn `function toRouteWaypoint(loc: ResolvedLocation): RouteWaypoint` (L145-150)

### class `export class PlacesSearcher` (L152-451)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`SearchResponse`|iface||12-20|interface SearchResponse|
|`PlaceDetailsResponse`|iface||22-27|interface PlaceDetailsResponse|
|`GeocodeResponse`|iface||29-37|interface GeocodeResponse|
|`ReverseGeocodeResponse`|iface||39-47|interface ReverseGeocodeResponse|
|`DistanceMatrixResponse`|iface||49-58|interface DistanceMatrixResponse|
|`DirectionsResponse`|iface||60-69|interface DirectionsResponse|
|`TimezoneResponse`|iface||71-81|interface TimezoneResponse|
|`WeatherResponse`|iface||83-87|interface WeatherResponse|
|`StaticMapResponse`|iface||89-97|interface StaticMapResponse|
|`AirQualityResponse`|iface||99-103|interface AirQualityResponse|
|`ElevationResponse`|iface||105-112|interface ElevationResponse|
|`ResolvedLocation`|iface||114-120|interface ResolvedLocation|
|`parseCoordinateInput`|fn||125-139|function parseCoordinateInput(input: string): { lat: numb...|
|`toRouteWaypoint`|fn||145-150|function toRouteWaypoint(loc: ResolvedLocation): RouteWay...|
|`PlacesSearcher`|class||152-451|export class PlacesSearcher|


---

# RoutesService.ts | TypeScript | 385L | 9 symbols | 1 imports | 20 comments
> Path: `src/services/RoutesService.ts`

## Imports
```
import { Logger } from "../index.js";
```

## Definitions

### fn `export function parseDuration(duration: string | undefined): number` (L39-43)

### fn `export function formatDistance(meters: number): string` (L48-53)

### fn `export function formatDuration(seconds: number): string` (L58-68)

- type `export type RouteWaypoint = { latLng: { latitude: number; longitude: number } } | { placeId: string };` (L72)
- type `export type WaypointInput = string | RouteWaypoint;` (L73)
### fn `function describeWaypoint(waypoint: WaypointInput): string` (L78-86)

### fn `function toWaypoint(location: WaypointInput): any` (L95-111)

### fn `function buildRouteModifiers(params: { avoidTolls?: boolean; avoidHighways?: boolean }, travelMode: string): any` (L113-132)

### class `export class RoutesService` (L140-385)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`parseDuration`|fn||39-43|export function parseDuration(duration: string | undefine...|
|`formatDistance`|fn||48-53|export function formatDistance(meters: number): string|
|`formatDuration`|fn||58-68|export function formatDuration(seconds: number): string|
|`RouteWaypoint`|type||72||
|`WaypointInput`|type||73||
|`describeWaypoint`|fn||78-86|function describeWaypoint(waypoint: WaypointInput): string|
|`toWaypoint`|fn||95-111|function toWaypoint(location: WaypointInput): any|
|`buildRouteModifiers`|fn||113-132|function buildRouteModifiers(params: { avoidTolls?: boole...|
|`RoutesService`|class||140-385|export class RoutesService|


---

# toolclass.ts | TypeScript | 531L | 3 symbols | 4 imports | 12 comments
> Path: `src/services/toolclass.ts`

## Imports
```
import { Client, Language } from "@googlemaps/google-maps-services-js";
import dotenv from "dotenv";
import { Logger } from "../index.js";
import { RoutesService } from "./RoutesService.js";
```

## Definitions

### iface `interface GeocodeResult` (L8-13)

### fn `function extractErrorMessage(error: any): string` (L18-50)

### class `export class GoogleMapsTools` (L52-351)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`GeocodeResult`|iface||8-13|interface GeocodeResult|
|`extractErrorMessage`|fn||18-50|function extractErrorMessage(error: any): string|
|`GoogleMapsTools`|class||52-351|export class GoogleMapsTools|


---

# airQuality.ts | TypeScript | 60L | 2 symbols | 3 imports | 0 comments
> Path: `src/tools/maps/airQuality.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type AirQualityParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L22)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L24-53)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`AirQualityParams`|type||22||
|`ACTION`|fn||24-53|async function ACTION(params: any): Promise<{ content: an...|


---

# batchGeocode.ts | TypeScript | 58L | 2 symbols | 3 imports | 0 comments
> Path: `src/tools/maps/batchGeocode.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type BatchGeocodeParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L13)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L15-51)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`BatchGeocodeParams`|type||13||
|`ACTION`|fn||15-51|async function ACTION(params: any): Promise<{ content: an...|


---

# comparePlaces.ts | TypeScript | 41L | 2 symbols | 3 imports | 0 comments
> Path: `src/tools/maps/comparePlaces.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type ComparePlacesParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L21)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L23-39)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`ComparePlacesParams`|type||21||
|`ACTION`|fn||23-39|async function ACTION(params: any): Promise<{ content: an...|


---

# directions.ts | TypeScript | 75L | 2 symbols | 3 imports | 1 comments
> Path: `src/tools/maps/directions.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type DirectionsParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L28)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L30-68)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`DirectionsParams`|type||28||
|`ACTION`|fn||30-68|async function ACTION(params: any): Promise<{ content: an...|


---

# distanceMatrix.ts | TypeScript | 78L | 2 symbols | 3 imports | 1 comments
> Path: `src/tools/maps/distanceMatrix.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type DistanceMatrixParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L32)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L34-71)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`DistanceMatrixParams`|type||32||
|`ACTION`|fn||34-71|async function ACTION(params: any): Promise<{ content: an...|


---

# elevation.ts | TypeScript | 59L | 2 symbols | 3 imports | 1 comments
> Path: `src/tools/maps/elevation.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type ElevationParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L20)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L22-52)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`ElevationParams`|type||20||
|`ACTION`|fn||22-52|async function ACTION(params: any): Promise<{ content: an...|


---

# exploreArea.ts | TypeScript | 41L | 2 symbols | 3 imports | 0 comments
> Path: `src/tools/maps/exploreArea.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type ExploreAreaParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L21)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L23-39)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`ExploreAreaParams`|type||21||
|`ACTION`|fn||23-39|async function ACTION(params: any): Promise<{ content: an...|


---

# geocode.ts | TypeScript | 52L | 2 symbols | 3 imports | 1 comments
> Path: `src/tools/maps/geocode.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type GeocodeParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L13)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L15-45)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`GeocodeParams`|type||13||
|`ACTION`|fn||15-45|async function ACTION(params: any): Promise<{ content: an...|


---

# localRankTracker.ts | TypeScript | 91L | 2 symbols | 3 imports | 1 comments
> Path: `src/tools/maps/localRankTracker.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type LocalRankTrackerParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L44)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L46-84)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`LocalRankTrackerParams`|type||44||
|`ACTION`|fn||46-84|async function ACTION(params: any): Promise<{ content: an...|


---

# placeDetails.ts | TypeScript | 67L | 2 symbols | 3 imports | 0 comments
> Path: `src/tools/maps/placeDetails.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type PlaceDetailsParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L26)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L28-60)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`PlaceDetailsParams`|type||26||
|`ACTION`|fn||28-60|async function ACTION(params: any): Promise<{ content: an...|


---

# planRoute.ts | TypeScript | 52L | 2 symbols | 3 imports | 0 comments
> Path: `src/tools/maps/planRoute.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type PlanRouteParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L32)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L34-50)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`PlanRouteParams`|type||32||
|`ACTION`|fn||34-50|async function ACTION(params: any): Promise<{ content: an...|


---

# reverseGeocode.ts | TypeScript | 53L | 2 symbols | 3 imports | 1 comments
> Path: `src/tools/maps/reverseGeocode.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type ReverseGeocodeParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L14)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L16-46)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`ReverseGeocodeParams`|type||14||
|`ACTION`|fn||16-46|async function ACTION(params: any): Promise<{ content: an...|


---

# searchAlongRoute.ts | TypeScript | 53L | 2 symbols | 3 imports | 0 comments
> Path: `src/tools/maps/searchAlongRoute.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type SearchAlongRouteParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L20)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L22-46)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`SearchAlongRouteParams`|type||20||
|`ACTION`|fn||22-46|async function ACTION(params: any): Promise<{ content: an...|


---

# searchNearby.ts | TypeScript | 64L | 2 symbols | 3 imports | 1 comments
> Path: `src/tools/maps/searchNearby.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type SearchNearbyParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L25)
### fn `async function ACTION(params: SearchNearbyParams): Promise<{ content: any[]; isError?: boolean }>` (L27-57)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`SearchNearbyParams`|type||25||
|`ACTION`|fn||27-57|async function ACTION(params: SearchNearbyParams): Promis...|


---

# searchPlaces.ts | TypeScript | 124L | 2 symbols | 3 imports | 0 comments
> Path: `src/tools/maps/searchPlaces.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type SearchPlacesParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L67)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L69-117)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`SearchPlacesParams`|type||67||
|`ACTION`|fn||69-117|async function ACTION(params: any): Promise<{ content: an...|


---

# staticMap.ts | TypeScript | 74L | 2 symbols | 3 imports | 0 comments
> Path: `src/tools/maps/staticMap.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type StaticMapParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L31)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L33-67)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`StaticMapParams`|type||31||
|`ACTION`|fn||33-67|async function ACTION(params: any): Promise<{ content: an...|


---

# timezone.ts | TypeScript | 51L | 2 symbols | 3 imports | 0 comments
> Path: `src/tools/maps/timezone.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type TimezoneParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L18)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L20-44)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`TimezoneParams`|type||18||
|`ACTION`|fn||20-44|async function ACTION(params: any): Promise<{ content: an...|


---

# weather.ts | TypeScript | 62L | 2 symbols | 3 imports | 0 comments
> Path: `src/tools/maps/weather.ts`

## Imports
```
import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
```

## Definitions

- type `export type WeatherParams = z.infer<z.ZodObject<typeof SCHEMA>>;` (L23)
### fn `async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }>` (L25-55)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`WeatherParams`|type||23||
|`ACTION`|fn||25-55|async function ACTION(params: any): Promise<{ content: an...|


---

# apiKeyManager.ts | TypeScript | 72L | 1 symbols | 1 imports | 11 comments
> Path: `src/utils/apiKeyManager.ts`

## Imports
```
import { Request } from "express";
```

## Definitions

### class `export class ApiKeyManager` (L3-72)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`ApiKeyManager`|class||3-72|export class ApiKeyManager|


---

# autoUpdate.ts | TypeScript | 192L | 7 symbols | 1 imports | 22 comments
> Path: `src/utils/autoUpdate.ts`

## Imports
```
import { Logger } from "../index.js";
```

## Definitions

### iface `export interface AutoUpdateLogger` (L33-38)
- @brief Minimal logger contract consumed by the update check.
- @details Structural subset of `Logger` (`src/index.ts`); injectable so tests
capture diagnostics without touching stderr.
- @param args {unknown[]} Diagnostic fragments joined for stderr output.
- @param args {unknown[]} Error diagnostic fragments for stderr output.

### iface `export interface AutoUpdateCheckerDeps` (L46-61)
- @brief Dependency injection surface of `checkForUpdates`.
- @details Every field is optional; omitted fields resolve to production
defaults (`process.env`, global `fetch`, `Logger`). Injection exists to keep
unit tests deterministic and network-free (TST-011).

### iface `export interface AutoUpdateResult` (L64-69)

### fn `export function isAutoUpdateDisabled(` (L81-86)
- @brief Evaluates the disable flag for the automatic update check.
- @details Reads `AUTO_UPDATE_DISABLED_ENV` from the given environment map and
matches values `1`, `true`, `yes` case-insensitively after trimming; any
other value (including unset, empty, `0`, `false`) keeps the check enabled.
- @param env {Record<string, string | undefined>} Environment map to inspect. Defaults to `process.env`.
- @return {boolean} True when the update check is disabled; false when enabled.
- @note Complexity: O(1). Pure; no side effects.
- @satisfies REQ-083

### fn `export function isNewerVersion(candidate: string, current: string): boolean` (L100-123)
- @brief Compares two dotted numeric version strings.
- @details Splits both inputs on `.` into integer segments, right-pads the
shorter sequence with zeroes, and returns on the first differing segment.
Any non-integer segment (e.g. prerelease suffix `3-beta.1`) forces False, so
unparseable or prerelease candidates never trigger an update notice.
- @param candidate {string} Version reported as available (latest).
- @param current {string} Version currently running.
- @return {boolean} True only when `candidate` is strictly newer than `current`.
- @note Complexity: O(k) where k is the number of dotted segments. Pure; no side effects.
- @satisfies REQ-084

### fn `const toSegments = (version: string): number[] =>` (L101-113)

### fn `export async function checkForUpdates(` (L142-143)
- @brief Runs the automatic update check against the npm registry.
- @details Resolution order: disabled-flag short-circuit (REQ-083, zero
network calls) → running-version guard (missing `currentVersion` aborts with
an stderr diagnostic, zero network calls) → single `GET {registry}/{package}/latest`
with `timeoutMs` deadline → `response.ok` and `payload.version` validation →
`isNewerVersion` gate → stderr upgrade notice (REQ-084). Every failure path
(disabled, missing version, non-OK status, malformed payload, network error)
returns null, logs to stderr only, and never throws (REQ-085).
- @param deps {AutoUpdateCheckerDeps} Optional dependency overrides; production defaults when omitted.
- @return {Promise<AutoUpdateResult | null>} `{ currentVersion, latestVersion }` when a strictly newer version is published; null otherwise.
- @warning Must be invoked fire-and-forget (`void checkForUpdates(...)`) so server startup is never awaited on it (REQ-085).
- @note Complexity: O(k) in version segments plus one HTTP round-trip bounded by `timeoutMs`.
- @see isAutoUpdateDisabled
- @see isNewerVersion
- @satisfies REQ-082, REQ-083, REQ-084, REQ-085

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`AutoUpdateLogger`|iface||33-38|export interface AutoUpdateLogger|
|`AutoUpdateCheckerDeps`|iface||46-61|export interface AutoUpdateCheckerDeps|
|`AutoUpdateResult`|iface||64-69|export interface AutoUpdateResult|
|`isAutoUpdateDisabled`|fn||81-86|export function isAutoUpdateDisabled(|
|`isNewerVersion`|fn||100-123|export function isNewerVersion(candidate: string, current...|
|`toSegments`|fn||101-113|const toSegments = (version: string): number[] =>|
|`checkForUpdates`|fn||142-143|export async function checkForUpdates(|


---

# cliInstaller.ts | TypeScript | 210L | 8 symbols | 4 imports | 9 comments
> Path: `src/utils/cliInstaller.ts`
- @brief Orchestrate MCP-server registration and skill installation for enabled CLIs.
- @details Loads the enabled-CLI settings, reads the packaged skills
manifest, and for each enabled CLI registers the stdio `mcp-google-map`
entry in that CLI's MCP configuration plus synchronizes every manifest
skill into that CLI's skills directory. Uninstallation is the exact
reciprocal operation. Per-CLI failures are collected without stopping the
remaining CLIs.
- @satisfies PRJ-015, DES-020, REQ-114, REQ-115, REQ-116

## Imports
```
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadCliSettings, MCP_SERVER_NAME } from "./cliSettings.js";
import {
```

## Definitions

### iface `export interface ManifestSkill` (L28-34)
- @brief One manifest skill entry from `src/resources/skills/manifest.json`.
- @details `id` names the packaged `<id>/` directory holding `SKILL.md`.

### iface `export interface CliOperationSummary` (L41-45)
- @brief Per-CLI outcome of one install or uninstall run.
- @details `server` counts the MCP registration (0 or 1); `skills` counts
processed manifest skills for that CLI.

### iface `export interface CliOperationResult` (L51-54)
- @brief Aggregate outcome of one install or uninstall run.
- @details Both lists are empty when no CLI is enabled (REQ-116, REQ-119).

### fn `export function buildServerRegistration(apiKey: string | undefined):` (L65-75)
- @brief Build the stdio MCP-server registration entry.
- @details Launcher `npx -y mcp-google-map --stdio`; `env` embeds
`GOOGLE_MAPS_API_KEY` only when resolved at install time, matching the
prebuilt-package-first Quick Start.
- @param apiKey {string | undefined} Resolved Google Maps API key.
- @return {object} Registration entry consumed by every supported CLI.
- @satisfies REQ-114

### fn `export function resolveSkillsResourcesRoot(packageRoot: string): string` (L86-92)
- @brief Resolve the packaged skills root for the running installation.
- @details Checks `<packageRoot>/src/resources/skills` — the layout used
both by from-source runs and by the published npm package, which ships the
same subtree (PKG-024).
- @param packageRoot {string} Package installation root.
- @return {string} Absolute skills resources root.
- @throws {Error} When the skills root directory is missing.

### fn `export function loadSkillsManifest(resourcesRoot: string): ManifestSkill[]` (L101-132)
- @brief Load and validate the packaged skills manifest.
- @param resourcesRoot {string} Skills resources root directory.
- @return {ManifestSkill[]} Manifest entries in file order.
- @throws {Error} When the manifest is missing, malformed, or lists a missing
`SKILL.md` path.

### fn `export function installEnabledCliResources(options:` (L145-172)
- @brief Install the MCP server entry and every manifest skill per enabled CLI.
- @details For each enabled CLI in settings order: registers the stdio entry
via `applyServerRegistration`, then synchronizes each manifest skill
directory `<resourcesRoot>/<skill-id>` into `<skillsDir>/<skill-id>`.
Failures are collected per CLI and remaining CLIs still run.
- @param options {object} `{ home?, apiKey, resourcesRoot }`.
- @return {CliOperationResult} Per-CLI summaries and failure diagnostics.
- @throws {Error} When the skills manifest cannot be loaded (all CLIs fail).
- @satisfies REQ-114, REQ-116

### fn `export function uninstallEnabledCliResources(options:` (L185-210)
- @brief Remove the MCP server entry and managed skills per enabled CLI.
- @details Reciprocal of `installEnabledCliResources`: removes the managed
server entry and deletes each manifest skill directory. Missing entries
count as removed without failure; per-CLI failures are collected and
remaining CLIs still run.
- @param options {object} `{ home?, resourcesRoot }`.
- @return {CliOperationResult} Per-CLI summaries and failure diagnostics.
- @throws {Error} When the skills manifest cannot be loaded (all CLIs fail).
- @satisfies REQ-115, REQ-116

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`ManifestSkill`|iface||28-34|export interface ManifestSkill|
|`CliOperationSummary`|iface||41-45|export interface CliOperationSummary|
|`CliOperationResult`|iface||51-54|export interface CliOperationResult|
|`buildServerRegistration`|fn||65-75|export function buildServerRegistration(apiKey: string | ...|
|`resolveSkillsResourcesRoot`|fn||86-92|export function resolveSkillsResourcesRoot(packageRoot: s...|
|`loadSkillsManifest`|fn||101-132|export function loadSkillsManifest(resourcesRoot: string)...|
|`installEnabledCliResources`|fn||145-172|export function installEnabledCliResources(options:|
|`uninstallEnabledCliResources`|fn||185-210|export function uninstallEnabledCliResources(options:|


---

# cliSettings.ts | TypeScript | 110L | 5 symbols | 2 imports | 8 comments
> Path: `src/utils/cliSettings.ts`
- @brief Persist the enabled-CLI set for the CLI configuration-management commands.
- @details Stores `{"enabled": ["<cli>", ...]}` at
`<home>/.config/mcp-google-map/config.json`. Loading tolerates missing,
unreadable, non-object, or malformed content by returning normalized
defaults; saving serializes with two-space indentation plus a trailing
newline, writes a sibling temporary file, and replaces the target
atomically. Adopted from the reference `skills` settings model
(`$HOME/.config/skills/config.json`) so both tools share one UX.
- @satisfies DES-018

## Imports
```
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
```

## Definitions

### iface `export interface CliSettings` (L35-37)
- @brief User settings shape consumed by enable/disable/install/uninstall/show.
- @details `enabled` lists canonical CLI names in persistence order.

### fn `export function resolveCliSettingsPath(home?: string): string` (L45-48)
- @brief Resolve the user settings file path for a home root.
- @param home {string | undefined} Home-directory override; defaults to `os.homedir()`.
- @return {string} Absolute settings file path.
- @satisfies DES-018

### fn `function uniqueStrings(value: unknown): string[]` (L55-64)
- @brief Normalize an arbitrary parsed value into unique non-empty strings.
- @param value {unknown} Candidate JSON value.
- @return {string[]} Unique strings in first-seen order; empty for non-lists.

### fn `export function loadCliSettings(home?: string): CliSettings` (L74-84)
- @brief Load the user settings with normalized defaults.
- @details Reads JSON from `resolveCliSettingsPath`; missing, unreadable,
malformed, or non-object content yields `{ enabled: [] }`. Never throws.
- @param home {string | undefined} Home-directory override.
- @return {CliSettings} Normalized settings object.
- @satisfies DES-018

### fn `export function saveCliSettings(settings: CliSettings, home?: string): string` (L99-110)
- @brief Persist settings to the user settings file atomically.
- @details Creates parent directories, serializes with two-space indentation
and a trailing newline, writes `<file>.tmp`, then renames over the target
so readers never observe a partial file.
- @param settings {CliSettings} Settings object to persist.
- @param home {string | undefined} Home-directory override.
- @return {string} Written settings file path.
- @throws {Error} With descriptive message when directory creation, writing,
or replacement fails; the temporary file is best-effort removed.
- @satisfies DES-018
- @post The settings file contains the serialized `settings` object.

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`CliSettings`|iface||35-37|export interface CliSettings|
|`resolveCliSettingsPath`|fn||45-48|export function resolveCliSettingsPath(home?: string): st...|
|`uniqueStrings`|fn||55-64|function uniqueStrings(value: unknown): string[]|
|`loadCliSettings`|fn||74-84|export function loadCliSettings(home?: string): CliSettings|
|`saveCliSettings`|fn||99-110|export function saveCliSettings(settings: CliSettings, ho...|


---

# cliShow.ts | TypeScript | 183L | 6 symbols | 5 imports | 10 comments
> Path: `src/utils/cliShow.ts`
- @brief Render the CLI Configuration and Installation Status report tables.
- @details Builds the human-readable `show` output: a CLI Configuration
table covering every supported CLI (enabled state, MCP configuration
path, skills destination path) and an Installation Status table listing
the managed MCP server and every manifest skill per enabled CLI with
OK / MISSING / STALE detection.
- @satisfies REQ-117, REQ-118, REQ-119

## Imports
```
import { join } from "node:path";
import { relative, resolve } from "node:path";
import { loadCliSettings, MCP_SERVER_NAME } from "./cliSettings.js";
import { CLI_TARGETS, compareSkillTree, isServerRegistered, type CliTargetId } from "./cliTargets.js";
import { loadSkillsManifest } from "./cliInstaller.js";
```

## Definitions

### fn `function wrapCell(text: string, width: number): string[]` (L42-67)
- @brief Wrap one cell value into fixed-width lines on word boundaries.
- @details Collapses whitespace, splits overlong tokens into `width`-sized
chunks, and greedily packs words without exceeding `width`.
- @param text {string} Cell value to wrap.
- @param width {number} Maximum line width in characters; MUST be positive.
- @return {string[]} Rendered lines; `[""]` for an empty value.

### fn `export function renderAsciiTable(headers: string[], rows: string[][], maxWidth = MAX_CELL_WIDTH): string` (L79-101)
- @brief Render an ASCII grid table with aligned and wrapped cells.
- @details Column widths are the longest cell capped by `maxWidth`; every
row is emitted between `+---+` borders and multi-line cells are padded to
the row height.
- @param headers {string[]} Column header labels.
- @param rows {string[][]} Row cell values.
- @param maxWidth {number} Maximum column width in characters.
- @return {string} Rendered table text without trailing newline.

### fn `const renderRow = (cells: string[]): string[] =>` (L85-94)

### fn `function buildCliRows(home?: string): string[][]` (L111-123)
- @brief Build the CLI Configuration table rows.
- @details One row per supported CLI in registry order: enabled yes/no,
home-relative MCP configuration path, and home-relative skills directory.
- @param home {string | undefined} Home-directory override.
- @return {string[][]} `(CLI, Enabled, MCP Config Path, Skills Config Path)` rows.
- @satisfies REQ-117

### fn `function buildInstallRows(home: string | undefined, resourcesRoot: string): string[][]` (L135-160)
- @brief Build the Installation Status table rows.
- @details Emits rows only for enabled CLIs: one `Server` row for the
managed `mcp-google-map` entry plus one `Skill` row per manifest skill,
each with OK / MISSING / STALE detection.
- @param home {string | undefined} Home-directory override.
- @param resourcesRoot {string} Packaged skills resources root.
- @return {string[][]} `(Type, Name, CLI, Enabled, Installed)` rows.
- @satisfies REQ-118

### fn `export function buildCliShowReport(options: { home?: string; resourcesRoot: string }): string` (L173-181)
- @brief Build the complete `show` report text.
- @details Renders the CLI Configuration table (always, REQ-119) and the
Installation Status table (empty when no CLI is enabled), in this order,
separated by a blank line. Manifest load failures propagate so the command
handler reports a JSON error.
- @param options {object} `{ home?, resourcesRoot }`.
- @return {string} Report text with two titled tables.
- @throws {Error} When the skills manifest cannot be loaded.
- @satisfies REQ-117, REQ-118, REQ-119

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`wrapCell`|fn||42-67|function wrapCell(text: string, width: number): string[]|
|`renderAsciiTable`|fn||79-101|export function renderAsciiTable(headers: string[], rows:...|
|`renderRow`|fn||85-94|const renderRow = (cells: string[]): string[] =>|
|`buildCliRows`|fn||111-123|function buildCliRows(home?: string): string[][]|
|`buildInstallRows`|fn||135-160|function buildInstallRows(home: string | undefined, resou...|
|`buildCliShowReport`|fn||173-181|export function buildCliShowReport(options: { home?: stri...|


---

# cliTargets.ts | TypeScript | 528L | 27 symbols | 2 imports | 33 comments
> Path: `src/utils/cliTargets.ts`
- @brief Provide per-CLI MCP-configuration and skills-destination adapters.
- @details Defines one adapter for each supported CLI agent (`pi`,
`openclaw`, `codex`, `antigravity`, `claude`) resolving the MCP
configuration file and the skills destination directory from an injectable
home root. MCP registration applies read-modify-write: JSON targets merge
the `mcpServers["mcp-google-map"]` entry preserving every unrelated key;
the TOML target (codex) appends or removes the `[mcp_servers.<name>]`
table without touching other tables. Skill synchronization copies packaged
skill directories with overwrite and prunes stale files inside managed
skill directories only, preserving unmanaged destination entries. Paths
adopted from the reference `skills` installer targets.
- @satisfies DES-017, DES-019, DES-020, REQ-110, REQ-112, REQ-113

## Imports
```
import {
import { join, relative, resolve } from "node:path";
```

## Definitions

- type `export type CliTargetId = "pi" | "openclaw" | "codex" | "antigravity" | "claude";` (L34)
- @brief Canonical identifiers of the supported CLI agents.
- @details Registry order: pi, openclaw, codex, antigravity, claude.
### iface `export interface McpServerRegistration` (L40-44)
- @brief MCP-server registration entry written into CLI configurations.
- @details stdio launcher shape consumed by every supported CLI agent.

- type `export type CliConfigFormat = "json" | "toml";` (L51)
- @brief Configuration format of one CLI's MCP configuration file.
- @details `json` targets expose a `mcpServers` object map; `toml` targets
expose `mcp_servers` tables (codex `config.toml`).
### iface `export interface CliTarget` (L58-63)
- @brief Adapter describing one supported CLI installation target.
- @details Pure path/format descriptor; all operations are module functions
parameterized by the adapter so each CLI stays data-driven.

### fn `function homeRoot(home?: string): string` (L66-68)
- @brief Resolve the effective home root. */

### fn `export function resolveCliTarget(name: string): CliTarget | undefined` (L133-135)
- @brief Resolve a CLI adapter by user-supplied name.
- @details Trims surrounding whitespace and lowercases before the registry
lookup, matching `pi`, `openclaw`, `codex`, `antigravity`, `claude`
case-insensitively.
- @param name {string} CLI name from the command line.
- @return {CliTarget | undefined} Matching adapter; undefined when unsupported.
- @satisfies REQ-110

### fn `export function supportedCliNames(): string` (L142-144)
- @brief Comma-separated list of supported CLI names for diagnostics.
- @return {string} Ordered `pi, openclaw, codex, antigravity, claude`.
- @satisfies REQ-110

### fn `function readJsonConfig(configPath: string): Record<string, unknown>` (L154-161)
- @brief Read and parse a JSON MCP configuration file.
- @details Missing files yield `{}`; malformed JSON throws so the caller can
fail that CLI without ever overwriting the user's file.
- @param configPath {string} Target configuration file path.
- @return {Record<string, unknown>} Parsed JSON object.
- @throws {Error} When the file exists but is not valid JSON.

### fn `function writeJsonConfig(configPath: string, value: Record<string, unknown>): void` (L173-178)
- @brief Serialize and atomically write a JSON object to a file.
- @details Two-space indentation, trailing newline, sibling `.tmp` write
followed by rename; parent directories are created on demand.
- @param configPath {string} Target file path.
- @param value {Record<string, unknown>} Object to serialize.
- @return {void}
- @throws {Error} When serialization, writing, or renaming fails.
- @satisfies DES-019

### fn `export function writeJsonMcpServerEntry(` (L192-205)
- @brief Register an MCP-server entry in a JSON `mcpServers` configuration.
- @details Read-modify-write: parses the file (missing files start as `{}`),
upserts `mcpServers.<serverName>` leaving every unrelated key untouched,
and replaces the file atomically.
- @param configPath {string} JSON configuration file path.
- @param serverName {string} Server key inside `mcpServers`.
- @param entry {McpServerRegistration} Registration entry to upsert.
- @return {void}
- @throws {Error} When the existing file is malformed or the write fails.
- @satisfies DES-019, REQ-112

### fn `export function removeJsonMcpServerEntry(configPath: string, serverName: string): boolean` (L218-232)
- @brief Remove an MCP-server entry from a JSON `mcpServers` configuration.
- @details Deletes `mcpServers.<serverName>` when present and rewrites the
file atomically; an empty `mcpServers` object is kept to minimize
disruption. Missing files are a successful no-op.
- @param configPath {string} JSON configuration file path.
- @param serverName {string} Server key inside `mcpServers`.
- @return {boolean} True when an entry was removed; false when absent.
- @throws {Error} When the existing file is malformed or the write fails.
- @satisfies DES-019, REQ-115

### fn `export function readJsonMcpServerEntry(` (L240-254)
- @brief Read one MCP-server entry from a JSON configuration.
- @param configPath {string} JSON configuration file path.
- @param serverName {string} Server key inside `mcpServers`.
- @return {McpServerRegistration | undefined} Entry when registered; undefined otherwise.

### fn `function tomlString(value: string): string` (L262-264)
- @brief Escape a value as a TOML basic string.
- @details Escapes backslash and double-quote characters.
- @param value {string} Raw string value.
- @return {string} Quoted TOML basic string.

### fn `function tomlSectionHeader(serverName: string): string` (L271-273)
- @brief Header line of one managed server's TOML table.
- @param serverName {string} Server key inside `mcp_servers`.
- @return {string} Exact `[mcp_servers.<serverName>]` header line.

### fn `function removeTomlSection(content: string, serverName: string): string` (L284-309)
- @brief Remove one managed server's TOML table from raw content.
- @details Deletes the `[mcp_servers.<name>]` header line plus its body up to
the next top-level `[` table header or EOF, collapsing the resulting
duplicate blank separators. Other tables are preserved byte-for-byte.
- @param content {string} Raw TOML document content.
- @param serverName {string} Server key inside `mcp_servers`.
- @return {string} Content with the managed table removed.

### fn `function hasTomlSection(content: string, serverName: string): boolean` (L317-319)
- @brief Detect one managed server's TOML table in raw content.
- @param content {string} Raw TOML document content.
- @param serverName {string} Server key inside `mcp_servers`.
- @return {boolean} True when the `[mcp_servers.<name>]` header line exists.

### fn `function registrationToTomlLines(entry: McpServerRegistration): string[]` (L326-336)
- @brief Serialize a registration entry as TOML table lines.
- @param entry {McpServerRegistration} Registration entry.
- @return {string[]} `command`, optional `args`, and optional `env` lines.

### fn `export function writeTomlMcpServerSection(` (L350-363)
- @brief Register an MCP-server table in a TOML configuration file.
- @details Reads the file (missing files start empty), removes any existing
managed table, then appends the fresh `[mcp_servers.<name>]` table. Other
tables are preserved; the write is atomic via sibling `.tmp` + rename.
- @param configPath {string} TOML configuration file path.
- @param serverName {string} Server key inside `mcp_servers`.
- @param entry {McpServerRegistration} Registration entry to write.
- @return {void}
- @throws {Error} When reading or writing fails.
- @satisfies DES-019, REQ-112

### fn `export function removeTomlMcpServerSection(configPath: string, serverName: string): boolean` (L375-384)
- @brief Remove an MCP-server table from a TOML configuration file.
- @details Missing files and absent tables are successful no-ops; otherwise
the managed table is removed and the file is rewritten atomically.
- @param configPath {string} TOML configuration file path.
- @param serverName {string} Server key inside `mcp_servers`.
- @return {boolean} True when a table was removed; false when absent.
- @throws {Error} When reading or writing fails.
- @satisfies DES-019, REQ-115

### fn `export function hasTomlMcpServerSection(configPath: string, serverName: string): boolean` (L392-395)
- @brief Detect one managed server's TOML table in a configuration file.
- @param configPath {string} TOML configuration file path.
- @param serverName {string} Server key inside `mcp_servers`.
- @return {boolean} True when the managed table header exists.

### fn `function listFilesRecursive(root: string): string[]` (L402-417)
- @brief Recursively list relative file paths under a directory.
- @param root {string} Directory to scan.
- @return {string[]} POSIX-style relative file paths; empty when the directory is absent.

### fn `const walk = (dir: string): void =>` (L405-414)

### fn `export function syncSkillTree(source: string, destination: string): void` (L433-443)
- @brief Synchronize one packaged skill directory into a destination.
- @details Creates the destination, recursively copies every packaged file
with overwrite, then deletes destination files and directories absent from
the package — strictly inside the managed skill directory, so sibling
unmanaged skills are never touched. Pruning runs deepest-first.
- @param source {string} Packaged skill directory containing `SKILL.md`.
- @param destination {string} Target `<skillsDir>/<skill-id>` path.
- @return {void}
- @throws {Error} When copying or pruning fails.
- @satisfies DES-020
- @pre `source` MUST exist.
- @post `destination` mirrors exactly the packaged skill tree.

### fn `export function removeSkillDir(skillDir: string): void` (L454-456)
- @brief Remove one managed skill directory from a skills destination.
- @details Missing directories are successful no-ops; nothing outside the
named directory is touched and no directory is created.
- @param skillDir {string} Managed `<skillsDir>/<skill-id>` path.
- @return {void}
- @throws {Error} When recursive deletion fails.
- @satisfies DES-020, REQ-115

### fn `export function compareSkillTree(source: string, destination: string): "OK" | "MISSING" | "STALE"` (L468-480)
- @brief Compare one packaged skill directory with its installed copy.
- @details Every packaged regular file must exist in the destination with
identical bytes; extra destination files are ignored (staleness is judged
only on packaged content).
- @param source {string} Packaged skill directory.
- @param destination {string} Installed skill directory.
- @return {string} `OK` when all packaged files match, `MISSING` when the
package or destination is absent, `STALE` on byte mismatch.

### fn `export function isServerRegistered(target: CliTarget, serverName: string, home?: string): boolean` (L489-495)
- @brief Detect whether a CLI has the managed server entry registered.
- @param target {CliTarget} CLI adapter.
- @param serverName {string} Managed server key.
- @param home {string | undefined} Home-directory override.
- @return {boolean} True when the entry/table is present and parseable.

### fn `export function applyServerRegistration(` (L508-528)
- @brief Write or remove the managed server entry for one CLI target.
- @param target {CliTarget} CLI adapter.
- @param serverName {string} Managed server key.
- @param entry {McpServerRegistration | undefined} Entry to register;
undefined removes the entry.
- @param home {string | undefined} Home-directory override.
- @return {void}
- @throws {Error} When the configuration read-modify-write fails.
- @satisfies DES-019, REQ-112, REQ-115

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`CliTargetId`|type||34||
|`McpServerRegistration`|iface||40-44|export interface McpServerRegistration|
|`CliConfigFormat`|type||51||
|`CliTarget`|iface||58-63|export interface CliTarget|
|`homeRoot`|fn||66-68|function homeRoot(home?: string): string|
|`resolveCliTarget`|fn||133-135|export function resolveCliTarget(name: string): CliTarget...|
|`supportedCliNames`|fn||142-144|export function supportedCliNames(): string|
|`readJsonConfig`|fn||154-161|function readJsonConfig(configPath: string): Record<strin...|
|`writeJsonConfig`|fn||173-178|function writeJsonConfig(configPath: string, value: Recor...|
|`writeJsonMcpServerEntry`|fn||192-205|export function writeJsonMcpServerEntry(|
|`removeJsonMcpServerEntry`|fn||218-232|export function removeJsonMcpServerEntry(configPath: stri...|
|`readJsonMcpServerEntry`|fn||240-254|export function readJsonMcpServerEntry(|
|`tomlString`|fn||262-264|function tomlString(value: string): string|
|`tomlSectionHeader`|fn||271-273|function tomlSectionHeader(serverName: string): string|
|`removeTomlSection`|fn||284-309|function removeTomlSection(content: string, serverName: s...|
|`hasTomlSection`|fn||317-319|function hasTomlSection(content: string, serverName: stri...|
|`registrationToTomlLines`|fn||326-336|function registrationToTomlLines(entry: McpServerRegistra...|
|`writeTomlMcpServerSection`|fn||350-363|export function writeTomlMcpServerSection(|
|`removeTomlMcpServerSection`|fn||375-384|export function removeTomlMcpServerSection(configPath: st...|
|`hasTomlMcpServerSection`|fn||392-395|export function hasTomlMcpServerSection(configPath: strin...|
|`listFilesRecursive`|fn||402-417|function listFilesRecursive(root: string): string[]|
|`walk`|fn||405-414|const walk = (dir: string): void =>|
|`syncSkillTree`|fn||433-443|export function syncSkillTree(source: string, destination...|
|`removeSkillDir`|fn||454-456|export function removeSkillDir(skillDir: string): void|
|`compareSkillTree`|fn||468-480|export function compareSkillTree(source: string, destinat...|
|`isServerRegistered`|fn||489-495|export function isServerRegistered(target: CliTarget, ser...|
|`applyServerRegistration`|fn||508-528|export function applyServerRegistration(|


---

# clientSnippets.ts | TypeScript | 120L | 6 symbols | 0 imports | 10 comments
> Path: `src/utils/clientSnippets.ts`

## Definitions

- type `export type SnippetClient = "generic" | "claude" | "cursor" | "pi";` (L10)
- @brief Supported MCP client targets; selects the documented target file. */
- type `export type SnippetTransport = "stdio" | "http";` (L13)
- @brief Supported MCP transports for the generated registration entry. */
- type `export type SnippetLauncher = "npx" | "node" | "bin";` (L16)
- @brief stdio launcher strategy: `npx` one-shot, `node` with a script path, or the installed `bin`. */
### iface `export interface SnippetOptions` (L23-32)
- @brief Options controlling snippet rendering.
- @details All fields optional; defaults: client `generic`, transport `stdio`,
launcher `npx`, serverName `mcp-google-map`, HTTP host `127.0.0.1`, port 3000.

### iface `export interface SnippetResult` (L40-43)
- @brief Rendered snippet plus stderr guidance notes.
- @details `json` is a complete pretty-printed `mcpServers` registration
object (parses with `JSON.parse`); `notes` are human guidance lines the CLI
prints on stderr so stdout stays pure JSON (PRJ-008).

### fn `export function renderClientSnippet(options: SnippetOptions = {}): SnippetResult` (L78-120)
- @brief Renders a valid MCP-client registration snippet without writing files.
- @details stdio transport: launcher `npx` -> `npx -y mcp-google-map --stdio`;
`bin` -> installed `mcp-google-map --stdio`; `node` -> `node <commandPath>
--stdio` and throws when `commandPath` is missing. HTTP transport: emits
`{ url: "http://<host>:<port>/mcp" }`. The `env` block embeds
`API_KEY_PLACEHOLDER` by default; a provided `envKey` switches the value to
the literal `${<envKey>}` and adds a note that variable expansion is
client-specific (REQ-093). Pure: no filesystem or network access; output is
JSON.stringify'd with 2-space indent. Complexity O(1).
- @param options {SnippetOptions} Rendering options; defaults apply when omitted.
- @return {SnippetResult} Pretty-printed JSON snippet plus stderr notes.
- @throws {Error} When launcher is `node` and `commandPath` is missing.
- @satisfies PRJ-010, REQ-092, REQ-093

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`SnippetClient`|type||10||
|`SnippetTransport`|type||13||
|`SnippetLauncher`|type||16||
|`SnippetOptions`|iface||23-32|export interface SnippetOptions|
|`SnippetResult`|iface||40-43|export interface SnippetResult|
|`renderClientSnippet`|fn||78-120|export function renderClientSnippet(options: SnippetOptio...|


---

# configResolver.ts | TypeScript | 302L | 14 symbols | 3 imports | 17 comments
> Path: `src/utils/configResolver.ts`

## Imports
```
import { config as dotenvConfig } from "dotenv";
import { existsSync } from "fs";
import { isAutoUpdateDisabled } from "./autoUpdate.js";
```

## Definitions

### iface `export interface RuntimeConfigOverrides` (L36-41)
- @brief Higher-priority values that override environment-derived configuration.
- @details Flags parsed from CLI arguments; every field optional. `flag`
source wins over `environment` which wins over `default`.

- type `export type RuntimeConfigSource = "flag" | "environment" | "default";` (L44)
- @brief Origin tag attached to each resolved configuration field. */
### iface `export interface ResolvedRuntimeConfig` (L53-65)
- @brief Typed snapshot of every runtime configuration field with per-field source.
- @details Produced exclusively by `resolveRuntimeConfig`; consumed by all CLI
commands and `doctor` diagnostics (DES-015). `port` is undefined when the
configured value cannot be parsed to an integer; `portRaw` preserves the
original string for remediation messages.

### fn `export function resolveRuntimeConfig(` (L83-85)
- @brief Resolves runtime configuration from an environment map plus flag overrides.
- @details Priority per field: overrides (`flag`) > environment map
(`environment`) > built-in default (`default`). Port parsing: flag port used
as-is; environment string parsed with `Number` and left undefined when not a
finite integer (raw preserved in `portRaw`). `enabledToolsRaw` keeps the
trimmed `GOOGLE_MAPS_ENABLED_TOOLS` string; empty string normalizes to
undefined. `autoUpdateDisabled` delegates to `isAutoUpdateDisabled`. Pure:
reads inputs only, mutates nothing. Complexity O(1).
- @param env {Record<string, string | undefined>} Environment map; defaults to `process.env`.
- @param overrides {RuntimeConfigOverrides} Flag-derived overrides; defaults to none.
- @return {ResolvedRuntimeConfig} Fully typed configuration with per-field sources.
- @see isAutoUpdateDisabled
- @see validateHttpEndpoint
- @satisfies DES-015

### fn `export function maskSecret(value: string | undefined): string` (L134-142)
- @brief Masks a secret value for safe inclusion in reports and diagnostics.
- @details `undefined`/empty -> `unset`; length <= 8 -> `****`; otherwise first
four characters + `****` + last four characters. The raw secret never
appears in the output. Pure; complexity O(n) in value length.
- @param value {string | undefined} Secret to mask (e.g. Google Maps API key).
- @return {string} Masked representation safe for stderr/stdout reports.
- @satisfies DES-016, REQ-089

### iface `export interface ConfigDiagnostics` (L150-157)
- @brief Per-field effective-value diagnostic structure with masked secrets.
- @details Every field carries its resolved value (masked when secret) and its
`RuntimeConfigSource`; produced by `describeRuntimeConfig` and embedded in
`doctor` local reports.

### fn `export function describeRuntimeConfig(config: ResolvedRuntimeConfig): ConfigDiagnostics` (L168-181)
- @brief Builds a serializable diagnostic view of a resolved configuration.
- @details Maps `ResolvedRuntimeConfig` to `ConfigDiagnostics`, masking the API
key via `maskSecret` so the result is safe to print. Complexity O(1); pure.
- @param config {ResolvedRuntimeConfig} Configuration produced by `resolveRuntimeConfig`.
- @return {ConfigDiagnostics} Masked, source-annotated diagnostics.
- @see maskSecret
- @satisfies REQ-089, DES-016

### fn `export function formatConfigDiagnostics(diagnostics: ConfigDiagnostics): string` (L192-200)
- @brief Formats config diagnostics as one compact human-readable line.
- @details Joins `key=value (source)` fragments; the API key is pre-masked by
`describeRuntimeConfig`. Used as `doctor` check detail text. Complexity O(1).
- @param diagnostics {ConfigDiagnostics} Output of `describeRuntimeConfig`.
- @return {string} Single-line `;`-separated diagnostic string.
- @see describeRuntimeConfig
- @satisfies REQ-089

### iface `export interface HttpEndpointValidation` (L207-210)
- @brief Outcome of HTTP endpoint validation over a resolved configuration.
- @details `valid` is false when `errors` is non-empty; each error is a
remediation-oriented message.

### fn `export function validateHttpEndpoint(config: ResolvedRuntimeConfig): HttpEndpointValidation` (L221-230)
- @brief Validates the HTTP bind endpoint of a resolved configuration.
- @details Rules: port must be defined, an integer in 1..65535; host must be a
non-empty string. Returns every violated rule as a remediation message.
Pure; complexity O(1).
- @param config {ResolvedRuntimeConfig} Configuration to validate.
- @return {HttpEndpointValidation} `valid` plus per-rule error messages.
- @satisfies REQ-009

### iface `export interface ExplicitEnvFileResult` (L236-239)
- @brief Result of loading an explicit `--env-file` file.
- @details `ok` false carries an `error` message suitable for CLI JSON errors.

### fn `export function applyExplicitEnvFile(path: string): ExplicitEnvFileResult` (L250-256)
- @brief Loads exactly one explicit environment file via dotenv.
- @details Checks existence first (dotenv silently ignores missing files) and
returns `{ ok: false, error }` when absent; otherwise loads the file without
overriding already-set process variables. Complexity O(file size).
- @param path {string} Absolute or relative path to the environment file.
- @return {ExplicitEnvFileResult} `{ ok: true }` on load; `{ ok: false, error }` when missing.
- @satisfies CTN-009

### iface `export interface EnabledToolsResolution` (L264-269)
- @brief Result of resolving the `GOOGLE_MAPS_ENABLED_TOOLS` allowlist.
- @details `names` is the effective tool-name list; `matched` counts allowlist
hits; `fallback` is true when the allowlist matched zero tools and the full
set is returned (REQ-012); `requested` lists the parsed allowlist items.

### fn `export function resolveEnabledToolNames(` (L282-302)
- @brief Resolves the enabled-tool allowlist against the full tool registry.
- @details Semantics: unset, empty, or `*` -> full set (REQ-010); at least one
matching name -> the named subset, items trimmed and empties ignored
(REQ-011); zero matches -> full set with `fallback: true` (REQ-012). Pure;
complexity O(n + m) with n registry names and m allowlist items.
- @param allToolNames {readonly string[]} Full registered tool-name registry.
- @param raw {string | undefined} Raw `GOOGLE_MAPS_ENABLED_TOOLS` value.
- @return {EnabledToolsResolution} Effective names plus resolution metadata.
- @satisfies REQ-010, REQ-011, REQ-012, PRJ-006

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`RuntimeConfigOverrides`|iface||36-41|export interface RuntimeConfigOverrides|
|`RuntimeConfigSource`|type||44||
|`ResolvedRuntimeConfig`|iface||53-65|export interface ResolvedRuntimeConfig|
|`resolveRuntimeConfig`|fn||83-85|export function resolveRuntimeConfig(|
|`maskSecret`|fn||134-142|export function maskSecret(value: string | undefined): st...|
|`ConfigDiagnostics`|iface||150-157|export interface ConfigDiagnostics|
|`describeRuntimeConfig`|fn||168-181|export function describeRuntimeConfig(config: ResolvedRun...|
|`formatConfigDiagnostics`|fn||192-200|export function formatConfigDiagnostics(diagnostics: Conf...|
|`HttpEndpointValidation`|iface||207-210|export interface HttpEndpointValidation|
|`validateHttpEndpoint`|fn||221-230|export function validateHttpEndpoint(config: ResolvedRunt...|
|`ExplicitEnvFileResult`|iface||236-239|export interface ExplicitEnvFileResult|
|`applyExplicitEnvFile`|fn||250-256|export function applyExplicitEnvFile(path: string): Expli...|
|`EnabledToolsResolution`|iface||264-269|export interface EnabledToolsResolution|
|`resolveEnabledToolNames`|fn||282-302|export function resolveEnabledToolNames(|


---

# requestContext.ts | TypeScript | 24L | 3 symbols | 1 imports | 3 comments
> Path: `src/utils/requestContext.ts`

## Imports
```
import { AsyncLocalStorage } from "node:async_hooks";
```

## Definitions

### iface `interface RequestContext` (L3-6)

### fn `export function getCurrentApiKey(): string | undefined` (L14-17)

### fn `export function runWithContext<T>(context: RequestContext, fn: () => T | Promise<T>): T | Promise<T>` (L22-24)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`RequestContext`|iface||3-6|interface RequestContext|
|`getCurrentApiKey`|fn||14-17|export function getCurrentApiKey(): string | undefined|
|`runWithContext`|fn||22-24|export function runWithContext<T>(context: RequestContext...|


---

# toolProfiles.ts | TypeScript | 162L | 5 symbols | 0 imports | 7 comments
> Path: `src/utils/toolProfiles.ts`

## Definitions

- type `export type GoogleApiId =` (L6)
- @brief Identifier of a Google Maps Platform API consumed by a tool.
- @details Stable machine-readable ids used across tool profiles, `doctor`
local reports, and documentation tables.
### iface `export interface ToolApiProfile` (L39-43)
- @brief Dependency profile of one MCP tool.
- @details `apis` lists every Google API the tool can call at runtime
(including dependencies reached through composite resolution such as
address geocoding or text-search fallback); `dependsOnTools` lists the
sibling tools whose operations the composite tool chains internally.

### fn `export function getToolProfile(toolName: string): ToolApiProfile | undefined` (L107-109)
- @brief Looks up the dependency profile of one tool.
- @details Direct registry access; unknown names return undefined so callers
decide whether to skip or report. Complexity O(1).
- @param toolName {string} MCP tool name (e.g. `maps_geocode`).
- @return {ToolApiProfile | undefined} Profile when registered; undefined otherwise.
- @satisfies PRJ-009

### iface `export interface ToolsProfileSummary` (L116-120)
- @brief Aggregated API-dependency summary for a set of enabled tools.
- @details `tools` keeps per-tool ordering of the input; `apis` is the deduped,
registry-order union of required `GoogleApiId`s across all given tools.

### fn `export function describeToolsProfile(toolNames: readonly string[]): ToolsProfileSummary` (L133-162)
- @brief Aggregates tool/API profiles for the enabled tool set.
- @details Maps each name through `TOOL_API_PROFILES` (unknown names and
duplicates are skipped), unions the required APIs in registry order without
duplicates, and echoes per-tool dependencies. No network access.
Complexity O(n) in tool names plus O(n*a) API union work.
- @param toolNames {readonly string[]} Effective enabled tool names.
- @return {ToolsProfileSummary} Per-tool profiles and aggregated API union.
- @see getToolProfile
- @satisfies PRJ-009, REQ-090

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`GoogleApiId`|type||6||
|`ToolApiProfile`|iface||39-43|export interface ToolApiProfile|
|`getToolProfile`|fn||107-109|export function getToolProfile(toolName: string): ToolApi...|
|`ToolsProfileSummary`|iface||116-120|export interface ToolsProfileSummary|
|`describeToolsProfile`|fn||133-162|export function describeToolsProfile(toolNames: readonly ...|

