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
        ├── configResolver.ts
        ├── requestContext.ts
        └── toolProfiles.ts
```

# cli.ts | TypeScript | 1280L | 32 symbols | 16 imports | 42 comments
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
```

## Definitions

### fn `function extractEnvFileOption(argv: readonly string[]): string | undefined` (L41-52)
- @brief Extracts the explicit `--env-file <path>` value from a raw argv array.
- @details Scans for both `--env-file <path>` and `--env-file=<path>` forms
before any command parsing so the file loads before option defaults are
captured. First match wins. Complexity O(n) in argv length; pure.
- @param argv {readonly string[]} Raw process argument vector.
- @return {string | undefined} Path value when present; undefined otherwise.
- @satisfies CTN-009

### fn `function loadEnvironment(envFile: string | undefined): void` (L67-80)
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

### iface `export interface ServerStartupOutcome` (L88-92)
- @brief Aggregated HTTP startup result across all configured server instances.
- @details `started`/`failed` count per instance; `servers` holds only the
instances that are listening, so a zero-length array with `started === 0`
is the reliable-failure signal consumed by the default command (REQ-095).

### fn `export async function startServer(` (L109-183)
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

- type `export type ShutdownExitHook = (code: number) => void;` (L186)
- @brief Exit hook signature used by the shutdown handler. */
### fn `export function createShutdownHandler(` (L200-214)
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

### fn `export function installShutdownHandlers(servers: readonly BaseMcpServer[]): void` (L226-230)
- @brief Registers SIGINT/SIGTERM handlers that orderly-stop the given servers.
- @details Wraps `createShutdownHandler` and attaches it to both signals so
Ctrl-C and terminate requests close all HTTP sessions and the listening
socket before process exit (REQ-096). Complexity O(1).
- @param servers {readonly BaseMcpServer[]} Listening server instances.
- @return {void}
- @see createShutdownHandler
- @satisfies REQ-096

- type `type ExecFailureResponse = {` (L255)
### iface `interface ExecOutput` (L260-262)

### iface `interface ExecStreams` (L264-267)

- type `type ExecToolRunner = (toolName: string, params: any, apiKey: string) => Promise<unknown>;` (L269)
- type `export type DoctorCheck = {` (L271)
- type `export type DoctorReport = {` (L277)
- type `type DoctorToolRunner = (toolName: string, params: any, apiKey: string) => Promise<unknown>;` (L284)
### fn `function isExecFailureResponse(result: unknown): result is ExecFailureResponse` (L286-293)

### fn `function getExecFailureMessage(toolName: string, result: ExecFailureResponse): string` (L295-303)

### fn `export async function execTool(toolName: string, params: any, apiKey: string): Promise<any>` (L305-439)

### fn `export async function runExecCommand(` (L449-454)

- type `export type DoctorProbeId = "geocoding" | "places-new" | "routes";` (L474)
- @brief Selectable live-probe identifier used by `doctor --live --probes`. */
### iface `export interface DoctorLiveProbe` (L477-482)
- @brief Static definition of one billable live probe executed by doctor. */

### iface `export interface DoctorProbesParseResult` (L514-517)
- @brief Parsed `--probes` CLI value: either valid probe ids or an error. */

### fn `export function parseDoctorProbes(raw: string | undefined): DoctorProbesParseResult` (L529-551)
- @brief Parses the raw `--probes` CLI string into validated probe ids.
- @details `undefined` input -> `{ probes: undefined }` (probe all three,
legacy `--live` behavior). Splits on commas, trims, lowercases, maps through
`DOCTOR_PROBE_ALIASES`, dedupes, and rejects unknown names or an empty list
with a remediation error. Complexity O(n) in items; pure.
- @param raw {string | undefined} Raw option value from argv.
- @return {DoctorProbesParseResult} Validated ids, or `error` describing the invalid input.
- @satisfies REQ-091

### iface `export interface DoctorOptions` (L559-564)
- @brief Injectable doctor dependencies for deterministic testing.
- @details `nodeVersion` overrides `process.versions.node`; `config` overrides
environment-derived runtime configuration; `allToolNames` overrides the
registered tool-name registry used by the profile check.

### fn `export async function runDoctor(` (L588-593)
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

### iface `export interface SetupCheck` (L699-703)
- @brief One named onboarding check result (`pass`, `fail`, or `skip`). */

### iface `export interface SetupReport` (L706-710)
- @brief JSON-serializable outcome of the `setup` command. */

### iface `export interface SetupFs` (L713-717)
- @brief Injectable filesystem surface used by `runSetup` (tests pass fakes). */

### iface `export interface SetupDeps` (L720-724)
- @brief Injectable dependencies for deterministic `runSetup` testing. */

### iface `export interface SetupOptions` (L727-731)
- @brief Inputs controlling `runSetup` behavior. */

### fn `export async function runSetup(options: SetupOptions, deps: SetupDeps = {}): Promise<SetupReport>` (L748-830)
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

### fn `export function runSnippetCommand(` (L846-848)
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

### fn `const semaphore = async (tasks: (() => Promise<void>)[], limit: number) =>` (L1148-1160)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`extractEnvFileOption`|fn||41-52|function extractEnvFileOption(argv: readonly string[]): s...|
|`loadEnvironment`|fn||67-80|function loadEnvironment(envFile: string | undefined): void|
|`ServerStartupOutcome`|iface||88-92|export interface ServerStartupOutcome|
|`startServer`|fn||109-183|export async function startServer(|
|`ShutdownExitHook`|type||186||
|`createShutdownHandler`|fn||200-214|export function createShutdownHandler(|
|`installShutdownHandlers`|fn||226-230|export function installShutdownHandlers(servers: readonly...|
|`ExecFailureResponse`|type||255||
|`ExecOutput`|iface||260-262|interface ExecOutput|
|`ExecStreams`|iface||264-267|interface ExecStreams|
|`ExecToolRunner`|type||269||
|`DoctorCheck`|type||271||
|`DoctorReport`|type||277||
|`DoctorToolRunner`|type||284||
|`isExecFailureResponse`|fn||286-293|function isExecFailureResponse(result: unknown): result i...|
|`getExecFailureMessage`|fn||295-303|function getExecFailureMessage(toolName: string, result: ...|
|`execTool`|fn||305-439|export async function execTool(toolName: string, params: ...|
|`runExecCommand`|fn||449-454|export async function runExecCommand(|
|`DoctorProbeId`|type||474||
|`DoctorLiveProbe`|iface||477-482|export interface DoctorLiveProbe|
|`DoctorProbesParseResult`|iface||514-517|export interface DoctorProbesParseResult|
|`parseDoctorProbes`|fn||529-551|export function parseDoctorProbes(raw: string | undefined...|
|`DoctorOptions`|iface||559-564|export interface DoctorOptions|
|`runDoctor`|fn||588-593|export async function runDoctor(|
|`SetupCheck`|iface||699-703|export interface SetupCheck|
|`SetupReport`|iface||706-710|export interface SetupReport|
|`SetupFs`|iface||713-717|export interface SetupFs|
|`SetupDeps`|iface||720-724|export interface SetupDeps|
|`SetupOptions`|iface||727-731|export interface SetupOptions|
|`runSetup`|fn||748-830|export async function runSetup(options: SetupOptions, dep...|
|`runSnippetCommand`|fn||846-848|export function runSnippetCommand(|
|`semaphore`|fn||1148-1160|const semaphore = async (tasks: (() => Promise<void>)[], ...|


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

