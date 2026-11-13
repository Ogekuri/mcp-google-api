/**
 * @fileoverview HDT unit suite for the management-command upgrade flow.
 * @details Regression coverage for the `--upgrade` defect where the
 * post-upgrade child resolved an unversioned `npx` spec instead of the
 * upgraded package's own CLI: a stale npx-cache copy of the package could
 * start the MCP HTTP server instead of running the `install` command,
 * blocking the parent forever (REQ-126). Verifies REQ-125 (upgrade child
 * spawn + exit propagation), REQ-126 (post-upgrade `install` child via the
 * upgraded package bin, captured stdout), REQ-127 (uninstall child), REQ-128
 * (spawn-failure hint), REQ-132/REQ-135 (summary fallback), the
 * management-command exact-match dispatch (PRJ-003), the `--force`
 * auxiliary upgrade option (REQ-187, REQ-188, REQ-189, REQ-190), the
 * develop-channel release-asset install (REQ-171, REQ-172, REQ-225, REQ-228),
 * and the ENOENT global-tree recovery (REQ-182, REQ-183, REQ-226, REQ-227,
 * REQ-229, REQ-230). All child processes, filesystem reads, network probes,
 * and output streams are injected, so the suite is deterministic and
 * side-effect free.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildDevelopUpgradeCommand,
  PACKAGE_UPGRADE_COMMAND,
  PACKAGE_UNINSTALL_COMMAND,
  parseManagementCommand,
  parseUpgradeForce,
  purgeGlobalPackageTree,
  runPackageManagerCommand,
  runUpgradeCommand,
  runUninstallCommand,
  runVersionCommand,
  UPGRADE_FORCE_OPTION,
  type GlobalPackageTreeFs,
  type ManagementCommandDeps,
  type ManagementCommandOptions,
} from "../src/utils/upgradeManager.js";
import { DEFAULT_GITHUB_RELEASES_API_URL, type AutoUpdateLogger } from "../src/utils/autoUpdate.js";

/** Recorded record of one spawned child process. */
interface RecordedSpawn {
  /** Spawned executable (first element of the command tuple). */
  command: string;
  /** Spawned arguments (remaining elements of the command tuple). */
  args: readonly string[];
  /** Spawn options; `stdio` distinguishes inherited vs captured streams. */
  options: { stdio?: unknown; shell?: boolean; cwd?: unknown; encoding?: unknown };
}

/**
 * @brief Builds a fetch stub answering the npm registry and GitHub release probes.
 * @details Route discrimination follows the probe URL shapes: `api.github.com`
 * yields `{ tag_name }`; an npm `/latest` document yields `{ version }`; the
 * packument manifest URL yields `{ "dist-tags": { latest } }`. Every response
 * is `ok`, so the suite stays network-free and deterministic (REQ-162,
 * REQ-163, REQ-134).
 * @param npmLatest {string} Version published as the npm `latest` dist-tag.
 * @param githubTag {string} GitHub `tag_name` of the latest release.
 * @return {typeof fetch} Stub fetch implementation.
 */
function createRegistryFetchStub(npmLatest: string, githubTag: string): typeof fetch {
  return (async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    const payload = url.includes("api.github.com")
      ? { tag_name: githubTag }
      : url.endsWith("/latest")
        ? { version: npmLatest }
        : { "dist-tags": { latest: npmLatest } };
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }) as unknown as typeof fetch;
}

/**
 * @brief Builds a capturing stdout sink collecting everything written to it.
 * @param chunks {string[]} Accumulator receiving each written chunk.
 * @return {NodeJS.WritableStream} Minimal write-only stream stub.
 */
function createStdoutStub(chunks: string[]): NodeJS.WritableStream {
  return { write: (data: string | Uint8Array) => void chunks.push(String(data)) } as NodeJS.WritableStream;
}

// ---------------------------------------------------------------------------
// Helpers shared by the management-command cases below
// ---------------------------------------------------------------------------

/**
 * @brief Builds a spawn stub that records every child process and returns scripted results.
 * @details Each call consumes the next entry of `results`; when entries are
 * exhausted the last entry repeats. Never touches a real process, so the
 * suite stays deterministic and network-free.
 * @param results {Array<Partial<ReturnType<typeof spawnSync>>>} Scripted results consumed in call order.
 * @return {{ spawnStub: typeof spawnSync; calls: RecordedSpawn[] }} Stub plus ordered call records.
 */
function createSpawnStub(
  results: Array<Partial<ReturnType<typeof spawnSync>>>
): { spawnStub: typeof spawnSync; calls: RecordedSpawn[] } {
  const calls: RecordedSpawn[] = [];
  const spawnStub = ((command: string, args: readonly string[], options: never) => {
    calls.push({ command, args, options });
    const scripted = results[Math.min(calls.length - 1, results.length - 1)];
    return scripted as ReturnType<typeof spawnSync>;
  }) as unknown as typeof spawnSync;
  return { spawnStub, calls };
}

/**
 * @brief Builds a logger stub capturing diagnostics without touching stderr.
 * @details Mirrors the recorder used by `autoUpdate.unit.test.ts`.
 * @return {{ logger: AutoUpdateLogger; logs: string[]; errors: string[] }} Logger stub plus captured arrays.
 */
function createLoggerStub(): { logger: AutoUpdateLogger; logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  const logger: AutoUpdateLogger = {
    log: (...args: unknown[]) => {
      logs.push(args.map((item) => String(item)).join(" "));
    },
    error: (...args: unknown[]) => {
      errors.push(args.map((item) => String(item)).join(" "));
    },
  };
  return { logger, logs, errors };
}

/**
 * @brief Creates a temporary home directory with an enabled-CLI settings file.
 * @details Writes `{ "enabled": [...] }` at the program-owned settings path
 * under a fresh `mkdtemp` directory so no real user configuration is read.
 * @param enabled {readonly string[]} CLI names persisted in the settings file.
 * @return {string} Absolute temporary home directory path.
 */
function createFakeHome(enabled: readonly string[]): string {
  const home = mkdtempSync(join(tmpdir(), "upgrade-manager-test-"));
  const configDir = join(home, ".config", "mcp-google-api");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({ enabled }), "utf-8");
  return home;
}

/**
 * @brief Builds the activity-report payload emitted by the `install` child command.
 * @details Shape matches the human-readable stdout report consumed by the
 * post-upgrade outcome parser (REQ-166).
 * @param cli {string} CLI name reported in the single report line.
 * @return {string} Serialized child stdout payload.
 */
function buildInstallChildStdout(cli: string): string {
  return `mcp-google-api install report:\n  ${cli}: MCP server registered, 1 skill(s) installed\n`;
}

/**
 * @brief Assembles the management-command dependency surface for a test run.
 * @details Disables the registry probe via the injected environment so
 * `resolveUpdatedVersion` short-circuits to `unknown` with zero network
 * access (REQ-134 tolerance path).
 * @param spawnStub {typeof spawnSync} Recorded spawn stub under test.
 * @param logger {AutoUpdateLogger} Capturing logger stub.
 * @param stdout {NodeJS.WritableStream} Sink receiving summaries and version lines.
 * @return {ManagementCommandDeps} Fully injected dependency object.
 */
function buildDeps(
  spawnStub: typeof spawnSync,
  logger: AutoUpdateLogger,
  stdout: NodeJS.WritableStream
): ManagementCommandDeps {
  return {
    spawn: spawnStub,
    logger,
    stdout,
    idleCheck: { env: { MCP_AUTO_UPDATE_DISABLED: "1" } },
  };
}

// ---------------------------------------------------------------------------
// Level 0 — published-version reporting (REQ-162, REQ-163, REQ-134)
// ---------------------------------------------------------------------------

test("runVersionCommand_reports_published_npm_latest_when_not_newer_than_installed", async () => {
  const chunks: string[] = [];
  const fetchImpl = createRegistryFetchStub("0.26.6", "v0.26.7");
  const deps: ManagementCommandDeps = {
    stdout: createStdoutStub(chunks),
    idleCheck: { fetchImpl },
    githubCheck: { fetchImpl },
  };

  // Act: --ver over an installed version AHEAD of the published npm latest.
  const exitCode = await runVersionCommand({ currentVersion: "0.26.7" }, deps);

  // Assert: the npm line carries the registry-published latest, never the
  // installed version (REQ-162), while the GitHub line carries the latest
  // GitHub release (REQ-163) and the separators stay column-aligned (REQ-120).
  assert.equal(exitCode, 0);
  const lines = chunks.join("").trimEnd().split("\n");
  assert.equal(lines[0], "Current Installed : 0.26.7");
  assert.equal(lines[1], "Latest @ NPMjs    : 0.26.6");
  assert.equal(lines[2], "Latest @ GitHub   : 0.26.7");
});

test("runUpgradeCommand_reports_probed_npm_latest_as_updated_version_on_downgrade", async () => {
  const home = createFakeHome([]);
  try {
    const { spawnStub, calls } = createSpawnStub([{ status: 0 }]);
    const { logger } = createLoggerStub();
    const chunks: string[] = [];
    const deps: ManagementCommandDeps = {
      spawn: spawnStub,
      logger,
      stdout: createStdoutStub(chunks),
      idleCheck: { fetchImpl: createRegistryFetchStub("0.26.6", "v0.26.7") },
    };

    // Act: default-channel --upgrade from an installed version ahead of npm.
    const exitCode = await runUpgradeCommand({ currentVersion: "0.26.7", home }, deps);

    // Assert: the unconditional npm update child ran, and the summary reports
    // the probed registry latest (the version just installed by the downgrade)
    // instead of the starting version (REQ-134, REQ-146).
    assert.equal(exitCode, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual([...calls[0].args], [...PACKAGE_UPGRADE_COMMAND.slice(1)]);
    assert.ok(chunks.join("").includes("0.26.7 -> 0.26.6"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Level 0 — parseManagementCommand (pure dispatch matcher)
// ---------------------------------------------------------------------------

test("parseManagementCommand_matches_only_exact_single_token_flags", async () => {
  assert.equal(parseManagementCommand(["--upgrade"]), "--upgrade");
  assert.equal(parseManagementCommand(["--ver"]), "--ver");
  assert.equal(parseManagementCommand(["--version"]), "--version");
  assert.equal(parseManagementCommand(["--uninstall"]), "--uninstall");
});

test("parseManagementCommand_rejects_any_other_argv_shape", async () => {
  assert.equal(parseManagementCommand([]), undefined);
  assert.equal(parseManagementCommand(["start"]), undefined);
  assert.equal(parseManagementCommand(["install"]), undefined);
  assert.equal(parseManagementCommand(["--upgrade", "--stdio"]), undefined);
  assert.equal(parseManagementCommand(["--UPGRADE"]), undefined);
});

// ---------------------------------------------------------------------------
// Level 0 — --force option parsing (REQ-187: accepted only beside --upgrade)
// ---------------------------------------------------------------------------

test("parseManagementCommand_accepts_force_with_upgrade_and_channel_in_any_order", () => {
  // Act + Assert: REQ-187 — --force combines with the default and develop
  // channels in any argument order and stays a single management dispatch.
  assert.equal(parseManagementCommand(["--upgrade", "--force"]), "--upgrade");
  assert.equal(parseManagementCommand(["--force", "--upgrade"]), "--upgrade");
  assert.equal(parseManagementCommand(["--upgrade", "--develop", "--force"]), "--upgrade");
  assert.equal(parseManagementCommand(["--upgrade", "--force", "--develop"]), "--upgrade");
  assert.equal(parseManagementCommand(["--develop", "--upgrade", "--force"]), "--upgrade");
  assert.equal(parseManagementCommand(["--force", "--develop", "--upgrade"]), "--upgrade");
  assert.equal(parseManagementCommand(["--upgrade", "--dev", "--force"]), "--upgrade");
  assert.equal(parseManagementCommand(["--force", "--upgrade", "--dev"]), "--upgrade");
});

test("parseManagementCommand_rejects_force_beside_other_commands_or_duplicate_options", () => {
  // Act + Assert: --force is an --upgrade-only auxiliary option; duplicates
  // and unknown tokens keep normal yargs dispatch untouched.
  assert.equal(parseManagementCommand(["--force"]), undefined);
  assert.equal(parseManagementCommand(["--ver", "--force"]), undefined);
  assert.equal(parseManagementCommand(["--version", "--force"]), undefined);
  assert.equal(parseManagementCommand(["--uninstall", "--force"]), undefined);
  assert.equal(parseManagementCommand(["--upgrade", "--force", "--force"]), undefined);
  assert.equal(parseManagementCommand(["--upgrade", "--develop", "--dev"]), undefined);
  assert.equal(parseManagementCommand(["--upgrade", "--stdio", "--force"]), undefined);
});

test("parseUpgradeForce_detects_the_force_option_only_when_present", () => {
  // Act + Assert: REQ-187 selector is order-independent and absent-by-default.
  assert.equal(parseUpgradeForce(["--upgrade", "--force"]), true);
  assert.equal(parseUpgradeForce(["--force", "--upgrade", "--develop"]), true);
  assert.equal(parseUpgradeForce(["--upgrade"]), false);
  assert.equal(parseUpgradeForce(["--upgrade", "--develop"]), false);
  assert.equal(parseUpgradeForce([]), false);
});

// ---------------------------------------------------------------------------
// Level 1 — runUpgradeCommand (composes spawn + probe + post-upgrade install)
// ---------------------------------------------------------------------------

test("runUpgradeCommand_spawns_post_upgrade_install_via_upgraded_package_bin", async () => {
  const home = createFakeHome(["pi"]);
  try {
    const { spawnStub, calls } = createSpawnStub([
      { status: 0 },
      { status: 0, stdout: Buffer.from(buildInstallChildStdout("pi")) },
    ]);
    const { logger } = createLoggerStub();
    const chunks: string[] = [];
    const stdout = { write: (data: string | Uint8Array) => void chunks.push(String(data)) } as NodeJS.WritableStream;
    const deps = buildDeps(spawnStub, logger, stdout);
    const options: ManagementCommandOptions = { currentVersion: "0.8.0", home };

    // Act: run the full --upgrade flow with fully injected children.
    const exitCode = await runUpgradeCommand(options, deps);

    // Assert: upgrade child spawns the npm global reinstall (REQ-125).
    assert.equal(calls.length, 2);
    assert.equal(calls[0].command, PACKAGE_UPGRADE_COMMAND[0]);
    assert.deepEqual([...calls[0].args], [...PACKAGE_UPGRADE_COMMAND.slice(1)]);

    // Assert: post-upgrade install runs the UPGRADED package's own CLI
    // (`mcp-google-api install`), never an unversioned npx spec whose
    // resolution could yield a stale copy starting the MCP server (REQ-126).
    assert.equal(calls[1].command, "mcp-google-api");
    assert.deepEqual([...calls[1].args], ["install"]);

    // Assert: the install child keeps stdout captured and stderr inherited.
    const stdio = calls[1].options.stdio as string[] | undefined;
    assert.ok(Array.isArray(stdio));
    assert.equal(stdio[1], "pipe");

    // Assert: summary reports the version transition and per-CLI outcome.
    const summary = chunks.join("");
    assert.ok(summary.includes("0.8.0 -> unknown"));
    assert.ok(summary.includes("pi: OK"));
    assert.equal(exitCode, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("runUpgradeCommand_propagates_upgrade_child_failure_without_post_upgrade_spawn", async () => {
  const home = createFakeHome(["pi"]);
  try {
    const { spawnStub, calls } = createSpawnStub([{ status: 3 }]);
    const { logger } = createLoggerStub();
    const deps = buildDeps(spawnStub, logger, process.stdout);
    const options: ManagementCommandOptions = { currentVersion: "0.8.0", home };

    const exitCode = await runUpgradeCommand(options, deps);

    assert.equal(exitCode, 3);
    assert.equal(calls.length, 1, "no post-upgrade spawn after a failed upgrade child");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("runUpgradeCommand_skips_post_upgrade_spawn_when_no_cli_is_enabled", async () => {
  const home = createFakeHome([]);
  try {
    const { spawnStub, calls } = createSpawnStub([{ status: 0 }]);
    const { logger } = createLoggerStub();
    const deps = buildDeps(spawnStub, logger, process.stdout);
    const options: ManagementCommandOptions = { currentVersion: "0.8.0", home };

    const exitCode = await runUpgradeCommand(options, deps);

    assert.equal(exitCode, 0);
    assert.equal(calls.length, 1, "only the upgrade child runs when no CLI is enabled");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("runUpgradeCommand_spawn_failure_maps_to_exit_one_with_manual_hint", async () => {
  const home = createFakeHome(["pi"]);
  try {
    const throwingSpawn = (() => {
      throw new Error("spawn failed");
    }) as unknown as typeof spawnSync;
    const { logger, logs, errors } = createLoggerStub();
    const deps = buildDeps(throwingSpawn, logger, process.stdout);
    const options: ManagementCommandOptions = { currentVersion: "0.8.0", home };

    const exitCode = await runUpgradeCommand(options, deps);

    assert.equal(exitCode, 1);
    const diagnostics = [...logs, ...errors];
    assert.ok(
      diagnostics.some((text) => text.includes("mcp-google-api") && text.includes("install")),
      "manual-command hint names the upgraded package install command"
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Level 1 — runUpgradeCommand --force option (forced vs standard update child)
// ---------------------------------------------------------------------------

test("runUpgradeCommand_force_appends_the_npm_force_flag_to_the_update_child", async () => {
  const home = createFakeHome([]);
  try {
    const { spawnStub, calls } = createSpawnStub([{ status: 0 }]);
    const { logger } = createLoggerStub();
    const deps = buildDeps(spawnStub, logger, process.stdout);
    const options: ManagementCommandOptions = { currentVersion: "0.8.0", home, force: true };

    // Act: run the forced default-channel upgrade with fully injected children.
    const exitCode = await runUpgradeCommand(options, deps);

    // Assert: REQ-188 — the forced npm channel runs the update child with the
    // npm --force reinstall flag appended to the standard command; no extra
    // child is spawned for the forced path.
    assert.equal(exitCode, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, PACKAGE_UPGRADE_COMMAND[0]);
    assert.deepEqual([...calls[0].args], [...PACKAGE_UPGRADE_COMMAND.slice(1), UPGRADE_FORCE_OPTION]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("runUpgradeCommand_without_force_runs_the_standard_unforced_update_child", async () => {
  const home = createFakeHome([]);
  try {
    const { spawnStub, calls } = createSpawnStub([{ status: 0 }]);
    const { logger } = createLoggerStub();
    const deps = buildDeps(spawnStub, logger, process.stdout);
    const options: ManagementCommandOptions = { currentVersion: "0.8.0", home, force: false };

    const exitCode = await runUpgradeCommand(options, deps);

    // Assert: REQ-190 — without --force the standard unforced update child
    // runs verbatim (no force, no reinstall option) on the npm channel.
    assert.equal(exitCode, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual([...calls[0].args], [...PACKAGE_UPGRADE_COMMAND.slice(1)]);
    assert.equal(calls[0].args.includes(UPGRADE_FORCE_OPTION), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Level 1 — runUninstallCommand (sibling management spawn)
// ---------------------------------------------------------------------------

test("runUninstallCommand_spawns_npm_uninstall_and_propagates_exit_code", async () => {
  const { spawnStub, calls } = createSpawnStub([{ status: 5 }]);
  const { logger } = createLoggerStub();

  const exitCode = await runUninstallCommand({ spawn: spawnStub, logger });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, PACKAGE_UNINSTALL_COMMAND[0]);
  assert.deepEqual([...calls[0].args], [...PACKAGE_UNINSTALL_COMMAND.slice(1)]);
  assert.equal(exitCode, 5);
});

// ---------------------------------------------------------------------------
// Level 1 — runPackageManagerCommand (neutral cwd defect reproducer)
// ---------------------------------------------------------------------------

test("runPackageManagerCommand_spawns_child_with_neutral_home_cwd", () => {
  const { spawnStub, calls } = createSpawnStub([{ status: 0 }]);
  const { logger } = createLoggerStub();

  // Act: run the package-manager child with only injected dependencies.
  const exitCode = runPackageManagerCommand(["npm", "install", "-g", "spec"], {
    spawn: spawnStub,
    logger,
  });

  // Assert: REQ-125/REQ-171 — the child MUST run with an explicit neutral
  // working directory (the user home), never inheriting the caller's cwd:
  // executing the git-ref global install from inside the source checkout of
  // the SAME package corrupts npm reify (TAR_ENTRY_ERROR ENOENT flood plus
  // lifecycle "spawn sh ENOENT" against a cwd deleted mid-reify).
  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  const cwd = calls[0].options.cwd as string | undefined;
  assert.equal(typeof cwd, "string");
  assert.notEqual(cwd, process.cwd());
  assert.equal(cwd, homedir());
});

/**
 * @brief Builds the release-asset URL installed by the develop channel.
 * @details Mirrors the REQ-171/REQ-225 shape: the download URL of the probed
 * tag carrying the `mcp-google-api-<version>.tgz` asset of that tag.
 * @param tag {string} Raw release tag (`tag_name`).
 * @param version {string} Version text of the tag without its leading `v`.
 * @return {string} Absolute GitHub Release asset URL.
 */
function developAssetUrl(tag: string, version: string): string {
  return `https://github.com/Ogekuri/mcp-google-api/releases/download/${tag}/mcp-google-api-${version}.tgz`;
}

/**
 * @brief Builds a stateful in-memory npm global tree for recovery assertions.
 * @details Implements the REQ-226 filesystem surface over a path set so the
 * REQ-182 removal and the retired-directory sweep are observable without
 * touching a real npm installation.
 * @param paths {readonly string[]} Initially existing absolute paths, files or directories.
 * @return {{ globalTreeFs: GlobalPackageTreeFs; removed: string[] }} Injected surface plus the removal log in call order.
 */
function createGlobalTreeStub(paths: readonly string[]): {
  globalTreeFs: GlobalPackageTreeFs;
  removed: string[];
} {
  const existing = new Set(paths);
  const removed: string[] = [];
  const globalTreeFs: GlobalPackageTreeFs = {
    existsSync: (path) => existing.has(path),
    readdirSync: (path) => {
      const prefix = `${path}/`;
      return [...existing]
        .filter((entry) => entry.startsWith(prefix) && !entry.slice(prefix.length).includes("/"))
        .map((entry) => entry.slice(prefix.length));
    },
    rmSync: (path) => {
      for (const entry of [...existing]) {
        if (entry === path || entry.startsWith(`${path}/`)) {
          existing.delete(entry);
        }
      }
      removed.push(path);
    },
  };
  return { globalTreeFs, removed };
}

// ---------------------------------------------------------------------------
// Level 0 — buildDevelopUpgradeCommand (pure tag-install command builder)
// ---------------------------------------------------------------------------

test("buildDevelopUpgradeCommand_builds_tagged_release_asset_install_command", () => {
  // Act + Assert: REQ-171/REQ-225 — the develop channel installs the release
  // tarball asset of the probed tag, never a git-ref spec.
  const command = [...buildDevelopUpgradeCommand("v1.2.3", "1.2.3")];
  assert.deepEqual(command, ["npm", "install", "-g", developAssetUrl("v1.2.3", "1.2.3")]);
  assert.equal(command.some((token) => token.startsWith("github:")), false);
});

test("buildDevelopUpgradeCommand_appends_the_npm_force_flag_only_when_requested", () => {
  // Act + Assert: REQ-189 — forced develop-channel install carries the npm
  // --force flag; REQ-190 — the default invocation stays unforced.
  assert.deepEqual(
    [...buildDevelopUpgradeCommand("v1.2.3", "1.2.3", true)],
    ["npm", "install", "-g", developAssetUrl("v1.2.3", "1.2.3"), UPGRADE_FORCE_OPTION]
  );
  assert.equal(buildDevelopUpgradeCommand("v1.2.3", "1.2.3").includes(UPGRADE_FORCE_OPTION), false);
  assert.equal(buildDevelopUpgradeCommand("v1.2.3", "1.2.3", false).includes(UPGRADE_FORCE_OPTION), false);
});

// ---------------------------------------------------------------------------
// Level 1 — runUpgradeCommand develop channel (probe-gated tagged GitHub install)
// ---------------------------------------------------------------------------

test("runUpgradeCommand_develop_channel_spawns_latest_tagged_github_release", async () => {
  const home = createFakeHome([]);
  try {
    const requestedUrls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      requestedUrls.push(String(url));
      return { ok: true, json: async () => ({ tag_name: "v1.2.3" }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const { spawnStub, calls } = createSpawnStub([{ status: 0 }]);
    const { logger, errors } = createLoggerStub();
    const chunks: string[] = [];
    const stdout = { write: (data: string | Uint8Array) => void chunks.push(String(data)) } as NodeJS.WritableStream;
    const deps: ManagementCommandDeps = {
      ...buildDeps(spawnStub, logger, stdout),
      githubCheck: { fetchImpl },
    };
    const options: ManagementCommandOptions = { currentVersion: "0.8.0", home, channel: "develop" };

    // Act: run the full develop-channel flow with injected probe and children.
    const exitCode = await runUpgradeCommand(options, deps);

    // Assert: REQ-177 — exactly one forced probe, against the GitHub releases
    // endpoint only; no npm-registry request (REQ-172 skip semantics).
    assert.deepEqual(requestedUrls, [DEFAULT_GITHUB_RELEASES_API_URL]);

    // Assert: REQ-171/REQ-225/REQ-228 — the single spawned child installs the
    // release tarball asset of the RAW tag_name, so no git-ref spec is built.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "npm");
    assert.deepEqual([...calls[0].args], ["install", "-g", developAssetUrl("v1.2.3", "1.2.3")]);
    assert.equal(calls[0].args.some((token) => token.startsWith("github:")), false);

    // Assert: REQ-173 — the summary reports the probed GitHub release version.
    assert.ok(chunks.join("").includes("0.8.0 -> 1.2.3"));
    assert.equal(exitCode, 0);
    assert.equal(errors.length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("runUpgradeCommand_develop_channel_installs_even_when_tag_matches_installed", async () => {
  const home = createFakeHome([]);
  try {
    const fetchImpl = (async () => {
      return { ok: true, json: async () => ({ tag_name: "v0.8.0" }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const { spawnStub, calls } = createSpawnStub([{ status: 0 }]);
    const { logger } = createLoggerStub();
    const deps: ManagementCommandDeps = {
      ...buildDeps(spawnStub, logger, process.stdout),
      githubCheck: { fetchImpl },
    };
    const options: ManagementCommandOptions = { currentVersion: "0.8.0", home, channel: "develop" };

    const exitCode = await runUpgradeCommand(options, deps);

    // Assert: REQ-172 — no installed-vs-latest comparison (the channel always
    // downloads): the tagged release asset install runs even when the probed
    // tag equals the installed version (REQ-171, REQ-225).
    assert.equal(calls.length, 1);
    assert.deepEqual([...calls[0].args], ["install", "-g", developAssetUrl("v0.8.0", "0.8.0")]);
    assert.equal(exitCode, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("runUpgradeCommand_develop_channel_force_appends_the_npm_force_flag", async () => {
  const home = createFakeHome([]);
  try {
    const fetchImpl = (async () => {
      return { ok: true, json: async () => ({ tag_name: "v1.2.3" }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const { spawnStub, calls } = createSpawnStub([{ status: 0 }]);
    const { logger } = createLoggerStub();
    const deps: ManagementCommandDeps = {
      ...buildDeps(spawnStub, logger, process.stdout),
      githubCheck: { fetchImpl },
    };
    const options: ManagementCommandOptions = { currentVersion: "0.8.0", home, channel: "develop", force: true };

    const exitCode = await runUpgradeCommand(options, deps);

    // Assert: REQ-189 — the forced develop channel appends the npm --force
    // flag to the release-asset install command, preserving the REQ-171 shape.
    assert.equal(exitCode, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(
      [...calls[0].args],
      ["install", "-g", developAssetUrl("v1.2.3", "1.2.3"), UPGRADE_FORCE_OPTION]
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("runUpgradeCommand_develop_channel_fails_fast_when_github_probe_errors", async () => {
  const home = createFakeHome(["pi"]);
  try {
    const fetchImpl = (async () => {
      return { ok: false, status: 404 } as unknown as Response;
    }) as unknown as typeof fetch;
    const { spawnStub, calls } = createSpawnStub([{ status: 0 }]);
    const { logger, errors } = createLoggerStub();
    const deps: ManagementCommandDeps = {
      ...buildDeps(spawnStub, logger, process.stdout),
      githubCheck: { fetchImpl },
    };
    const options: ManagementCommandOptions = { currentVersion: "0.8.0", home, channel: "develop" };

    const exitCode = await runUpgradeCommand(options, deps);

    // Assert: REQ-178 — stderr diagnostic carries the probe message, no child
    // process is spawned, and the exit code is non-zero.
    assert.equal(exitCode, 1);
    assert.equal(calls.length, 0);
    assert.ok(
      errors.some((text) => text.includes("GitHub upgrade channel probe failed") && text.includes("HTTP 404"))
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Level 1 — ENOENT global-tree recovery (REQ-182, REQ-183, REQ-226, REQ-227, REQ-229)
// ---------------------------------------------------------------------------

test("runUpgradeCommand_enoent_recovery_removes_the_global_tree_then_retries_once", async () => {
  const home = createFakeHome([]);
  try {
    const prefix = join(tmpdir(), "npm-global-root");
    const globalNodeModules = join(prefix, "lib", "node_modules");
    const packageDir = join(globalNodeModules, "mcp-google-api");
    const retiredDir = join(globalNodeModules, ".mcp-google-api-AWNsTvJL");
    const { globalTreeFs, removed } = createGlobalTreeStub([globalNodeModules, packageDir, retiredDir]);
    const { spawnStub, calls } = createSpawnStub([
      { status: 1, stderr: "npm error spawn sh ENOENT\n" },
      { status: 0, stdout: `${prefix}\n` },
      { status: 0 },
    ]);
    const { logger, errors } = createLoggerStub();
    const deps: ManagementCommandDeps = {
      ...buildDeps(spawnStub, logger, process.stdout),
      globalTreeFs,
      platform: "linux",
    };
    const options: ManagementCommandOptions = { currentVersion: "0.8.0", home };

    const exitCode = await runUpgradeCommand(options, deps);

    // Assert: REQ-227 — the recovery resolves the npm global root with
    // `npm prefix -g` before touching the destination tree.
    assert.equal(calls.length, 3);
    assert.equal(calls[1].command, "npm");
    assert.deepEqual([...calls[1].args], ["prefix", "-g"]);

    // Assert: REQ-226 — the package directory and every retired sibling are
    // force-removed, so the retry reifies into a clean destination.
    assert.deepEqual(removed, [packageDir, retiredDir]);
    assert.equal(globalTreeFs.existsSync?.(packageDir), false);
    assert.equal(globalTreeFs.existsSync?.(retiredDir), false);

    // Assert: REQ-182 — exactly one retry of the same channel update command.
    assert.deepEqual([...calls[2].args], [...PACKAGE_UPGRADE_COMMAND.slice(1)]);
    assert.equal(exitCode, 0);
    // The failed first attempt echoes its captured stderr, but no restore child
    // is needed once the retry succeeds (REQ-183 not triggered).
    assert.equal(errors.some((text) => text.includes("restoring a working global installation")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("runUpgradeCommand_failed_retry_spawns_one_restore_child_and_propagates_retry_code", async () => {
  const home = createFakeHome([]);
  try {
    const prefix = join(tmpdir(), "npm-global-root");
    const globalNodeModules = join(prefix, "lib", "node_modules");
    const packageDir = join(globalNodeModules, "mcp-google-api");
    const { globalTreeFs } = createGlobalTreeStub([globalNodeModules, packageDir]);
    const { spawnStub, calls } = createSpawnStub([
      { status: 1, stderr: "npm error spawn sh ENOENT\n" },
      { status: 0, stdout: `${prefix}\n` },
      { status: 9, stderr: "npm error retry failed\n" },
      { status: 0 },
    ]);
    const { logger, errors } = createLoggerStub();
    const deps: ManagementCommandDeps = {
      ...buildDeps(spawnStub, logger, process.stdout),
      globalTreeFs,
      platform: "linux",
    };
    const options: ManagementCommandOptions = { currentVersion: "0.8.0", home };

    const exitCode = await runUpgradeCommand(options, deps);

    // Assert: REQ-183 — one bounded restore child reinstalls the npm package
    // so the global installation is not left destroyed.
    assert.equal(calls.length, 4);
    assert.deepEqual([...calls[3].args], [...PACKAGE_UPGRADE_COMMAND.slice(1)]);
    assert.ok(errors.some((text) => text.includes("restoring a working global installation")));

    // Assert: REQ-229 — the retry exit code propagates (no summary printed).
    assert.equal(exitCode, 9);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("purgeGlobalPackageTree_returns_false_when_the_global_root_is_unresolvable", () => {
  const { spawnStub, calls } = createSpawnStub([{ status: 1 }]);
  const { logger, errors } = createLoggerStub();
  const { globalTreeFs, removed } = createGlobalTreeStub([]);

  const purged = purgeGlobalPackageTree({ spawn: spawnStub, logger, globalTreeFs, platform: "linux" });

  // Assert: REQ-227 — an unresolvable global root never guesses a path: the
  // removal reports failure on stderr and deletes nothing.
  assert.equal(purged, false);
  assert.equal(calls.length, 1);
  assert.equal(removed.length, 0);
  assert.ok(errors.some((text) => text.includes("cannot resolve the npm global root")));
});
