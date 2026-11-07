/**
 * @fileoverview Idle-gated online version check and package self-upgrade
 * management commands (`--upgrade`, `--uninstall`, `--ver`, `--version`).
 * @details Adapted from the reference `skills` Python CLI semantics: the
 * automatic registry check is made non-invasive through a persistent idle
 * cache that suppresses registry requests while the previously computed idle
 * deadline is still in the future (REQ-121); `--ver`/`--version` probe npm
 * (packument manifest, latest resolved from `dist-tags.latest`, REQ-179,
 * REQ-180) and GitHub bypassing the idle gate and print the three-line
 * installed/npmjs/GitHub latest-version report (REQ-120, REQ-161, REQ-162,
 * REQ-163, REQ-164); `--upgrade` accepts the `--develop` option and its
 * equivalent `--dev` alias selecting the latest tagged GitHub release as the
 * install source (REQ-170, REQ-177); in the default npm channel it first probes the
 * registry and proceeds only when an upgrade is necessary or necessity is
 * undeterminable (REQ-144, REQ-145, REQ-146,
 * REQ-147), reinstalls the latest package via npm, re-runs the upgraded
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
  probeLatestGitHubVersion,
  probeLatestManifestVersion,
  probeLatestVersion,
  type AutoUpdateCheckerDeps,
  type AutoUpdateLogger,
  type GitHubProbeDeps,
  type LatestVersionProbe,
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
export const IDLE_CACHE_DIR_NAME = "mcp-google-api";

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

/** GitHub repository (owner/name) resolved by the develop upgrade channel (REQ-177). */
export const GITHUB_UPGRADE_REPOSITORY = "Ogekuri/mcp-google-api";

/**
 * @brief Builds the package-manager command installing one GitHub release tag (REQ-171).
 * @details Produces `npm install -g github:<repository>#<tag>` where `<tag>`
 * is the raw `tag_name` probed from the GitHub releases API (REQ-177), so the
 * develop channel installs the latest tagged release regardless of the branch
 * carrying it (REQ-170, REQ-172). npm fetches and builds the referenced tag;
 * child exit-code and spawn-failure semantics are identical to
 * `PACKAGE_UPGRADE_COMMAND` (REQ-125, REQ-128).
 * @param tag {string} Raw GitHub release tag (`tag_name`, e.g. `v1.2.3`); MUST be non-empty.
 * @return {readonly string[]} Executable-plus-arguments command tuple.
 * @satisfies REQ-170, REQ-171, REQ-177
 * @note Complexity: O(n) in tag length. Pure; no side effects.
 * @see probeLatestGitHubVersion
 */
export function buildDevelopUpgradeCommand(tag: string): readonly string[] {
  return ["npm", "install", "-g", `github:${GITHUB_UPGRADE_REPOSITORY}#${tag}`];
}

/** Package-manager command executed by `--uninstall` (REQ-127). */
export const PACKAGE_UNINSTALL_COMMAND: readonly string[] = [
  "npm",
  "uninstall",
  "-g",
  DEFAULT_PACKAGE_NAME,
];

/**
 * @brief Child command refreshing skills/registrations after `--upgrade` (REQ-126).
 * @details Invokes the globally installed bin of the package JUST upgraded by
 * `PACKAGE_UPGRADE_COMMAND` (REQ-125): the executable already on `PATH` in the
 * exact scenario where `--upgrade` runs, guaranteed to match the upgraded
 * version. MUST NOT be an unversioned `npx -y mcp-google-api` spec: npx
 * resolves from its own cache/registry rather than the upgraded global
 * install, so a stale cached copy of the CLI could execute instead — on
 * pre-`$0`-gating releases the default command starts the MCP HTTP server,
 * which never exits and blocks the parent `spawnSync` forever (observed
 * defect: `--upgrade` appears to launch the MCP server instead of running
 * `install`). Windows spawns run through a shell, so `mcp-google-api.cmd`
 * resolves via `PATHEXT` exactly like the `npm` executable.
 * @satisfies REQ-126
 */
export const POST_UPGRADE_INSTALL_COMMAND: readonly string[] = [
  DEFAULT_PACKAGE_NAME,
  "install",
];

/**
 * @brief Per-CLI result entry of the post-upgrade install consumed by the `--upgrade` summary.
 * @details One entry per CLI processed by the child `install` command (REQ-133);
 * counts are present only when the child activity report was parseable.
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
 * @details Joins `<home>/.cache/mcp-google-api/check_version_idle-time.json`
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
 * @brief Install source selected for the `--upgrade` command.
 * @details `npm` (default) resolves `mcp-google-api@latest` from the npm
 * registry (REQ-125); `develop` resolves the latest tagged GitHub release of
 * `Ogekuri/mcp-google-api` via the releases API (REQ-177) and installs it as
 * `github:Ogekuri/mcp-google-api#<tag>` (REQ-171), independent of the branch
 * carrying the tag (REQ-170).
 * @satisfies REQ-170
 */
export type UpgradeChannel = "npm" | "develop";

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
 * installation; `channel` selects the `--upgrade` install source (`npm`
 * default; `develop` = latest tagged GitHub release, REQ-170, REQ-177).
 */
export interface ManagementCommandOptions {
  /** Running package version printed by `--ver`/`--version`. */
  currentVersion: string;
  /** Home-directory override for the enabled-CLI settings read. */
  home?: string;
  /** `--upgrade` install channel; `develop` selects the latest tagged GitHub release (REQ-170, REQ-177). Default: `npm`. */
  channel?: UpgradeChannel;
}

/**
 * @brief Aggregated dependency surface of the management dispatch.
 * @details Combines the package-manager injection surface with the idle-check
 * injection surface and an injectable stdout sink used by the version print.
 */
export interface ManagementCommandDeps extends PackageManagerDeps {
  /** Dependencies forwarded to `probeLatestVersion` by `--ver`/`--version` and the `--upgrade` pre-upgrade probe. */
  idleCheck?: IdleCheckDeps;
  /** Dependencies forwarded to `probeLatestGitHubVersion` by `--ver`/`--version`. */
  githubCheck?: GitHubProbeDeps;
  /** stdout sink receiving the version report lines and the `--upgrade` summary; defaults to `process.stdout`. */
  stdout?: { write: (data: string) => void };
}

/**
 * @brief Detects an exact management-command argv shape in a raw argv array.
 * @details Single-token shape: exactly one of `--ver`, `--version`,
 * `--upgrade`, `--uninstall`. Two-token shape: `--upgrade` paired with the
 * `--develop` option or its equivalent `--dev` alias, in either order
 * (REQ-170). Any other shape (including combined flags or subcommands)
 * yields undefined so normal yargs dispatch stays untouched.
 * @param args {readonly string[]} Raw argv after the Node binary/script tokens.
 * @return {ManagementCommandName | undefined} Canonical command name, or undefined.
 * @satisfies PRJ-003, REQ-120, REQ-125, REQ-127, REQ-170
 * @note Complexity: O(1). Pure.
 */
export function parseManagementCommand(
  args: readonly string[]
): ManagementCommandName | undefined {
  if (args.length === 1) {
    const arg = args[0];
    if (arg === "--ver" || arg === "--version" || arg === "--upgrade" || arg === "--uninstall") {
      return arg;
    }
    return undefined;
  }
  if (args.length === 2) {
    const hasUpgrade = args.includes("--upgrade");
    const hasDevelop = args.includes("--develop") || args.includes("--dev");
    if (hasUpgrade && hasDevelop) {
      return "--upgrade";
    }
  }
  return undefined;
}

/**
 * @brief Resolves the `--upgrade` install channel from a raw argv array.
 * @details Returns `"develop"` when the argv contains the `--develop` option
 * or its equivalent `--dev` alias (both orderings relative to `--upgrade`
 * accepted by `parseManagementCommand`); returns `"npm"` (default channel)
 * otherwise. Pure; no side effects.
 * @param args {readonly string[]} Raw argv after the Node binary/script tokens.
 * @return {UpgradeChannel} `"develop"` or `"npm"`.
 * @satisfies REQ-170
 * @note Complexity: O(n) in argv length. Pure.
 */
export function parseUpgradeChannel(args: readonly string[]): UpgradeChannel {
  return args.includes("--develop") || args.includes("--dev") ? "develop" : "npm";
}

/**
 * @brief Runs one package-manager command as a child process with inherited stdio.
 * @details Spawns `command[0]` with the remaining tokens, inheriting stdio so
 * npm/npx output streams through unchanged; on Windows the spawn runs through
 * a shell so `npm.cmd` resolves. The child runs with an explicit neutral
 * working directory (the user home), never the caller's cwd: management
 * installs are routinely invoked from inside the source checkout of the same
 * package being replaced, and reconciling a git-ref global install against
 * that same-name local project context corrupts npm reify (observed as
 * TAR_ENTRY_ERROR ENOENT floods plus lifecycle `spawn sh ENOENT` in a cwd
 * deleted mid-reify). A spawn failure (missing executable or thrown spawn
 * error) prints the error plus the exact manual command hint on stderr and
 * returns exit code 1; otherwise the child exit code propagates (null status
 * maps to 1).
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
      cwd: homedir(),
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
 * @brief Parses the child `install` activity report into per-CLI outcomes.
 * @details Accepts the human-readable report emitted by the `install` command
 * on stdout (REQ-166): lines of the form `  <cli>: <activity>` under the
 * `mcp-google-api install report:` header, optionally followed by an
 * `Errors:` block. A CLI is marked `ok: false` when any error diagnostic text
 * contains its name (case-insensitive). Returns undefined for missing or
 * unparseable output so callers fall back to the persisted enabled-CLI list
 * (REQ-135). Pure; never throws.
 * @param raw {string | undefined} Captured child stdout text.
 * @return {PostUpgradeCliOutcome[] | undefined} Per-CLI entries in report order; undefined when unparseable.
 * @satisfies REQ-133, REQ-135, REQ-166
 * @note Complexity: O(n + m) with n report lines and m error strings.
 */
function parsePostUpgradeCliOutcomes(
  raw: string | undefined
): PostUpgradeCliOutcome[] | undefined {
  if (raw === undefined || !raw.includes("install report:")) {
    return undefined;
  }
  const lines = raw.split(/\r?\n/);
  const cliLine = /^\s{2,}([a-z][a-z0-9-]*):\s+/;
  const outcomes: PostUpgradeCliOutcome[] = [];
  for (const line of lines) {
    const match = cliLine.exec(line);
    if (match) {
      outcomes.push({ cli: match[1], ok: true });
    }
  }
  if (outcomes.length === 0) {
    return undefined;
  }
  const errorBlockIndex = lines.findIndex((line) => line.trim() === "Errors:");
  const errorTexts =
    errorBlockIndex >= 0
      ? lines.slice(errorBlockIndex + 1).filter((line) => line.trim().length > 0)
      : [];
  for (const outcome of outcomes) {
    const lowered = outcome.cli.toLowerCase();
    if (errorTexts.some((text) => text.toLowerCase().includes(lowered))) {
      outcome.ok = false;
    }
  }
  return outcomes;
}

/**
 * @brief Refreshes installed skills through the upgraded package after `--upgrade`.
 * @details When at least one CLI is enabled in the persisted settings, spawns
 * `mcp-google-api install` — the globally installed bin of the just-upgraded
 * package (`POST_UPGRADE_INSTALL_COMMAND`) — with captured child stdout
 * (stderr stays inherited so child diagnostics remain visible), so the
 * freshly upgraded package (not the running process, and never a stale npx
 * cache copy) re-synchronizes its packaged skills and MCP registrations into
 * every enabled CLI without echoing the child activity report (REQ-126). The captured payload is parsed into per-CLI outcomes;
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
    `mcp-google-api upgrade completed: ${previousVersion} -> ${updatedVersion}`,
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
 * @brief Maps one registry probe outcome to its latest-version text.
 * @details `newer` -> `latestVersion`; `current` -> `currentVersion`;
 * every other outcome (`disabled`, `unknown-version`, `error`) -> `unknown`
 * (REQ-164). Pure; never throws.
 * @param probe {LatestVersionProbe} Logging-free registry probe outcome.
 * @return {string} Latest npm-published version text, or `unknown`.
 * @satisfies REQ-164
 * @note Complexity: O(1). Pure; no side effects.
 * @see probeLatestVersion
 */
function resolveProbeLatestVersion(probe: LatestVersionProbe): string {
  if (probe.status === "newer") {
    return probe.latestVersion;
  }
  if (probe.status === "current") {
    return probe.currentVersion;
  }
  return "unknown";
}

/**
 * @brief Resolves the updated package version reported by the `--upgrade` summary.
 * @details Runs one logging-free `probeLatestVersion` registry probe after the
 * upgrade child succeeds, forwarding the injected idle-check dependencies, and
 * delegates the outcome-to-version mapping to `resolveProbeLatestVersion`:
 * `newer` maps to the registry latest version, `current` to the running
 * version, and every other outcome to `unknown` (REQ-134). Never throws.
 * Invoked by `runUpgradeCommand` only when the pre-upgrade probe did not
 * resolve an npmjs latest version (REQ-181).
 * @param options {ManagementCommandOptions} Options carrying `currentVersion`.
 * @param deps {ManagementCommandDeps} Optional idle-check dependency overrides.
 * @return {Promise<string>} Updated version string; `unknown` when undeterminable.
 * @satisfies REQ-134
 * @see probeLatestVersion
 * @see resolveProbeLatestVersion
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
  return resolveProbeLatestVersion(probe);
}

/**
 * @brief Handles `--ver`/`--version`: dual online probe plus three-line version report.
 * @details Runs the npm packument-manifest probe (`probeLatestManifestVersion`,
 * abbreviated-manifest Accept header, latest resolved from `dist-tags.latest`,
 * REQ-179, REQ-180) and the GitHub releases probe (`probeLatestGitHubVersion`)
 * concurrently, both bypassing the idle cache gate (REQ-161: no cache read, no
 * cache write, no persisted `autoUpdate` gating), then writes exactly three
 * stdout lines — the installed version, `npmjs latest: <version>` (REQ-162),
 * and `GitHub latest: <version>` (REQ-163) — and returns 0 (REQ-120). Any
 * undeterminable version prints as `unknown` (REQ-164).
 * @param options {ManagementCommandOptions} Options carrying `currentVersion`.
 * @param deps {ManagementCommandDeps} Optional idle-check/GitHub-check/stdout overrides.
 * @return {Promise<number>} Exit code 0.
 * @satisfies REQ-120, REQ-161, REQ-162, REQ-163, REQ-164, REQ-179, REQ-180
 * @see probeLatestManifestVersion
 * @see probeLatestGitHubVersion
 * @see resolveProbeLatestVersion
 */
export async function runVersionCommand(
  options: ManagementCommandOptions,
  deps: ManagementCommandDeps = {}
): Promise<number> {
  const [npmProbe, githubProbe] = await Promise.all([
    probeLatestManifestVersion({ ...deps.idleCheck, currentVersion: options.currentVersion }),
    probeLatestGitHubVersion(deps.githubCheck),
  ]);
  const installedVersion = options.currentVersion || "unknown";
  const npmLatest = resolveProbeLatestVersion(npmProbe);
  const githubLatest = githubProbe.status === "ok" ? githubProbe.version : "unknown";
  const stdout = deps.stdout ?? process.stdout;
  stdout.write(`${installedVersion}\nnpmjs latest: ${npmLatest}\nGitHub latest: ${githubLatest}\n`);
  return 0;
}

/**
 * @brief Decides whether the `--upgrade` flow must proceed after the pre-upgrade check.
 * @details Decision table over `LatestVersionProbe.status`: `newer` -> true
 * (REQ-146); `current` -> false (REQ-145: the installed version is already
 * the latest available); `disabled`, `unknown-version`, `error` -> true
 * (REQ-147: upgrade necessity undeterminable, legacy update path preserved).
 * @param status {LatestVersionProbe["status"]} Status of the pre-upgrade registry probe.
 * @return {boolean} True when the REQ-125 package-update child process must run.
 * @satisfies REQ-144, REQ-145, REQ-146, REQ-147
 * @note Complexity: O(1). Pure; no side effects.
 * @see probeLatestVersion
 */
function isUpgradeNecessary(status: LatestVersionProbe["status"]): boolean {
  return status !== "current";
}

/**
 * @brief Handles `--upgrade`: channel selection, package reinstall, then refresh skills with a stdout summary.
 * @details Develop channel (`options.channel === "develop"`, selected by the
 * `--develop` option or its equivalent `--dev` alias, REQ-170): skips the
 * registry comparison and the already-latest skip path entirely, always
 * proceeding with the tagged GitHub update (REQ-172). It first runs one
 * forced GitHub releases probe bypassing the idle cache gate (REQ-177); on
 * probe failure it prints a stderr diagnostic carrying the probe message and
 * returns 1 without spawning any child process (REQ-178); on success it runs
 * `buildDevelopUpgradeCommand(tag)` (REQ-171), then the post-upgrade
 * install and summary with the probed latest GitHub release version as the
 * updated version (REQ-173). Default npm channel
 * resolution order: one forced logging-free `probeLatestVersion`
 * registry probe bypassing the idle cache gate (REQ-144) -> `current` status
 * writes the already-latest stdout line including the installed version and
 * returns 0 without spawning any child process (REQ-145) -> any other
 * outcome proceeds to the update path (`newer` per REQ-146;
 * `disabled`/`unknown-version`/`error` per REQ-147). The update path runs
 * `npm install -g mcp-google-api@latest` with inherited stdio and propagates
 * a non-zero exit code unchanged without printing any summary; on success
 * resolves the updated version from the pre-upgrade probe's npmjs latest when
 * that probe reported a newer version, avoiding a second registry round-trip
 * (REQ-181), else via one post-upgrade registry probe (REQ-134), runs the
 * captured-stdout post-upgrade install (REQ-126), prints the
 * human-readable stdout summary with starting version, updated version,
 * install outcome, and per-CLI entries (REQ-132, REQ-133), and returns the
 * post-upgrade install exit code.
 * @param options {ManagementCommandOptions} Options carrying `currentVersion`, `home`, and `channel`.
 * @param deps {ManagementCommandDeps} Optional spawner/idle-check/stdout overrides.
 * @return {Promise<number>} 0 when the installed version is already the latest available; otherwise the upgrade exit code when non-zero, else the post-upgrade install exit code.
 * @satisfies REQ-125, REQ-126, REQ-132, REQ-133, REQ-134, REQ-135, REQ-144, REQ-145, REQ-146, REQ-147, REQ-170, REQ-171, REQ-172, REQ-173, REQ-177, REQ-178, REQ-181
 * @see probeLatestVersion
 * @see probeLatestGitHubVersion
 * @see isUpgradeNecessary
 * @see runPackageManagerCommand
 * @see buildDevelopUpgradeCommand
 * @see resolveUpdatedVersion
 * @see runPostUpgradeSkillInstall
 * @see renderUpgradeSummary
 */
export async function runUpgradeCommand(
  options: ManagementCommandOptions,
  deps: ManagementCommandDeps = {}
): Promise<number> {
  if ((options.channel ?? "npm") === "develop") {
    const githubProbe = await probeLatestGitHubVersion(deps.githubCheck);
    if (githubProbe.status !== "ok") {
      (deps.logger ?? Logger).error(`GitHub upgrade channel probe failed: ${githubProbe.message}`);
      return 1;
    }
    const upgraded = runPackageManagerCommand(buildDevelopUpgradeCommand(githubProbe.tag), deps);
    if (upgraded !== 0) {
      return upgraded;
    }
    const outcome = runPostUpgradeSkillInstall(options, deps);
    const stdout = deps.stdout ?? process.stdout;
    stdout.write(renderUpgradeSummary(options.currentVersion, githubProbe.version, outcome));
    return outcome.exitCode;
  }
  const precheck = await probeLatestVersion({
    ...deps.idleCheck,
    currentVersion: options.currentVersion,
  });
  if (!isUpgradeNecessary(precheck.status)) {
    const stdout = deps.stdout ?? process.stdout;
    stdout.write(
      `${DEFAULT_PACKAGE_NAME} ${options.currentVersion} is already the latest available version.\n`
    );
    return 0;
  }
  // REQ-181: reuse the pre-upgrade npmjs latest when resolved (`newer`); the
  // post-upgrade probe only backs the undeterminable precheck outcomes (REQ-134).
  const knownLatest = precheck.status === "newer" ? precheck.latestVersion : undefined;
  const upgraded = runPackageManagerCommand(PACKAGE_UPGRADE_COMMAND, deps);
  if (upgraded !== 0) {
    return upgraded;
  }
  const updatedVersion = knownLatest ?? (await resolveUpdatedVersion(options, deps));
  const outcome = runPostUpgradeSkillInstall(options, deps);
  const stdout = deps.stdout ?? process.stdout;
  stdout.write(renderUpgradeSummary(options.currentVersion, updatedVersion, outcome));
  return outcome.exitCode;
}

/**
 * @brief Handles `--uninstall`: remove the globally installed package.
 * @details Runs `npm uninstall -g mcp-google-api` with inherited stdio and
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
 * `runUpgradeCommand` (honoring the forwarded develop-channel option);
 * `--uninstall` -> `runUninstallCommand`.
 * @param command {ManagementCommandName} Canonical management command name.
 * @param options {ManagementCommandOptions} Options carrying version, home, and upgrade channel.
 * @param deps {ManagementCommandDeps} Optional dependency overrides.
 * @return {Promise<number>} Handler exit code suitable for `process.exitCode`.
 * @satisfies PRJ-003, REQ-120, REQ-125, REQ-126, REQ-127, REQ-132, REQ-133, REQ-134, REQ-135, REQ-170
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
