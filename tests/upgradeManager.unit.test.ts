/**
 * @fileoverview HDT unit suite for the management-command upgrade flow.
 * @details Regression coverage for the `--upgrade` defect where the
 * post-upgrade child resolved an unversioned `npx` spec instead of the
 * upgraded package's own CLI: a stale npx-cache copy of the package could
 * start the MCP HTTP server instead of running the `install` command,
 * blocking the parent forever (REQ-126). Verifies REQ-125 (upgrade child
 * spawn + exit propagation), REQ-126 (post-upgrade `install` child via the
 * upgraded package bin, captured stdout), REQ-127 (uninstall child), REQ-128
 * (spawn-failure hint), REQ-132/REQ-135 (summary fallback), and the
 * management-command exact-match dispatch (PRJ-003). All child processes,
 * filesystem reads, network probes, and output streams are injected, so the
 * suite is deterministic and side-effect free.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  PACKAGE_UPGRADE_COMMAND,
  PACKAGE_UNINSTALL_COMMAND,
  parseManagementCommand,
  runUpgradeCommand,
  runUninstallCommand,
  type ManagementCommandDeps,
  type ManagementCommandOptions,
} from "../src/utils/upgradeManager.js";
import type { AutoUpdateLogger } from "../src/utils/autoUpdate.js";

/** Recorded record of one spawned child process. */
interface RecordedSpawn {
  /** Spawned executable (first element of the command tuple). */
  command: string;
  /** Spawned arguments (remaining elements of the command tuple). */
  args: readonly string[];
  /** Spawn options; `stdio` distinguishes inherited vs captured streams. */
  options: { stdio?: unknown; shell?: boolean };
}

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
  const configDir = join(home, ".config", "mcp-google-map");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({ enabled }), "utf-8");
  return home;
}

/**
 * @brief Builds the JSON summary payload emitted by the `install` child command.
 * @details Shape matches the `{ success, operation, summaries[], errors[] }`
 * stdout contract consumed by the post-upgrade outcome parser.
 * @param cli {string} CLI name reported in the single summary entry.
 * @return {string} Serialized child stdout payload.
 */
function buildInstallChildStdout(cli: string): string {
  return JSON.stringify({
    success: true,
    operation: "install",
    summaries: [{ cli, server: 1, skills: 1 }],
    errors: [],
  });
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
    // (`mcp-google-map install`), never an unversioned npx spec whose
    // resolution could yield a stale copy starting the MCP server (REQ-126).
    assert.equal(calls[1].command, "mcp-google-map");
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
      diagnostics.some((text) => text.includes("mcp-google-map") && text.includes("install")),
      "manual-command hint names the upgraded package install command"
    );
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
