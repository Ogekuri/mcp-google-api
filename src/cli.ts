#!/usr/bin/env node

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
import { checkVersionIdle, parseManagementCommand, parseUpgradeChannel, parseUpgradeForce, runManagementCommand } from "./utils/upgradeManager.js";
import {
  NODE_ENGINE_FLOOR,
  describeRuntimeConfig,
  formatConfigDiagnostics,
  maskSecret,
  resolveEnabledToolNames,
  resolveRuntimeConfig,
  type ResolvedRuntimeConfig,
} from "./utils/configResolver.js";
import { describeToolsProfile } from "./utils/toolProfiles.js";
import { renderClientSnippet, type SnippetClient, type SnippetOptions } from "./utils/clientSnippets.js";
import { ApiKeyManager } from "./utils/apiKeyManager.js";
import { loadCliSettings, loadConfiguredApiKey, saveCliSettings } from "./utils/cliSettings.js";
import { resolveCliTarget, supportedCliNames } from "./utils/cliTargets.js";
import {
  installEnabledCliResources,
  resolveSkillsResourcesRoot,
  uninstallEnabledCliResources,
  type CliOperationResult,
} from "./utils/cliInstaller.js";
import { buildCliShowReport } from "./utils/cliShow.js";
import { CONFIG_CLI_USAGE, runConfigCommandIfMatched } from "./utils/configCli.js";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * @brief Aggregated HTTP startup result across all configured server instances.
 * @details `started`/`failed` count per instance; `servers` holds only the
 * instances that are listening, so a zero-length array with `started === 0`
 * is the reliable-failure signal consumed by the default command (REQ-095).
 */
export interface ServerStartupOutcome {
  started: number;
  failed: number;
  servers: BaseMcpServer[];
}

/**
 * @brief Starts every configured HTTP MCP server instance and reports the outcome.
 * @details Validates the requested listen port (integer 1-65535), skips the
 * invalid instance with remediation guidance while marking it failed
 * (REQ-009), awaits `startHttpServer` so listen errors are caught, installs
 * SIGINT/SIGTERM handlers on success (REQ-096), and returns the aggregate
 * outcome. The port and host are resolved by the caller from CLI flags over
 * the persisted settings (REQ-008, DES-015); the startup API key is injected
 * into `ApiKeyManager`, never into the environment (DES-006). Startup
 * diagnostics identify the application as `MCP Google API server`
 * (REQ-165). Complexity O(instances).
 * @param port {number} Effective HTTP listen port (flag or persisted setting).
 * @param apiKey {string | undefined} Startup API key injected into `ApiKeyManager` from the persisted settings (REQ-142).
 * @param host {string} Effective HTTP bind host (flag or persisted setting; default loopback).
 * @return {Promise<ServerStartupOutcome>} Per-run counts plus listening servers.
 * @see installShutdownHandlers
 * @satisfies REQ-008, REQ-009, REQ-096, REQ-165
 */
export async function startServer(
  port: number,
  apiKey?: string,
  host: string = "127.0.0.1"
): Promise<ServerStartupOutcome> {
  ApiKeyManager.getInstance().setDefaultApiKey(apiKey);

  Logger.log("🚀 Starting MCP Google API server...");
  Logger.log(
    "ℹ️  Reminder: enable Places API (New) in https://console.cloud.google.com before using the new Place features."
  );
  Logger.log("");

  const servers: BaseMcpServer[] = [];
  let started = 0;
  let failed = 0;

  await Promise.all(
    serverConfigs.map(async (config) => {
      const serverPort = port;
      if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
        Logger.error(
          `❌ [${config.name}] Invalid port number "${serverPort}" (expected integer 1-65535).`
        );
        Logger.log("💡 Fix the persisted port with 'mcp-google-api port <number>' or pass --port.");
        failed++;
        return;
      }

      try {
        const activeTools = filterTools(config.tools);
        Logger.log(`📍 ${activeTools.length} tools registered (configure with 'mcp-google-api tools')`);
        const server = new BaseMcpServer(config.name, activeTools);
        const serverHost = host;
        Logger.log(`🔧 [${config.name}] Initializing MCP Server in HTTP mode on ${serverHost}:${serverPort}...`);
        await server.startHttpServer(serverPort, serverHost);
        servers.push(server);
        started++;
        const displayHost = serverHost === "0.0.0.0" ? "localhost" : serverHost;
        Logger.log(`✅ [${config.name}] MCP Server started successfully!`);
        Logger.log(`   🌐 Endpoint: http://${displayHost}:${serverPort}/mcp`);
        Logger.log(`   📚 Tools: ${activeTools.length} available`);
      } catch (error) {
        Logger.error(`❌ [${config.name}] Failed to start MCP Server on port ${serverPort}:`, error);
        failed++;
      }
    })
  );

  if (started > 0) {
    installShutdownHandlers(servers);
  }

  Logger.log("");
  Logger.log(started > 0 ? "🎉 Server initialization completed!" : "❌ No MCP server instance started.");
  Logger.log("💡 Need help? Check the README.md for configuration details.");
  return { started, failed, servers };
}

/** @brief Exit hook signature used by the shutdown handler. */
export type ShutdownExitHook = (code: number) => void;

/**
 * @brief Builds a one-shot orderly shutdown handler for HTTP server instances.
 * @details On first invocation it stops every given server via
 * `stopHttpServer()` (transport close + socket close, errors tolerated) and
 * then calls `exitHook(0)`; subsequent invocations are no-ops, so repeated
 * signals never double-stop. Complexity O(servers).
 * @param servers {readonly BaseMcpServer[]} Listening server instances.
 * @param exitHook {ShutdownExitHook} Terminal action; defaults to `process.exit`.
 * @return {(signal: string) => Promise<void>} Reusable async signal handler.
 * @see stopHttpServer
 * @satisfies REQ-096
 */
export function createShutdownHandler(
  servers: readonly BaseMcpServer[],
  exitHook: ShutdownExitHook = (code) => process.exit(code)
): (signal: string) => Promise<void> {
  let invoked = false;
  return async (signal: string) => {
    if (invoked) {
      return;
    }
    invoked = true;
    Logger.log(`📶 Received ${signal}; shutting down MCP HTTP server...`);
    await Promise.allSettled(servers.map((server) => server.stopHttpServer()));
    exitHook(0);
  };
}

/**
 * @brief Registers SIGINT/SIGTERM handlers that orderly-stop the given servers.
 * @details Wraps `createShutdownHandler` and attaches it to both signals so
 * Ctrl-C and terminate requests close all HTTP sessions and the listening
 * socket before process exit (REQ-096). Complexity O(1).
 * @param servers {readonly BaseMcpServer[]} Listening server instances.
 * @return {void}
 * @see createShutdownHandler
 * @satisfies REQ-096
 */
export function installShutdownHandlers(servers: readonly BaseMcpServer[]): void {
  const handler = createShutdownHandler(servers);
  process.on("SIGINT", () => void handler("SIGINT"));
  process.on("SIGTERM", () => void handler("SIGTERM"));
}

// --------------- Exec Mode ---------------

export const EXEC_TOOLS = [
  "maps_geocode",
  "maps_reverse_geocode",
  "maps_search_nearby",
  "maps_search_places",
  "maps_place_details",
  "maps_directions",
  "maps_distance_matrix",
  "maps_elevation",
  "maps_timezone",
  "maps_weather",
  "maps_explore_area",
  "maps_plan_route",
  "maps_compare_places",
  "maps_air_quality",
  "maps_static_map",
  "maps_batch_geocode",
  "maps_search_along_route",
  "maps_local_rank_tracker",
] as const;

type ExecFailureResponse = {
  success: false;
  error?: unknown;
};

interface ExecOutput {
  write(chunk: string): unknown;
}

interface ExecStreams {
  stdout: ExecOutput;
  stderr: ExecOutput;
}

type ExecToolRunner = (toolName: string, params: any, apiKey: string) => Promise<unknown>;

export type DoctorCheck = {
  name: string;
  status: "pass" | "fail" | "skip";
  detail: string;
};

export type DoctorReport = {
  success: boolean;
  version: string;
  live: boolean;
  checks: DoctorCheck[];
};

type DoctorToolRunner = (toolName: string, params: any, apiKey: string) => Promise<unknown>;

function isExecFailureResponse(result: unknown): result is ExecFailureResponse {
  return (
    typeof result === "object" &&
    result !== null &&
    "success" in result &&
    (result as { success?: unknown }).success === false
  );
}

function getExecFailureMessage(toolName: string, result: ExecFailureResponse): string {
  if (typeof result.error === "string" && result.error.trim().length > 0) {
    return result.error;
  }
  if (result.error !== undefined && result.error !== null) {
    return String(result.error);
  }
  return `Tool "${toolName}" returned a failure response`;
}

export async function execTool(toolName: string, params: any, apiKey: string): Promise<any> {
  const searcher = new PlacesSearcher(apiKey);

  switch (toolName) {
    case "maps_geocode":
      return searcher.geocode(params.address);

    case "maps_reverse_geocode":
      return searcher.reverseGeocode(params.latitude, params.longitude);

    case "maps_search_nearby":
      return searcher.searchNearby(params);

    case "maps_search_places":
      return searcher.searchText({
        query: params.query,
        locationBias: params.locationBias,
        openNow: params.openNow,
        minRating: params.minRating,
        includedType: params.includedType,
        strictTypeFiltering: params.strictTypeFiltering,
        priceLevels: params.priceLevels,
        pageSize: params.pageSize,
        pageToken: params.pageToken,
        languageCode: params.languageCode,
        includeRaw: params.includeRaw,
      });

    case "maps_place_details":
      return searcher.getPlaceDetails(params.placeId, params.maxPhotos || 0, params.includeRaw || false);

    case "maps_directions":
      return searcher.getDirections(
        params.origin,
        params.destination,
        params.mode,
        params.departure_time,
        params.arrival_time,
        params.avoid_tolls,
        params.avoid_highways
      );

    case "maps_distance_matrix":
      return searcher.calculateDistanceMatrix(
        params.origins,
        params.destinations,
        params.mode,
        params.departure_time,
        params.avoid_tolls,
        params.avoid_highways
      );

    case "maps_elevation":
      return searcher.getElevation(params.locations);

    case "maps_timezone":
      return searcher.getTimezone(params.latitude, params.longitude, params.timestamp);

    case "maps_weather":
      return searcher.getWeather(
        params.latitude,
        params.longitude,
        params.type,
        params.forecastDays,
        params.forecastHours
      );

    case "maps_explore_area":
      return searcher.exploreArea(params);

    case "maps_plan_route":
      return searcher.planRoute(params);

    case "maps_compare_places":
      return searcher.comparePlaces(params);

    case "maps_air_quality":
      return searcher.getAirQuality(
        params.latitude,
        params.longitude,
        params.includeHealthRecommendations,
        params.includePollutants
      );

    case "maps_static_map":
      return searcher.getStaticMap(params);

    case "maps_batch_geocode": {
      const results = await Promise.all(
        (params.addresses as string[]).map(async (address: string) => {
          try {
            const result = await searcher.geocode(address);
            return { address, ...result };
          } catch (error: any) {
            return { address, success: false, error: error.message };
          }
        })
      );
      const succeeded = results.filter((r) => r.success).length;
      return {
        success: true,
        data: { total: params.addresses.length, succeeded, failed: params.addresses.length - succeeded, results },
      };
    }

    case "maps_search_along_route":
      return searcher.searchAlongRoute(params);

    case "maps_local_rank_tracker":
      return searcher.localRankTracker(params);

    default:
      throw new Error(`Unknown tool: ${toolName}. Available: ${EXEC_TOOLS.join(", ")}`);
  }
}

/**
 * Run an exec-mode tool and route its result to the appropriate stream.
 *
 * Service methods report API failures as `{ success: false, error }` rather
 * than throwing. Treat those responses as command failures so scripts can
 * rely on the exit code while successful responses remain machine-readable
 * JSON on stdout.
 */
export async function runExecCommand(
  toolName: string,
  params: any,
  apiKey: string,
  runner: ExecToolRunner = execTool,
  streams: ExecStreams = { stdout: process.stdout, stderr: process.stderr }
): Promise<number> {
  try {
    const result = await runner(toolName, params, apiKey);
    if (isExecFailureResponse(result)) {
      streams.stderr.write(JSON.stringify({ error: getExecFailureMessage(toolName, result) }, null, 2) + "\n");
      return 1;
    }

    streams.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  } catch (error: unknown) {
    streams.stderr.write(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) + "\n"
    );
    return 1;
  }
}

/** @brief Selectable live-probe identifier used by `doctor --live --probes`. */
export type DoctorProbeId = "geocoding" | "places-new" | "routes";

/** @brief Static definition of one billable live probe executed by doctor. */
export interface DoctorLiveProbe {
  readonly id: DoctorProbeId;
  readonly name: string;
  readonly tool: string;
  readonly params: Record<string, unknown>;
}

/**
 * @brief Registry of the three independent live probes (Geocoding, Places (New), Routes).
 * @details Each probe maps to one cheap `exec` tool call; probes run
 * independently so a single API outage fails exactly one check. Complexity
 * O(1); pure constant.
 * @satisfies REQ-072, REQ-091
 */
export const DOCTOR_PROBES: readonly DoctorLiveProbe[] = [
  { id: "geocoding", name: "geocoding-api", tool: "maps_geocode", params: { address: "Tokyo Tower" } },
  { id: "places-new", name: "places-api-new", tool: "maps_search_places", params: { query: "Tokyo Tower" } },
  {
    id: "routes",
    name: "routes-api",
    tool: "maps_directions",
    params: { origin: "Tokyo Tower", destination: "Tokyo Station", mode: "walking" },
  },
];

/** @brief Accepted case-insensitive `--probes` spellings per probe id. */
const DOCTOR_PROBE_ALIASES: Readonly<Record<string, DoctorProbeId>> = {
  geocoding: "geocoding",
  "geocoding-api": "geocoding",
  "places-new": "places-new",
  places: "places-new",
  "places-api-new": "places-new",
  routes: "routes",
  "routes-api": "routes",
};

/** @brief Parsed `--probes` CLI value: either valid probe ids or an error. */
export interface DoctorProbesParseResult {
  probes: DoctorProbeId[] | undefined;
  error?: string;
}

/**
 * @brief Parses the raw `--probes` CLI string into validated probe ids.
 * @details `undefined` input -> `{ probes: undefined }` (probe all three,
 * legacy `--live` behavior). Splits on commas, trims, lowercases, maps through
 * `DOCTOR_PROBE_ALIASES`, dedupes, and rejects unknown names or an empty list
 * with a remediation error. Complexity O(n) in items; pure.
 * @param raw {string | undefined} Raw option value from argv.
 * @return {DoctorProbesParseResult} Validated ids, or `error` describing the invalid input.
 * @satisfies REQ-091
 */
export function parseDoctorProbes(raw: string | undefined): DoctorProbesParseResult {
  if (raw === undefined) {
    return { probes: undefined };
  }
  const items = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (items.length === 0) {
    return { probes: undefined, error: "--probes received no probe names (expected: geocoding, places-new, routes)" };
  }
  const probes: DoctorProbeId[] = [];
  for (const item of items) {
    const id = DOCTOR_PROBE_ALIASES[item];
    if (!id) {
      return { probes: [], error: `unknown probe "${item}" (expected: geocoding, places-new, routes)` };
    }
    if (!probes.includes(id)) {
      probes.push(id);
    }
  }
  return { probes };
}

/**
 * @brief Injectable doctor dependencies for deterministic testing.
 * @details `nodeVersion` overrides `process.versions.node`; `config` overrides
 * environment-derived runtime configuration; `allToolNames` overrides the
 * registered tool-name registry used by the profile check.
 */
export interface DoctorOptions {
  probes?: readonly DoctorProbeId[];
  nodeVersion?: string;
  config?: ResolvedRuntimeConfig;
  allToolNames?: readonly string[];
}

/**
 * @brief Runs the readiness self-check decoupled from server startup.
 * @details Local checks (zero network calls): Node major >=
 * `NODE_ENGINE_FLOOR` (24, aligned with `package.json` `engines`, REQ-070),
 * non-zero package version, API key presence (value hidden), effective
 * configuration diagnostics with masked secrets and per-field sources
 * (REQ-089, zero-match allowlist reported as fail), and the per-tool Google
 * API profile of the effective tool set (REQ-090). Live branch: without
 * `options.probes` runs all three probes (legacy `--live`, REQ-072); with
 * `options.probes` runs only the selected subset (REQ-091); each probe fails
 * independently. `success` is false when any check fails; the caller maps it
 * to the exit code.
 * @param packageVersion {string} Installed package version ("0.0.0" = unknown).
 * @param apiKey {string | undefined} Resolved API key; never printed.
 * @param live {boolean} True to run billable live probes.
 * @param runner {DoctorToolRunner} Injectable tool runner; defaults to `execTool`.
 * @param options {DoctorOptions} Injectable Node version, config, tool registry, and probe subset.
 * @return {Promise<DoctorReport>} JSON-serializable report with `checks` and aggregate `success`.
 * @see resolveRuntimeConfig
 * @see describeToolsProfile
 * @satisfies REQ-070, REQ-071, REQ-072, REQ-089, REQ-090, REQ-091
 */
export async function runDoctor(
  packageVersion: string,
  apiKey: string | undefined,
  live = false,
  runner: DoctorToolRunner = execTool,
  options: DoctorOptions = {}
): Promise<DoctorReport> {
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const nodeMajor = Number.parseInt(nodeVersion.split(".")[0] ?? "0", 10);
  const config = options.config ?? resolveRuntimeConfig(loadCliSettings());
  const allToolNames = options.allToolNames ?? serverConfigs[0].tools.map((tool) => tool.name);
  const toolsResolution = resolveEnabledToolNames(allToolNames, config.enabledToolsRaw);
  const diagnostics = describeRuntimeConfig(config);
  const toolsProfile = describeToolsProfile(toolsResolution.names);

  const checks: DoctorCheck[] = [
    {
      name: "node",
      status: nodeMajor >= NODE_ENGINE_FLOOR ? "pass" : "fail",
      detail: `Node.js ${nodeVersion} detected; version ${NODE_ENGINE_FLOOR} or newer is required (package.json engines).`,
    },
    {
      name: "package",
      status: packageVersion !== "0.0.0" ? "pass" : "fail",
      detail:
        packageVersion !== "0.0.0"
          ? `mcp-google-api ${packageVersion} is available.`
          : "Could not read the installed package version.",
    },
    {
      name: "api-key",
      status: apiKey ? "pass" : "fail",
      detail: apiKey
        ? "Google Maps API key is configured via 'mcp-google-api api-key' (value hidden)."
        : "Google Maps API key is not configured. Run 'mcp-google-api api-key <your-api-key>' to configure it.",
    },
    {
      name: "config",
      status: toolsResolution.fallback ? "fail" : "pass",
      detail: toolsResolution.fallback
        ? `enabledTools matched 0 tools; the server falls back to all ${allToolNames.length} tools. Effective configuration: ${formatConfigDiagnostics(diagnostics)}`
        : `Effective configuration: ${formatConfigDiagnostics(diagnostics)}`,
    },
    {
      name: "tools",
      status: "pass",
      detail: `${toolsProfile.toolCount} tool(s) enabled; Google APIs: ${toolsProfile.apis.join(", ") || "none"}; per-tool: ${toolsProfile.tools.map((tool) => `${tool.tool}[${tool.apis.join("+")}]`).join(", ")}`,
    },
  ];

  if (!live) {
    checks.push({
      name: "live-api",
      status: "skip",
      detail: "Live API checks were not requested; no Google Maps API calls were made.",
    });
  } else if (!apiKey) {
    checks.push({
      name: "live-api",
      status: "skip",
      detail: "Live API checks require a configured Google Maps API key.",
    });
  } else {
    const selected = options.probes
      ? DOCTOR_PROBES.filter((probe) => (options.probes as readonly DoctorProbeId[]).includes(probe.id))
      : DOCTOR_PROBES;

    for (const check of selected) {
      try {
        const result = await runner(check.tool, check.params, apiKey);
        if (isExecFailureResponse(result)) {
          checks.push({
            name: check.name,
            status: "fail",
            detail: getExecFailureMessage(check.tool, result),
          });
        } else {
          checks.push({
            name: check.name,
            status: "pass",
            detail: `${check.name} request succeeded.`,
          });
        }
      } catch (error: unknown) {
        checks.push({
          name: check.name,
          status: "fail",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    success: checks.every((check) => check.status !== "fail"),
    version: packageVersion,
    live,
    checks,
  };
}

// --------------- Snippet Mode ---------------

/**
 * @brief Renders a client registration snippet and routes output per PRJ-008.
 * @details Delegates JSON construction to `renderClientSnippet`, writes the
 * snippet JSON to `stdout` and each guidance note to `stderr` so stdout stays
 * pure JSON; never writes or edits any file. Rendering errors surface as a
 * JSON stderr error with exit code 1. Complexity O(1).
 * @param options {SnippetOptions} Rendering options forwarded to `renderClientSnippet`.
 * @param streams {ExecStreams} Injectable stdout/stderr sinks; defaults to process streams.
 * @return {number} Exit code: 0 on success, 1 on a rendering error.
 * @see renderClientSnippet
 * @satisfies PRJ-010, REQ-092, REQ-093
 */
export function runSnippetCommand(
  options: SnippetOptions,
  streams: ExecStreams = { stdout: process.stdout, stderr: process.stderr }
): number {
  try {
    const snippet = renderClientSnippet(options);
    streams.stdout.write(snippet.json + "\n");
    for (const note of snippet.notes) {
      streams.stderr.write(`[snippet] ${note}\n`);
    }
    return 0;
  } catch (error: unknown) {
    streams.stderr.write(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) + "\n"
    );
    return 1;
  }
}

// --------------- CLI Configuration Management ---------------

/**
 * @brief Enables or disables one supported CLI in the persisted settings.
 * @details Resolves the CLI adapter case-insensitively; unsupported names
 * exit 2 with a JSON stderr error listing supported names (REQ-110).
 * Idempotent: enabling an enabled CLI and disabling a disabled CLI succeed
 * without rewriting the settings file (REQ-111). Success prints a
 * human-readable stdout confirmation naming the resolved CLI and the
 * resulting enabled state (REQ-184, human-readable exception to PRJ-008).
 * @param name {string} CLI name from the command line.
 * @param enable {boolean} True to enable; false to disable.
 * @param options {object} `{ home?, streams? }`; streams default to process streams.
 * @return {number} Exit code: 0 on success, 2 for an unsupported CLI.
 * @see loadCliSettings
 * @see saveCliSettings
 * @satisfies REQ-110, REQ-111, REQ-184
 */
export function runEnableDisableCliCommand(
  name: string,
  enable: boolean,
  options: { home?: string; streams?: ExecStreams } = {}
): number {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  const target = resolveCliTarget(name);
  if (target === undefined) {
    streams.stderr.write(
      JSON.stringify({ error: `Unsupported CLI: ${name}. Supported: ${supportedCliNames()}.` }, null, 2) + "\n"
    );
    return 2;
  }
  const settings = loadCliSettings(options.home);
  const already = settings.enabled.includes(target.id);
  if (enable === already) {
    streams.stdout.write(`${target.id} is already ${enable ? "enabled" : "disabled"}.\n`);
    return 0;
  }
  settings.enabled = enable
    ? [...settings.enabled, target.id]
    : settings.enabled.filter((item) => item !== target.id);
  saveCliSettings(settings, options.home);
  streams.stdout.write(`${enable ? "Enabled" : "Disabled"} ${target.id}.\n`);
  return 0;
}

/**
 * @brief Saves the Google Maps API key in the persisted settings and refreshes enabled-CLI registrations.
 * @details Validates the key first (REQ-020 format via `ApiKeyManager`),
 * rejecting empty, whitespace-only, or malformed input with a human-readable
 * stderr error and non-zero exit before any write (REQ-137); persists the key
 * as the settings `apiKey` field atomically (REQ-136, DES-023); then runs the
 * install operation for every enabled CLI with REQ-116 and REQ-119 semantics
 * (REQ-138) and without the debug overlay (REQ-159). Prints a human-readable
 * operation report on stdout (REQ-139,
 * human-readable exception to PRJ-008): the configured-key confirmation with
 * the DES-016 masked key, then one line per processed CLI with its install
 * result, or the enable hint when zero CLIs are enabled.
 * @param key {string | undefined} Raw key argument from the command line.
 * @param options {object} `{ home?, resourcesRoot, streams? }`; streams default to process streams.
 * @return {number} Exit code: 0 on success or zero enabled CLIs, 1 on validation, persistence, or install failure.
 * @see loadCliSettings
 * @see saveCliSettings
 * @see installEnabledCliResources
 * @satisfies REQ-136, REQ-137, REQ-138, REQ-139, REQ-159
 */
export function runApiKeyCommand(
  key: string | undefined,
  options: { home?: string; resourcesRoot: string; streams?: ExecStreams }
): number {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  const trimmed = (key ?? "").trim();
  if (!ApiKeyManager.getInstance().isValidApiKeyFormat(trimmed)) {
    streams.stderr.write(
      "api-key: invalid Google Maps API key. Expected 20-50 characters of letters, digits, hyphens, or underscores.\n" +
        "Usage: mcp-google-api api-key <your-api-key>\n"
    );
    return 1;
  }
  try {
    const settings = loadCliSettings(options.home);
    settings.apiKey = trimmed;
    saveCliSettings(settings, options.home);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    streams.stderr.write(`api-key: failed to persist the API key: ${message}\n`);
    return 1;
  }
  streams.stdout.write(`API key configured (${maskSecret(trimmed)}).\n`);
  let install: CliOperationResult;
  try {
    install = installEnabledCliResources({ home: options.home, resourcesRoot: options.resourcesRoot });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    streams.stderr.write(`api-key: install failed: ${message}\n`);
    return 1;
  }
  if (install.summaries.length === 0 && install.errors.length === 0) {
    streams.stdout.write("No CLI agent enabled. Run 'mcp-google-api enable <cli name>' first.\n");
    return 0;
  }
  for (const summary of install.summaries) {
    streams.stdout.write(
      `${summary.cli}: MCP connector installed (server entries: ${summary.server}, skills: ${summary.skills}).\n`
    );
  }
  for (const error of install.errors) {
    streams.stdout.write(`${error}\n`);
  }
  return install.errors.length > 0 ? 1 : 0;
}

/**
 * @brief Enables or disables the automatic update check in the persisted settings.
 * @details Accepts `enable`, `disable`, `1`, `0` case-insensitively (REQ-148)
 * and persists the resolved boolean into the settings `autoUpdate` field
 * atomically before printing any result (REQ-149, DES-024). Prints a
 * human-readable confirmation on stdout (REQ-150, human-readable exception to
 * PRJ-008). A missing or non-accepted value prints a human-readable stderr
 * error listing the accepted values and persists nothing (REQ-151).
 * @param rawState {string | undefined} Raw state argument from the command line.
 * @param options {object} `{ home?, streams? }`; streams default to process streams.
 * @return {number} Exit code: 0 on success, 1 on an invalid value or persistence failure.
 * @see loadCliSettings
 * @see saveCliSettings
 * @satisfies REQ-148, REQ-149, REQ-150, REQ-151
 */
export function runAutoUpdateCommand(
  rawState: string | undefined,
  options: { home?: string; streams?: ExecStreams } = {}
): number {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  const normalized = (rawState ?? "").trim().toLowerCase();
  let enabled: boolean;
  if (normalized === "enable" || normalized === "1") {
    enabled = true;
  } else if (normalized === "disable" || normalized === "0") {
    enabled = false;
  } else {
    streams.stderr.write(
      `auto-update: invalid value "${rawState ?? ""}". Accepted values: enable, disable, 1, 0.\n`
    );
    return 1;
  }
  try {
    const settings = loadCliSettings(options.home);
    settings.autoUpdate = enabled;
    saveCliSettings(settings, options.home);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    streams.stderr.write(`auto-update: failed to persist the setting: ${message}\n`);
    return 1;
  }
  streams.stdout.write(enabled ? "Auto-update check enabled.\n" : "Auto-update check disabled.\n");
  return 0;
}

/**
 * @brief Persists the enabled-tool allowlist via the `tools` command.
 * @details Accepts a comma-separated tool-name list or the literal `*`
 * (full set). Unknown names, empty items only, or a missing value print a
 * human-readable stderr error listing the accepted names and exit 1 without
 * persisting anything (REQ-167); a valid value is persisted atomically into
 * the settings `enabledTools` field before the human-readable stdout
 * confirmation is printed. Complexity O(n + m).
 * @param raw {string | undefined} Raw positional argument from the command line.
 * @param options {object} `{ home?, streams? }`; streams default to process streams.
 * @return {number} Exit code: 0 on success, 1 on invalid input or persistence failure.
 * @see loadCliSettings
 * @see saveCliSettings
 * @satisfies REQ-167
 */
export function runToolsCommand(
  raw: string | undefined,
  options: { home?: string; streams?: ExecStreams } = {}
): number {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  const allToolNames = serverConfigs[0].tools.map((tool) => tool.name);
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    streams.stderr.write(
      `tools: missing or empty tool list. Use '*' for all tools or a comma-separated subset of: ${allToolNames.join(", ")}.\n`
    );
    return 1;
  }
  let value: string;
  if (trimmed === "*") {
    value = "*";
  } else {
    const requested = trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const unknown = requested.filter((item) => !allToolNames.includes(item));
    if (requested.length === 0 || unknown.length > 0) {
      streams.stderr.write(
        `tools: unknown tool name(s): ${unknown.join(", ") || "(none)"}. Accepted: ${allToolNames.join(", ")} (or '*').\n`
      );
      return 1;
    }
    value = requested.join(",");
  }
  try {
    const settings = loadCliSettings(options.home);
    settings.enabledTools = value;
    saveCliSettings(settings, options.home);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    streams.stderr.write(`tools: failed to persist the setting: ${message}\n`);
    return 1;
  }
  const count = value === "*" ? allToolNames.length : value.split(",").length;
  streams.stdout.write(`Enabled tools set to ${value === "*" ? `* (all ${count})` : value}.\n`);
  return 0;
}

/**
 * @brief Persists the HTTP bind host via the `host` command.
 * @details Rejects missing or whitespace-only values with a human-readable
 * stderr error, persisting nothing (REQ-168); a valid non-empty hostname is
 * persisted atomically into the settings `host` field before the
 * human-readable stdout confirmation is printed. Complexity O(1).
 * @param raw {string | undefined} Raw positional argument from the command line.
 * @param options {object} `{ home?, streams? }`; streams default to process streams.
 * @return {number} Exit code: 0 on success, 1 on invalid input or persistence failure.
 * @see loadCliSettings
 * @see saveCliSettings
 * @satisfies REQ-168
 */
export function runHostCommand(
  raw: string | undefined,
  options: { home?: string; streams?: ExecStreams } = {}
): number {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    streams.stderr.write("host: missing or empty hostname. Example: mcp-google-api host 127.0.0.1\n");
    return 1;
  }
  try {
    const settings = loadCliSettings(options.home);
    settings.host = trimmed;
    saveCliSettings(settings, options.home);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    streams.stderr.write(`host: failed to persist the setting: ${message}\n`);
    return 1;
  }
  streams.stdout.write(`HTTP bind host set to ${trimmed}.\n`);
  return 0;
}

/**
 * @brief Persists the HTTP listen port via the `port` command.
 * @details Rejects missing or non-integer values outside 1..65535 with a
 * human-readable stderr error, persisting nothing (REQ-169); a valid port is
 * persisted atomically into the settings `port` field before the
 * human-readable stdout confirmation is printed. Complexity O(1).
 * @param raw {string | undefined} Raw positional argument from the command line.
 * @param options {object} `{ home?, streams? }`; streams default to process streams.
 * @return {number} Exit code: 0 on success, 1 on invalid input or persistence failure.
 * @see loadCliSettings
 * @see saveCliSettings
 * @satisfies REQ-169
 */
export function runPortCommand(
  raw: string | undefined,
  options: { home?: string; streams?: ExecStreams } = {}
): number {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  const trimmed = (raw ?? "").trim();
  const parsed = Number(trimmed);
  if (trimmed.length === 0 || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    streams.stderr.write(`port: invalid port "${trimmed || "(none)"}" (expected integer 1-65535).\n`);
    return 1;
  }
  try {
    const settings = loadCliSettings(options.home);
    settings.port = parsed;
    saveCliSettings(settings, options.home);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    streams.stderr.write(`port: failed to persist the setting: ${message}\n`);
    return 1;
  }
  streams.stdout.write(`HTTP port set to ${parsed}.\n`);
  return 0;
}

/**
 * @brief Shared handler for the `install` and `uninstall` commands.
 * @details Runs the requested operation over every enabled CLI and prints a
 * human-readable per-CLI activity report on stdout (REQ-166): one header
 * line `mcp-google-api <operation> report:`, one indented line per processed
 * CLI stating the server registration and installed/removed skill count, and
 * an `Errors:` block listing every collected diagnostic; exits 1 when any
 * per-CLI failure was collected (REQ-116). With zero enabled CLIs prints the
 * enable hint and exits 0 (REQ-119). `install` forwards `includeDebugSkills`
 * so each skill's declared debug overlay is appended to the installed
 * `SKILL.md` only when REQ-154 `--debug-skills` is requested.
 * @param operation {"install" | "uninstall"} Requested reciprocal operation.
 * @param options {object} `{ home?, resourcesRoot, includeDebugSkills?, streams? }`.
 * @return {number} Exit code: 0 on success or zero enabled CLIs, 1 on failures.
 * @see installEnabledCliResources
 * @see uninstallEnabledCliResources
 * @satisfies REQ-114, REQ-115, REQ-116, REQ-119, REQ-154, REQ-155, REQ-156, REQ-166
 */
export function runInstallUninstallCommand(
  operation: "install" | "uninstall",
  options: { home?: string; resourcesRoot: string; includeDebugSkills?: boolean; streams?: ExecStreams }
): number {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  if (loadCliSettings(options.home).enabled.length === 0) {
    streams.stdout.write("No CLI agent enabled. Run 'mcp-google-api enable <cli name>' first.\n");
    return 0;
  }
  let result: CliOperationResult;
  try {
    result =
      operation === "install"
        ? installEnabledCliResources({
            home: options.home,
            resourcesRoot: options.resourcesRoot,
            includeDebugSkills: options.includeDebugSkills === true,
          })
        : uninstallEnabledCliResources({ home: options.home, resourcesRoot: options.resourcesRoot });
  } catch (error: unknown) {
    streams.stderr.write(
      `${operation} failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }
  streams.stdout.write(`mcp-google-api ${operation} report:\n`);
  for (const summary of result.summaries) {
    streams.stdout.write(
      `  ${summary.cli}: MCP server ${operation === "install" ? "registered" : "removed"}, ${summary.skills} skill(s) ${operation === "install" ? "installed" : "removed"}\n`
    );
  }
  if (result.errors.length > 0) {
    streams.stdout.write("Errors:\n");
    for (const error of result.errors) {
      streams.stdout.write(`  ${error}\n`);
    }
  }
  return result.errors.length > 0 ? 1 : 0;
}

/**
 * @brief Prints the CLI Configuration and Installation Status tables.
 * @details Delegates rendering to `buildCliShowReport` and writes the report
 * text to stdout (human-readable exception to PRJ-008). Manifest or render
 * failures surface as a JSON stderr error with exit code 1.
 * @param options {object} `{ home?, resourcesRoot, streams? }`.
 * @return {number} Exit code: 0 on success, 1 on a report failure.
 * @see buildCliShowReport
 * @satisfies REQ-117, REQ-118, REQ-119
 */
export function runShowCommand(
  options: { home?: string; resourcesRoot: string; streams?: ExecStreams }
): number {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  try {
    streams.stdout.write(buildCliShowReport(options) + "\n");
    return 0;
  } catch (error: unknown) {
    streams.stderr.write(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) + "\n"
    );
    return 1;
  }
}

// --------------- Entry Point ---------------

// Check if this script is being run directly
/**
 * @brief Detects whether this module is the process main module.
 * @details Compares the REAL paths of both sides after symlink resolution:
 * `realpathSync(process.argv[1])` versus the real path of this module
 * derived from `import.meta.url`. Node resolves the main module through
 * symlinks (preserve-symlinks off), so `import.meta.url` carries the real
 * path while `process.argv[1]` keeps the invocation path; resolving BOTH
 * sides makes every symlinked launcher (npm global `bin/` links, `_npx`
 * `.bin` shims, user aliases, renamed distribution bins) match regardless
 * of the launcher basename. The previous string-concatenated comparison
 * `import.meta.url === `file://${process.argv[1]}`` was false for every
 * symlinked launch, silently skipping the whole CLI dispatch (exit 0 with
 * no output; MCP stdio clients report "MCP connection closed"). Returns
 * false when `process.argv[1]` is missing, empty, or not an existing path
 * (plain module import, REPL); never throws. Complexity O(1) filesystem
 * metadata lookups; no side effects.
 * @return {boolean} True when this module was launched as the main module.
 * @satisfies PRJ-003
 */
function isEntryMainModule(): boolean {
  const entryPath = process.argv[1];
  if (entryPath === undefined || entryPath === "") {
    return false;
  }
  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/**
 * @brief Detects a stdio server-start argv shape that the entry gate skipped.
 * @details Matches the registered MCP-client stdio launch shape (REQ-114
 * launcher `npx -y mcp-google-api start --stdio`): the post-entry argument
 * vector contains the `start` or `run` command token (REQ-079) together with
 * the `--stdio` flag. This shape reaching the skipped-dispatch branch means
 * the running artifact is not the current entrypoint — the stale-build
 * signature of a renamed distribution, which previously exited 0 with no
 * output and surfaced to MCP clients as "MCP connection closed". Pure;
 * complexity O(n) in argument count; no side effects.
 * @param args {readonly string[]} Post-entry process arguments (argv slice 2).
 * @return {string | undefined} Build-remediation guidance text (REQ-094)
 * naming the local rebuild and the global-refresh commands; undefined for
 * any other argv shape (plain module imports, unrelated commands).
 * @satisfies REQ-094
 */
export function describeUndispatchedServerStart(args: readonly string[]): string | undefined {
  const isServerStart = (args.includes("start") || args.includes("run")) && args.includes("--stdio");
  if (!isServerStart) {
    return undefined;
  }
  return (
    "CLI dispatch was skipped for this server-start launch: the running artifact is not the " +
    "mcp-google-api entrypoint (stale build after a distribution rename). Rebuild the local " +
    "artifact with 'npm run build' (or 'npm run verify'), or refresh the global installation " +
    "with 'npm install -g mcp-google-api@latest', then reconnect the MCP client."
  );
}

/**
 * @brief Reports an undispatched server-start launch on stderr and exits non-zero.
 * @details Detects the server-start argv shape via
 * `describeUndispatchedServerStart`; when present, writes exactly one JSON
 * diagnostic object (`error`, `requestedEntry`, `modulePath`, `remediation`)
 * to the injected stderr sink and returns exit code 1. stdout is never
 * touched, preserving JSON-RPC framing in stdio mode (CTN-003, REQ-015).
 * Non-server-start argv shapes keep the legacy silent exit-0 no-op so plain
 * module imports and unrelated tooling are unaffected (PRJ-003). The exit
 * code is returned, never exited inline.
 * @param args {readonly string[]} Post-entry process arguments (argv slice 2).
 * @param streams {object} Injectable stderr sink; defaults to `process.stderr`.
 * @return {number} 1 when the remediation diagnostic was emitted; 0 otherwise.
 * @satisfies REQ-094, REQ-015, CTN-003
 */
export function handleUndispatchedEntry(
  args: readonly string[],
  streams: { stderr: { write: (text: string) => unknown } } = process
): number {
  const error = describeUndispatchedServerStart(args);
  if (error === undefined) {
    return 0;
  }
  streams.stderr.write(
    JSON.stringify(
      {
        error,
        requestedEntry: process.argv[1] ?? null,
        modulePath: fileURLToPath(import.meta.url),
        remediation: ["npm run build", "npm install -g mcp-google-api@latest"],
      },
      null,
      2
    ) + "\n"
  );
  return 1;
}

const isMainModule = isEntryMainModule();

if (isMainModule) {
  let packageVersion = "0.0.0";
  try {
    const packageJsonPath = resolve(__dirname, "../package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    packageVersion = packageJson.version;
  } catch (e) {
    packageVersion = "0.0.0";
  }

  // Top-level management commands (--ver/--version/--upgrade/--uninstall) are
  // dispatched before yargs because they are flags, not subcommands. The
  // forced idle-bypassing version check and the child-process upgrade flows
  // run exclusively here (REQ-120, REQ-125, REQ-126, REQ-127). The --upgrade
  // command additionally accepts the --develop option or its equivalent
  // --dev alias selecting the latest tagged GitHub release install source
  // (REQ-170, REQ-177) and the auxiliary --force option forcing package
  // re-download and complete reinstallation (REQ-187).
  const managementCommand = parseManagementCommand(hideBin(process.argv));
  if (managementCommand !== undefined) {
    const upgradeChannel = parseUpgradeChannel(hideBin(process.argv));
    const upgradeForce = parseUpgradeForce(hideBin(process.argv));
    void runManagementCommand(managementCommand, { currentVersion: packageVersion, channel: upgradeChannel, force: upgradeForce })
      .then((code) => {
        process.exitCode = code;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(JSON.stringify({ error: message }, null, 2) + "\n");
        process.exitCode = 1;
      });
  } else if (runConfigCommandIfMatched(hideBin(process.argv))) {
    // The configuration interface (--print/--info/--print-raw/--get/--set/--unset)
    // is dispatched before yargs because those actions are flags carrying
    // positional arguments rather than subcommands (DES-028, PRJ-023).
  } else {
    /**
     * @brief Applies the shared server-start options to a yargs builder.
     * @details Declares `--port`, `--host`, and `--stdio` with defaults taken
     * from the persisted settings (DES-015) plus the server-mode examples.
     * Shared verbatim by the `start` and `run` commands so both expose an
     * identical option surface (PRJ-003). Complexity O(1).
     * @param yargs {Argv} Builder of the command being configured.
     * @return {Argv} The same builder instance with the typed server options attached.
     * @satisfies REQ-079, REQ-008
     */
    const buildServerCommandOptions = (yargs: Argv) => {
      const settings = loadCliSettings();
      return yargs
        .option("port", {
          alias: "p",
          type: "number",
          description: "Port to run the MCP server on (default: configured 'port' setting or 3000)",
          default: settings.port,
        })
        .option("host", {
          type: "string",
          description: "Hostname to bind the server to (default: configured 'host' setting or 127.0.0.1; 0.0.0.0 for all interfaces)",
          default: settings.host,
        })
        .option("stdio", {
          type: "boolean",
          description: "Use stdio transport instead of HTTP",
          default: false,
        })
        .example([
          ["$0 start", "Start HTTP server with default settings"],
          ["$0 start --host 0.0.0.0 --port 3000", "Start HTTP accessible from all interfaces"],
          ["$0 start --stdio", "Start in stdio mode (for MCP clients)"],
          ["$0 run --stdio", "Alias: run the server in stdio mode"],
        ]);
    };

    /** Parsed argv shape produced by `buildServerCommandOptions` (port/host/apikey/stdio). */
    type ServerCommandArgs = BuilderArguments<typeof buildServerCommandOptions>;

    /**
     * @brief Server-start handler shared by the `start` and `run` commands.
     * @details Resolves the effective API key exclusively from the persisted
     * settings key (REQ-142) and injects it into `ApiKeyManager` (DES-006);
     * fires the idle-gated automatic update check fire-and-forget only when
     * the persisted `autoUpdate` setting enables it (REQ-082, REQ-083,
     * DES-024; never blocks startup), then starts stdio mode when `--stdio`
     * is passed — exiting 1 with a stderr JSON error naming the `api-key`
     * command when no key resolves (REQ-143) — otherwise HTTP mode via
     * `startServer` with the flag-or-settings host and port (REQ-008),
     * exiting 1 when zero instances listen (REQ-095). The HTTP banner
     * identifies the application as `MCP Google API server` (REQ-165).
 * HTTP mode without an API key logs a warning and still starts (REQ-080).
     * @param argv {ServerCommandArgs} Parsed options: `--port`, `--host`, `--stdio`.
     * @return {Promise<void>} Resolves when stdio mode stops; HTTP mode persists.
     * @satisfies REQ-079, REQ-080, REQ-082, REQ-095, REQ-142, REQ-143, REQ-165
     */
    const runServerCommand = async (argv: ServerCommandArgs): Promise<void> => {
      // REQ-142: the effective key resolves exclusively from the persisted
      // settings (`api-key` command); empty values are unset.
      // Injected into the key manager so every default-key consumer sees it.
      const effectiveApiKey = loadConfiguredApiKey();
      ApiKeyManager.getInstance().setDefaultApiKey(effectiveApiKey);

      // REQ-082/REQ-083: the idle-gated update check runs only when the
      // persisted settings enable it (DES-024, enabled by default).
      // Fire-and-forget so it never blocks startup; diagnostics on stderr.
      if (loadCliSettings().autoUpdate) {
        void checkVersionIdle({ currentVersion: packageVersion }).catch(() => undefined);
      }

      const tools = filterTools(serverConfigs[0].tools);

      if (argv.stdio) {
        // REQ-143: refuse to boot stdio without a usable key; stdout stays
        // reserved for JSON-RPC, so the error rides on stderr as JSON.
        if (effectiveApiKey === undefined) {
          process.stderr.write(
            JSON.stringify(
              {
                error:
                  "Google Maps API key is not configured. Run 'mcp-google-api api-key <your-api-key>' to configure it.",
              },
              null,
              2
            ) + "\n"
          );
          process.exitCode = 1;
          return;
        }
        // stdio mode — all logs go to stderr, stdout reserved for JSON-RPC
        const server = new BaseMcpServer(serverConfigs[0].name, tools);
        await server.startStdio();
      } else {
        // HTTP mode
        Logger.log("🗺️  MCP Google API server");
        Logger.log("   Google APIs for AI agents over the Model Context Protocol");
        Logger.log("");

        if (effectiveApiKey === undefined) {
          Logger.log("⚠️  Google Maps API Key not found!");
          Logger.log("   Run 'mcp-google-api api-key <your-api-key>' to configure it.");
          Logger.log("");
        }

        startServer(argv.port, effectiveApiKey, argv.host)
          .then((outcome) => {
            if (outcome.started === 0) {
              process.exit(1);
            }
          })
          .catch((error) => {
            Logger.error("❌ Failed to start server:", error);
            process.exit(1);
          });
      }
    };

    /**
     * @brief Builds the fully configured yargs CLI instance (not yet parsed).
     * @details Registers the `start`/`run` server-start commands (REQ-079),
     * every onboarding and management subcommand, and a `$0` fallback that
     * prints the help text so a bare invocation starts nothing (REQ-129).
     * Help output opens with `mcp-google-api v<version>` (REQ-130) and the
     * epilog documents the pre-yargs management commands `--ver`, `--version`,
     * `--upgrade`, `--uninstall` (REQ-131) including the `--develop`/`--dev`
     * upgrade-channel options (REQ-175) and the `--force` forced-reinstall
     * option (REQ-191).
     * @return {Argv} Configured yargs instance ready for `parse()`.
     * @satisfies REQ-079, REQ-129, REQ-130, REQ-131, REQ-191
     */
    const cli = yargs(hideBin(process.argv))
      .scriptName("mcp-google-api")
      .usage(
        `mcp-google-api v${packageVersion}\n\n` +
          `Usage: mcp-google-api <command> [options]\n` +
          `       mcp-google-api start|run [--stdio] [options]`
      )
      .command(
        "doctor",
        "Check standalone CLI readiness without starting an MCP server",
        (yargs) =>
          yargs
            .option("live", {
              type: "boolean",
              default: false,
              description: "Make billable test requests to Geocoding, Places (New), and Routes APIs",
            })
            .option("probes", {
              type: "string",
              description: "Comma-separated subset of live probes: geocoding, places-new, routes (default: all three)",
            })
            .option("apikey", {
              alias: "k",
              type: "string",
              description: "Google Maps API key override for live probes (default: configured api-key setting)",
            })
            .example([
              ["$0 doctor", "Check local runtime and API key configuration without network calls"],
              ["$0 doctor --live", "Also verify three Google Maps APIs with billable requests"],
              ["$0 doctor --live --probes geocoding,routes", "Probe only the selected APIs"],
            ]),
        async (argv) => {
          const parsedProbes = parseDoctorProbes(argv.probes as string | undefined);
          if (parsedProbes.error) {
            process.stderr.write(JSON.stringify({ error: parsedProbes.error }, null, 2) + "\n");
            process.exitCode = 1;
            return;
          }
          const effectiveKey = ((argv.apikey as string | undefined) ?? "").trim() || loadConfiguredApiKey();
          const report = await runDoctor(packageVersion, effectiveKey, argv.live as boolean, undefined, {
            probes: parsedProbes.probes,
            config: resolveRuntimeConfig(loadCliSettings()),
          });
          process.stdout.write(JSON.stringify(report, null, 2) + "\n");
          process.exitCode = report.success ? 0 : 1;
        }
      )
      .command(
        "snippet",
        "Print an MCP client registration snippet (JSON on stdout; never writes files)",
        (yargs) =>
          yargs
            .option("client", {
              type: "string",
              choices: ["generic", "claude", "cursor", "pi"],
              default: "generic",
              description: "Target client (selects the documented target file)",
            })
            .option("transport", {
              type: "string",
              choices: ["stdio", "http"],
              default: "stdio",
              description: "MCP transport of the snippet",
            })
            .option("launcher", {
              type: "string",
              choices: ["npx", "node", "bin"],
              default: "npx",
              description: "stdio launcher command",
            })
            .option("command", {
              type: "string",
              description: "Absolute path to the CLI entry script (required for --launcher node)",
            })
            .option("host", {
              type: "string",
              default: "127.0.0.1",
              description: "Host used in the URL (transport http)",
            })
            .option("port", {
              type: "number",
              default: 3000,
              description: "Port used in the URL (transport http)",
            })
            .option("name", {
              type: "string",
              default: "mcp-google-api",
              description: "Server name inside mcpServers",
            })
            .example([
              ["$0 snippet --client claude", "stdio snippet using the npx launcher"],
              ["$0 snippet --client pi --launcher node --command /abs/path/dist/cli.js", "stdio snippet with an explicit artifact"],
              ["$0 snippet --transport http --port 3100", "HTTP URL snippet"],
            ]),
        (argv) => {
          process.exitCode = runSnippetCommand({
            client: argv.client as SnippetClient,
            transport: argv.transport as "stdio" | "http",
            launcher: argv.launcher as "npx" | "node" | "bin",
            commandPath: argv.command as string | undefined,
            host: argv.host as string,
            port: argv.port as number,
            serverName: argv.name as string,
          });
        }
      )
      .command(
        "enable <cli>",
        "Enable MCP-server and skill installation for a supported CLI",
        (yargs) =>
          yargs
            .positional("cli", {
              type: "string",
              describe: `CLI name: ${supportedCliNames()}`,
            })
            .option("home", {
              type: "string",
              description: "Home-directory override (default: user home)",
            })
            .example([["$0 enable pi", "Enable pi for install/uninstall/show"]]),
        (argv) => {
          process.exitCode = runEnableDisableCliCommand(argv.cli as string, true, {
            home: argv.home as string | undefined,
          });
        }
      )
      .command(
        "disable <cli>",
        "Disable MCP-server and skill installation for a supported CLI",
        (yargs) =>
          yargs
            .positional("cli", {
              type: "string",
              describe: `CLI name: ${supportedCliNames()}`,
            })
            .option("home", {
              type: "string",
              description: "Home-directory override (default: user home)",
            })
            .example([["$0 disable claude", "Disable claude for install/uninstall/show"]]),
        (argv) => {
          process.exitCode = runEnableDisableCliCommand(argv.cli as string, false, {
            home: argv.home as string | undefined,
          });
        }
      )
      .command(
        "auto-update <state>",
        "Enable or disable the automatic update check at startup",
        (yargs) =>
          yargs
            .positional("state", {
              type: "string",
              describe: "New state: enable or disable (1 and 0 accepted)",
            })
            .option("home", {
              type: "string",
              description: "Home-directory override (default: user home)",
            })
            .example([[
              "$0 auto-update disable",
              "Disable the automatic update check",
            ]]),
        (argv) => {
          process.exitCode = runAutoUpdateCommand(argv.state as string | undefined, {
            home: argv.home as string | undefined,
          });
        }
      )
      .command(
        "tools <tools>",
        "Set the enabled tools ('*' = all 18 tools)",
        (yargs) =>
          yargs
            .positional("tools", {
              type: "string",
              describe: "Comma-separated tool names (e.g. maps_geocode,maps_search_places) or '*' for all",
            })
            .option("home", {
              type: "string",
              description: "Home-directory override (default: user home)",
            })
            .example([
              ["$0 tools '*'", "Expose every registered tool (default)"],
              ["$0 tools maps_geocode,maps_search_places", "Expose only the named tools"],
            ]),
        (argv) => {
          process.exitCode = runToolsCommand(argv.tools as string | undefined, {
            home: argv.home as string | undefined,
          });
        }
      )
      .command(
        "host <host>",
        "Set the HTTP bind host (default 127.0.0.1)",
        (yargs) =>
          yargs
            .positional("host", {
              type: "string",
              describe: "Bind hostname (e.g. 127.0.0.1 loopback; 0.0.0.0 for all interfaces)",
            })
            .option("home", {
              type: "string",
              description: "Home-directory override (default: user home)",
            })
            .example([["$0 host 0.0.0.0", "Bind the HTTP server on all interfaces"]]),
        (argv) => {
          process.exitCode = runHostCommand(argv.host as string | undefined, {
            home: argv.home as string | undefined,
          });
        }
      )
      .command(
        "port <port>",
        "Set the HTTP listen port (default 3000)",
        (yargs) =>
          yargs
            .positional("port", {
              type: "number",
              describe: "Listen port (integer 1-65535)",
            })
            .option("home", {
              type: "string",
              description: "Home-directory override (default: user home)",
            })
            .example([["$0 port 3100", "Serve Streamable HTTP on port 3100"]]),
        (argv) => {
          process.exitCode = runPortCommand(argv.port === undefined ? undefined : String(argv.port), {
            home: argv.home as string | undefined,
          });
        }
      )
      .command(
        "api-key <key>",
        "Save the Google Maps API key and refresh every enabled CLI registration",
        (yargs) =>
          yargs
            .positional("key", {
              type: "string",
              describe: "Google Maps API key (20-50 characters: letters, digits, hyphens, underscores)",
            })
            .option("home", {
              type: "string",
              description: "Home-directory override (default: user home)",
            })
            .example([["$0 api-key AIzaSy...", "Save the key and reinstall every enabled CLI"]]),
        (argv) => {
          process.exitCode = runApiKeyCommand(argv.key as string | undefined, {
            home: argv.home as string | undefined,
            resourcesRoot: resolveSkillsResourcesRoot(resolve(__dirname, "..")),
          });
        }
      )
      .command(
        "install",
        "Register the mcp-google-api stdio server and install packaged skills for every enabled CLI",
        (yargs) =>
          yargs
            .option("home", {
              type: "string",
              description: "Home-directory override (default: user home)",
            })
            .option("debug-skills", {
              type: "boolean",
              description: "Append each skill's packaged debug overlay to the installed SKILL.md",
              default: false,
            })
            .example([
              ["$0 install", "Register the server and skills in every enabled CLI"],
              ["$0 install --debug-skills", "Also append the packaged debug overlay to every installed skill"],
            ]),
        (argv) => {
          // REQ-114: registrations carry no key or environment setup; the
          // registered server reads its configuration file at startup (REQ-142).
          process.exitCode = runInstallUninstallCommand("install", {
            home: argv.home as string | undefined,
            resourcesRoot: resolveSkillsResourcesRoot(resolve(__dirname, "..")),
            includeDebugSkills: argv.debugSkills === true,
          });
        }
      )
      .command(
        "uninstall",
        "Remove the mcp-google-api server entry and managed skills from every enabled CLI",
        (yargs) =>
          yargs
            .option("home", {
              type: "string",
              description: "Home-directory override (default: user home)",
            })
            .example([["$0 uninstall", "Reciprocal removal of install for every enabled CLI"]]),
        (argv) => {
          process.exitCode = runInstallUninstallCommand("uninstall", {
            home: argv.home as string | undefined,
            resourcesRoot: resolveSkillsResourcesRoot(resolve(__dirname, "..")),
          });
        }
      )
      .command(
        "show",
        "Show CLI configuration and installation status tables (human-readable)",
        (yargs) =>
          yargs
            .option("home", {
              type: "string",
              description: "Home-directory override (default: user home)",
            })
            .example([["$0 show", "Print CLI Configuration and Installation Status tables"]]),
        (argv) => {
          process.exitCode = runShowCommand({
            home: argv.home as string | undefined,
            resourcesRoot: resolveSkillsResourcesRoot(resolve(__dirname, "..")),
          });
        }
      )
      .command(
        "exec <tool> [params]",
        "Execute a tool directly and output JSON",
        (yargs) => {
          return yargs
            .positional("tool", {
              type: "string",
              describe: `Tool name: ${EXEC_TOOLS.join(", ")}`,
            })
            .positional("params", {
              type: "string",
              describe: "JSON parameters string",
            })
            .example([
              ['$0 exec maps_geocode \'{"address":"Tokyo Tower"}\'', "Geocode an address"],
              [
                '$0 exec maps_search_nearby \'{"center":{"value":"35.68,139.74","isCoordinates":true},"keyword":"restaurant"}\'',
                "Search nearby",
              ],
              ['$0 exec maps_search_places \'{"query":"ramen in Tokyo"}\'', "Text search"],
            ]);
        },
        async (argv) => {
          // CTN-002/REQ-142: exec resolves the key from the persisted settings only.
          const apiKey = loadConfiguredApiKey();
          if (!apiKey) {
            process.stderr.write(
              JSON.stringify(
                {
                  error:
                    "Google Maps API key is not configured. Run 'mcp-google-api api-key <your-api-key>' to configure it.",
                },
                null,
                2
              ) + "\n"
            );
            process.exitCode = 1;
            return;
          }
          try {
            const params = argv.params ? JSON.parse(argv.params as string) : {};
            process.exitCode = await runExecCommand(argv.tool as string, params, apiKey);
          } catch (error: any) {
            process.stderr.write(JSON.stringify({ error: error.message }, null, 2) + "\n");
            process.exitCode = 1;
          }
        }
      )
      .command(
        "batch-geocode",
        "Geocode multiple addresses from a file (one address per line)",
        (yargs) => {
          return yargs
            .option("input", {
              alias: "i",
              type: "string",
              describe: "Input file path (one address per line). Use - for stdin.",
              demandOption: true,
            })
            .option("output", {
              alias: "o",
              type: "string",
              describe: "Output file path (JSON). Defaults to stdout.",
            })
            .option("concurrency", {
              alias: "c",
              type: "number",
              describe: "Max parallel requests",
              default: 20,
            })
            .example([
              ["$0 batch-geocode -i addresses.txt", "Geocode to stdout"],
              ["$0 batch-geocode -i addresses.txt -o results.json", "Geocode to file"],
              ["cat addresses.txt | $0 batch-geocode -i -", "Geocode from stdin"],
            ]);
        },
        async (argv) => {
          // CTN-002/REQ-142: batch-geocode resolves the key from the persisted settings only.
          const apiKey = loadConfiguredApiKey();
          if (!apiKey) {
            console.error("Error: Google Maps API key is not configured. Run 'mcp-google-api api-key <your-api-key>'.");
            process.exit(1);
          }

          // Read addresses
          let lines: string[];
          if (argv.input === "-") {
            // Read from stdin
            const rl = createInterface({ input: process.stdin });
            lines = [];
            for await (const line of rl) {
              const trimmed = line.trim();
              if (trimmed) lines.push(trimmed);
            }
          } else {
            if (!existsSync(argv.input as string)) {
              console.error(`Error: File not found: ${argv.input}`);
              process.exit(1);
            }
            lines = readFileSync(argv.input as string, "utf-8")
              .split("\n")
              .map((l) => l.trim())
              .filter((l) => l.length > 0);
          }

          if (lines.length === 0) {
            console.error("Error: No addresses found in input.");
            process.exit(1);
          }

          const searcher = new PlacesSearcher(apiKey);
          const concurrency = Math.min(Math.max(argv.concurrency as number, 1), 50);
          const results: any[] = [];
          let completed = 0;

          // Process with concurrency limit
          const semaphore = async (tasks: (() => Promise<void>)[], limit: number) => {
            const executing: Promise<void>[] = [];
            for (const task of tasks) {
              const p = task().then(() => {
                executing.splice(executing.indexOf(p), 1);
              });
              executing.push(p);
              if (executing.length >= limit) {
                await Promise.race(executing);
              }
            }
            await Promise.all(executing);
          };

          const tasks = lines.map((address, index) => async () => {
            try {
              const result = await searcher.geocode(address);
              results[index] = { address, ...result };
            } catch (error: any) {
              results[index] = { address, success: false, error: error.message };
            }
            completed++;
            if (!argv.output) return; // Don't log progress when outputting to stdout
            process.stderr.write(`\r  ${completed}/${lines.length} geocoded`);
          });

          await semaphore(tasks, concurrency);

          if (argv.output) {
            process.stderr.write("\n");
          }

          // Summary
          const succeeded = results.filter((r) => r.success).length;
          const failed = results.filter((r) => !r.success).length;
          const summary = { total: lines.length, succeeded, failed, results };

          const json = JSON.stringify(summary, null, 2);

          if (argv.output) {
            writeFileSync(argv.output as string, json, "utf-8");
            console.error(`Done: ${succeeded}/${lines.length} succeeded. Output: ${argv.output}`);
          } else {
            console.log(json);
          }

          process.exit(failed > 0 ? 1 : 0);
        }
      )
      .command(
        "start",
        "Start the MCP server (HTTP by default, --stdio for stdio mode)",
        buildServerCommandOptions,
        runServerCommand
      )
      .command(
        "run",
        "Alias of start: run the MCP server (HTTP by default, --stdio for stdio mode)",
        buildServerCommandOptions,
        runServerCommand
      )
      .command(
        "$0",
        "Print the help text (use start or run to launch the MCP server)",
        (yargs) => yargs,
        () => {
          cli.showHelp("log");
        }
      )
      .version(packageVersion)
      .alias("version", "v")
      .epilog(
        `Management commands (single flags):\n` +
          `  --ver         Print the installed, npmjs-latest, and GitHub-latest versions\n` +
          `  --version     Alias of --ver\n` +
          `  --upgrade     Upgrade the global package to the latest version and refresh installed skills\n` +
          `                --develop | --dev: install the latest tagged GitHub release (any branch)\n` +
          `                --force: force package re-download and complete reinstallation (npm install --force)\n` +
          `  --uninstall   Remove the globally installed mcp-google-api package\n\n` +
          CONFIG_CLI_USAGE
      )
      .help();
    cli.parse();
  }
} else {
  process.exitCode = handleUndispatchedEntry(process.argv.slice(2));
}
