/**
 * @fileoverview Idle-gated online version check and package self-upgrade
 * management commands (`--upgrade`, `--uninstall`, `--ver`, `--version`).
 * @details Adapted from the reference `skills` Python CLI semantics: the
 * automatic registry check is made non-invasive through a persistent idle
 * cache that suppresses registry requests while the previously computed idle
 * deadline is still in the future (REQ-121); `--ver`/`--version` force one
 * check bypassing the idle gate and print the installed version (REQ-120);
 * `--upgrade` reinstalls the latest package via npm, re-runs the upgraded
 * package's `install` child command with captured stdout so packaged skills
 * and MCP registrations refresh from the upgraded package (REQ-125, REQ-126),
 * and prints a human-readable stdout summary with starting/updated versions,
 * install outcome, and per-CLI results (REQ-132, REQ-133, REQ-134, REQ-135);
 * `--uninstall` removes the globally installed package (REQ-127). Every
 * diagnostic is stderr-only; cache write failures never throw (REQ-128).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Logger } from "../index.js";
import {
  DEFAULT_PACKAGE_NAME,
  probeLatestVersion,
  type AutoUpdateCheckerDeps,
  type AutoUpdateLogger,
} from "./autoUpdate.js";
import { loadCliSettings } from "./cliSettings.js";

/** ANSI SGR sequence selecting bright-green foreground text. */
const ANSI_GREEN = "\u001b[92m";
/** ANSI SGR sequence selecting bright-red foreground text. */
const ANSI_RED = "\u001b[91m";
/** ANSI SGR sequence resetting all text attributes. */
const ANSI_RESET = "\u001b[0m";

/**
 * @brief Wraps diagnostic text in bright-green SGR sequences.
 * @param text {string} Plain diagnostic text.
 * @return {string} Green-colored text terminated by an SGR reset.
 */
const green = (text: string): string => `${ANSI_GREEN}${text}${ANSI_RESET}`;

/**
 * @brief Wraps diagnostic text in bright-red SGR sequences.
 * @param text {string} Plain diagnostic text.
 * @return {string} Red-colored text terminated by an SGR reset.
 */
const red = (text: string): string => `${ANSI_RED}${text}${ANSI_RESET}`;

/** Program-owned cache directory segment (never a shared/generic name). */
export const IDLE_CACHE_DIR_NAME = "mcp-google-map";

/** Idle-cache file name mirroring the reference skills CLI layout. */
export const IDLE_CACHE_FILE_NAME = "check_version_idle-time.json";

/** Idle window applied when the executed check found a newer version (3600 s). */
export const IDLE_WINDOW_NEWER_MS = 60 * 60 * 1000;

/** Idle window applied to every other executed check (86400 s = 24 h). */
export const IDLE_WINDOW_DEFAULT_MS = 24 * 60 * 60 * 1000;

/** Package-manager command executed by `--upgrade` (REQ-125). */
export const PACKAGE_UPGRADE_COMMAND: readonly string[] = [
  "npm",
  "install",
  "-g",
  `${DEFAULT_PACKAGE_NAME}@latest`,
];

/** Package-manager command executed by `--uninstall` (REQ-127). */
export const PACKAGE_UNINSTALL_COMMAND: readonly string[] = [
  "npm",
  "uninstall",
  "-g",
  DEFAULT_PACKAGE_NAME,
];

/** Child command refreshing skills/registrations after `--upgrade` (REQ-126). */
export const POST_UPGRADE_INSTALL_COMMAND: readonly string[] = [
  "npx",
  "-y",
  DEFAULT_PACKAGE_NAME,
  "install",
];

/**
 * @brief Per-CLI result entry of the post-upgrade install consumed by the `--upgrade` summary.
 * @details One entry per CLI processed by the child `install` command (REQ-133);
 * counts are present only when the child JSON summary was parseable.
 */
export interface PostUpgradeCliOutcome {
  /** Canonical CLI name as reported by the child `install` summary or the persisted settings. */
  cli: string;
  /** True when no child error diagnostic references this CLI and no fallback failure applies. */
  ok: boolean;
  /** Registered-server count from the child `install` summary; undefined when unknown. */
  server?: number;
  /** Installed-skill count from the child `install` summary; undefined when unknown. */
  skills?: number;
}

/**
 * @brief Aggregate outcome of the post-upgrade `install` child command (REQ-126, REQ-132).
 * @details `clis` is empty only when no CLI is enabled (successful no-op);
 * `exitCode` is the child exit code, 0 for the no-op and success cases.
 */
export interface PostUpgradeInstallOutcome {
  /** Child `install` exit code; 0 for the zero-enabled-CLI no-op and full success. */
  exitCode: number;
  /** One entry per processed CLI, in child-summary or persisted-settings order. */
  clis: PostUpgradeCliOutcome[];
}

/**
 * @brief Persisted idle-cache shape (snake_case keys, reference-CLI layout).
 * @details `*_epoch` fields are POSIX milliseconds since the Unix epoch;
 * `*_human` fields are their ISO-8601 UTC renderings (REQ-122).
 */
export interface VersionIdleCache {
  /** Epoch of the last registry probe that returned a usable payload. */
  last_success_epoch?: number;
  /** ISO-8601 UTC rendering of `last_success_epoch`. */
  last_success_human?: string;
  /** Epoch before which the automatic check MUST be skipped. */
  idle_time_epoch?: number;
  /** ISO-8601 UTC rendering of `idle_time_epoch`. */
  idle_time_human?: string;
}

/**
 * @brief Injectable filesystem surface consumed by the idle check.
 * @details Tests substitute in-memory readers/writers so no real cache file
 * is touched; production defaults map to `node:fs` primitives.
 */
export interface IdleFsDeps {
  /** Synchronous UTF-8 file reader. */
  readFile?: (path: string) => string;
  /** Synchronous file writer creating or replacing the target. */
  writeFile?: (path: string, data: string) => void;
  /** Recursive directory creator for the cache parent directory. */
  mkdir?: (path: string) => void;
}

/**
 * @brief Dependency surface of the idle-gated version check.
 * @details Extends the registry-probe injection surface with the idle-gate
 * inputs: forced mode, cache path override, injectable clock, and fs stubs.
 */
export interface IdleCheckDeps extends AutoUpdateCheckerDeps {
  /** True bypasses the idle gate exactly once (REQ-120). */
  force?: boolean;
  /** Cache file path override; defaults to `resolveIdleCachePath()`. */
  cachePath?: string;
  /** Clock returning POSIX milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** Filesystem injection surface. */
  fs?: IdleFsDeps;
}

/** Outcome status of one idle-gated check attempt. */
export type IdleCheckStatus =
  | "idle"
  | "disabled"
  | "newer"
  | "current"
  | "unknown-version"
  | "error";

/**
 * @brief Result of one idle-gated version-check attempt.
 * @details `checked` is false only when no registry probe ran (idle gate hit
 * or disabled flag); the remaining fields echo the probe outcome and the
 * freshly persisted idle deadline for callers and tests.
 */
export interface IdleCheckResult {
  /** True when a registry probe actually executed. */
  checked: boolean;
  /** Discriminated outcome of the attempt. */
  status: IdleCheckStatus;
  /** Running package version, when known. */
  currentVersion?: string;
  /** Latest published version, when a newer one exists. */
  latestVersion?: string;
  /** Epoch of the idle deadline persisted by this attempt, when written. */
  idleUntilEpoch?: number;
  /** Epoch of the last successful probe, when persisted. */
  lastSuccessEpoch?: number;
}

/**
 * @brief Resolves the program-owned idle-cache file path.
 * @details Joins `<home>/.cache/mcp-google-map/check_version_idle-time.json`
 * (program-owned directory segment per the DES-021 naming rule; never a
 * shared or generic directory).
 * @param home {string | undefined} Home-directory override; defaults to `os.homedir()`.
 * @return {string} Absolute idle-cache file path.
 * @satisfies REQ-121, REQ-122
 */
export function resolveIdleCachePath(home?: string): string {
  return join(home ?? homedir(), ".cache", IDLE_CACHE_DIR_NAME, IDLE_CACHE_FILE_NAME);
}

/**
 * @brief Loads the idle cache tolerating any missing or malformed content.
 * @details Missing files, I/O errors, non-object JSON, and wrong-typed fields
 * all normalize to `{}`; numeric fields are accepted only when finite numbers.
 * @param cachePath {string} Idle-cache file path.
 * @param fs {IdleFsDeps} Injectable filesystem surface.
 * @return {VersionIdleCache} Parsed cache subset; empty object on any failure.
 * @satisfies REQ-122
 */
export function loadIdleCache(cachePath: string, fs: IdleFsDeps = {}): VersionIdleCache {
  try {
    const readFile = fs.readFile ?? ((path: string) => readFileSync(path, "utf-8"));
    const raw = readFile(cachePath);
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const isFiniteNumber = (value: unknown): value is number =>
      typeof value === "number" && Number.isFinite(value);
    return {
      last_success_epoch: isFiniteNumber(record.last_success_epoch)
        ? record.last_success_epoch
        : undefined,
      last_success_human:
        typeof record.last_success_human === "string" ? record.last_success_human : undefined,
      idle_time_epoch: isFiniteNumber(record.idle_time_epoch) ? record.idle_time_epoch : undefined,
      idle_time_human:
        typeof record.idle_time_human === "string" ? record.idle_time_human : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * @brief Persists the idle cache after one executed check.
 * @details Serializes `last_success_*` and `idle_time_*` fields with two-space
 * indentation plus a trailing newline, creating the parent directory on
 * demand. Write failures are reported on stderr and never propagate (the
 * check itself already completed).
 * @param cachePath {string} Idle-cache file path.
 * @param lastSuccess {number | undefined} Epoch of the last successful probe.
 * @param idleUntil {number} Epoch of the new idle deadline.
 * @param fs {IdleFsDeps} Injectable filesystem surface.
 * @param logger {AutoUpdateLogger} Diagnostics sink for cache write errors.
 * @return {void}
 * @post The cache file contains the serialized deadlines, or a stderr error was emitted.
 * @satisfies REQ-122
 */
export function persistIdleCache(
  cachePath: string,
  lastSuccess: number | undefined,
  idleUntil: number,
  fs: IdleFsDeps = {},
  logger: AutoUpdateLogger = Logger
): void {
  const toIso = (epoch: number | undefined): string | null =>
    epoch === undefined ? null : new Date(epoch).toISOString();
  const data = {
    last_success_epoch: lastSuccess ?? null,
    last_success_human: toIso(lastSuccess),
    idle_time_epoch: idleUntil,
    idle_time_human: toIso(idleUntil),
  };
  try {
    const mkdir = fs.mkdir ?? ((path: string) => mkdirSync(path, { recursive: true }));
    const writeFile = fs.writeFile ?? ((path: string, data: string) => writeFileSync(path, data));
    mkdir(dirname(cachePath));
    writeFile(cachePath, JSON.stringify(data, null, 2) + "\n");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(red(`Version cache error: ${message}`));
  }
}

/**
 * @brief Runs the idle-gated automatic version check.
 * @details Resolution order: disabled-flag short-circuit (REQ-083; zero
 * network calls, zero cache writes) -> idle gate (skip with `status: "idle"`
 * while `idle_time_epoch` is in the future and `force` is not set, REQ-121)
 * -> `probeLatestVersion` registry probe -> outcome reporting and idle-window
 * selection: newer -> green stderr `Available Version: <latest> | Installed
 * Version: <current>` plus an upgrade command and a 3600 s window (REQ-123,
 * REQ-124); registry-reached-but-current -> no output: a current version is
 * not an error (REQ-124) and still gets an 86400 s window; any failure -> red
 * stderr error notice and a 86400 s window. The cache is refreshed after every executed probe; cache write
 * failures never throw. Never blocks the caller's error path: never throws.
 * @param deps {IdleCheckDeps} Optional dependency overrides; production defaults when omitted.
 * @return {Promise<IdleCheckResult>} Outcome with the persisted idle deadline.
 * @satisfies REQ-120, REQ-121, REQ-122, REQ-123, REQ-124
 * @note Complexity: one HTTP round-trip bounded by `timeoutMs` plus O(1) cache I/O.
 * @warning Startup call sites MUST invoke fire-and-forget (`void checkVersionIdle(...)`) to preserve REQ-085.
 * @see probeLatestVersion
 * @see loadIdleCache
 * @see persistIdleCache
 */
export async function checkVersionIdle(deps: IdleCheckDeps = {}): Promise<IdleCheckResult> {
  const logger = deps.logger ?? Logger;
  const now = deps.now ?? (() => Date.now());
  const cachePath = deps.cachePath ?? resolveIdleCachePath();
  const cache = loadIdleCache(cachePath, deps.fs);
  if (deps.force !== true) {
    const idle = cache.idle_time_epoch;
    if (typeof idle === "number" && idle > now()) {
      return { checked: false, status: "idle" };
    }
  }
  const probe = await probeLatestVersion(deps);
  if (probe.status === "disabled") {
    return { checked: false, status: "disabled" };
  }
  let delayMs = IDLE_WINDOW_DEFAULT_MS;
  let lastSuccess =
    typeof cache.last_success_epoch === "number" ? cache.last_success_epoch : undefined;
  const result: IdleCheckResult = { checked: true, status: probe.status };
  switch (probe.status) {
    case "unknown-version":
      logger.error(red("Version check error: running package version is unknown."));
      break;
    case "error":
      logger.error(red(`Version check error: ${probe.message}`));
      break;
    case "current":
      // Not an error: the running version is already the latest published
      // one. REQ-124 forbids output here; only the idle window refreshes.
      lastSuccess = now();
      result.currentVersion = probe.currentVersion;
      break;
    case "newer": {
      lastSuccess = now();
      delayMs = IDLE_WINDOW_NEWER_MS;
      result.currentVersion = probe.currentVersion;
      result.latestVersion = probe.latestVersion;
      logger.log(
        green(
          `Available Version: ${probe.latestVersion} | Installed Version: ${probe.currentVersion}`
        )
      );
      logger.log(
        green(
          `Upgrade with: npm install -g ${DEFAULT_PACKAGE_NAME}@latest ` +
            `(or run: ${DEFAULT_PACKAGE_NAME} --upgrade)`
        )
      );
      break;
    }
  }
  const finishedAt = now();
  const idleUntil = finishedAt + delayMs;
  persistIdleCache(cachePath, lastSuccess, idleUntil, deps.fs, logger);
  result.idleUntilEpoch = idleUntil;
  result.lastSuccessEpoch = lastSuccess;
  return result;
}

/** Canonical names of the top-level management commands. */
export type ManagementCommandName = "--ver" | "--version" | "--upgrade" | "--uninstall";

/**
 * @brief Injectable child-process surface for package-manager commands.
 * @details `spawn` defaults to `node:child_process` `spawnSync`; `logger`
 * defaults to the stderr `Logger`. Injection keeps the management commands
 * deterministic and side-effect free under test (DES-022).
 */
export interface PackageManagerDeps {
  /** Synchronous child-process spawner with `stdio: "inherit"` semantics. */
  spawn?: typeof spawnSync;
  /** Diagnostics sink for spawn errors and manual-command hints. */
  logger?: AutoUpdateLogger;
}

/**
 * @brief Options consumed by the management command handlers.
 * @details `currentVersion` backs the `--ver`/`--version` output, the forced
 * online check, and the starting version of the `--upgrade` summary; `home`
 * scopes the enabled-CLI settings read performed by the post-upgrade skill
 * installation.
 */
export interface ManagementCommandOptions {
  /** Running package version printed by `--ver`/`--version`. */
  currentVersion: string;
  /** Home-directory override for the enabled-CLI settings read. */
  home?: string;
}

/**
 * @brief Aggregated dependency surface of the management dispatch.
 * @details Combines the package-manager injection surface with the idle-check
 * injection surface and an injectable stdout sink used by the version print.
 */
export interface ManagementCommandDeps extends PackageManagerDeps {
  /** Dependencies forwarded to `checkVersionIdle` by `--ver`/`--version`. */
  idleCheck?: IdleCheckDeps;
  /** stdout sink receiving the installed-version line and the `--upgrade` summary; defaults to `process.stdout`. */
  stdout?: { write: (data: string) => void };
}

/**
 * @brief Detects an exact single-token management command in a raw argv array.
 * @details Returns the canonical name only when the post-bin argv is exactly
 * one of `--ver`, `--version`, `--upgrade`, `--uninstall`; any other shape
 * (including combined flags or subcommands) yields undefined so normal yargs
 * dispatch stays untouched.
 * @param args {readonly string[]} Raw argv after the Node binary/script tokens.
 * @return {ManagementCommandName | undefined} Canonical command name, or undefined.
 * @satisfies PRJ-003, REQ-120, REQ-125, REQ-127
 * @note Complexity: O(1). Pure.
 */
export function parseManagementCommand(
  args: readonly string[]
): ManagementCommandName | undefined {
  if (args.length !== 1) {
    return undefined;
  }
  const arg = args[0];
  if (arg === "--ver" || arg === "--version" || arg === "--upgrade" || arg === "--uninstall") {
    return arg;
  }
  return undefined;
}

/**
 * @brief Runs one package-manager command as a child process with inherited stdio.
 * @details Spawns `command[0]` with the remaining tokens, inheriting stdio so
 * npm/npx output streams through unchanged; on Windows the spawn runs through
 * a shell so `npm.cmd` resolves. A spawn failure (missing executable or
 * thrown spawn error) prints the error plus the exact manual command hint on
 * stderr and returns exit code 1; otherwise the child exit code propagates
 * (null status maps to 1).
 * @param command {readonly string[]} Executable plus arguments.
 * @param deps {PackageManagerDeps} Optional spawner/logger overrides.
 * @return {number} Child exit code, or 1 when spawning failed.
 * @satisfies REQ-125, REQ-127, REQ-128
 */
export function runPackageManagerCommand(
  command: readonly string[],
  deps: PackageManagerDeps = {}
): number {
  const logger = deps.logger ?? Logger;
  const spawnImpl = deps.spawn ?? spawnSync;
  const reportSpawnFailure = (message: string): number => {
    logger.error(`Error executing ${command[0]}: ${message}`);
    logger.log(`Warning: run this command manually: ${command.join(" ")}`);
    return 1;
  };
  try {
    const result = spawnImpl(command[0], [...command.slice(1)], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.error) {
      return reportSpawnFailure(result.error.message);
    }
    return result.status ?? 1;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return reportSpawnFailure(message);
  }
}

/**
 * @brief Parses the child `install` JSON summary into per-CLI outcomes.
 * @details Accepts the `{ success, operation, summaries[], errors[] }` payload
 * emitted by the `install` command on stdout; locates the first `{`, parses
 * the remainder, validates the `summaries` array shape, and marks a CLI
 * `ok: false` when any error diagnostic text contains its name
 * (case-insensitive). Returns undefined for missing, non-JSON, or malformed
 * payloads so callers fall back to the persisted enabled-CLI list (REQ-135).
 * Pure; never throws.
 * @param raw {string | undefined} Captured child stdout text.
 * @return {PostUpgradeCliOutcome[] | undefined} Per-CLI entries in summary order; undefined when unparseable.
 * @satisfies REQ-133, REQ-135
 * @note Complexity: O(n + m) with n summary entries and m error strings.
 */
function parsePostUpgradeCliOutcomes(
  raw: string | undefined
): PostUpgradeCliOutcome[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const start = raw.indexOf("{");
  if (start < 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const summaries = (parsed as { summaries?: unknown }).summaries;
  const errors = (parsed as { errors?: unknown }).errors;
  if (!Array.isArray(summaries)) {
    return undefined;
  }
  const errorTexts = Array.isArray(errors)
    ? errors.filter((item): item is string => typeof item === "string")
    : [];
  const outcomes: PostUpgradeCliOutcome[] = [];
  for (const entry of summaries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as { cli?: unknown; server?: unknown; skills?: unknown };
    const cli = record.cli;
    if (typeof cli !== "string" || cli.length === 0) {
      continue;
    }
    const lowered = cli.toLowerCase();
    const failed = errorTexts.some((text) => text.toLowerCase().includes(lowered));
    outcomes.push({
      cli,
      ok: !failed,
      server: typeof record.server === "number" ? record.server : undefined,
      skills: typeof record.skills === "number" ? record.skills : undefined,
    });
  }
  return outcomes;
}

/**
 * @brief Refreshes installed skills through the upgraded package after `--upgrade`.
 * @details When at least one CLI is enabled in the persisted settings, spawns
 * `npx -y mcp-google-map install` with captured child stdout (stderr stays
 * inherited so child diagnostics remain visible), so the freshly upgraded
 * package (not the running process) re-synchronizes its packaged skills and
 * MCP registrations into every enabled CLI without echoing the child JSON
 * summary (REQ-126). The captured payload is parsed into per-CLI outcomes;
 * missing or unparseable output falls back to the persisted enabled-CLI list
 * carrying the aggregate exit-code outcome (REQ-135). Spawn failures report
 * the manual command hint on stderr and map to exit code 1 (REQ-128). With
 * zero enabled CLIs the hook is a successful no-op with an empty CLI list.
 * @param options {ManagementCommandOptions} `{ home }` scoping the settings read.
 * @param deps {PackageManagerDeps} Optional spawner/logger overrides.
 * @return {PostUpgradeInstallOutcome} Child exit code plus one outcome entry per processed CLI.
 * @satisfies REQ-126, REQ-128, REQ-133, REQ-135
 * @see loadCliSettings
 * @see parsePostUpgradeCliOutcomes
 */
export function runPostUpgradeSkillInstall(
  options: Pick<ManagementCommandOptions, "home">,
  deps: PackageManagerDeps = {}
): PostUpgradeInstallOutcome {
  const enabled = loadCliSettings(options.home).enabled;
  if (enabled.length === 0) {
    return { exitCode: 0, clis: [] };
  }
  const logger = deps.logger ?? Logger;
  const spawnImpl = deps.spawn ?? spawnSync;
  const reportSpawnFailure = (message: string): PostUpgradeInstallOutcome => {
    logger.error(`Error executing ${POST_UPGRADE_INSTALL_COMMAND[0]}: ${message}`);
    logger.log(`Warning: run this command manually: ${POST_UPGRADE_INSTALL_COMMAND.join(" ")}`);
    return { exitCode: 1, clis: enabled.map((cli) => ({ cli, ok: false })) };
  };
  try {
    const result = spawnImpl(
      POST_UPGRADE_INSTALL_COMMAND[0],
      [...POST_UPGRADE_INSTALL_COMMAND.slice(1)],
      {
        stdio: ["ignore", "pipe", "inherit"],
        shell: process.platform === "win32",
      }
    );
    if (result.error) {
      return reportSpawnFailure(result.error.message);
    }
    const exitCode = result.status ?? 1;
    const stdoutText = result.stdout === undefined ? undefined : String(result.stdout);
    const clis =
      parsePostUpgradeCliOutcomes(stdoutText) ??
      enabled.map((cli) => ({ cli, ok: exitCode === 0 }));
    return { exitCode, clis };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return reportSpawnFailure(message);
  }
}

/**
 * @brief Renders the human-readable `--upgrade` summary block.
 * @details First line states the version transition `starting -> updated`;
 * the second line states the post-upgrade install outcome (success, failure
 * with exit code, or skip when no CLI is enabled); with processed CLIs it
 * appends one indented entry per CLI with its OK/FAILED result and the
 * reported server/skill counts when known. Pure; deterministic text.
 * @param previousVersion {string} Starting (pre-upgrade) package version.
 * @param updatedVersion {string} Updated package version; `unknown` when the registry probe failed (REQ-134).
 * @param outcome {PostUpgradeInstallOutcome} Post-upgrade install outcome.
 * @return {string} Multi-line summary terminated by one trailing newline.
 * @satisfies REQ-132, REQ-133, REQ-134
 */
export function renderUpgradeSummary(
  previousVersion: string,
  updatedVersion: string,
  outcome: PostUpgradeInstallOutcome
): string {
  const lines: string[] = [
    `mcp-google-map upgrade completed: ${previousVersion} -> ${updatedVersion}`,
  ];
  if (outcome.clis.length === 0) {
    lines.push(
      outcome.exitCode === 0
        ? "Post-upgrade install: skipped (no CLI enabled)."
        : `Post-upgrade install: FAILED (exit code ${outcome.exitCode}).`
    );
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    outcome.exitCode === 0
      ? "Post-upgrade install: completed successfully on the following CLI(s):"
      : `Post-upgrade install: FAILED (exit code ${outcome.exitCode}) for the following CLI(s):`
  );
  for (const entry of outcome.clis) {
    const counts =
      entry.server !== undefined || entry.skills !== undefined
        ? ` (server: ${entry.server ?? 0}, skills: ${entry.skills ?? 0})`
        : "";
    lines.push(`  - ${entry.cli}: ${entry.ok ? "OK" : "FAILED"}${counts}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * @brief Resolves the updated package version reported by the `--upgrade` summary.
 * @details Runs one logging-free `probeLatestVersion` registry probe after the
 * upgrade child succeeds, forwarding the injected idle-check dependencies;
 * maps `newer` to the registry latest version, `current` to the running
 * version, and every other outcome (`disabled`, `unknown-version`, `error`)
 * to `unknown` (REQ-134). Never throws.
 * @param options {ManagementCommandOptions} Options carrying `currentVersion`.
 * @param deps {ManagementCommandDeps} Optional idle-check dependency overrides.
 * @return {Promise<string>} Updated version string; `unknown` when undeterminable.
 * @satisfies REQ-134
 * @see probeLatestVersion
 * @note Complexity: one HTTP round-trip bounded by the probe timeout.
 */
async function resolveUpdatedVersion(
  options: ManagementCommandOptions,
  deps: ManagementCommandDeps
): Promise<string> {
  const probe = await probeLatestVersion({
    ...deps.idleCheck,
    currentVersion: options.currentVersion,
  });
  if (probe.status === "newer") {
    return probe.latestVersion;
  }
  if (probe.status === "current") {
    return probe.currentVersion;
  }
  return "unknown";
}

/**
 * @brief Handles `--ver`/`--version`: forced online check plus version print.
 * @details Awaits exactly one idle-gate-bypassing `checkVersionIdle` run
 * (force: true) so the colored availability diagnostics land on stderr before
 * the version line, then writes the installed version plus a newline to
 * stdout and returns 0 (REQ-120, REQ-122, REQ-123, REQ-124).
 * @param options {ManagementCommandOptions} Options carrying `currentVersion`.
 * @param deps {ManagementCommandDeps} Optional idle-check/stdout overrides.
 * @return {Promise<number>} Exit code 0.
 * @satisfies REQ-120
 * @see checkVersionIdle
 */
export async function runVersionCommand(
  options: ManagementCommandOptions,
  deps: ManagementCommandDeps = {}
): Promise<number> {
  await checkVersionIdle({
    ...deps.idleCheck,
    force: true,
    currentVersion: options.currentVersion,
  });
  const stdout = deps.stdout ?? process.stdout;
  stdout.write(`${options.currentVersion}\n`);
  return 0;
}

/**
 * @brief Handles `--upgrade`: reinstall the latest package, then refresh skills with a stdout summary.
 * @details Runs `npm install -g mcp-google-map@latest` with inherited stdio
 * and propagates a non-zero exit code unchanged without printing any summary;
 * on success resolves the updated version via one registry probe (REQ-134),
 * runs the captured-stdout post-upgrade install (REQ-126), prints the
 * human-readable stdout summary with starting version, updated version,
 * install outcome, and per-CLI entries (REQ-132, REQ-133), and returns the
 * post-upgrade install exit code.
 * @param options {ManagementCommandOptions} Options carrying `currentVersion` and `home`.
 * @param deps {ManagementCommandDeps} Optional spawner/idle-check/stdout overrides.
 * @return {Promise<number>} Upgrade exit code when non-zero; otherwise the post-upgrade install exit code.
 * @satisfies REQ-125, REQ-126, REQ-132, REQ-133, REQ-134, REQ-135
 * @see runPackageManagerCommand
 * @see resolveUpdatedVersion
 * @see runPostUpgradeSkillInstall
 * @see renderUpgradeSummary
 */
export async function runUpgradeCommand(
  options: ManagementCommandOptions,
  deps: ManagementCommandDeps = {}
): Promise<number> {
  const upgraded = runPackageManagerCommand(PACKAGE_UPGRADE_COMMAND, deps);
  if (upgraded !== 0) {
    return upgraded;
  }
  const updatedVersion = await resolveUpdatedVersion(options, deps);
  const outcome = runPostUpgradeSkillInstall(options, deps);
  const stdout = deps.stdout ?? process.stdout;
  stdout.write(renderUpgradeSummary(options.currentVersion, updatedVersion, outcome));
  return outcome.exitCode;
}

/**
 * @brief Handles `--uninstall`: remove the globally installed package.
 * @details Runs `npm uninstall -g mcp-google-map` with inherited stdio and
 * returns the child exit code (spawn failures map to 1 with the manual
 * command hint, REQ-127, REQ-128). Managed skill/MCP removal stays the
 * responsibility of the existing `uninstall` subcommand.
 * @param deps {ManagementCommandDeps} Optional spawner/logger overrides.
 * @return {number} Child exit code, or 1 when spawning failed.
 * @satisfies REQ-127
 * @see runPackageManagerCommand
 */
export function runUninstallCommand(deps: ManagementCommandDeps = {}): number {
  return runPackageManagerCommand(PACKAGE_UNINSTALL_COMMAND, deps);
}

/**
 * @brief Dispatches one management command to its handler.
 * @details Single dispatch surface for the CLI entry intercept:
 * `--ver`/`--version` -> `runVersionCommand` (async); `--upgrade` ->
 * `runUpgradeCommand`; `--uninstall` -> `runUninstallCommand`.
 * @param command {ManagementCommandName} Canonical management command name.
 * @param options {ManagementCommandOptions} Options carrying version and home.
 * @param deps {ManagementCommandDeps} Optional dependency overrides.
 * @return {Promise<number>} Handler exit code suitable for `process.exitCode`.
 * @satisfies PRJ-003, REQ-120, REQ-125, REQ-126, REQ-127, REQ-132, REQ-133, REQ-134, REQ-135
 * @see runVersionCommand
 * @see runUpgradeCommand
 * @see runUninstallCommand
 */
export async function runManagementCommand(
  command: ManagementCommandName,
  options: ManagementCommandOptions,
  deps: ManagementCommandDeps = {}
): Promise<number> {
  switch (command) {
    case "--ver":
    case "--version":
      return runVersionCommand(options, deps);
    case "--upgrade":
      return runUpgradeCommand(options, deps);
    case "--uninstall":
      return runUninstallCommand(deps);
  }
}
