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
        ├── toolProfiles.ts
        └── upgradeManager.ts
```

# cli.ts | TypeScript | 1751L | 36 symbols | 20 imports | 56 comments
> Path: `src/cli.ts`

## Imports
```
import yargs from "yargs";
import type { Argv, BuilderArguments } from "yargs";
import { hideBin } from "yargs/helpers";
import serverConfigs, { filterTools } from "./config.js";
import { BaseMcpServer } from "./core/BaseMcpServer.js";
import { Logger } from "./index.js";
import { PlacesSearcher } from "./services/PlacesSearcher.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readFileSync, writeFileSync, existsSync, realpathSync } from "fs";
import { createInterface } from "readline";
import { checkVersionIdle, parseManagementCommand, runManagementCommand } from "./utils/upgradeManager.js";
import {
import { describeToolsProfile } from "./utils/toolProfiles.js";
import { renderClientSnippet, type SnippetClient, type SnippetOptions } from "./utils/clientSnippets.js";
import { ApiKeyManager } from "./utils/apiKeyManager.js";
import { loadCliSettings, loadConfiguredApiKey, saveCliSettings } from "./utils/cliSettings.js";
import { resolveCliTarget, supportedCliNames } from "./utils/cliTargets.js";
import {
import { buildCliShowReport } from "./utils/cliShow.js";
```

## Definitions

### iface `export interface ServerStartupOutcome` (L47-51)
- @brief Aggregated HTTP startup result across all configured server instances.
- @details `started`/`failed` count per instance; `servers` holds only the
instances that are listening, so a zero-length array with `started === 0`
is the reliable-failure signal consumed by the default command (REQ-095).

### fn `export async function startServer(` (L71-128)
- @brief Starts every configured HTTP MCP server instance and reports the outcome.
- @details Validates the requested listen port (integer 1-65535), skips the
invalid instance with remediation guidance while marking it failed
(REQ-009), awaits `startHttpServer` so listen errors are caught, installs
SIGINT/SIGTERM handlers on success (REQ-096), and returns the aggregate
outcome. The port and host are resolved by the caller from CLI flags over
the persisted settings (REQ-008, DES-015); the startup API key is injected
into `ApiKeyManager`, never into the environment (DES-006). Startup
diagnostics identify the application as `MCP Google API server`
(REQ-165). Complexity O(instances).
- @param port {number} Effective HTTP listen port (flag or persisted setting).
- @param apiKey {string | undefined} Startup API key injected into `ApiKeyManager` from the persisted settings (REQ-142).
- @param host {string} Effective HTTP bind host (flag or persisted setting; default loopback).
- @return {Promise<ServerStartupOutcome>} Per-run counts plus listening servers.
- @see installShutdownHandlers
- @satisfies REQ-008, REQ-009, REQ-096, REQ-165

- type `export type ShutdownExitHook = (code: number) => void;` (L131)
- @brief Exit hook signature used by the shutdown handler. */
### fn `export function createShutdownHandler(` (L145-159)
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

### fn `export function installShutdownHandlers(servers: readonly BaseMcpServer[]): void` (L171-175)
- @brief Registers SIGINT/SIGTERM handlers that orderly-stop the given servers.
- @details Wraps `createShutdownHandler` and attaches it to both signals so
Ctrl-C and terminate requests close all HTTP sessions and the listening
socket before process exit (REQ-096). Complexity O(1).
- @param servers {readonly BaseMcpServer[]} Listening server instances.
- @return {void}
- @see createShutdownHandler
- @satisfies REQ-096

- type `type ExecFailureResponse = {` (L200)
### iface `interface ExecOutput` (L205-207)

### iface `interface ExecStreams` (L209-212)

- type `type ExecToolRunner = (toolName: string, params: any, apiKey: string) => Promise<unknown>;` (L214)
- type `export type DoctorCheck = {` (L216)
- type `export type DoctorReport = {` (L222)
- type `type DoctorToolRunner = (toolName: string, params: any, apiKey: string) => Promise<unknown>;` (L229)
### fn `function isExecFailureResponse(result: unknown): result is ExecFailureResponse` (L231-238)

### fn `function getExecFailureMessage(toolName: string, result: ExecFailureResponse): string` (L240-248)

### fn `export async function execTool(toolName: string, params: any, apiKey: string): Promise<any>` (L250-384)

### fn `export async function runExecCommand(` (L394-399)

- type `export type DoctorProbeId = "geocoding" | "places-new" | "routes";` (L419)
- @brief Selectable live-probe identifier used by `doctor --live --probes`. */
### iface `export interface DoctorLiveProbe` (L422-427)
- @brief Static definition of one billable live probe executed by doctor. */

### iface `export interface DoctorProbesParseResult` (L459-462)
- @brief Parsed `--probes` CLI value: either valid probe ids or an error. */

### fn `export function parseDoctorProbes(raw: string | undefined): DoctorProbesParseResult` (L474-496)
- @brief Parses the raw `--probes` CLI string into validated probe ids.
- @details `undefined` input -> `{ probes: undefined }` (probe all three,
legacy `--live` behavior). Splits on commas, trims, lowercases, maps through
`DOCTOR_PROBE_ALIASES`, dedupes, and rejects unknown names or an empty list
with a remediation error. Complexity O(n) in items; pure.
- @param raw {string | undefined} Raw option value from argv.
- @return {DoctorProbesParseResult} Validated ids, or `error` describing the invalid input.
- @satisfies REQ-091

### iface `export interface DoctorOptions` (L504-509)
- @brief Injectable doctor dependencies for deterministic testing.
- @details `nodeVersion` overrides `process.versions.node`; `config` overrides
environment-derived runtime configuration; `allToolNames` overrides the
registered tool-name registry used by the profile check.

### fn `export async function runDoctor(` (L533-538)
- @brief Runs the readiness self-check decoupled from server startup.
- @details Local checks (zero network calls): Node major >=
`NODE_ENGINE_FLOOR` (24, aligned with `package.json` `engines`, REQ-070),
non-zero package version, API key presence (value hidden), effective
configuration diagnostics with masked secrets and per-field sources
(REQ-089, zero-match allowlist reported as fail), and the per-tool Google
API profile of the effective tool set (REQ-090). Live branch: without
`options.probes` runs all three probes (legacy `--live`, REQ-072); with
`options.probes` runs only the selected subset (REQ-091); each probe fails
independently. `success` is false when any check fails; the caller maps it
to the exit code.
- @param packageVersion {string} Installed package version ("0.0.0" = unknown).
- @param apiKey {string | undefined} Resolved API key; never printed.
- @param live {boolean} True to run billable live probes.
- @param runner {DoctorToolRunner} Injectable tool runner; defaults to `execTool`.
- @param options {DoctorOptions} Injectable Node version, config, tool registry, and probe subset.
- @return {Promise<DoctorReport>} JSON-serializable report with `checks` and aggregate `success`.
- @see resolveRuntimeConfig
- @see describeToolsProfile
- @satisfies REQ-070, REQ-071, REQ-072, REQ-089, REQ-090, REQ-091

### fn `export function runSnippetCommand(` (L648-650)
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

### fn `export function runEnableDisableCliCommand(` (L684-687)
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

### fn `export function runApiKeyCommand(` (L735-737)
- @brief Saves the Google Maps API key in the persisted settings and refreshes enabled-CLI registrations.
- @details Validates the key first (REQ-020 format via `ApiKeyManager`),
rejecting empty, whitespace-only, or malformed input with a human-readable
stderr error and non-zero exit before any write (REQ-137); persists the key
as the settings `apiKey` field atomically (REQ-136, DES-023); then runs the
install operation for every enabled CLI with REQ-116 and REQ-119 semantics
(REQ-138) and without the debug overlay (REQ-159). Prints a human-readable
operation report on stdout (REQ-139,
human-readable exception to PRJ-008): the configured-key confirmation with
the DES-016 masked key, then one line per processed CLI with its install
result, or the enable hint when zero CLIs are enabled.
- @param key {string | undefined} Raw key argument from the command line.
- @param options {object} `{ home?, resourcesRoot, streams? }`; streams default to process streams.
- @return {number} Exit code: 0 on success or zero enabled CLIs, 1 on validation, persistence, or install failure.
- @see loadCliSettings
- @see saveCliSettings
- @see installEnabledCliResources
- @satisfies REQ-136, REQ-137, REQ-138, REQ-139, REQ-159

### fn `export function runAutoUpdateCommand(` (L796-798)
- @brief Enables or disables the automatic update check in the persisted settings.
- @details Accepts `enable`, `disable`, `1`, `0` case-insensitively (REQ-148)
and persists the resolved boolean into the settings `autoUpdate` field
atomically before printing any result (REQ-149, DES-024). Prints a
human-readable confirmation on stdout (REQ-150, human-readable exception to
PRJ-008). A missing or non-accepted value prints a human-readable stderr
error listing the accepted values and persists nothing (REQ-151).
- @param rawState {string | undefined} Raw state argument from the command line.
- @param options {object} `{ home?, streams? }`; streams default to process streams.
- @return {number} Exit code: 0 on success, 1 on an invalid value or persistence failure.
- @see loadCliSettings
- @see saveCliSettings
- @satisfies REQ-148, REQ-149, REQ-150, REQ-151

### fn `export function runToolsCommand(` (L841-843)
- @brief Persists the enabled-tool allowlist via the `tools` command.
- @details Accepts a comma-separated tool-name list or the literal `*`
(full set). Unknown names, empty items only, or a missing value print a
human-readable stderr error listing the accepted names and exit 1 without
persisting anything (REQ-167); a valid value is persisted atomically into
the settings `enabledTools` field before the human-readable stdout
confirmation is printed. Complexity O(n + m).
- @param raw {string | undefined} Raw positional argument from the command line.
- @param options {object} `{ home?, streams? }`; streams default to process streams.
- @return {number} Exit code: 0 on success, 1 on invalid input or persistence failure.
- @see loadCliSettings
- @see saveCliSettings
- @satisfies REQ-167

### fn `export function runHostCommand(` (L898-900)
- @brief Persists the HTTP bind host via the `host` command.
- @details Rejects missing or whitespace-only values with a human-readable
stderr error, persisting nothing (REQ-168); a valid non-empty hostname is
persisted atomically into the settings `host` field before the
human-readable stdout confirmation is printed. Complexity O(1).
- @param raw {string | undefined} Raw positional argument from the command line.
- @param options {object} `{ home?, streams? }`; streams default to process streams.
- @return {number} Exit code: 0 on success, 1 on invalid input or persistence failure.
- @see loadCliSettings
- @see saveCliSettings
- @satisfies REQ-168

### fn `export function runPortCommand(` (L934-936)
- @brief Persists the HTTP listen port via the `port` command.
- @details Rejects missing or non-integer values outside 1..65535 with a
human-readable stderr error, persisting nothing (REQ-169); a valid port is
persisted atomically into the settings `port` field before the
human-readable stdout confirmation is printed. Complexity O(1).
- @param raw {string | undefined} Raw positional argument from the command line.
- @param options {object} `{ home?, streams? }`; streams default to process streams.
- @return {number} Exit code: 0 on success, 1 on invalid input or persistence failure.
- @see loadCliSettings
- @see saveCliSettings
- @satisfies REQ-169

### fn `export function runInstallUninstallCommand(` (L976-978)
- @brief Shared handler for the `install` and `uninstall` commands.
- @details Runs the requested operation over every enabled CLI and prints a
human-readable per-CLI activity report on stdout (REQ-166): one header
line `mcp-google-api <operation> report:`, one indented line per processed
CLI stating the server registration and installed/removed skill count, and
an `Errors:` block listing every collected diagnostic; exits 1 when any
per-CLI failure was collected (REQ-116). With zero enabled CLIs prints the
enable hint and exits 0 (REQ-119). `install` forwards `includeDebugSkills`
so each skill's declared debug overlay is appended to the installed
`SKILL.md` only when REQ-154 `--debug-skills` is requested.
- @param operation {"install" | "uninstall"} Requested reciprocal operation.
- @param options {object} `{ home?, resourcesRoot, includeDebugSkills?, streams? }`.
- @return {number} Exit code: 0 on success or zero enabled CLIs, 1 on failures.
- @see installEnabledCliResources
- @see uninstallEnabledCliResources
- @satisfies REQ-114, REQ-115, REQ-116, REQ-119, REQ-154, REQ-155, REQ-156, REQ-166

### fn `export function runShowCommand(` (L1026-1027)
- @brief Prints the CLI Configuration and Installation Status tables.
- @details Delegates rendering to `buildCliShowReport` and writes the report
text to stdout (human-readable exception to PRJ-008). Manifest or render
failures surface as a JSON stderr error with exit code 1.
- @param options {object} `{ home?, resourcesRoot, streams? }`.
- @return {number} Exit code: 0 on success, 1 on a report failure.
- @see buildCliShowReport
- @satisfies REQ-117, REQ-118, REQ-119

### fn `function isEntryMainModule(): boolean` (L1063-1073)
- @brief Detects whether this module is the process main module.
- @details Compares the REAL paths of both sides after symlink resolution:
`realpathSync(process.argv[1])` versus the real path of this module
derived from `import.meta.url`. Node resolves the main module through
symlinks (preserve-symlinks off), so `import.meta.url` carries the real
path while `process.argv[1]` keeps the invocation path; resolving BOTH
sides makes every symlinked launcher (npm global `bin/` links, `_npx`
`.bin` shims, user aliases, renamed distribution bins) match regardless
of the launcher basename. The previous string-concatenated comparison
`import.meta.url === `file://${process.argv[1]}`` was false for every
symlinked launch, silently skipping the whole CLI dispatch (exit 0 with
no output; MCP stdio clients report "MCP connection closed"). Returns
false when `process.argv[1]` is missing, empty, or not an existing path
(plain module import, REPL); never throws. Complexity O(1) filesystem
metadata lookups; no side effects.
- @return {boolean} True when this module was launched as the main module.
- @satisfies PRJ-003

### fn `const buildServerCommandOptions = (yargs: Argv) =>` (L1120-1145)
- @brief Applies the shared server-start options to a yargs builder.
- @details Declares `--port`, `--host`, and `--stdio` with defaults taken
from the persisted settings (DES-015) plus the server-mode examples.
Shared verbatim by the `start` and `run` commands so both expose an
identical option surface (PRJ-003). Complexity O(1).
- @param yargs {Argv} Builder of the command being configured.
- @return {Argv} The same builder instance with the typed server options attached.
- @satisfies REQ-079, REQ-008

- type `type ServerCommandArgs = BuilderArguments<typeof buildServerCommandOptions>;` (L1148)
### fn `const runServerCommand = async (argv: ServerCommandArgs): Promise<void> =>` (L1167-1226)
- @brief Server-start handler shared by the `start` and `run` commands.
- @details Resolves the effective API key exclusively from the persisted
settings key (REQ-142) and injects it into `ApiKeyManager` (DES-006);
fires the idle-gated automatic update check fire-and-forget only when
the persisted `autoUpdate` setting enables it (REQ-082, REQ-083,
DES-024; never blocks startup), then starts stdio mode when `--stdio`
is passed — exiting 1 with a stderr JSON error naming the `api-key`
command when no key resolves (REQ-143) — otherwise HTTP mode via
`startServer` with the flag-or-settings host and port (REQ-008),
exiting 1 when zero instances listen (REQ-095). The HTTP banner
identifies the application as `MCP Google API server` (REQ-165).
HTTP mode without an API key logs a warning and still starts (REQ-080).
- @param argv {ServerCommandArgs} Parsed options: `--port`, `--host`, `--stdio`.
- @return {Promise<void>} Resolves when stdio mode stops; HTTP mode persists.
- @satisfies REQ-079, REQ-080, REQ-082, REQ-095, REQ-142, REQ-143, REQ-165

### fn `const semaphore = async (tasks: (() => Promise<void>)[], limit: number) =>` (L1670-1682)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`ServerStartupOutcome`|iface||47-51|export interface ServerStartupOutcome|
|`startServer`|fn||71-128|export async function startServer(|
|`ShutdownExitHook`|type||131||
|`createShutdownHandler`|fn||145-159|export function createShutdownHandler(|
|`installShutdownHandlers`|fn||171-175|export function installShutdownHandlers(servers: readonly...|
|`ExecFailureResponse`|type||200||
|`ExecOutput`|iface||205-207|interface ExecOutput|
|`ExecStreams`|iface||209-212|interface ExecStreams|
|`ExecToolRunner`|type||214||
|`DoctorCheck`|type||216||
|`DoctorReport`|type||222||
|`DoctorToolRunner`|type||229||
|`isExecFailureResponse`|fn||231-238|function isExecFailureResponse(result: unknown): result i...|
|`getExecFailureMessage`|fn||240-248|function getExecFailureMessage(toolName: string, result: ...|
|`execTool`|fn||250-384|export async function execTool(toolName: string, params: ...|
|`runExecCommand`|fn||394-399|export async function runExecCommand(|
|`DoctorProbeId`|type||419||
|`DoctorLiveProbe`|iface||422-427|export interface DoctorLiveProbe|
|`DoctorProbesParseResult`|iface||459-462|export interface DoctorProbesParseResult|
|`parseDoctorProbes`|fn||474-496|export function parseDoctorProbes(raw: string | undefined...|
|`DoctorOptions`|iface||504-509|export interface DoctorOptions|
|`runDoctor`|fn||533-538|export async function runDoctor(|
|`runSnippetCommand`|fn||648-650|export function runSnippetCommand(|
|`runEnableDisableCliCommand`|fn||684-687|export function runEnableDisableCliCommand(|
|`runApiKeyCommand`|fn||735-737|export function runApiKeyCommand(|
|`runAutoUpdateCommand`|fn||796-798|export function runAutoUpdateCommand(|
|`runToolsCommand`|fn||841-843|export function runToolsCommand(|
|`runHostCommand`|fn||898-900|export function runHostCommand(|
|`runPortCommand`|fn||934-936|export function runPortCommand(|
|`runInstallUninstallCommand`|fn||976-978|export function runInstallUninstallCommand(|
|`runShowCommand`|fn||1026-1027|export function runShowCommand(|
|`isEntryMainModule`|fn||1063-1073|function isEntryMainModule(): boolean|
|`buildServerCommandOptions`|fn||1120-1145|const buildServerCommandOptions = (yargs: Argv) =>|
|`ServerCommandArgs`|type||1148||
|`runServerCommand`|fn||1167-1226|const runServerCommand = async (argv: ServerCommandArgs):...|
|`semaphore`|fn||1670-1682|const semaphore = async (tasks: (() => Promise<void>)[], ...|


---

# config.ts | TypeScript | 206L | 2 symbols | 22 imports | 3 comments
> Path: `src/config.ts`

## Imports
```
import { resolveEnabledToolNames } from "./utils/configResolver.js";
import { loadCliSettings } from "./utils/cliSettings.js";
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

### iface `interface ServerInstanceConfig` (L34-37)

### fn `export function filterTools(tools: ToolConfig[], raw: string | undefined = loadCliSettings().enabledTools): ToolConfig[]` (L187-204)
- @brief Applies the persisted `enabledTools` allowlist to a tool registry.
- @details Delegates allowlist semantics to `resolveEnabledToolNames` (unset,
empty, or `*` -> full set; >=1 match -> subset; 0 matches -> full set plus
stderr error). The raw allowlist defaults to the persisted settings
`enabledTools` field (DES-015, REQ-167); callers may pass an explicit
value for testing. Logs the active-count line only when a strict subset is
selected, preserving legacy output. Complexity O(n + m).
- @param tools {ToolConfig[]} Full tool registry.
- @param raw {string | undefined} Raw allowlist string; defaults to the persisted settings value.
- @return {ToolConfig[]} Effective tool list (never empty for a non-empty input).
- @see resolveEnabledToolNames
- @satisfies PRJ-006, REQ-010, REQ-011, REQ-012

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`ServerInstanceConfig`|iface||34-37|interface ServerInstanceConfig|
|`filterTools`|fn||187-204|export function filterTools(tools: ToolConfig[], raw: str...|


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

# NewPlacesService.ts | TypeScript | 661L | 3 symbols | 2 imports | 31 comments
> Path: `src/services/NewPlacesService.ts`

## Imports
```
import { PlacesClient } from "@googlemaps/places";
import { Logger } from "../index.js";
```

## Definitions

### class `export class NewPlacesService` (L4-303)

### fn `const toDayNumber = (value: any): number | undefined =>` (L562-573)

### fn `const toMinutes = (time: any): number | undefined =>` (L575-588)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`NewPlacesService`|class||4-303|export class NewPlacesService|
|`toDayNumber`|fn||562-573|const toDayNumber = (value: any): number | undefined =>|
|`toMinutes`|fn||575-588|const toMinutes = (time: any): number | undefined =>|


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

# RoutesService.ts | TypeScript | 386L | 9 symbols | 1 imports | 21 comments
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

### class `export class RoutesService` (L140-386)

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
|`RoutesService`|class||140-386|export class RoutesService|


---

# toolclass.ts | TypeScript | 528L | 3 symbols | 3 imports | 12 comments
> Path: `src/services/toolclass.ts`

## Imports
```
import { Client, Language } from "@googlemaps/google-maps-services-js";
import { Logger } from "../index.js";
import { RoutesService } from "./RoutesService.js";
```

## Definitions

### iface `interface GeocodeResult` (L5-10)

### fn `function extractErrorMessage(error: any): string` (L15-47)

### class `export class GoogleMapsTools` (L49-348)

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`GeocodeResult`|iface||5-10|interface GeocodeResult|
|`extractErrorMessage`|fn||15-47|function extractErrorMessage(error: any): string|
|`GoogleMapsTools`|class||49-348|export class GoogleMapsTools|


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

# apiKeyManager.ts | TypeScript | 108L | 1 symbols | 1 imports | 13 comments
> Path: `src/utils/apiKeyManager.ts`

## Imports
```
import { Request } from "express";
```

## Definitions

### class `export class ApiKeyManager` (L13-108)
- @brief Singleton resolver of the effective API key for each request.
- @details Resolution priority (`getApiKey`): `X-Google-Maps-API-Key` header,
then `Authorization: Bearer` token, then session key, then the startup
default key injected via `setDefaultApiKey` (DES-005). The default key is
configured exclusively from the persisted settings by the server-start path
(REQ-142); no environment variable is consulted or written (CTN-002,
DES-006).
- @satisfies DES-005, DES-006, REQ-016, REQ-017, REQ-018, REQ-019, REQ-020

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`ApiKeyManager`|class||13-108|export class ApiKeyManager|


---

# autoUpdate.ts | TypeScript | 347L | 13 symbols | 1 imports | 32 comments
> Path: `src/utils/autoUpdate.ts`

## Imports
```
import { Logger } from "../index.js";
```

## Definitions

### iface `export interface AutoUpdateLogger` (L36-41)
- @brief Minimal logger contract consumed by the update check.
- @details Structural subset of `Logger` (`src/index.ts`); injectable so tests
capture diagnostics without touching stderr.
- @param args {unknown[]} Diagnostic fragments joined for stderr output.
- @param args {unknown[]} Error diagnostic fragments for stderr output.

### iface `export interface AutoUpdateCheckerDeps` (L50-65)
- @brief Dependency injection surface of `checkForUpdates`.
- @details Every field is optional; omitted fields resolve to production
defaults (global `fetch`, `Logger`; no environment input is consulted by
default, REQ-083). Injection exists to keep unit tests deterministic and
network-free (TST-011).

### iface `export interface AutoUpdateResult` (L68-73)

- type `export type LatestVersionProbe =` (L82)
- @brief Discriminated outcome of one registry probe without side effects.
- @details Logging-free core result consumed by `checkForUpdates` (legacy
notice contract, TST-011) and by the idle-gated `checkVersionIdle` wrapper
(`src/utils/upgradeManager.ts`) which needs to distinguish "registry
reached, no newer version" from failure paths to pick its idle window.
### fn `export async function probeLatestVersion(` (L107-108)
- @brief Probes the npm registry for the latest published package version.
- @details Logging-free resolution order: disable-injection short-circuit
(only when an explicit `deps.env` disable map is supplied; production
supplies none, so the effective gate is the persisted settings field,
REQ-083, DES-024; zero network calls) -> running-version guard (missing
`currentVersion` ->
`unknown-version`, zero network calls) -> single
`GET {registry}/{package}/latest` with `timeoutMs` deadline ->
`response.ok` and `payload.version` validation -> `isNewerVersion` gate.
Every failure is returned as `{ status: "error", message }`; never throws.
- @param deps {AutoUpdateCheckerDeps} Optional dependency overrides; production defaults when omitted.
- @return {Promise<LatestVersionProbe>} Discriminated probe outcome; `message` carries the final diagnostic text without logging.
- @note Complexity: O(k) in version segments plus one HTTP round-trip bounded by `timeoutMs`.
- @see isNewerVersion
- @see checkForUpdates
- @satisfies REQ-082, REQ-083

### fn `export function isAutoUpdateDisabled(` (L163-168)
- @brief Evaluates an explicitly injected disable map for the automatic update check.
- @details Reads `AUTO_UPDATE_DISABLED_ENV` from the given map and matches
values `1`, `true`, `yes` case-insensitively after trimming; any other
value (including unset, empty, `0`, `false`) keeps the check enabled.
Injection seam only: production call sites never pass a map, so the
effective disable decision is the persisted settings `autoUpdate` field
(REQ-083, DES-024).
- @param env {Record<string, string | undefined>} Explicitly injected map; tests supply it, production MUST NOT.
- @return {boolean} True when the update check is disabled; false when enabled.
- @note Complexity: O(1). Pure; no side effects.
- @satisfies REQ-083

### fn `export function isNewerVersion(candidate: string, current: string): boolean` (L182-205)
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

### fn `const toSegments = (version: string): number[] =>` (L183-195)

### fn `export async function checkForUpdates(` (L224-225)
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

### iface `export interface GitHubProbeDeps` (L265-272)
- @brief Dependency injection surface of `probeLatestGitHubVersion`.
- @details Every field is optional; omitted fields resolve to production
defaults (global `fetch`, `DEFAULT_GITHUB_RELEASES_API_URL`,
`DEFAULT_UPDATE_CHECK_TIMEOUT_MS`). Injection keeps unit tests
deterministic and network-free.

- type `export type GitHubLatestVersionProbe =` (L280)
- @brief Discriminated outcome of one GitHub latest-release probe without side effects.
- @details Logging-free core result consumed by the `--ver`/`--version`
command (`runVersionCommand`, `src/utils/upgradeManager.ts`), which maps
`error` to the `unknown` placeholder (REQ-164).
### fn `function stripReleaseTagPrefix(tag: string): string` (L292-294)
- @brief Strips the release-tag prefix from a GitHub release tag.
- @details Trims surrounding whitespace, removes one leading `v`/`V`, and
returns the remaining text.
- @param tag {string} Raw `tag_name` value from the GitHub releases API.
- @return {string} Version text without the leading `v`; possibly empty.
- @note Complexity: O(n) in tag length. Pure; no side effects.

### fn `export async function probeLatestGitHubVersion(` (L311-312)
- @brief Probes the GitHub releases API for the latest published release version.
- @details Logging-free resolution order: single `GET {releasesUrl}` with the
`timeoutMs` deadline and the GitHub-mandatory `user-agent` header ->
`response.ok` validation -> `payload.tag_name` validation -> leading `v`
prefix strip. Never consults the idle cache and never gates on the
persisted settings `autoUpdate` field: callers own the manual-command
context (REQ-161). Every failure (non-OK status, malformed payload,
network error) is returned as `{ status: "error", message }`; never throws.
- @param deps {GitHubProbeDeps} Optional dependency overrides; production defaults when omitted.
- @return {Promise<GitHubLatestVersionProbe>} `ok` with the stripped version text, or `error` with the diagnostic message.
- @note Complexity: O(n) in tag length plus one HTTP round-trip bounded by `timeoutMs`.
- @see probeLatestVersion
- @satisfies REQ-161, REQ-163

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`AutoUpdateLogger`|iface||36-41|export interface AutoUpdateLogger|
|`AutoUpdateCheckerDeps`|iface||50-65|export interface AutoUpdateCheckerDeps|
|`AutoUpdateResult`|iface||68-73|export interface AutoUpdateResult|
|`LatestVersionProbe`|type||82||
|`probeLatestVersion`|fn||107-108|export async function probeLatestVersion(|
|`isAutoUpdateDisabled`|fn||163-168|export function isAutoUpdateDisabled(|
|`isNewerVersion`|fn||182-205|export function isNewerVersion(candidate: string, current...|
|`toSegments`|fn||183-195|const toSegments = (version: string): number[] =>|
|`checkForUpdates`|fn||224-225|export async function checkForUpdates(|
|`GitHubProbeDeps`|iface||265-272|export interface GitHubProbeDeps|
|`GitHubLatestVersionProbe`|type||280||
|`stripReleaseTagPrefix`|fn||292-294|function stripReleaseTagPrefix(tag: string): string|
|`probeLatestGitHubVersion`|fn||311-312|export async function probeLatestGitHubVersion(|


---

# cliInstaller.ts | TypeScript | 246L | 9 symbols | 4 imports | 10 comments
> Path: `src/utils/cliInstaller.ts`
- @brief Orchestrate MCP-server registration and skill installation for enabled CLIs.
- @details Loads the enabled-CLI settings, reads the packaged skills
manifest, and for each enabled CLI registers the stdio `mcp-google-api`
entry in that CLI's MCP configuration plus synchronizes every manifest
skill into that CLI's skills directory. Uninstallation is the exact
reciprocal operation. Per-CLI failures are collected without stopping the
remaining CLIs. Each manifest skill MAY declare a debug overlay file that
is installed only when debug skills are requested.
- @satisfies PRJ-015, DES-020, REQ-114, REQ-115, REQ-116, REQ-152, REQ-155, REQ-156

## Imports
```
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadCliSettings, MCP_SERVER_NAME } from "./cliSettings.js";
import {
```

## Definitions

### iface `export interface ManifestSkill` (L33-40)
- @brief One manifest skill entry from `src/resources/skills/manifest.json`.
- @details `id` names the packaged `<id>/` directory holding `SKILL.md`;
`debugPath` is the optional debug overlay path relative to that directory
(REQ-152).
- @satisfies REQ-152

### iface `export interface CliOperationSummary` (L47-51)
- @brief Per-CLI outcome of one install or uninstall run.
- @details `server` counts the MCP registration (0 or 1); `skills` counts
processed manifest skills for that CLI.

### iface `export interface CliOperationResult` (L57-60)
- @brief Aggregate outcome of one install or uninstall run.
- @details Both lists are empty when no CLI is enabled (REQ-116, REQ-119).

### fn `export function buildServerRegistration(): { command: string; args: string[] }` (L71-73)
- @brief Build the stdio MCP-server registration entry.
- @details Launcher `npx -y mcp-google-api start --stdio` with no `env`
payload: the registered server resolves its API key from its own
configuration file at startup (REQ-142), so CLI registrations never embed
keys or environment setup (REQ-114).
- @return {object} Registration entry consumed by every supported CLI.
- @satisfies REQ-114

### fn `export function resolveSkillsResourcesRoot(packageRoot: string): string` (L84-90)
- @brief Resolve the packaged skills root for the running installation.
- @details Checks `<packageRoot>/src/resources/skills` — the layout used
both by from-source runs and by the published npm package, which ships the
same subtree (PKG-024).
- @param packageRoot {string} Package installation root.
- @return {string} Absolute skills resources root.
- @throws {Error} When the skills root directory is missing.

### fn `export function loadSkillsManifest(resourcesRoot: string): ManifestSkill[]` (L103-143)
- @brief Load and validate the packaged skills manifest.
- @details Validates each entry's `id`, `path`, and optional `debug` overlay;
the overlay path is resolved relative to the skill directory. Malformed
overlay declarations and missing referenced files fail the whole manifest.
- @param resourcesRoot {string} Skills resources root directory.
- @return {ManifestSkill[]} Manifest entries in file order.
- @throws {Error} When the manifest is missing, malformed, or lists a missing
`SKILL.md` or debug overlay path.
- @satisfies REQ-152

### fn `export function resolveSkillContentLayout(skill: ManifestSkill, includeDebug: boolean): SkillContentLayout` (L155-160)
- @brief Build the install layout of one manifest skill.
- @details Resolves the declared debug overlay and whether its content must be
appended to the installed `SKILL.md` (REQ-155, REQ-156). Skills without a
declared overlay always resolve to the empty layout.
- @param skill {ManifestSkill} Manifest skill entry.
- @param includeDebug {boolean} True when `--debug-skills` was requested.
- @return {SkillContentLayout} Layout consumed by `syncSkillTree`.
- @satisfies REQ-155, REQ-156, REQ-157

### fn `export function installEnabledCliResources(options:` (L177-208)
- @brief Install the MCP server entry and every manifest skill per enabled CLI.
- @details For each enabled CLI in settings order: registers the stdio entry
via `applyServerRegistration` (no key or environment payload; the server
reads its configuration file at startup, REQ-142), then synchronizes each
manifest skill directory `<resourcesRoot>/<skill-id>` into
`<skillsDir>/<skill-id>` with the resolved content layout: the declared
debug overlay is excluded as a standalone file and appended to the installed
`SKILL.md` only when `includeDebugSkills` is true.
Failures are collected per CLI and remaining CLIs still run.
- @param options {object} `{ home?, resourcesRoot, includeDebugSkills? }`.
- @return {CliOperationResult} Per-CLI summaries and failure diagnostics.
- @throws {Error} When the skills manifest cannot be loaded (all CLIs fail).
- @satisfies REQ-114, REQ-116, REQ-155, REQ-156, REQ-157

### fn `export function uninstallEnabledCliResources(options:` (L221-246)
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
|`ManifestSkill`|iface||33-40|export interface ManifestSkill|
|`CliOperationSummary`|iface||47-51|export interface CliOperationSummary|
|`CliOperationResult`|iface||57-60|export interface CliOperationResult|
|`buildServerRegistration`|fn||71-73|export function buildServerRegistration(): { command: str...|
|`resolveSkillsResourcesRoot`|fn||84-90|export function resolveSkillsResourcesRoot(packageRoot: s...|
|`loadSkillsManifest`|fn||103-143|export function loadSkillsManifest(resourcesRoot: string)...|
|`resolveSkillContentLayout`|fn||155-160|export function resolveSkillContentLayout(skill: Manifest...|
|`installEnabledCliResources`|fn||177-208|export function installEnabledCliResources(options:|
|`uninstallEnabledCliResources`|fn||221-246|export function uninstallEnabledCliResources(options:|


---

# cliSettings.ts | TypeScript | 295L | 11 symbols | 2 imports | 19 comments
> Path: `src/utils/cliSettings.ts`
- @brief Persist the program configuration file for the CLI configuration-management commands.
- @details Stores `{"enabled": ["<cli>", ...], "apiKey": "<key>", "autoUpdate": true, "enabledTools": "*", "host": "127.0.0.1", "port": 3000}` at
`<home>/.config/<SETTINGS_PROGRAM_NAME>/config.json`. The settings directory
segment is the distribution program name `mcp-google-api` (DES-021):
program-owned, never a shared or generic directory such as `skills`.
Loading tolerates missing, unreadable, non-object, or malformed content by
returning normalized defaults; saving serializes with two-space
indentation plus a trailing newline, writes a sibling temporary file,
and replaces the target atomically.
- @satisfies DES-018, DES-021, DES-023, DES-024, REQ-167, REQ-168, REQ-169

## Imports
```
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
```

## Definitions

### iface `export interface CliSettings` (L89-96)
- @brief Program configuration shape loaded at bootstrap and persisted by the configuration commands.
- @details `enabled` lists canonical CLI names in persistence order; `apiKey`
is the Google Maps API key (DES-023) and defaults to the empty string;
`autoUpdate` gates the automatic update check (DES-024) and defaults to
true; `enabledTools` is the tool allowlist (`*` = full set, REQ-167);
`host` is the HTTP bind address (REQ-168); `port` is the HTTP port
(REQ-169). The configuration file is the only configuration source
(CTN-002, DES-015, REQ-083, REQ-142).
- @satisfies DES-018, DES-023, DES-024, REQ-167, REQ-168, REQ-169

### fn `export function resolveCliSettingsPath(home?: string): string` (L107-110)
- @brief Resolve the user settings file path for a home root.
- @details Joins the effective home directory with
`.config/<SETTINGS_PROGRAM_NAME>/config.json` — the program-owned path
derived from the distribution name, never a shared directory (DES-021).
- @param home {string | undefined} Home-directory override; defaults to `os.homedir()`.
- @return {string} Absolute settings file path.
- @satisfies DES-018, DES-021

### fn `function normalizeEnabledTools(value: unknown): string` (L120-126)
- @brief Normalize an arbitrary parsed `enabledTools` value.
- @details Accepts only strings; trims surrounding whitespace; collapses an
empty result to the `"*"` full-set default so hand-edited files never
disable every tool by omission (DES-018, REQ-167). Pure; complexity O(n).
- @param value {unknown} Candidate JSON value.
- @return {string} Normalized allowlist string.

### fn `function normalizeHost(value: unknown): string` (L136-142)
- @brief Normalize an arbitrary parsed `host` value.
- @details Accepts only non-empty strings after trimming; any other value
(missing, empty, non-string) yields the loopback default (DES-018,
REQ-168). Pure; complexity O(n).
- @param value {unknown} Candidate JSON value.
- @return {string} Normalized bind hostname.

### fn `function normalizePort(value: unknown): number` (L152-157)
- @brief Normalize an arbitrary parsed `port` value.
- @details Accepts finite integers in 1..65535; any other value (missing,
fractional, out-of-range, non-number) yields the default port 3000
(DES-018, REQ-169). Pure; complexity O(1).
- @param value {unknown} Candidate JSON value.
- @return {number} Normalized HTTP port.

### fn `function defaultSettings(): CliSettings` (L165-174)
- @brief Build the normalized default configuration.
- @details Single source of the load-time defaults shared by every error and
miss path of `loadCliSettings` (DES-018). Complexity O(1); pure.
- @return {CliSettings} Default settings object.

### fn `export function isUnsetApiKey(value: string | undefined | null): boolean` (L187-194)
- @brief Classify a candidate API key value as unset.
- @details True for undefined/null, empty or whitespace-only strings, and the
literal `INSTALL_API_KEY_PLACEHOLDER` marker, so placeholder-bearing client
configurations never count as a configured key (REQ-142). Pure;
complexity O(1).
- @param value {string | undefined | null} Candidate key from the settings file or another injection source.
- @return {boolean} True when the value must be treated as no key.
- @see INSTALL_API_KEY_PLACEHOLDER
- @satisfies REQ-142

### fn `function uniqueStrings(value: unknown): string[]` (L201-210)
- @brief Normalize an arbitrary parsed value into unique non-empty strings.
- @param value {unknown} Candidate JSON value.
- @return {string[]} Unique strings in first-seen order; empty for non-lists.

### fn `export function loadCliSettings(home?: string): CliSettings` (L224-242)
- @brief Load the program configuration with normalized defaults.
- @details Reads JSON from `resolveCliSettingsPath`; missing, unreadable,
malformed, or non-object content yields the normalized defaults. `apiKey`
is accepted only as a string, defaulting to the empty string
(DES-023); `autoUpdate` is accepted only as a boolean, defaulting to true
(DES-024); `enabledTools`, `host`, and `port` are normalized per their
dedicated helpers (REQ-167, REQ-168, REQ-169). Never throws.
- @param home {string | undefined} Home-directory override.
- @return {CliSettings} Normalized configuration object.
- @satisfies DES-018, DES-021, DES-023, DES-024, REQ-167, REQ-168, REQ-169

### fn `export function loadConfiguredApiKey(home?: string): string | undefined` (L254-257)
- @brief Load the user-configured API key from the persisted configuration.
- @details Reads `loadCliSettings().apiKey` and normalizes placeholder and
empty values to undefined so callers receive only a usable key (DES-023,
REQ-142). Tolerates any malformed configuration content by delegation.
- @param home {string | undefined} Home-directory override.
- @return {string | undefined} Configured key; undefined when unset or placeholder.
- @see isUnsetApiKey
- @satisfies DES-023, REQ-142

### fn `export function saveCliSettings(settings: CliSettings, home?: string): string` (L276-295)
- @brief Persist the program configuration to the configuration file atomically.
- @details Creates parent directories, serializes `enabled`, `apiKey`
(DES-023, empty string when unset), `autoUpdate` (DES-024), and the
`enabledTools`/`host`/`port` fields (REQ-167, REQ-168, REQ-169) with
two-space indentation and a trailing newline, writes
`<file>.tmp`, then renames over the target so readers never observe a
partial file. Target path is the program-owned
`.config/<SETTINGS_PROGRAM_NAME>/config.json` (DES-021).
- @param settings {CliSettings} Settings object to persist.
- @param home {string | undefined} Home-directory override.
- @return {string} Written settings file path.
- @throws {Error} With descriptive message when directory creation, writing,
or replacement fails; the temporary file is best-effort removed.
- @satisfies DES-018, DES-021, DES-023, DES-024, REQ-167, REQ-168, REQ-169
- @post The configuration file contains the serialized `settings` object.

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`CliSettings`|iface||89-96|export interface CliSettings|
|`resolveCliSettingsPath`|fn||107-110|export function resolveCliSettingsPath(home?: string): st...|
|`normalizeEnabledTools`|fn||120-126|function normalizeEnabledTools(value: unknown): string|
|`normalizeHost`|fn||136-142|function normalizeHost(value: unknown): string|
|`normalizePort`|fn||152-157|function normalizePort(value: unknown): number|
|`defaultSettings`|fn||165-174|function defaultSettings(): CliSettings|
|`isUnsetApiKey`|fn||187-194|export function isUnsetApiKey(value: string | undefined |...|
|`uniqueStrings`|fn||201-210|function uniqueStrings(value: unknown): string[]|
|`loadCliSettings`|fn||224-242|export function loadCliSettings(home?: string): CliSettings|
|`loadConfiguredApiKey`|fn||254-257|export function loadConfiguredApiKey(home?: string): stri...|
|`saveCliSettings`|fn||276-295|export function saveCliSettings(settings: CliSettings, ho...|


---

# cliShow.ts | TypeScript | 186L | 6 symbols | 5 imports | 10 comments
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

### fn `function buildInstallRows(home: string | undefined, resourcesRoot: string): string[][]` (L136-163)
- @brief Build the Installation Status table rows.
- @details Emits rows only for enabled CLIs: one `Server` row for the
managed `mcp-google-api` entry plus one `Skill` row per manifest skill,
each with OK / MISSING / STALE detection. Skill comparison accepts both
the plain and the debug-overlay-extended installed `SKILL.md` (REQ-158).
- @param home {string | undefined} Home-directory override.
- @param resourcesRoot {string} Packaged skills resources root.
- @return {string[][]} `(Type, Name, CLI, Enabled, Installed)` rows.
- @satisfies REQ-118, REQ-158

### fn `export function buildCliShowReport(options: { home?: string; resourcesRoot: string }): string` (L176-184)
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
|`buildInstallRows`|fn||136-163|function buildInstallRows(home: string | undefined, resou...|
|`buildCliShowReport`|fn||176-184|export function buildCliShowReport(options: { home?: stri...|


---

# cliTargets.ts | TypeScript | 581L | 28 symbols | 2 imports | 35 comments
> Path: `src/utils/cliTargets.ts`
- @brief Provide per-CLI MCP-configuration and skills-destination adapters.
- @details Defines one adapter for each supported CLI agent (`pi`,
`openclaw`, `codex`, `antigravity`, `claude`) resolving the MCP
configuration file and the skills destination directory from an injectable
home root. MCP registration applies read-modify-write: JSON targets merge
the `mcpServers["mcp-google-api"]` entry preserving every unrelated key;
the TOML target (codex) appends or removes the `[mcp_servers.<name>]`
table without touching other tables. Skill synchronization copies packaged
skill content with overwrite and prunes stale files inside managed
skill directories only, preserving unmanaged destination entries; a skill's
declared debug overlay is excluded as a standalone file and is appended to
the installed `SKILL.md` only when debug skills are requested. Paths
adopted from the reference `skills` installer targets.
- @satisfies DES-017, DES-019, DES-020, REQ-110, REQ-112, REQ-113, REQ-155, REQ-156, REQ-157, REQ-158

## Imports
```
import {
import { join, relative, resolve } from "node:path";
```

## Definitions

- type `export type CliTargetId = "pi" | "openclaw" | "codex" | "antigravity" | "claude";` (L37)
- @brief Canonical identifiers of the supported CLI agents.
- @details Registry order: pi, openclaw, codex, antigravity, claude.
### iface `export interface McpServerRegistration` (L43-47)
- @brief MCP-server registration entry written into CLI configurations.
- @details stdio launcher shape consumed by every supported CLI agent.

- type `export type CliConfigFormat = "json" | "toml";` (L54)
- @brief Configuration format of one CLI's MCP configuration file.
- @details `json` targets expose a `mcpServers` object map; `toml` targets
expose `mcp_servers` tables (codex `config.toml`).
### iface `export interface CliTarget` (L61-66)
- @brief Adapter describing one supported CLI installation target.
- @details Pure path/format descriptor; all operations are module functions
parameterized by the adapter so each CLI stays data-driven.

### fn `function homeRoot(home?: string): string` (L69-71)
- @brief Resolve the effective home root. */

### fn `export function resolveCliTarget(name: string): CliTarget | undefined` (L136-138)
- @brief Resolve a CLI adapter by user-supplied name.
- @details Trims surrounding whitespace and lowercases before the registry
lookup, matching `pi`, `openclaw`, `codex`, `antigravity`, `claude`
case-insensitively.
- @param name {string} CLI name from the command line.
- @return {CliTarget | undefined} Matching adapter; undefined when unsupported.
- @satisfies REQ-110

### fn `export function supportedCliNames(): string` (L145-147)
- @brief Comma-separated list of supported CLI names for diagnostics.
- @return {string} Ordered `pi, openclaw, codex, antigravity, claude`.
- @satisfies REQ-110

### fn `function readJsonConfig(configPath: string): Record<string, unknown>` (L157-164)
- @brief Read and parse a JSON MCP configuration file.
- @details Missing files yield `{}`; malformed JSON throws so the caller can
fail that CLI without ever overwriting the user's file.
- @param configPath {string} Target configuration file path.
- @return {Record<string, unknown>} Parsed JSON object.
- @throws {Error} When the file exists but is not valid JSON.

### fn `function writeJsonConfig(configPath: string, value: Record<string, unknown>): void` (L176-181)
- @brief Serialize and atomically write a JSON object to a file.
- @details Two-space indentation, trailing newline, sibling `.tmp` write
followed by rename; parent directories are created on demand.
- @param configPath {string} Target file path.
- @param value {Record<string, unknown>} Object to serialize.
- @return {void}
- @throws {Error} When serialization, writing, or renaming fails.
- @satisfies DES-019

### fn `export function writeJsonMcpServerEntry(` (L195-208)
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

### fn `export function removeJsonMcpServerEntry(configPath: string, serverName: string): boolean` (L221-235)
- @brief Remove an MCP-server entry from a JSON `mcpServers` configuration.
- @details Deletes `mcpServers.<serverName>` when present and rewrites the
file atomically; an empty `mcpServers` object is kept to minimize
disruption. Missing files are a successful no-op.
- @param configPath {string} JSON configuration file path.
- @param serverName {string} Server key inside `mcpServers`.
- @return {boolean} True when an entry was removed; false when absent.
- @throws {Error} When the existing file is malformed or the write fails.
- @satisfies DES-019, REQ-115

### fn `export function readJsonMcpServerEntry(` (L243-257)
- @brief Read one MCP-server entry from a JSON configuration.
- @param configPath {string} JSON configuration file path.
- @param serverName {string} Server key inside `mcpServers`.
- @return {McpServerRegistration | undefined} Entry when registered; undefined otherwise.

### fn `function tomlString(value: string): string` (L265-267)
- @brief Escape a value as a TOML basic string.
- @details Escapes backslash and double-quote characters.
- @param value {string} Raw string value.
- @return {string} Quoted TOML basic string.

### fn `function tomlSectionHeader(serverName: string): string` (L274-276)
- @brief Header line of one managed server's TOML table.
- @param serverName {string} Server key inside `mcp_servers`.
- @return {string} Exact `[mcp_servers.<serverName>]` header line.

### fn `function removeTomlSection(content: string, serverName: string): string` (L287-312)
- @brief Remove one managed server's TOML table from raw content.
- @details Deletes the `[mcp_servers.<name>]` header line plus its body up to
the next top-level `[` table header or EOF, collapsing the resulting
duplicate blank separators. Other tables are preserved byte-for-byte.
- @param content {string} Raw TOML document content.
- @param serverName {string} Server key inside `mcp_servers`.
- @return {string} Content with the managed table removed.

### fn `function hasTomlSection(content: string, serverName: string): boolean` (L320-322)
- @brief Detect one managed server's TOML table in raw content.
- @param content {string} Raw TOML document content.
- @param serverName {string} Server key inside `mcp_servers`.
- @return {boolean} True when the `[mcp_servers.<name>]` header line exists.

### fn `function registrationToTomlLines(entry: McpServerRegistration): string[]` (L329-339)
- @brief Serialize a registration entry as TOML table lines.
- @param entry {McpServerRegistration} Registration entry.
- @return {string[]} `command`, optional `args`, and optional `env` lines.

### fn `export function writeTomlMcpServerSection(` (L353-366)
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

### fn `export function removeTomlMcpServerSection(configPath: string, serverName: string): boolean` (L378-387)
- @brief Remove an MCP-server table from a TOML configuration file.
- @details Missing files and absent tables are successful no-ops; otherwise
the managed table is removed and the file is rewritten atomically.
- @param configPath {string} TOML configuration file path.
- @param serverName {string} Server key inside `mcp_servers`.
- @return {boolean} True when a table was removed; false when absent.
- @throws {Error} When reading or writing fails.
- @satisfies DES-019, REQ-115

### fn `export function hasTomlMcpServerSection(configPath: string, serverName: string): boolean` (L395-398)
- @brief Detect one managed server's TOML table in a configuration file.
- @param configPath {string} TOML configuration file path.
- @param serverName {string} Server key inside `mcp_servers`.
- @return {boolean} True when the managed table header exists.

### fn `function listFilesRecursive(root: string): string[]` (L405-420)
- @brief Recursively list relative file paths under a directory.
- @param root {string} Directory to scan.
- @return {string[]} POSIX-style relative file paths; empty when the directory is absent.

### fn `const walk = (dir: string): void =>` (L408-417)

### iface `export interface SkillContentLayout` (L439-442)
- @brief Skill content layout consumed by install synchronization and status comparison.
- @details `debugPath` names the packaged debug overlay file relative to the
skill directory and is excluded from the synchronized tree in every mode
(REQ-155). `includeDebug` appends the overlay content to the installed
`SKILL.md` (REQ-156); the packaged document is always rewritten first, so
repeated runs never duplicate the overlay (REQ-157). Status comparison
accepts both the plain and the overlay-extended document (REQ-158).
- @satisfies REQ-155, REQ-156, REQ-157, REQ-158

### fn `export function syncSkillTree(source: string, destination: string, layout: SkillContentLayout = {}): void` (L461-482)
- @brief Synchronize one packaged skill directory into a destination.
- @details Creates the destination, recursively copies every packaged content
file with overwrite while excluding any declared debug overlay, then deletes
destination files and directories absent from the package — strictly inside
the managed skill directory, so sibling unmanaged skills are never touched.
Pruning runs deepest-first. When `layout.includeDebug` is true the overlay
content is appended to the installed `SKILL.md` after the fresh copy.
- @param source {string} Packaged skill directory containing `SKILL.md`.
- @param destination {string} Target `<skillsDir>/<skill-id>` path.
- @param layout {SkillContentLayout} Debug overlay declaration; defaults to no overlay.
- @return {void}
- @throws {Error} When copying, appending, or pruning fails.
- @satisfies DES-020, REQ-155, REQ-156, REQ-157
- @pre `source` MUST exist.
- @post `destination` mirrors exactly the packaged content tree plus the optional debug overlay.

### fn `export function removeSkillDir(skillDir: string): void` (L493-495)
- @brief Remove one managed skill directory from a skills destination.
- @details Missing directories are successful no-ops; nothing outside the
named directory is touched and no directory is created.
- @param skillDir {string} Managed `<skillsDir>/<skill-id>` path.
- @return {void}
- @throws {Error} When recursive deletion fails.
- @satisfies DES-020, REQ-115

### fn `export function compareSkillTree(` (L512-515)
- @brief Compare one packaged skill directory with its installed copy.
- @details Every packaged content file must exist in the destination with
identical bytes; the declared debug overlay is ignored as a standalone file
and the installed `SKILL.md` counts as matching when it equals either the
packaged document or the packaged document plus the overlay content
(REQ-158). Extra destination files are ignored (staleness is judged only on
packaged content).
- @param source {string} Packaged skill directory.
- @param destination {string} Installed skill directory.
- @param layout {SkillContentLayout} Debug overlay declaration; defaults to no overlay.
- @return {string} `OK` when all packaged content matches, `MISSING` when the
package or destination is absent, `STALE` on byte mismatch.
- @satisfies REQ-118, REQ-158

### fn `export function isServerRegistered(target: CliTarget, serverName: string, home?: string): boolean` (L542-548)
- @brief Detect whether a CLI has the managed server entry registered.
- @param target {CliTarget} CLI adapter.
- @param serverName {string} Managed server key.
- @param home {string | undefined} Home-directory override.
- @return {boolean} True when the entry/table is present and parseable.

### fn `export function applyServerRegistration(` (L561-581)
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
|`CliTargetId`|type||37||
|`McpServerRegistration`|iface||43-47|export interface McpServerRegistration|
|`CliConfigFormat`|type||54||
|`CliTarget`|iface||61-66|export interface CliTarget|
|`homeRoot`|fn||69-71|function homeRoot(home?: string): string|
|`resolveCliTarget`|fn||136-138|export function resolveCliTarget(name: string): CliTarget...|
|`supportedCliNames`|fn||145-147|export function supportedCliNames(): string|
|`readJsonConfig`|fn||157-164|function readJsonConfig(configPath: string): Record<strin...|
|`writeJsonConfig`|fn||176-181|function writeJsonConfig(configPath: string, value: Recor...|
|`writeJsonMcpServerEntry`|fn||195-208|export function writeJsonMcpServerEntry(|
|`removeJsonMcpServerEntry`|fn||221-235|export function removeJsonMcpServerEntry(configPath: stri...|
|`readJsonMcpServerEntry`|fn||243-257|export function readJsonMcpServerEntry(|
|`tomlString`|fn||265-267|function tomlString(value: string): string|
|`tomlSectionHeader`|fn||274-276|function tomlSectionHeader(serverName: string): string|
|`removeTomlSection`|fn||287-312|function removeTomlSection(content: string, serverName: s...|
|`hasTomlSection`|fn||320-322|function hasTomlSection(content: string, serverName: stri...|
|`registrationToTomlLines`|fn||329-339|function registrationToTomlLines(entry: McpServerRegistra...|
|`writeTomlMcpServerSection`|fn||353-366|export function writeTomlMcpServerSection(|
|`removeTomlMcpServerSection`|fn||378-387|export function removeTomlMcpServerSection(configPath: st...|
|`hasTomlMcpServerSection`|fn||395-398|export function hasTomlMcpServerSection(configPath: strin...|
|`listFilesRecursive`|fn||405-420|function listFilesRecursive(root: string): string[]|
|`walk`|fn||408-417|const walk = (dir: string): void =>|
|`SkillContentLayout`|iface||439-442|export interface SkillContentLayout|
|`syncSkillTree`|fn||461-482|export function syncSkillTree(source: string, destination...|
|`removeSkillDir`|fn||493-495|export function removeSkillDir(skillDir: string): void|
|`compareSkillTree`|fn||512-515|export function compareSkillTree(|
|`isServerRegistered`|fn||542-548|export function isServerRegistered(target: CliTarget, ser...|
|`applyServerRegistration`|fn||561-581|export function applyServerRegistration(|


---

# clientSnippets.ts | TypeScript | 105L | 6 symbols | 0 imports | 9 comments
> Path: `src/utils/clientSnippets.ts`

## Definitions

- type `export type SnippetClient = "generic" | "claude" | "cursor" | "pi";` (L2)
- @brief Supported MCP client targets; selects the documented target file. */
- type `export type SnippetTransport = "stdio" | "http";` (L5)
- @brief Supported MCP transports for the generated registration entry. */
- type `export type SnippetLauncher = "npx" | "node" | "bin";` (L8)
- @brief stdio launcher strategy: `npx` one-shot, `node` with a script path, or the installed `bin`. */
### iface `export interface SnippetOptions` (L15-23)
- @brief Options controlling snippet rendering.
- @details All fields optional; defaults: client `generic`, transport `stdio`,
launcher `npx`, serverName `mcp-google-api`, HTTP host `127.0.0.1`, port 3000.

### iface `export interface SnippetResult` (L31-34)
- @brief Rendered snippet plus stderr guidance notes.
- @details `json` is a complete pretty-printed `mcpServers` registration
object (parses with `JSON.parse`); `notes` are human guidance lines the CLI
prints on stderr so stdout stays pure JSON (PRJ-008).

### fn `export function renderClientSnippet(options: SnippetOptions = {}): SnippetResult` (L70-105)
- @brief Renders a valid MCP-client registration snippet without writing files.
- @details stdio transport: launcher `npx` -> `npx -y mcp-google-api start
--stdio`; `bin` -> installed `mcp-google-api start --stdio`; `node` ->
`node <commandPath> start --stdio` and throws when `commandPath` is
missing. HTTP transport: emits `{ url: "http://<host>:<port>/mcp" }`.
Entries embed no API key and no environment payload (REQ-093): the
registered server loads its key at startup from the persisted `api-key`
setting (REQ-142), and the stderr notes say so. Pure: no filesystem or
network access; output is JSON.stringify'd with 2-space indent.
Complexity O(1).
- @param options {SnippetOptions} Rendering options; defaults apply when omitted.
- @return {SnippetResult} Pretty-printed JSON snippet plus stderr notes.
- @throws {Error} When launcher is `node` and `commandPath` is missing.
- @satisfies PRJ-010, REQ-092, REQ-093

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`SnippetClient`|type||2||
|`SnippetTransport`|type||5||
|`SnippetLauncher`|type||8||
|`SnippetOptions`|iface||15-23|export interface SnippetOptions|
|`SnippetResult`|iface||31-34|export interface SnippetResult|
|`renderClientSnippet`|fn||70-105|export function renderClientSnippet(options: SnippetOptio...|


---

# configResolver.ts | TypeScript | 275L | 12 symbols | 1 imports | 15 comments
> Path: `src/utils/configResolver.ts`

## Imports
```
import { isUnsetApiKey, type CliSettings } from "./cliSettings.js";
```

## Definitions

### iface `export interface RuntimeConfigOverrides` (L35-39)
- @brief Higher-priority values that override settings-derived configuration.
- @details Flags parsed from CLI arguments; every field optional. `flag`
source wins over `settings`.

- type `export type RuntimeConfigSource = "flag" | "settings";` (L42)
- @brief Origin tag attached to each resolved configuration field. */
### iface `export interface ResolvedRuntimeConfig` (L51-62)
- @brief Typed snapshot of every runtime configuration field with per-field source.
- @details Produced exclusively by `resolveRuntimeConfig`; consumed by all CLI
commands and `doctor` diagnostics (DES-015). `port` is undefined when the
configured value cannot be used as a listen port; `portRaw` preserves the
original value rendering for remediation messages.

### fn `export function resolveRuntimeConfig(` (L81-83)
- @brief Resolves runtime configuration from the persisted settings plus flag overrides.
- @details Priority per field: overrides (`flag`) > persisted settings
(`settings`). The persisted settings file is the only non-flag configuration
source (DES-015); no environment variable is consulted. Port handling:
flag port used as-is; settings port kept when it is an integer in 1..65535,
otherwise left undefined with the raw rendering preserved in `portRaw`.
`apiKey` normalizes unset and placeholder settings values to undefined
(DES-023). `autoUpdateDisabled` is the negation of the persisted
`autoUpdate` field (DES-024). Pure: reads inputs only, mutates nothing.
Complexity O(1).
- @param settings {CliSettings} Persisted settings loaded via `loadCliSettings`.
- @param overrides {RuntimeConfigOverrides} Flag-derived overrides; defaults to none.
- @return {ResolvedRuntimeConfig} Fully typed configuration with per-field sources.
- @see validateHttpEndpoint
- @satisfies DES-015, REQ-008

### fn `export function maskSecret(value: string | undefined): string` (L135-143)
- @brief Masks a secret value for safe inclusion in reports and diagnostics.
- @details `undefined`/empty -> `unset`; length <= 8 -> `****`; otherwise first
four characters + `****` + last four characters. The raw secret never
appears in the output. Pure; complexity O(n) in value length.
- @param value {string | undefined} Secret to mask (e.g. Google Maps API key).
- @return {string} Masked representation safe for stderr/stdout reports.
- @satisfies DES-016, REQ-089

### iface `export interface ConfigDiagnostics` (L151-157)
- @brief Per-field effective-value diagnostic structure with masked secrets.
- @details Every field carries its resolved value (masked when secret) and its
`RuntimeConfigSource`; produced by `describeRuntimeConfig` and embedded in
`doctor` local reports.

### fn `export function describeRuntimeConfig(config: ResolvedRuntimeConfig): ConfigDiagnostics` (L168-180)
- @brief Builds a serializable diagnostic view of a resolved configuration.
- @details Maps `ResolvedRuntimeConfig` to `ConfigDiagnostics`, masking the API
key via `maskSecret` so the result is safe to print. Complexity O(1); pure.
- @param config {ResolvedRuntimeConfig} Configuration produced by `resolveRuntimeConfig`.
- @return {ConfigDiagnostics} Masked, source-annotated diagnostics.
- @see maskSecret
- @satisfies REQ-089, DES-016

### fn `export function formatConfigDiagnostics(diagnostics: ConfigDiagnostics): string` (L191-199)
- @brief Formats config diagnostics as one compact human-readable line.
- @details Joins `key=value (source)` fragments; the API key is pre-masked by
`describeRuntimeConfig`. Used as `doctor` check detail text. Complexity O(1).
- @param diagnostics {ConfigDiagnostics} Output of `describeRuntimeConfig`.
- @return {string} Single-line `;`-separated diagnostic string.
- @see describeRuntimeConfig
- @satisfies REQ-089

### iface `export interface HttpEndpointValidation` (L206-209)
- @brief Outcome of HTTP endpoint validation over a resolved configuration.
- @details `valid` is false when `errors` is non-empty; each error is a
remediation-oriented message.

### fn `export function validateHttpEndpoint(config: ResolvedRuntimeConfig): HttpEndpointValidation` (L220-229)
- @brief Validates the HTTP bind endpoint of a resolved configuration.
- @details Rules: port must be defined, an integer in 1..65535; host must be a
non-empty string. Returns every violated rule as a remediation message.
Pure; complexity O(1).
- @param config {ResolvedRuntimeConfig} Configuration to validate.
- @return {HttpEndpointValidation} `valid` plus per-rule error messages.
- @satisfies REQ-009

### iface `export interface EnabledToolsResolution` (L237-242)
- @brief Result of resolving the persisted `enabledTools` allowlist.
- @details `names` is the effective tool-name list; `matched` counts allowlist
hits; `fallback` is true when the allowlist matched zero tools and the full
set is returned (REQ-012); `requested` lists the parsed allowlist items.

### fn `export function resolveEnabledToolNames(` (L255-275)
- @brief Resolves the enabled-tool allowlist against the full tool registry.
- @details Semantics: unset, empty, or `*` -> full set (REQ-010); at least one
matching name -> the named subset, items trimmed and empties ignored
(REQ-011); zero matches -> full set with `fallback: true` (REQ-012). Pure;
complexity O(n + m) with n registry names and m allowlist items.
- @param allToolNames {readonly string[]} Full registered tool-name registry.
- @param raw {string | undefined} Raw `enabledTools` settings value.
- @return {EnabledToolsResolution} Effective names plus resolution metadata.
- @satisfies REQ-010, REQ-011, REQ-012, PRJ-006

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`RuntimeConfigOverrides`|iface||35-39|export interface RuntimeConfigOverrides|
|`RuntimeConfigSource`|type||42||
|`ResolvedRuntimeConfig`|iface||51-62|export interface ResolvedRuntimeConfig|
|`resolveRuntimeConfig`|fn||81-83|export function resolveRuntimeConfig(|
|`maskSecret`|fn||135-143|export function maskSecret(value: string | undefined): st...|
|`ConfigDiagnostics`|iface||151-157|export interface ConfigDiagnostics|
|`describeRuntimeConfig`|fn||168-180|export function describeRuntimeConfig(config: ResolvedRun...|
|`formatConfigDiagnostics`|fn||191-199|export function formatConfigDiagnostics(diagnostics: Conf...|
|`HttpEndpointValidation`|iface||206-209|export interface HttpEndpointValidation|
|`validateHttpEndpoint`|fn||220-229|export function validateHttpEndpoint(config: ResolvedRunt...|
|`EnabledToolsResolution`|iface||237-242|export interface EnabledToolsResolution|
|`resolveEnabledToolNames`|fn||255-275|export function resolveEnabledToolNames(|


---

# requestContext.ts | TypeScript | 42L | 3 symbols | 2 imports | 4 comments
> Path: `src/utils/requestContext.ts`

## Imports
```
import { AsyncLocalStorage } from "node:async_hooks";
import { ApiKeyManager } from "./apiKeyManager.js";
```

## Definitions

### iface `interface RequestContext` (L9-12)
- @brief Per-request context propagated through `AsyncLocalStorage`.
- @details Carries the resolved request API key and the MCP session id
(DES-006).

### fn `export function getCurrentApiKey(): string | undefined` (L26-29)
- @brief Returns the current request's API key.
- @details Reads the `AsyncLocalStorage` store first (per-request/per-session
key, DES-006); when no context exists (stdio transport) falls back to the
startup default key injected into `ApiKeyManager` from the persisted
settings (REQ-018, REQ-142). No environment fallback (CTN-002).
- @return {string | undefined} Effective API key; undefined when unconfigured.
- @satisfies DES-006, REQ-018, REQ-142

### fn `export function runWithContext<T>(context: RequestContext, fn: () => T | Promise<T>): T | Promise<T>` (L40-42)
- @brief Runs a function inside a specific request context.
- @details Opens an `AsyncLocalStorage` scope so nested reads via
`getCurrentApiKey` observe the given key/session pair (DES-006).
- @param context {RequestContext} Context to expose to the executed function.
- @param fn {() => T | Promise<T>} Function executed within the scope.
- @return {T | Promise<T>} The function's own result.
- @satisfies DES-006

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`RequestContext`|iface||9-12|interface RequestContext|
|`getCurrentApiKey`|fn||26-29|export function getCurrentApiKey(): string | undefined|
|`runWithContext`|fn||40-42|export function runWithContext<T>(context: RequestContext...|


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


---

# upgradeManager.ts | TypeScript | 826L | 33 symbols | 7 imports | 72 comments
> Path: `src/utils/upgradeManager.ts`

## Imports
```
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Logger } from "../index.js";
import {
import { loadCliSettings } from "./cliSettings.js";
```

## Definitions

- fn `const green = (text: string): string => `${ANSI_GREEN}${text}${ANSI_RESET}`;` (L49)
- @brief Wraps diagnostic text in bright-green SGR sequences.
- @param text {string} Plain diagnostic text.
- @return {string} Green-colored text terminated by an SGR reset.
- fn `const red = (text: string): string => `${ANSI_RED}${text}${ANSI_RESET}`;` (L56)
- @brief Wraps diagnostic text in bright-red SGR sequences.
- @param text {string} Plain diagnostic text.
- @return {string} Red-colored text terminated by an SGR reset.
### iface `export interface PostUpgradeCliOutcome` (L111-120)
- @brief Per-CLI result entry of the post-upgrade install consumed by the `--upgrade` summary.
- @details One entry per CLI processed by the child `install` command (REQ-133);
counts are present only when the child activity report was parseable.

### iface `export interface PostUpgradeInstallOutcome` (L127-132)
- @brief Aggregate outcome of the post-upgrade `install` child command (REQ-126, REQ-132).
- @details `clis` is empty only when no CLI is enabled (successful no-op);
`exitCode` is the child exit code, 0 for the no-op and success cases.

### iface `export interface VersionIdleCache` (L139-148)
- @brief Persisted idle-cache shape (snake_case keys, reference-CLI layout).
- @details `*_epoch` fields are POSIX milliseconds since the Unix epoch;
`*_human` fields are their ISO-8601 UTC renderings (REQ-122).

### iface `export interface IdleFsDeps` (L155-162)
- @brief Injectable filesystem surface consumed by the idle check.
- @details Tests substitute in-memory readers/writers so no real cache file
is touched; production defaults map to `node:fs` primitives.

### iface `export interface IdleCheckDeps extends AutoUpdateCheckerDeps` : AutoUpdateCheckerDeps (L169-178)
- @brief Dependency surface of the idle-gated version check.
- @details Extends the registry-probe injection surface with the idle-gate
inputs: forced mode, cache path override, injectable clock, and fs stubs.

- type `export type IdleCheckStatus =` (L181)
### iface `export interface IdleCheckResult` (L195-208)
- @brief Result of one idle-gated version-check attempt.
- @details `checked` is false only when no registry probe ran (idle gate hit
or disabled flag); the remaining fields echo the probe outcome and the
freshly persisted idle deadline for callers and tests.

### fn `export function resolveIdleCachePath(home?: string): string` (L219-221)
- @brief Resolves the program-owned idle-cache file path.
- @details Joins `<home>/.cache/mcp-google-api/check_version_idle-time.json`
(program-owned directory segment per the DES-021 naming rule; never a
shared or generic directory).
- @param home {string | undefined} Home-directory override; defaults to `os.homedir()`.
- @return {string} Absolute idle-cache file path.
- @satisfies REQ-121, REQ-122

### fn `export function loadIdleCache(cachePath: string, fs: IdleFsDeps = {}): VersionIdleCache` (L232-256)
- @brief Loads the idle cache tolerating any missing or malformed content.
- @details Missing files, I/O errors, non-object JSON, and wrong-typed fields
all normalize to `{}`; numeric fields are accepted only when finite numbers.
- @param cachePath {string} Idle-cache file path.
- @param fs {IdleFsDeps} Injectable filesystem surface.
- @return {VersionIdleCache} Parsed cache subset; empty object on any failure.
- @satisfies REQ-122

### fn `const isFiniteNumber = (value: unknown): value is number =>` (L241-252)

### fn `export function persistIdleCache(` (L273-277)
- @brief Persists the idle cache after one executed check.
- @details Serializes `last_success_*` and `idle_time_*` fields with two-space
indentation plus a trailing newline, creating the parent directory on
demand. Write failures are reported on stderr and never propagate (the
check itself already completed).
- @param cachePath {string} Idle-cache file path.
- @param lastSuccess {number | undefined} Epoch of the last successful probe.
- @param idleUntil {number} Epoch of the new idle deadline.
- @param fs {IdleFsDeps} Injectable filesystem surface.
- @param logger {AutoUpdateLogger} Diagnostics sink for cache write errors.
- @return {void}
- @satisfies REQ-122
- @post The cache file contains the serialized deadlines, or a stderr error was emitted.

### fn `const toIso = (epoch: number | undefined): string | null =>` (L280-287)

### fn `export async function checkVersionIdle(deps: IdleCheckDeps = {}): Promise<IdleCheckResult>` (L320-377)
- @brief Runs the idle-gated automatic version check.
- @details Resolution order: disabled-flag short-circuit (REQ-083; zero
network calls, zero cache writes) -> idle gate (skip with `status: "idle"`
while `idle_time_epoch` is in the future and `force` is not set, REQ-121)
-> `probeLatestVersion` registry probe -> outcome reporting and idle-window
selection: newer -> green stderr `Available Version: <latest> | Installed
Version: <current>` plus an upgrade command and a 3600 s window (REQ-123,
REQ-124); registry-reached-but-current -> no output: a current version is
not an error (REQ-124) and still gets an 86400 s window; any failure -> red
stderr error notice and a 86400 s window. The cache is refreshed after every executed probe; cache write
failures never throw. Never blocks the caller's error path: never throws.
- @param deps {IdleCheckDeps} Optional dependency overrides; production defaults when omitted.
- @return {Promise<IdleCheckResult>} Outcome with the persisted idle deadline.
- @warning Startup call sites MUST invoke fire-and-forget (`void checkVersionIdle(...)`) to preserve REQ-085.
- @note Complexity: one HTTP round-trip bounded by `timeoutMs` plus O(1) cache I/O.
- @see probeLatestVersion
- @see loadIdleCache
- @see persistIdleCache
- @satisfies REQ-120, REQ-121, REQ-122, REQ-123, REQ-124

- type `export type ManagementCommandName = "--ver" | "--version" | "--upgrade" | "--uninstall";` (L380)
### iface `export interface PackageManagerDeps` (L388-393)
- @brief Injectable child-process surface for package-manager commands.
- @details `spawn` defaults to `node:child_process` `spawnSync`; `logger`
defaults to the stderr `Logger`. Injection keeps the management commands
deterministic and side-effect free under test (DES-022).

### iface `export interface ManagementCommandOptions` (L402-407)
- @brief Options consumed by the management command handlers.
- @details `currentVersion` backs the `--ver`/`--version` output, the forced
online check, and the starting version of the `--upgrade` summary; `home`
scopes the enabled-CLI settings read performed by the post-upgrade skill
installation.

### iface `export interface ManagementCommandDeps extends PackageManagerDeps` : PackageManagerDeps (L414-421)
- @brief Aggregated dependency surface of the management dispatch.
- @details Combines the package-manager injection surface with the idle-check
injection surface and an injectable stdout sink used by the version print.

### fn `export function parseManagementCommand(` (L434-445)
- @brief Detects an exact single-token management command in a raw argv array.
- @details Returns the canonical name only when the post-bin argv is exactly
one of `--ver`, `--version`, `--upgrade`, `--uninstall`; any other shape
(including combined flags or subcommands) yields undefined so normal yargs
dispatch stays untouched.
- @param args {readonly string[]} Raw argv after the Node binary/script tokens.
- @return {ManagementCommandName | undefined} Canonical command name, or undefined.
- @note Complexity: O(1). Pure.
- @satisfies PRJ-003, REQ-120, REQ-125, REQ-127

### fn `export function runPackageManagerCommand(` (L460-462)
- @brief Runs one package-manager command as a child process with inherited stdio.
- @details Spawns `command[0]` with the remaining tokens, inheriting stdio so
npm/npx output streams through unchanged; on Windows the spawn runs through
a shell so `npm.cmd` resolves. A spawn failure (missing executable or
thrown spawn error) prints the error plus the exact manual command hint on
stderr and returns exit code 1; otherwise the child exit code propagates
(null status maps to 1).
- @param command {readonly string[]} Executable plus arguments.
- @param deps {PackageManagerDeps} Optional spawner/logger overrides.
- @return {number} Child exit code, or 1 when spawning failed.
- @satisfies REQ-125, REQ-127, REQ-128

### fn `const reportSpawnFailure = (message: string): number =>` (L466-470)

### fn `function parsePostUpgradeCliOutcomes(` (L500-530)
- @brief Parses the child `install` activity report into per-CLI outcomes.
- @details Accepts the human-readable report emitted by the `install` command
on stdout (REQ-166): lines of the form ` <cli>: <activity>` under the
`mcp-google-api install report:` header, optionally followed by an
`Errors:` block. A CLI is marked `ok: false` when any error diagnostic text
contains its name (case-insensitive). Returns undefined for missing or
unparseable output so callers fall back to the persisted enabled-CLI list
(REQ-135). Pure; never throws.
- @param raw {string | undefined} Captured child stdout text.
- @return {PostUpgradeCliOutcome[] | undefined} Per-CLI entries in report order; undefined when unparseable.
- @note Complexity: O(n + m) with n report lines and m error strings.
- @satisfies REQ-133, REQ-135, REQ-166

### fn `export function runPostUpgradeSkillInstall(` (L552-554)
- @brief Refreshes installed skills through the upgraded package after `--upgrade`.
- @details When at least one CLI is enabled in the persisted settings, spawns
`mcp-google-api install` — the globally installed bin of the just-upgraded
package (`POST_UPGRADE_INSTALL_COMMAND`) — with captured child stdout
(stderr stays inherited so child diagnostics remain visible), so the
freshly upgraded package (not the running process, and never a stale npx
cache copy) re-synchronizes its packaged skills and MCP registrations into
every enabled CLI without echoing the child activity report (REQ-126). The captured payload is parsed into per-CLI outcomes;
missing or unparseable output falls back to the persisted enabled-CLI list
carrying the aggregate exit-code outcome (REQ-135). Spawn failures report
the manual command hint on stderr and map to exit code 1 (REQ-128). With
zero enabled CLIs the hook is a successful no-op with an empty CLI list.
- @param options {ManagementCommandOptions} `{ home }` scoping the settings read.
- @param deps {PackageManagerDeps} Optional spawner/logger overrides.
- @return {PostUpgradeInstallOutcome} Child exit code plus one outcome entry per processed CLI.
- @see loadCliSettings
- @see parsePostUpgradeCliOutcomes
- @satisfies REQ-126, REQ-128, REQ-133, REQ-135

### fn `const reportSpawnFailure = (message: string): PostUpgradeInstallOutcome =>` (L562-566)

### fn `export function renderUpgradeSummary(` (L604-633)
- @brief Renders the human-readable `--upgrade` summary block.
- @details First line states the version transition `starting -> updated`;
the second line states the post-upgrade install outcome (success, failure
with exit code, or skip when no CLI is enabled); with processed CLIs it
appends one indented entry per CLI with its OK/FAILED result and the
reported server/skill counts when known. Pure; deterministic text.
- @param previousVersion {string} Starting (pre-upgrade) package version.
- @param updatedVersion {string} Updated package version; `unknown` when the registry probe failed (REQ-134).
- @param outcome {PostUpgradeInstallOutcome} Post-upgrade install outcome.
- @return {string} Multi-line summary terminated by one trailing newline.
- @satisfies REQ-132, REQ-133, REQ-134

### fn `function resolveProbeLatestVersion(probe: LatestVersionProbe): string` (L646-654)
- @brief Maps one registry probe outcome to its latest-version text.
- @details `newer` -> `latestVersion`; `current` -> `currentVersion`;
every other outcome (`disabled`, `unknown-version`, `error`) -> `unknown`
(REQ-164). Pure; never throws.
- @param probe {LatestVersionProbe} Logging-free registry probe outcome.
- @return {string} Latest npm-published version text, or `unknown`.
- @note Complexity: O(1). Pure; no side effects.
- @see probeLatestVersion
- @satisfies REQ-164

### fn `async function resolveUpdatedVersion(` (L671-680)
- @brief Resolves the updated package version reported by the `--upgrade` summary.
- @details Runs one logging-free `probeLatestVersion` registry probe after the
upgrade child succeeds, forwarding the injected idle-check dependencies, and
delegates the outcome-to-version mapping to `resolveProbeLatestVersion`:
`newer` maps to the registry latest version, `current` to the running
version, and every other outcome to `unknown` (REQ-134). Never throws.
- @param options {ManagementCommandOptions} Options carrying `currentVersion`.
- @param deps {ManagementCommandDeps} Optional idle-check dependency overrides.
- @return {Promise<string>} Updated version string; `unknown` when undeterminable.
- @note Complexity: one HTTP round-trip bounded by the probe timeout.
- @see probeLatestVersion
- @see resolveProbeLatestVersion
- @satisfies REQ-134

### fn `export async function runVersionCommand(` (L699-701)
- @brief Handles `--ver`/`--version`: dual online probe plus three-line version report.
- @details Runs the npm-registry probe (`probeLatestVersion`) and the GitHub
releases probe (`probeLatestGitHubVersion`) concurrently, both bypassing
the idle cache gate (REQ-161: no cache read, no cache write, no persisted
`autoUpdate` gating), then writes exactly three stdout lines — the
installed version, `npmjs latest: <version>` (REQ-162), and
`GitHub latest: <version>` (REQ-163) — and returns 0 (REQ-120). Any
undeterminable version prints as `unknown` (REQ-164).
- @param options {ManagementCommandOptions} Options carrying `currentVersion`.
- @param deps {ManagementCommandDeps} Optional idle-check/GitHub-check/stdout overrides.
- @return {Promise<number>} Exit code 0.
- @see probeLatestVersion
- @see probeLatestGitHubVersion
- @see resolveProbeLatestVersion
- @satisfies REQ-120, REQ-161, REQ-162, REQ-163, REQ-164

### fn `function isUpgradeNecessary(status: LatestVersionProbe["status"]): boolean` (L727-729)
- @brief Decides whether the `--upgrade` flow must proceed after the pre-upgrade check.
- @details Decision table over `LatestVersionProbe.status`: `newer` -> true
(REQ-146); `current` -> false (REQ-145: the installed version is already
the latest available); `disabled`, `unknown-version`, `error` -> true
(REQ-147: upgrade necessity undeterminable, legacy update path preserved).
- @param status {LatestVersionProbe["status"]} Status of the pre-upgrade registry probe.
- @return {boolean} True when the REQ-125 package-update child process must run.
- @note Complexity: O(1). Pure; no side effects.
- @see probeLatestVersion
- @satisfies REQ-144, REQ-145, REQ-146, REQ-147

### fn `export async function runUpgradeCommand(` (L757-759)
- @brief Handles `--upgrade`: check upgrade necessity, reinstall the latest package, then refresh skills with a stdout summary.
- @details Resolution order: one forced logging-free `probeLatestVersion`
registry probe bypassing the idle cache gate (REQ-144) -> `current` status
writes the already-latest stdout line including the installed version and
returns 0 without spawning any child process (REQ-145) -> any other
outcome proceeds to the update path (`newer` per REQ-146;
`disabled`/`unknown-version`/`error` per REQ-147). The update path runs
`npm install -g mcp-google-api@latest` with inherited stdio and propagates
a non-zero exit code unchanged without printing any summary; on success
resolves the updated version via one registry probe (REQ-134), runs the
captured-stdout post-upgrade install (REQ-126), prints the
human-readable stdout summary with starting version, updated version,
install outcome, and per-CLI entries (REQ-132, REQ-133), and returns the
post-upgrade install exit code.
- @param options {ManagementCommandOptions} Options carrying `currentVersion` and `home`.
- @param deps {ManagementCommandDeps} Optional spawner/idle-check/stdout overrides.
- @return {Promise<number>} 0 when the installed version is already the latest available; otherwise the upgrade exit code when non-zero, else the post-upgrade install exit code.
- @see probeLatestVersion
- @see isUpgradeNecessary
- @see runPackageManagerCommand
- @see resolveUpdatedVersion
- @see runPostUpgradeSkillInstall
- @see renderUpgradeSummary
- @satisfies REQ-125, REQ-126, REQ-132, REQ-133, REQ-134, REQ-135, REQ-144, REQ-145, REQ-146, REQ-147

### fn `export function runUninstallCommand(deps: ManagementCommandDeps = {}): number` (L794-796)
- @brief Handles `--uninstall`: remove the globally installed package.
- @details Runs `npm uninstall -g mcp-google-api` with inherited stdio and
returns the child exit code (spawn failures map to 1 with the manual
command hint, REQ-127, REQ-128). Managed skill/MCP removal stays the
responsibility of the existing `uninstall` subcommand.
- @param deps {ManagementCommandDeps} Optional spawner/logger overrides.
- @return {number} Child exit code, or 1 when spawning failed.
- @see runPackageManagerCommand
- @satisfies REQ-127

### fn `export async function runManagementCommand(` (L812-815)
- @brief Dispatches one management command to its handler.
- @details Single dispatch surface for the CLI entry intercept:
`--ver`/`--version` -> `runVersionCommand` (async); `--upgrade` ->
`runUpgradeCommand`; `--uninstall` -> `runUninstallCommand`.
- @param command {ManagementCommandName} Canonical management command name.
- @param options {ManagementCommandOptions} Options carrying version and home.
- @param deps {ManagementCommandDeps} Optional dependency overrides.
- @return {Promise<number>} Handler exit code suitable for `process.exitCode`.
- @see runVersionCommand
- @see runUpgradeCommand
- @see runUninstallCommand
- @satisfies PRJ-003, REQ-120, REQ-125, REQ-126, REQ-127, REQ-132, REQ-133, REQ-134, REQ-135

## Symbol Index
|Symbol|Kind|Vis|Lines|Sig|
|---|---|---|---|---|
|`green`|fn||49|const green = (text: string): string => `${ANSI_GREEN}${t...|
|`red`|fn||56|const red = (text: string): string => `${ANSI_RED}${text}...|
|`PostUpgradeCliOutcome`|iface||111-120|export interface PostUpgradeCliOutcome|
|`PostUpgradeInstallOutcome`|iface||127-132|export interface PostUpgradeInstallOutcome|
|`VersionIdleCache`|iface||139-148|export interface VersionIdleCache|
|`IdleFsDeps`|iface||155-162|export interface IdleFsDeps|
|`IdleCheckDeps`|iface||169-178|export interface IdleCheckDeps extends AutoUpdateCheckerDeps|
|`IdleCheckStatus`|type||181||
|`IdleCheckResult`|iface||195-208|export interface IdleCheckResult|
|`resolveIdleCachePath`|fn||219-221|export function resolveIdleCachePath(home?: string): string|
|`loadIdleCache`|fn||232-256|export function loadIdleCache(cachePath: string, fs: Idle...|
|`isFiniteNumber`|fn||241-252|const isFiniteNumber = (value: unknown): value is number =>|
|`persistIdleCache`|fn||273-277|export function persistIdleCache(|
|`toIso`|fn||280-287|const toIso = (epoch: number | undefined): string | null =>|
|`checkVersionIdle`|fn||320-377|export async function checkVersionIdle(deps: IdleCheckDep...|
|`ManagementCommandName`|type||380||
|`PackageManagerDeps`|iface||388-393|export interface PackageManagerDeps|
|`ManagementCommandOptions`|iface||402-407|export interface ManagementCommandOptions|
|`ManagementCommandDeps`|iface||414-421|export interface ManagementCommandDeps extends PackageMan...|
|`parseManagementCommand`|fn||434-445|export function parseManagementCommand(|
|`runPackageManagerCommand`|fn||460-462|export function runPackageManagerCommand(|
|`reportSpawnFailure`|fn||466-470|const reportSpawnFailure = (message: string): number =>|
|`parsePostUpgradeCliOutcomes`|fn||500-530|function parsePostUpgradeCliOutcomes(|
|`runPostUpgradeSkillInstall`|fn||552-554|export function runPostUpgradeSkillInstall(|
|`reportSpawnFailure`|fn||562-566|const reportSpawnFailure = (message: string): PostUpgrade...|
|`renderUpgradeSummary`|fn||604-633|export function renderUpgradeSummary(|
|`resolveProbeLatestVersion`|fn||646-654|function resolveProbeLatestVersion(probe: LatestVersionPr...|
|`resolveUpdatedVersion`|fn||671-680|async function resolveUpdatedVersion(|
|`runVersionCommand`|fn||699-701|export async function runVersionCommand(|
|`isUpgradeNecessary`|fn||727-729|function isUpgradeNecessary(status: LatestVersionProbe["s...|
|`runUpgradeCommand`|fn||757-759|export async function runUpgradeCommand(|
|`runUninstallCommand`|fn||794-796|export function runUninstallCommand(deps: ManagementComma...|
|`runManagementCommand`|fn||812-815|export async function runManagementCommand(|

