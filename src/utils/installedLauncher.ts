/**
 * @file installedLauncher.ts
 * @brief Resolve the absolute stdio launcher of the globally installed package.
 * @details Single resolver (DES-030) turning the npm global root into the
 * absolute Node.js executable plus the absolute packaged launcher path used by
 * every MCP-client registration (REQ-114, REQ-234). The resolved shape is
 * invariant to the client working directory, so no name-only `npx` spec is
 * ever persisted (REQ-233, REQ-234). The module also classifies the running
 * entrypoint against the global package directory (REQ-235) and compares a
 * stored registration with the expected launcher for `show` (REQ-237).
 * @note Pure decision logic plus one captured `npm prefix -g` probe through
 * `resolveGlobalPackageDir`; no configuration write and no cwd dependence.
 * @satisfies DES-030, REQ-114, REQ-233, REQ-234, REQ-235, REQ-236, REQ-237
 */

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MCP_SERVER_NAME } from "./cliSettings.js";
import type { McpServerRegistration } from "./cliTargets.js";
import { resolveGlobalPackageDir, type PackageManagerDeps } from "./upgradeManager.js";

/** @brief Package-relative path of the installed stdio launcher script. */
export const LAUNCHER_SCRIPT_RELATIVE_PATH = join("bin", "mcp-google-api.mjs");

/** @brief Global-refresh remediation command named by every refusal path. */
export const GLOBAL_INSTALL_REMEDIATION = `npm install -g ${MCP_SERVER_NAME}@latest`;

/** @brief Stdio arguments appended to the absolute launcher path. */
export const LAUNCHER_STDIO_ARGUMENTS: readonly string[] = ["start", "--stdio"];

/**
 * @brief Dependency surface of the launcher resolver and entrypoint classifier.
 * @details Extends the package-manager injection surface (spawner, platform,
 * logger) with the filesystem probes used to verify the launcher script and to
 * compare real paths, plus the Node.js executable reported in the registration
 * (REQ-114, REQ-235). Every field is optional; production calls pass none.
 * @satisfies DES-030, REQ-114, REQ-235
 */
export interface InstalledLauncherDeps extends PackageManagerDeps {
  /** Existence probe; defaults to `node:fs` `existsSync`. */
  existsSync?: (path: string) => boolean;
  /** Symlink-resolving path probe; defaults to `node:fs` `realpathSync`. */
  realpathSync?: (path: string) => string;
  /** Node.js executable rendered as the registration `command`; defaults to `process.execPath` (REQ-114). */
  execPath?: string;
  /** Home-directory override used by every home reference; defaults to `HOME` then `os.homedir()` (DES-031). */
  home?: string;
}

/**
 * @brief Resolve the user home root used by every home reference.
 * @details Priority: explicit override -> `HOME` environment variable ->
 * `os.homedir()`. An empty override or empty `HOME` falls through, so a
 * stripped environment still yields a usable root. The returned root carries
 * no trailing separator (DES-031).
 * @param home {string | undefined} Home-directory override.
 * @return {string} Home root without a trailing separator.
 * @note Complexity O(1). Pure; no filesystem access.
 * @satisfies DES-031, REQ-238, REQ-240
 */
export function resolveUserHome(home?: string): string {
  const candidate = home !== undefined && home.length > 0 ? home : process.env.HOME;
  const root = candidate !== undefined && candidate.length > 0 ? candidate : homedir();
  return root.replace(/[\\/]+$/, "");
}

/**
 * @brief Render one path as a `~/`-rooted home reference when it lies inside the user home.
 * @details Normalizes both sides to `/` separators and matches on a
 * path-segment boundary, so `/home/userX` is never treated as inside
 * `/home/user`. The home root itself renders as `~`, every deeper path as
 * `~/<rest>`; paths outside the home and plain tokens such as `start` are
 * returned verbatim (REQ-238, REQ-239, REQ-240).
 * @param value {string} Absolute path or plain token to encode.
 * @param home {string | undefined} Home-directory override; defaults to `resolveUserHome()`.
 * @return {string} Home reference or the unchanged value.
 * @note Complexity O(n) in path length. Pure; no filesystem access.
 * @see resolveUserHome
 * @satisfies DES-031, REQ-238, REQ-239, REQ-240
 */
export function toHomeReference(value: string, home?: string): string {
  if (value.length === 0) return value;
  const homeRoot = resolveUserHome(home).split("\\").join("/");
  if (homeRoot.length === 0) return value;
  const normalized = value.split("\\").join("/");
  if (normalized === homeRoot) return "~";
  const prefix = `${homeRoot}/`;
  return normalized.startsWith(prefix) ? `~/${normalized.slice(prefix.length)}` : value;
}

/**
 * @brief Discriminated outcome of one global launcher resolution.
 * @details `ok: true` carries the home-referenced registration entry together
 * with the resolved absolute global package directory and launcher path, which
 * callers reuse for the existence probe and entrypoint classification
 * (REQ-235, REQ-238); `ok: false` carries an English remediation diagnostic
 * (REQ-236).
 * @satisfies REQ-114, REQ-236, REQ-238
 */
export type InstalledLauncherResolution =
  | {
      ok: true;
      launcher: McpServerRegistration;
      globalPackageDir: string;
      launcherPath: string;
    }
  | { ok: false; error: string };

/**
 * @brief Resolve the absolute stdio launcher of the globally installed package.
 * @details Resolution order: `resolveGlobalPackageDir(deps)` (captured
 * `npm prefix -g`, POSIX `<prefix>/lib/node_modules`, win32
 * `<prefix>/node_modules`) -> `<global package dir>/bin/mcp-google-api.mjs`
 * existence probe -> registration `{ command: <node executable>, args:
 * [<global launcher>, "start", "--stdio"] }`, where every home-rooted path is
 * rendered as a `~/`-rooted home reference (REQ-238) and every path outside
 * the home stays absolute (REQ-239). Every failure returns `{ ok: false }`
 * with the GLOBAL_INSTALL_REMEDIATION command; no name-only spec and no
 * cwd-relative path is ever produced (REQ-232, REQ-234, REQ-236).
 * @param deps {InstalledLauncherDeps} Optional spawner, platform, filesystem, executable, and home overrides.
 * @return {InstalledLauncherResolution} Home-referenced launcher resolution or remediation diagnostic.
 * @note Complexity O(1) plus one child round-trip. No configuration write.
 * @see resolveGlobalPackageDir
 * @see toHomeReference
 * @see describeEntrypointBinding
 * @satisfies DES-030, DES-031, REQ-114, REQ-234, REQ-236, REQ-238, REQ-239
 */
export function resolveInstalledLauncher(
  deps: InstalledLauncherDeps = {}
): InstalledLauncherResolution {
  const exists = deps.existsSync ?? existsSync;
  const globalPackageDir = resolveGlobalPackageDir(deps);
  if (globalPackageDir === undefined) {
    return {
      ok: false,
      error: `Cannot resolve the npm global installation root; run '${GLOBAL_INSTALL_REMEDIATION}' first.`,
    };
  }
  const launcherPath = join(globalPackageDir, LAUNCHER_SCRIPT_RELATIVE_PATH);
  if (!exists(launcherPath)) {
    return {
      ok: false,
      error: `Global launcher not found at ${launcherPath}; run '${GLOBAL_INSTALL_REMEDIATION}' first.`,
    };
  }
  return {
    ok: true,
    launcher: {
      command: toHomeReference(deps.execPath ?? process.execPath, deps.home),
      args: [toHomeReference(launcherPath, deps.home), ...LAUNCHER_STDIO_ARGUMENTS],
    },
    globalPackageDir,
    launcherPath,
  };
}

/**
 * @brief Classify a running package root against the global package directory.
 * @details Resolves both sides through the injected `realpathSync` (tolerant:
 * an unresolvable side keeps its literal path) and compares them. A differing
 * root means the running entrypoint is a source checkout or an npm `_npx`
 * cache copy, so `install` MUST refuse to register (REQ-235). Returns
 * undefined when the paths match, i.e. the global installation is running.
 * @param packageRoot {string} Absolute root directory of the running package.
 * @param globalPackageDir {string} Absolute directory returned by the launcher resolution.
 * @param deps {InstalledLauncherDeps} Optional realpath override.
 * @return {string | undefined} Refusal diagnostic naming the remediation, or undefined when bound.
 * @note Complexity O(1) plus two filesystem metadata lookups. Pure; no side effects.
 * @satisfies REQ-235
 */
export function describeEntrypointBinding(
  packageRoot: string,
  globalPackageDir: string,
  deps: InstalledLauncherDeps = {}
): string | undefined {
  const resolveRealPath = deps.realpathSync ?? realpathSync;
  const real = (value: string): string => {
    try {
      return resolveRealPath(value);
    } catch {
      return value;
    }
  };
  if (real(packageRoot) === real(globalPackageDir)) {
    return undefined;
  }
  return (
    `install must run from the global installation (${toHomeReference(globalPackageDir, deps.home)}); ` +
    `the running entrypoint ${toHomeReference(packageRoot, deps.home)} is a source checkout or an npm _npx cache copy. ` +
    `Run '${GLOBAL_INSTALL_REMEDIATION}' and retry.`
  );
}

/**
 * @brief Compare one stored registration with the expected global launcher.
 * @details Classifies the binding for `show` (REQ-237): absent entry ->
 * `MISSING`; no expected launcher (unresolvable global root) -> `OK` because no
 * comparison is possible; otherwise equal `command` plus element-wise equal
 * `args` -> `OK`, any difference -> `STALE`. Both sides are normalized through
 * `toHomeReference` first, so a stored absolute home-prefixed binding and the
 * resolved `~/`-rooted launcher compare equal (REQ-241). An expected entry is
 * never subset-matched: extra or reordered arguments are stale.
 * @param binding {McpServerRegistration | undefined} Stored client registration.
 * @param expected {McpServerRegistration | undefined} Resolved global launcher, when available.
 * @param home {string | undefined} Home-directory override used for home-reference normalization (DES-031).
 * @return {"OK" | "MISSING" | "STALE"} Binding classification.
 * @note Complexity O(arguments). Pure; no side effects.
 * @see toHomeReference
 * @satisfies REQ-237, REQ-241
 */
export function compareServerRegistration(
  binding: McpServerRegistration | undefined,
  expected: McpServerRegistration | undefined,
  home?: string
): "OK" | "MISSING" | "STALE" {
  if (binding === undefined) {
    return "MISSING";
  }
  if (expected === undefined) {
    return "OK";
  }
  const normalizeEntry = (entry: McpServerRegistration): { command: string; args: string[] } => ({
    command: toHomeReference(entry.command, home),
    args: (entry.args ?? []).map((arg) => toHomeReference(arg, home)),
  });
  const stored = normalizeEntry(binding);
  const wanted = normalizeEntry(expected);
  const sameArguments =
    stored.args.length === wanted.args.length &&
    stored.args.every((arg, index) => arg === wanted.args[index]);
  return stored.command === wanted.command && sameArguments ? "OK" : "STALE";
}

/**
 * @brief Render one registration entry as a single display line.
 * @details Joins `command` and every argument with one space after rendering
 * every home-rooted token through `toHomeReference`, so the `show` Launcher
 * column shows `~/...` instead of an absolute home-prefixed path (REQ-240).
 * Empty entries render as the empty string so table cells stay compact
 * (REQ-118, REQ-237).
 * @param entry {McpServerRegistration | undefined} Registration to render.
 * @param home {string | undefined} Home-directory override used for home references (DES-031).
 * @return {string} Display text; empty when no entry is given.
 * @note Complexity O(arguments). Pure; no side effects.
 * @see toHomeReference
 * @satisfies REQ-118, REQ-237, REQ-240
 */
export function formatServerRegistration(
  entry: McpServerRegistration | undefined,
  home?: string
): string {
  if (entry === undefined) {
    return "";
  }
  return [entry.command, ...(entry.args ?? [])]
    .map((token) => toHomeReference(token, home))
    .join(" ");
}
