/**
 * @fileoverview HDT unit suite for the absolute MCP launcher binding.
 * @details Covers global launcher resolution (REQ-114, REQ-234), entrypoint
 * classification of source checkouts and npm `_npx` caches (REQ-235), refusal
 * without any configuration write (REQ-236), legacy `npx` entry migration
 * (REQ-232, REQ-233), the `show` Launcher column and STALE status (REQ-118,
 * REQ-237), and the TOML binding reader. Every test runs against temporary
 * roots with injected child-process and filesystem seams, so no real npm
 * installation, user path, or network endpoint is touched.
 * @satisfies TST-036, TST-037
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { spawnSync, SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  GLOBAL_INSTALL_REMEDIATION,
  compareServerRegistration,
  describeEntrypointBinding,
  formatServerRegistration,
  resolveInstalledLauncher,
} from "../src/utils/installedLauncher.js";
import { installEnabledCliResources, loadSkillsManifest } from "../src/utils/cliInstaller.js";
import {
  CLI_TARGETS,
  applyServerRegistration,
  readServerRegistration,
} from "../src/utils/cliTargets.js";
import { buildCliShowReport } from "../src/utils/cliShow.js";
import { saveCliSettings } from "../src/utils/cliSettings.js";
import type { McpServerRegistration } from "../src/utils/cliTargets.js";

/** @brief Global prefix returned by the injected `npm prefix -g` stub. */
const GLOBAL_PREFIX = "/opt/npm-global";

/** @brief Global launcher path derived from the injected prefix on POSIX. */
const GLOBAL_LAUNCHER = join(
  GLOBAL_PREFIX,
  "lib",
  "node_modules",
  "mcp-google-api",
  "bin",
  "mcp-google-api.mjs"
);

/** @brief Injected Node.js executable used as the registration command. */
const NODE_EXECUTABLE = "/opt/node/bin/node";

/**
 * @brief Build a `spawnSync` stub reporting one npm global prefix.
 * @param prefix {string | undefined} Prefix to report; undefined fails the child.
 * @return {typeof spawnSync} Stub compatible with the injected dependency surface.
 * @note Deterministic; no child process is spawned.
 */
function createPrefixSpawnStub(prefix: string | undefined): typeof spawnSync {
  const stub = (): SpawnSyncReturns<string> => ({
    pid: 4242,
    output: ["", prefix ?? "", ""],
    stdout: prefix === undefined ? "" : `${prefix}\n`,
    stderr: "",
    status: prefix === undefined ? 1 : 0,
    signal: null,
  });
  return stub as unknown as typeof spawnSync;
}

/**
 * @brief Build an isolated home plus packaged skills root.
 * @details Writes one manifest skill and enables the `pi` CLI, then returns the
 * fixture roots. The MCP configuration is written by each test through
 * `applyServerRegistration`, so legacy and absolute bindings stay explicit.
 * @param enabled {string[]} Enabled CLI names persisted in the temporary settings.
 * @return {{ root: string; resourcesRoot: string; home: string; mcpConfigPath: string }} Fixture paths.
 */
function createFixture(enabled: string[] = ["pi"]): {
  root: string;
  resourcesRoot: string;
  home: string;
  mcpConfigPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), "mcp-google-api-binding-"));
  const resourcesRoot = join(root, "skills");
  const skillDir = join(resourcesRoot, "demo-skill");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo-skill\ndescription: demo\n---\n");
  writeFileSync(
    join(resourcesRoot, "manifest.json"),
    JSON.stringify(
      { version: 1, skills: [{ id: "demo-skill", name: "demo-skill", version: "1.0.0", language: "en", path: "demo-skill/SKILL.md", description: "demo" }] },
      null,
      2
    ) + "\n"
  );
  const home = join(root, "home");
  saveCliSettings({ enabled, apiKey: "", autoUpdate: true }, home);
  const configPath = CLI_TARGETS.pi.mcpConfigPath(home);
  mkdirSync(dirname(configPath), { recursive: true });
  return { root, resourcesRoot, home, mcpConfigPath: configPath };
}

/**
 * @brief Read the managed JSON registration entry of the fixture.
 * @param configPath {string} MCP configuration file path.
 * @return {McpServerRegistration | undefined} Stored entry.
 */
function readPiEntry(configPath: string): McpServerRegistration | undefined {
  const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as {
    mcpServers?: Record<string, McpServerRegistration>;
  };
  return parsed.mcpServers?.["mcp-google-api"];
}

test("test_resolve_installed_launcher_binds_absolute_node_and_global_launcher", () => {
  const result = resolveInstalledLauncher({
    spawn: createPrefixSpawnStub(GLOBAL_PREFIX),
    existsSync: () => true,
    execPath: NODE_EXECUTABLE,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.launcher : undefined, {
    command: NODE_EXECUTABLE,
    args: [GLOBAL_LAUNCHER, "start", "--stdio"],
  });
  assert.equal(result.ok ? result.launcherPath : undefined, GLOBAL_LAUNCHER);
});

test("test_resolve_installed_launcher_reports_remediation_when_global_root_unresolved", () => {
  const result = resolveInstalledLauncher({
    spawn: createPrefixSpawnStub(undefined),
    existsSync: () => true,
    execPath: NODE_EXECUTABLE,
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, new RegExp(GLOBAL_INSTALL_REMEDIATION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("test_resolve_installed_launcher_reports_missing_global_launcher", () => {
  const result = resolveInstalledLauncher({
    spawn: createPrefixSpawnStub(GLOBAL_PREFIX),
    existsSync: () => false,
    execPath: NODE_EXECUTABLE,
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /Global launcher not found/);
});

test("test_entrypoint_binding_rejects_source_checkout_and_npx_cache", () => {
  const identity = { realpathSync: (path: string): string => path };

  const checkoutError = describeEntrypointBinding("/home/user/repo/mcp-google-api", "/opt/npm-global/lib/node_modules/mcp-google-api", identity);
  assert.match(checkoutError ?? "", /npm install -g mcp-google-api@latest/);
  assert.match(checkoutError ?? "", /source checkout or an npm _npx cache copy/);

  const npxError = describeEntrypointBinding("/home/user/.npm/_npx/abc123/node_modules/mcp-google-api", "/opt/npm-global/lib/node_modules/mcp-google-api", identity);
  assert.match(npxError ?? "", /_npx/);

  const bound = describeEntrypointBinding("/opt/npm-global/lib/node_modules/mcp-google-api", "/opt/npm-global/lib/node_modules/mcp-google-api", identity);
  assert.equal(bound, undefined);
});

test("test_install_writes_absolute_launcher_and_replaces_legacy_npx_entry", (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const legacy: McpServerRegistration = { command: "npx", args: ["-y", "mcp-google-api", "start", "--stdio"] };
  applyServerRegistration(CLI_TARGETS.pi, "mcp-google-api", legacy, fixture.home);

  const launcher: McpServerRegistration = { command: NODE_EXECUTABLE, args: [GLOBAL_LAUNCHER, "start", "--stdio"] };
  const result = installEnabledCliResources({ home: fixture.home, resourcesRoot: fixture.resourcesRoot, launcher });

  assert.deepEqual(result.errors, []);
  assert.equal(result.summaries.length, 1);
  const entry = readPiEntry(fixture.mcpConfigPath);
  assert.ok(entry !== undefined, "registered entry must exist");
  assert.equal(entry.command, NODE_EXECUTABLE);
  assert.deepEqual(entry.args, [GLOBAL_LAUNCHER, "start", "--stdio"]);
  assert.equal(JSON.stringify(entry).includes("npx"), false);
  assert.equal(loadSkillsManifest(fixture.resourcesRoot).length, 1);
});

test("test_install_persists_no_registration_when_launcher_unresolved", (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  assert.throws(
    () =>
      installEnabledCliResources({
        home: fixture.home,
        resourcesRoot: fixture.resourcesRoot,
        launcherResolutionDeps: { spawn: createPrefixSpawnStub(undefined), existsSync: () => true },
      }),
    /npm install -g mcp-google-api@latest/
  );
  assert.equal(existsSync(fixture.mcpConfigPath), false);
});

test("test_show_marks_legacy_binding_stale_and_reports_resolved_launcher", (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const launcher: McpServerRegistration = { command: NODE_EXECUTABLE, args: [GLOBAL_LAUNCHER, "start", "--stdio"] };

  applyServerRegistration(CLI_TARGETS.pi, "mcp-google-api", { command: "npx", args: ["-y", "mcp-google-api", "start", "--stdio"] }, fixture.home);
  const staleReport = buildCliShowReport({ home: fixture.home, resourcesRoot: fixture.resourcesRoot, launcher });
  assert.match(staleReport, /Launcher/);
  assert.match(staleReport, /STALE/);
  assert.match(staleReport, /npx -y mcp-google-api start --stdio/);

  applyServerRegistration(CLI_TARGETS.pi, "mcp-google-api", launcher, fixture.home);
  const boundReport = buildCliShowReport({ home: fixture.home, resourcesRoot: fixture.resourcesRoot, launcher });
  assert.match(boundReport, /OK/);
  assert.equal(boundReport.includes("STALE"), false);
  assert.match(boundReport, /bin\/mcp-google-api\.mjs/);
  assert.match(boundReport, /start --stdio/);
});

test("test_compare_registration_and_format_entry", () => {
  const expected: McpServerRegistration = { command: NODE_EXECUTABLE, args: [GLOBAL_LAUNCHER, "start", "--stdio"] };

  assert.equal(compareServerRegistration(undefined, expected), "MISSING");
  assert.equal(compareServerRegistration(expected, undefined), "OK");
  assert.equal(compareServerRegistration(expected, expected), "OK");
  assert.equal(compareServerRegistration({ command: NODE_EXECUTABLE, args: [GLOBAL_LAUNCHER] }, expected), "STALE");
  assert.equal(formatServerRegistration(expected), `${NODE_EXECUTABLE} ${GLOBAL_LAUNCHER} start --stdio`);
  assert.equal(formatServerRegistration(undefined), "");
});

test("test_read_server_registration_reads_codex_toml_binding", (t) => {
  const fixture = createFixture(["codex"]);
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const launcher: McpServerRegistration = { command: NODE_EXECUTABLE, args: [GLOBAL_LAUNCHER, "start", "--stdio"] };

  applyServerRegistration(CLI_TARGETS.codex, "mcp-google-api", launcher, fixture.home);
  const stored = readServerRegistration(CLI_TARGETS.codex, "mcp-google-api", fixture.home);

  assert.deepEqual(stored, launcher);
});
