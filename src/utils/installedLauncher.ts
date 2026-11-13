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
}

/**
 * @brief Discriminated outcome of one global launcher resolution.
 * @details `ok: true` carries the absolute registration entry together with
 * the resolved global package directory and launcher path, which callers reuse
 * for entrypoint classification (REQ-235); `ok: false` carries an English
 * remediation diagnostic (REQ-236).
 * @satisfies REQ-114, REQ-236
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
 * [<absolute launcher>, "start", "--stdio"] }`. Every failure returns
 * `{ ok: false }` with the GLOBAL_INSTALL_REMEDIATION command; no name-only
 * spec and no cwd-relative path is ever produced (REQ-232, REQ-234, REQ-236).
 * @param deps {InstalledLauncherDeps} Optional spawner, platform, filesystem, and executable overrides.
 * @return {InstalledLauncherResolution} Absolute launcher resolution or remediation diagnostic.
 * @note Complexity O(1) plus one child round-trip. No configuration write.
 * @see resolveGlobalPackageDir
 * @see describeEntrypointBinding
 * @satisfies DES-030, REQ-114, REQ-234, REQ-236
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
      command: deps.execPath ?? process.execPath,
      args: [launcherPath, ...LAUNCHER_STDIO_ARGUMENTS],
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
    `install must run from the global installation (${globalPackageDir}); ` +
    `the running entrypoint ${packageRoot} is a source checkout or an npm _npx cache copy. ` +
    `Run '${GLOBAL_INSTALL_REMEDIATION}' and retry.`
  );
}

/**
 * @brief Compare one stored registration with the expected global launcher.
 * @details Classifies the binding for `show` (REQ-237): absent entry ->
 * `MISSING`; no expected launcher (unresolvable global root) -> `OK` because no
 * comparison is possible; otherwise equal `command` plus element-wise equal
 * `args` -> `OK`, any difference -> `STALE`. An expected entry is never
 * subset-matched: extra or reordered arguments are stale.
 * @param binding {McpServerRegistration | undefined} Stored client registration.
 * @param expected {McpServerRegistration | undefined} Resolved global launcher, when available.
 * @return {"OK" | "MISSING" | "STALE"} Binding classification.
 * @note Complexity O(arguments). Pure; no side effects.
 * @satisfies REQ-237
 */
export function compareServerRegistration(
  binding: McpServerRegistration | undefined,
  expected: McpServerRegistration | undefined
): "OK" | "MISSING" | "STALE" {
  if (binding === undefined) {
    return "MISSING";
  }
  if (expected === undefined) {
    return "OK";
  }
  const bindingArgs = binding.args ?? [];
  const expectedArgs = expected.args ?? [];
  const sameArguments =
    bindingArgs.length === expectedArgs.length &&
    bindingArgs.every((arg, index) => arg === expectedArgs[index]);
  return binding.command === expected.command && sameArguments ? "OK" : "STALE";
}

/**
 * @brief Render one registration entry as a single display line.
 * @details Joins `command` and every argument with one space; empty entries
 * render as the empty string so table cells stay compact (REQ-118, REQ-237).
 * @param entry {McpServerRegistration | undefined} Registration to render.
 * @return {string} Display text; empty when no entry is given.
 * @note Complexity O(arguments). Pure; no side effects.
 * @satisfies REQ-237
 */
export function formatServerRegistration(entry: McpServerRegistration | undefined): string {
  if (entry === undefined) {
    return "";
  }
  return [entry.command, ...(entry.args ?? [])].join(" ");
}
