#!/usr/bin/env node

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import yargs from "yargs";
import type { Argv, BuilderArguments } from "yargs";
import { hideBin } from "yargs/helpers";
import serverConfigs, { filterTools } from "./config.js";
import { BaseMcpServer } from "./core/BaseMcpServer.js";
import { Logger } from "./index.js";
import { PlacesSearcher } from "./services/PlacesSearcher.js";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createInterface } from "readline";
import { checkVersionIdle, parseManagementCommand, runManagementCommand } from "./utils/upgradeManager.js";
import {
  NODE_ENGINE_FLOOR,
  applyExplicitEnvFile,
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
import { isUnsetApiKey, loadCliSettings, loadConfiguredApiKey, saveCliSettings } from "./utils/cliSettings.js";
import { resolveCliTarget, supportedCliNames } from "./utils/cliTargets.js";
import {
  installEnabledCliResources,
  resolveInstallApiKey,
  resolveSkillsResourcesRoot,
  uninstallEnabledCliResources,
  type CliOperationResult,
} from "./utils/cliInstaller.js";
import { buildCliShowReport } from "./utils/cliShow.js";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * @brief Extracts the explicit `--env-file <path>` value from a raw argv array.
 * @details Scans for both `--env-file <path>` and `--env-file=<path>` forms
 * before any command parsing so the file loads before option defaults are
 * captured. First match wins. Complexity O(n) in argv length; pure.
 * @param argv {readonly string[]} Raw process argument vector.
 * @return {string | undefined} Path value when present; undefined otherwise.
 * @satisfies CTN-009
 */
export function extractEnvFileOption(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env-file" && i + 1 < argv.length) {
      return argv[i + 1];
    }
    if (arg.startsWith("--env-file=")) {
      return arg.slice("--env-file=".length);
    }
  }
  return undefined;
}

/**
 * @brief Loads environment files for the current CLI invocation.
 * @details Explicit mode (`envFile` set): loads exactly that file via
 * `applyExplicitEnvFile` and exits 1 with a JSON stderr error when missing —
 * no implicit fallback. Implicit mode: loads `.env` from the current working
 * directory first, then from the package installation directory (dotenv never
 * overrides already-set variables). Complexity O(file count).
 * @param envFile {string | undefined} Explicit `--env-file` value; undefined selects implicit discovery.
 * @return {void}
 * @throws {never} Terminates the process via `process.exit(1)` on a missing explicit file.
 * @see applyExplicitEnvFile
 * @satisfies CTN-007, CTN-009
 */
function loadEnvironment(envFile: string | undefined): void {
  if (envFile !== undefined) {
    const result = applyExplicitEnvFile(envFile);
    if (!result.ok) {
      process.stderr.write(JSON.stringify({ error: result.error }, null, 2) + "\n");
      process.exit(1);
    }
    return;
  }
  // Try to load .env from current directory first, then from package directory
  dotenvConfig({ path: resolve(process.cwd(), ".env") });
  // Also try to load from the package installation directory
  dotenvConfig({ path: resolve(__dirname, "../.env") });
}

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
 * @details Applies flag overrides to the environment, validates each instance
 * port (integer 1-65535), skips invalid instances with remediation guidance
 * while marking them failed (REQ-009), awaits `startHttpServer` so listen
 * errors are caught, installs SIGINT/SIGTERM handlers on success (REQ-096),
 * and returns the aggregate outcome. Default bind host is loopback
 * `127.0.0.1` (REQ-008). Complexity O(instances).
 * @param port {number | undefined} `--port` override written to `MCP_SERVER_PORT`.
 * @param apiKey {string | undefined} `--apikey` override written to `GOOGLE_MAPS_API_KEY`.
 * @param host {string | undefined} `--host` override written to `MCP_SERVER_HOST`.
 * @return {Promise<ServerStartupOutcome>} Per-run counts plus listening servers.
 * @see installShutdownHandlers
 * @satisfies REQ-008, REQ-009, REQ-096
 */
export async function startServer(
  port?: number,
  apiKey?: string,
  host?: string
): Promise<ServerStartupOutcome> {
  // Override environment variables with CLI arguments if provided
  if (port) {
    process.env.MCP_SERVER_PORT = port.toString();
  }
  if (apiKey) {
    process.env.GOOGLE_MAPS_API_KEY = apiKey;
  }
  if (host) {
    process.env.MCP_SERVER_HOST = host;
  }

  Logger.log("🚀 Starting Google Maps MCP Server...");
  Logger.log("📍 18 tools registered (set GOOGLE_MAPS_ENABLED_TOOLS to limit)");
  Logger.log(
    "ℹ️  Reminder: enable Places API (New) in https://console.cloud.google.com before using the new Place features."
  );
  Logger.log("");

  const servers: BaseMcpServer[] = [];
  let started = 0;
  let failed = 0;

  await Promise.all(
    serverConfigs.map(async (config) => {
      const portString = process.env[config.portEnvVar];
      if (!portString) {
        Logger.error(`⚠️  [${config.name}] Port environment variable ${config.portEnvVar} not set.`);
        Logger.log(`💡 Please set ${config.portEnvVar} in your .env file or use --port parameter.`);
        Logger.log(`   Example: ${config.portEnvVar}=3000 or --port 3000`);
        failed++;
        return;
      }

      const serverPort = Number(portString);
      if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
        Logger.error(
              `❌ [${config.name}] Invalid port number "${portString}" defined in ${config.portEnvVar} (expected integer 1-65535).`
        );
        failed++;
        return;
      }

      try {
        const activeTools = filterTools(config.tools);
        const server = new BaseMcpServer(config.name, activeTools);
        const serverHost = process.env.MCP_SERVER_HOST || "127.0.0.1";
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
  "geocode",
  "reverse-geocode",
  "search-nearby",
  "search-places",
  "place-details",
  "directions",
  "distance-matrix",
  "elevation",
  "timezone",
  "weather",
  "explore-area",
  "plan-route",
  "compare-places",
  "air-quality",
  "static-map",
  "batch-geocode-tool",
  "search-along-route",
  "local-rank-tracker",
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
    case "geocode":
    case "maps_geocode":
      return searcher.geocode(params.address);

    case "reverse-geocode":
    case "maps_reverse_geocode":
      return searcher.reverseGeocode(params.latitude, params.longitude);

    case "search-nearby":
    case "search_nearby":
    case "maps_search_nearby":
      return searcher.searchNearby(params);

    case "search-places":
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

    case "place-details":
    case "get_place_details":
    case "maps_place_details":
      return searcher.getPlaceDetails(params.placeId, params.maxPhotos || 0, params.includeRaw || false);

    case "directions":
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

    case "distance-matrix":
    case "maps_distance_matrix":
      return searcher.calculateDistanceMatrix(
        params.origins,
        params.destinations,
        params.mode,
        params.departure_time,
        params.avoid_tolls,
        params.avoid_highways
      );

    case "elevation":
    case "maps_elevation":
      return searcher.getElevation(params.locations);

    case "timezone":
    case "maps_timezone":
      return searcher.getTimezone(params.latitude, params.longitude, params.timestamp);

    case "weather":
    case "maps_weather":
      return searcher.getWeather(
        params.latitude,
        params.longitude,
        params.type,
        params.forecastDays,
        params.forecastHours
      );

    case "explore-area":
    case "maps_explore_area":
      return searcher.exploreArea(params);

    case "plan-route":
    case "maps_plan_route":
      return searcher.planRoute(params);

    case "compare-places":
    case "maps_compare_places":
      return searcher.comparePlaces(params);

    case "air-quality":
    case "maps_air_quality":
      return searcher.getAirQuality(
        params.latitude,
        params.longitude,
        params.includeHealthRecommendations,
        params.includePollutants
      );

    case "static-map":
    case "maps_static_map":
      return searcher.getStaticMap(params);

    case "batch-geocode-tool":
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

    case "search-along-route":
    case "maps_search_along_route":
      return searcher.searchAlongRoute(params);

    case "local-rank-tracker":
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
  { id: "geocoding", name: "geocoding-api", tool: "geocode", params: { address: "Tokyo Tower" } },
  { id: "places-new", name: "places-api-new", tool: "search-places", params: { query: "Tokyo Tower" } },
  {
    id: "routes",
    name: "routes-api",
    tool: "directions",
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
 * `NODE_ENGINE_FLOOR` (22, aligned with `package.json` `engines`, REQ-070),
 * non-zero package version, API key presence (value hidden), effective
 * configuration diagnostics with masked secrets and per-field sources
 * (REQ-089, zero-match allowlist reported as fail), explicit env-file status,
 * and the per-tool Google API profile of the effective tool set (REQ-090).
 * Live branch: without `options.probes` runs all three probes (legacy
 * `--live`, REQ-072); with `options.probes` runs only the selected subset
 * (REQ-091); each probe fails independently. `success` is false when any
 * check fails; the caller maps it to the exit code.
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
  const config = options.config ?? resolveRuntimeConfig(process.env);
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
          ? `mcp-google-map ${packageVersion} is available.`
          : "Could not read the installed package version.",
    },
    {
      name: "api-key",
      status: apiKey ? "pass" : "fail",
      detail: apiKey
        ? "GOOGLE_MAPS_API_KEY is configured (value hidden)."
        : "GOOGLE_MAPS_API_KEY is not configured. Set it in the environment before making API calls.",
    },
    {
      name: "config",
      status: toolsResolution.fallback ? "fail" : "pass",
      detail: toolsResolution.fallback
        ? `GOOGLE_MAPS_ENABLED_TOOLS matched 0 tools; the server falls back to all ${allToolNames.length} tools. Effective configuration: ${formatConfigDiagnostics(diagnostics)}`
        : `Effective configuration: ${formatConfigDiagnostics(diagnostics)}`,
    },
    {
      name: "env-file",
      status: "pass",
      detail: config.envFile
        ? `Explicit environment file loaded: ${config.envFile}`
        : "No explicit --env-file requested; implicit .env discovery (current directory, then package directory) applies.",
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
      detail: "Live API checks require GOOGLE_MAPS_API_KEY.",
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

// --------------- Setup Mode ---------------

/** @brief One named onboarding check result (`pass`, `fail`, or `skip`). */
export interface SetupCheck {
  name: string;
  status: "pass" | "fail" | "skip";
  detail: string;
}

/** @brief JSON-serializable outcome of the `setup` command. */
export interface SetupReport {
  success: boolean;
  created: boolean;
  checks: SetupCheck[];
}

/** @brief Injectable filesystem surface used by `runSetup` (tests pass fakes). */
export interface SetupFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: "utf-8"): string;
  writeFileSync(path: string, data: string, encoding: "utf-8"): void;
}

/** @brief Injectable dependencies for deterministic `runSetup` testing. */
export interface SetupDeps {
  nodeVersion?: string;
  config?: ResolvedRuntimeConfig;
  fs?: SetupFs;
}

/** @brief Inputs controlling `runSetup` behavior. */
export interface SetupOptions {
  packageDir: string;
  targetDir: string;
  writeEnv: boolean;
}

/**
 * @brief Runs the non-interactive onboarding self-check with optional `.env` scaffolding.
 * @details Zero prompts, zero Google API calls, zero writes unless `writeEnv`
 * is true (REQ-087). Checks: Node major >= `NODE_ENGINE_FLOOR` (22);
 * `.env.example` presence in `packageDir`; `.env` handling in `targetDir` —
 * with `writeEnv` the file is created from the template only when absent and
 * is never overwritten (REQ-088), without it the check reports the current
 * state; API key presence from the resolved configuration (value hidden).
 * `success` is false only when a check fails. Complexity O(1) filesystem ops.
 * @param options {SetupOptions} Directories and the explicit write authorization flag.
 * @param deps {SetupDeps} Injectable Node version, config, and fs surface.
 * @return {Promise<SetupReport>} Report with `created` flag and named checks.
 * @see resolveRuntimeConfig
 * @satisfies PRJ-011, REQ-087, REQ-088
 */
export async function runSetup(options: SetupOptions, deps: SetupDeps = {}): Promise<SetupReport> {
  const fsImpl: SetupFs =
    deps.fs ?? {
      existsSync: (path) => existsSync(path),
      readFileSync: (path, encoding) => readFileSync(path, encoding),
      writeFileSync: (path, data, encoding) => writeFileSync(path, data, encoding),
    };
  const nodeVersion = deps.nodeVersion ?? process.versions.node;
  const nodeMajor = Number.parseInt(nodeVersion.split(".")[0] ?? "0", 10);
  const config = deps.config ?? resolveRuntimeConfig(process.env);

  const examplePath = resolve(options.packageDir, ".env.example");
  const envPath = resolve(options.targetDir, ".env");
  const checks: SetupCheck[] = [
    {
      name: "node",
      status: nodeMajor >= NODE_ENGINE_FLOOR ? "pass" : "fail",
      detail: `Node.js ${nodeVersion} detected; version ${NODE_ENGINE_FLOOR} or newer is required (package.json engines).`,
    },
    {
      name: "env-template",
      status: fsImpl.existsSync(examplePath) ? "pass" : "fail",
      detail: fsImpl.existsSync(examplePath)
        ? `Template found: ${examplePath}`
        : `Template missing: ${examplePath} (expected next to the installed package).`,
    },
  ];

  let created = false;
  if (options.writeEnv) {
    if (fsImpl.existsSync(envPath)) {
      checks.push({
        name: "env-file",
        status: "pass",
        detail: `${envPath} already exists; left untouched (no overwrite).`,
      });
    } else if (!fsImpl.existsSync(examplePath)) {
      checks.push({
        name: "env-file",
        status: "fail",
        detail: `Cannot create ${envPath}: template ${examplePath} is missing.`,
      });
    } else {
      try {
        fsImpl.writeFileSync(envPath, fsImpl.readFileSync(examplePath, "utf-8"), "utf-8");
        created = true;
        checks.push({
          name: "env-file",
          status: "pass",
          detail: `Created ${envPath} from template; edit it and set GOOGLE_MAPS_API_KEY.`,
        });
      } catch (error: unknown) {
        checks.push({
          name: "env-file",
          status: "fail",
          detail: `Failed to create ${envPath}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  } else {
    checks.push({
      name: "env-file",
      status: fsImpl.existsSync(envPath) ? "pass" : "skip",
      detail: fsImpl.existsSync(envPath)
        ? `${envPath} found.`
        : `${envPath} not found; rerun with --write-env to create it from the template.`,
    });
  }

  checks.push({
    name: "api-key",
    status: config.apiKey ? "pass" : "fail",
    detail: config.apiKey
      ? `GOOGLE_MAPS_API_KEY is configured (source: ${config.apiKeySource}, value hidden).`
      : "GOOGLE_MAPS_API_KEY is not configured. Set it in the environment or in .env after scaffolding.",
  });

  return {
    success: checks.every((check) => check.status !== "fail"),
    created,
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
 * without rewriting the settings file (REQ-111). Success prints a JSON
 * result on stdout (PRJ-008).
 * @param name {string} CLI name from the command line.
 * @param enable {boolean} True to enable; false to disable.
 * @param options {object} `{ home?, streams? }`; streams default to process streams.
 * @return {number} Exit code: 0 on success, 2 for an unsupported CLI.
 * @see loadCliSettings
 * @see saveCliSettings
 * @satisfies REQ-110, REQ-111
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
    streams.stdout.write(
      JSON.stringify({ cli: target.id, enabled: enable, message: `${target.id} is already ${enable ? "enabled" : "disabled"}.` }, null, 2) + "\n"
    );
    return 0;
  }
  settings.enabled = enable
    ? [...settings.enabled, target.id]
    : settings.enabled.filter((item) => item !== target.id);
  saveCliSettings(settings, options.home);
  streams.stdout.write(
    JSON.stringify({ cli: target.id, enabled: enable, message: `${enable ? "Enabled" : "Disabled"} ${target.id}.` }, null, 2) + "\n"
  );
  return 0;
}

/**
 * @brief Saves the Google Maps API key in the persisted settings and refreshes enabled-CLI registrations.
 * @details Validates the key first (REQ-020 format via `ApiKeyManager`),
 * rejecting empty, whitespace-only, or malformed input with a JSON stderr
 * error and non-zero exit before any write (REQ-137); persists the key as
 * the settings `apiKey` field atomically (REQ-136, DES-023); then runs the
 * install operation for every enabled CLI embedding the newly persisted key
 * with REQ-116 and REQ-119 semantics (REQ-138). Prints exactly one JSON
 * object on stdout containing the masked key (DES-016), the settings path,
 * and the per-CLI install summaries and errors (REQ-139).
 * @param key {string | undefined} Raw key argument from the command line.
 * @param options {object} `{ home?, resourcesRoot, streams? }`; streams default to process streams.
 * @return {number} Exit code: 0 on success or zero enabled CLIs, 1 on validation, persistence, or install failure.
 * @see loadCliSettings
 * @see saveCliSettings
 * @see installEnabledCliResources
 * @satisfies REQ-136, REQ-137, REQ-138, REQ-139
 */
export function runApiKeyCommand(
  key: string | undefined,
  options: { home?: string; resourcesRoot: string; streams?: ExecStreams }
): number {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  const trimmed = (key ?? "").trim();
  if (!ApiKeyManager.getInstance().isValidApiKeyFormat(trimmed)) {
    streams.stderr.write(
      JSON.stringify(
        {
          success: false,
          error:
            "Invalid Google Maps API key. Expected 20-50 characters of letters, digits, hyphens, or underscores. Usage: mcp-google-map api-key <your-api-key>",
        },
        null,
        2
      ) + "\n"
    );
    return 1;
  }
  let settingsPath: string;
  try {
    const settings = loadCliSettings(options.home);
    settings.apiKey = trimmed;
    settingsPath = saveCliSettings(settings, options.home);
  } catch (error: unknown) {
    streams.stderr.write(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }, null, 2) + "\n"
    );
    return 1;
  }
  let install: CliOperationResult;
  try {
    install = installEnabledCliResources({ home: options.home, apiKey: trimmed, resourcesRoot: options.resourcesRoot });
  } catch (error: unknown) {
    streams.stderr.write(
      JSON.stringify(
        {
          success: false,
          apiKey: maskSecret(trimmed),
          settingsPath,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2
      ) + "\n"
    );
    return 1;
  }
  const zeroEnabled = install.summaries.length === 0 && install.errors.length === 0;
  streams.stdout.write(
    JSON.stringify(
      {
        success: install.errors.length === 0,
        command: "api-key",
        apiKey: maskSecret(trimmed),
        settingsPath,
        ...(zeroEnabled
          ? { message: "API key saved. No CLI enabled. Use 'mcp-google-map enable <cli name>' first." }
          : {}),
        install: { operation: "install", summaries: install.summaries, errors: install.errors },
      },
      null,
      2
    ) + "\n"
  );
  return install.errors.length > 0 ? 1 : 0;
}

/**
 * @brief Shared handler for the `install` and `uninstall` commands.
 * @details Runs the requested operation over every enabled CLI, prints the
 * aggregate JSON result on stdout, and exits 1 when any per-CLI failure was
 * collected (REQ-116). With zero enabled CLIs prints the enable hint and
 * exits 0 (REQ-119). Diagnostics ride in the JSON `errors` array so stdout
 * stays the single machine-readable channel (PRJ-008).
 * @param operation {"install" | "uninstall"} Requested reciprocal operation.
 * @param options {object} `{ home?, apiKey?, resourcesRoot, streams? }`.
 * @return {number} Exit code: 0 on success or zero enabled CLIs, 1 on failures.
 * @see installEnabledCliResources
 * @see uninstallEnabledCliResources
 * @satisfies REQ-114, REQ-115, REQ-116, REQ-119
 */
export function runInstallUninstallCommand(
  operation: "install" | "uninstall",
  options: { home?: string; apiKey?: string; resourcesRoot: string; streams?: ExecStreams }
): number {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  if (loadCliSettings(options.home).enabled.length === 0) {
    streams.stdout.write(
      JSON.stringify(
        {
          success: true,
          message: "No CLI enabled. Use 'mcp-google-map enable <cli name>' first.",
          summaries: [],
          errors: [],
        },
        null,
        2
      ) + "\n"
    );
    return 0;
  }
  let result: CliOperationResult;
  try {
    result =
      operation === "install"
        ? installEnabledCliResources({ home: options.home, apiKey: options.apiKey, resourcesRoot: options.resourcesRoot })
        : uninstallEnabledCliResources({ home: options.home, resourcesRoot: options.resourcesRoot });
  } catch (error: unknown) {
    streams.stderr.write(
      JSON.stringify({ success: false, errors: [error instanceof Error ? error.message : String(error)] }, null, 2) + "\n"
    );
    return 1;
  }
  streams.stdout.write(
    JSON.stringify({ success: result.errors.length === 0, operation, summaries: result.summaries, errors: result.errors }, null, 2) + "\n"
  );
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
const isRunDirectly =
  process.argv[1] &&
  (process.argv[1].endsWith("cli.ts") ||
    process.argv[1].endsWith("cli.js") ||
    process.argv[1].endsWith("mcp-google-map") ||
    process.argv[1].includes("mcp-google-map"));

const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isRunDirectly || isMainModule) {
  // Load environment files before command dispatch: explicit --env-file wins
  // over the implicit cwd/package .env discovery chain.
  loadEnvironment(extractEnvFileOption(process.argv));

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
  // run exclusively here (REQ-120, REQ-125, REQ-126, REQ-127).
  const managementCommand = parseManagementCommand(hideBin(process.argv));
  if (managementCommand !== undefined) {
    void runManagementCommand(managementCommand, { currentVersion: packageVersion })
      .then((code) => {
        process.exitCode = code;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(JSON.stringify({ error: message }, null, 2) + "\n");
        process.exitCode = 1;
      });
  } else {
    /**
     * @brief Applies the shared server-start options to a yargs builder.
     * @details Declares `--port`, `--host`, `--apikey`, and `--stdio` with
     * environment-derived defaults plus the server-mode examples. Shared
     * verbatim by the `start` and `run` commands so both expose an identical
     * option surface (PRJ-003). Complexity O(1).
     * @param yargs {Argv} Builder of the command being configured.
     * @return {Argv} The same builder instance with the typed server options attached.
     * @satisfies REQ-079
     */
    const buildServerCommandOptions = (yargs: Argv) =>
      yargs
        .option("port", {
          alias: "p",
          type: "number",
          description: "Port to run the MCP server on",
          default: process.env.MCP_SERVER_PORT ? parseInt(process.env.MCP_SERVER_PORT) : 3000,
        })
        .option("host", {
          type: "string",
          description: "Hostname to bind the server to (default 127.0.0.1 loopback; 0.0.0.0 for all interfaces)",
          default: process.env.MCP_SERVER_HOST || "127.0.0.1",
        })
        .option("apikey", {
          alias: "k",
          type: "string",
          description: "Google Maps API key",
          default: process.env.GOOGLE_MAPS_API_KEY,
        })
        .option("stdio", {
          type: "boolean",
          description: "Use stdio transport instead of HTTP",
          default: false,
        })
        .example([
          ["$0 start", "Start HTTP server with default settings"],
          ['$0 start --port 3000 --apikey "your_api_key"', "Start HTTP with custom port and API key"],
          ["$0 start --host 0.0.0.0 --port 3000", "Start HTTP accessible from all interfaces"],
          ["$0 start --stdio", "Start in stdio mode (for MCP clients)"],
          ["$0 run --stdio", "Alias: run the server in stdio mode"],
        ]);

    /** Parsed argv shape produced by `buildServerCommandOptions` (port/host/apikey/stdio). */
    type ServerCommandArgs = BuilderArguments<typeof buildServerCommandOptions>;

    /**
     * @brief Server-start handler shared by the `start` and `run` commands.
     * @details Applies `--apikey` to the environment, resolves the effective
     * key with priority `--apikey` flag, `GOOGLE_MAPS_API_KEY` environment
     * (placeholder counts as unset), then the persisted settings key promoted
     * into the environment (REQ-142); fires the idle-gated automatic update
     * check fire-and-forget (REQ-082; never blocks startup), then starts
     * stdio mode when `--stdio` is passed — exiting 1 with a stderr JSON
     * error naming the `api-key` command when no key resolves (REQ-143) —
 * otherwise HTTP mode via `startServer`, exiting 1 when zero instances
     * listen (REQ-095). HTTP mode without an API key logs a warning and still
     * starts (REQ-080).
     * @param argv {ServerCommandArgs} Parsed options: `--port`, `--host`, `--apikey`, `--stdio`.
     * @return {Promise<void>} Resolves when stdio mode stops; HTTP mode persists.
     * @satisfies REQ-079, REQ-080, REQ-082, REQ-095, REQ-142, REQ-143
     */
    const runServerCommand = async (argv: ServerCommandArgs): Promise<void> => {
      if (argv.apikey) {
        process.env.GOOGLE_MAPS_API_KEY = argv.apikey;
      }

      // REQ-142 effective-key resolution: --apikey flag (applied above),
      // then GOOGLE_MAPS_API_KEY (placeholder counts as unset), then the key
      // persisted by the `api-key` command. A persisted key is promoted into
      // the environment so every default-key consumer sees it.
      let effectiveApiKey = isUnsetApiKey(process.env.GOOGLE_MAPS_API_KEY)
        ? undefined
        : process.env.GOOGLE_MAPS_API_KEY;
      if (effectiveApiKey === undefined) {
        const persistedApiKey = loadConfiguredApiKey();
        if (persistedApiKey !== undefined) {
          process.env.GOOGLE_MAPS_API_KEY = persistedApiKey;
          effectiveApiKey = persistedApiKey;
        }
      }

      // Automatic update check (enabled by default), idle-gated to keep it
      // non-invasive: at most one registry request per idle window.
      // Fire-and-forget so it never blocks startup; diagnostics on stderr.
      void checkVersionIdle({ currentVersion: packageVersion }).catch(() => undefined);

      const tools = filterTools(serverConfigs[0].tools);

      if (argv.stdio) {
        // REQ-143: refuse to boot stdio without a usable key; stdout stays
        // reserved for JSON-RPC, so the error rides on stderr as JSON.
        if (effectiveApiKey === undefined) {
          process.stderr.write(
            JSON.stringify(
              {
                error:
                  "Google Maps API key is not configured. Run 'mcp-google-map api-key <your-api-key>' to configure it, or pass --apikey / set GOOGLE_MAPS_API_KEY.",
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
        Logger.log("🗺️  Google Maps MCP Server");
        Logger.log("   A Model Context Protocol server for Google Maps services");
        Logger.log("");

        if (effectiveApiKey === undefined) {
          Logger.log("⚠️  Google Maps API Key not found!");
          Logger.log("   Run 'mcp-google-map api-key <your-api-key>' to configure it, or set GOOGLE_MAPS_API_KEY / pass --apikey");
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
     * Help output opens with `mcp-google-map v<version>` (REQ-130) and the
     * epilog documents the pre-yargs management commands `--ver`, `--version`,
     * `--upgrade`, `--uninstall` (REQ-131).
     * @return {Argv} Configured yargs instance ready for `parse()`.
     * @satisfies REQ-079, REQ-129, REQ-130, REQ-131
     */
    const cli = yargs(hideBin(process.argv))
      .scriptName("mcp-google-map")
      .usage(
        `mcp-google-map v${packageVersion}\n\n` +
          `Usage: mcp-google-map <command> [options]\n` +
          `       mcp-google-map start|run [--stdio] [options]`
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
              description: "Google Maps API key (prefer GOOGLE_MAPS_API_KEY to avoid shell history exposure)",
              default: process.env.GOOGLE_MAPS_API_KEY,
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
          const report = await runDoctor(packageVersion, argv.apikey as string | undefined, argv.live as boolean, undefined, {
            probes: parsedProbes.probes,
            config: resolveRuntimeConfig(process.env, { envFile: extractEnvFileOption(process.argv) }),
          });
          process.stdout.write(JSON.stringify(report, null, 2) + "\n");
          process.exitCode = report.success ? 0 : 1;
        }
      )
      .command(
        "setup",
        "Non-interactive onboarding: verify local readiness, optionally scaffold .env",
        (yargs) =>
          yargs
            .option("write-env", {
              type: "boolean",
              default: false,
              description: "Create .env from .env.example in --env-dir when it does not exist (never overwrites)",
            })
            .option("env-dir", {
              type: "string",
              default: process.cwd(),
              description: "Directory where .env is looked up / created",
            })
            .example([
              ["$0 setup", "Check readiness without writing anything"],
              ["$0 setup --write-env", "Also scaffold .env from the package template"],
            ]),
        async (argv) => {
          const report = await runSetup({
            packageDir: resolve(__dirname, ".."),
            targetDir: argv.envDir as string,
            writeEnv: argv.writeEnv as boolean,
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
              description: "Absolute path to dist/cli.js (required for --launcher node)",
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
            .option("env-key", {
              type: "string",
              description: 'Emit a ${NAME} variable reference instead of a literal placeholder (expansion is client-specific)',
            })
            .option("name", {
              type: "string",
              default: "mcp-google-map",
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
            envKey: argv.envKey as string | undefined,
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
              description: "Home-directory override for the settings file (default: user home)",
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
              description: "Home-directory override for the settings file (default: user home)",
            })
            .example([["$0 disable claude", "Disable claude for install/uninstall/show"]]),
        (argv) => {
          process.exitCode = runEnableDisableCliCommand(argv.cli as string, false, {
            home: argv.home as string | undefined,
          });
        }
      )
      .command(
        "api-key <key>",
        "Save the Google Maps API key in the user settings and refresh every enabled CLI registration",
        (yargs) =>
          yargs
            .positional("key", {
              type: "string",
              describe: "Google Maps API key (20-50 characters: letters, digits, hyphens, underscores)",
            })
            .option("home", {
              type: "string",
              description: "Home-directory override for CLI configuration paths (default: user home)",
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
        "Register the mcp-google-map stdio server and install packaged skills for every enabled CLI",
        (yargs) =>
          yargs
            .option("home", {
              type: "string",
              description: "Home-directory override for CLI configuration paths (default: user home)",
            })
            .option("apikey", {
              alias: "k",
              type: "string",
              description:
                "Google Maps API key embedded in the registered entry (priority: this flag, persisted api-key settings, GOOGLE_MAPS_API_KEY)",
            })
            .example([["$0 install", "Register the server and skills in every enabled CLI"]]),
        (argv) => {
          // REQ-140 install-time key resolution: flag > persisted settings
          // key > environment; the REQ-141 placeholder is embedded when
          // nothing resolves.
          const config = resolveRuntimeConfig(process.env, { envFile: extractEnvFileOption(process.argv) });
          process.exitCode = runInstallUninstallCommand("install", {
            home: argv.home as string | undefined,
            apiKey: resolveInstallApiKey({
              flagKey: argv.apikey as string | undefined,
              envKey: config.apiKey,
              home: argv.home as string | undefined,
            }),
            resourcesRoot: resolveSkillsResourcesRoot(resolve(__dirname, "..")),
          });
        }
      )
      .command(
        "uninstall",
        "Remove the mcp-google-map server entry and managed skills from every enabled CLI",
        (yargs) =>
          yargs
            .option("home", {
              type: "string",
              description: "Home-directory override for CLI configuration paths (default: user home)",
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
              description: "Home-directory override for CLI configuration paths (default: user home)",
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
            .option("apikey", {
              alias: "k",
              type: "string",
              description: "Google Maps API key",
              default: process.env.GOOGLE_MAPS_API_KEY,
            })
            .example([
              ['$0 exec geocode \'{"address":"Tokyo Tower"}\'', "Geocode an address"],
              [
                '$0 exec search-nearby \'{"center":{"value":"35.68,139.74","isCoordinates":true},"keyword":"restaurant"}\'',
                "Search nearby",
              ],
              ['$0 exec search-places \'{"query":"ramen in Tokyo"}\'', "Text search"],
            ]);
        },
        async (argv) => {
          if (!argv.apikey) {
            process.stderr.write(
              JSON.stringify(
                {
                  error: "GOOGLE_MAPS_API_KEY not set. Use --apikey or set GOOGLE_MAPS_API_KEY environment variable.",
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
            process.exitCode = await runExecCommand(argv.tool as string, params, argv.apikey as string);
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
            .option("apikey", {
              alias: "k",
              type: "string",
              description: "Google Maps API key",
              default: process.env.GOOGLE_MAPS_API_KEY,
            })
            .example([
              ["$0 batch-geocode -i addresses.txt", "Geocode to stdout"],
              ["$0 batch-geocode -i addresses.txt -o results.json", "Geocode to file"],
              ["cat addresses.txt | $0 batch-geocode -i -", "Geocode from stdin"],
            ]);
        },
        async (argv) => {
          if (!argv.apikey) {
            console.error("Error: GOOGLE_MAPS_API_KEY not set. Use --apikey or set env var.");
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

          const searcher = new PlacesSearcher(argv.apikey as string);
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
      .option("env-file", {
        type: "string",
        global: true,
        description: "Load environment variables from this exact file (error if missing; no implicit .env fallback)",
      })
      .epilog(
        `Management commands (single flags, dispatched before subcommands):\n` +
          `  --ver         Print the installed version and force one update check\n` +
          `  --version     Alias of --ver\n` +
          `  --upgrade     Upgrade the global package to the latest version and refresh installed skills\n` +
          `  --uninstall   Remove the globally installed mcp-google-map package`
      )
      .help();
    cli.parse();
  }
}
