import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/*
 * HDT Generator-mode artifact (Level 1 spawned-entry suite):
 * - UUT: CLI entry gate in `src/cli.ts` (module-scope `isRunDirectly` /
 *   `isMainModule` evaluation deciding whether yargs command dispatch runs).
 * - Call graph: entry gate -> loadEnvironment -> yargs `.parse()` dispatch.
 * - Levels: gate comparison = Level 0 (pure); spawned dispatch = Level 1.
 * - External deps isolated: no network (network-free `snippet` command,
 *   MCP_AUTO_UPDATE_DISABLED=1), no real user paths (mkdtemp temp dir),
 *   hard kill deadline per spawn.
 * - Defect regression: argv[1] being a SYMLINK whose basename matches no
 *   hard-coded gate name (the npm global-bin / `_npx/.bin` launch shape)
 *   MUST still dispatch; the previous string-concatenated
 *   `import.meta.url === \`file://${process.argv[1]}\`` comparison is false
 *   for every symlinked launch because Node resolves `import.meta.url` to
 *   the real path, so the CLI silently exited 0 with no output (observed by
 *   MCP clients as "MCP connection closed").
 */

// cli.ts is also the executable entrypoint and detects direct execution from
// process.argv[1]. Import it with a neutral argv value so the test process
// does not start a server or print a snippet as a side effect.
const originalArgv1 = process.argv[1];
process.argv[1] = "cli-entry-gate-unit-test";
await import("../src/cli.js");
process.argv[1] = originalArgv1;

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_ENTRY = join(PROJECT_ROOT, "src", "cli.ts");

const require = createRequire(import.meta.url);
const TSX_PACKAGE = require.resolve("tsx/package.json");
const TSX_CLI = resolve(TSX_PACKAGE, "../dist/cli.mjs");

/** @brief Spawn result of one CLI invocation: captured streams plus exit code. */
interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * @brief Spawns the CLI entry via the tsx runtime and collects its exit state.
 * @details Runs `node <tsx-cli> <entryPath> snippet` with the update check
 * disabled in the child environment (zero registry network calls), resolves
 * when the child exits, and never rejects. Bounded by a hard kill deadline
 * for determinism.
 * @param entryPath {string} Script path handed to tsx as the entry; MAY be a
 *   symlink to exercise the bin-shape launch (argv[1] keeps this path).
 * @param timeoutMs {number} Hard kill deadline in milliseconds (default 30000).
 * @return {Promise<SpawnResult>} Exit code (null on kill) plus stdout/stderr.
 */
function spawnCliEntry(entryPath: string, timeoutMs = 30000): Promise<SpawnResult> {
  return new Promise((resolveSpawn) => {
    const child = spawn(process.execPath, [TSX_CLI, entryPath, "snippet"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, MCP_AUTO_UPDATE_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      resolveSpawn({ code, stdout, stderr });
    });
    child.on("error", () => {
      settled = true;
      clearTimeout(timer);
      resolveSpawn({ code: null, stdout, stderr });
    });
  });
}

/**
 * @brief Asserts one spawned CLI invocation dispatched the `snippet` command.
 * @details Behavioral contract (REQ-092): dispatch MUST print a JSON object
 * containing the `mcpServers` map on stdout with exit code 0. The silent
 * no-op defect manifests as exit code 0 with EMPTY stdout, which fails the
 * JSON-parse assertion.
 * @param result {SpawnResult} Captured spawn outcome.
 * @return {void}
 */
function assertSnippetDispatched(result: SpawnResult): void {
  assert.equal(result.code, 0, `expected exit code 0, got ${result.code}; stderr: ${result.stderr.slice(0, 400)}`);
  let parsed: unknown;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(result.stdout);
  }, `CLI produced no dispatchable stdout (silently skipped entry gate); stdout: ${JSON.stringify(result.stdout.slice(0, 200))}`);
  assert.ok(
    typeof parsed === "object" && parsed !== null && "mcpServers" in parsed,
    "snippet stdout JSON must contain the mcpServers map"
  );
}

test("symlinked argv[1] with non-matching basename dispatches CLI commands", async () => {
  // Arrange: symlink whose basename matches none of the hard-coded gate
  // names (cli.ts / cli.js / mcp-google-api), mirroring an npm `.bin`
  // or global-bin symlink launch after a distribution rename.
  const tempDir = mkdtempSync(join(tmpdir(), "cli-entry-gate-"));
  const aliasEntry = join(tempDir, "clibin-alias");
  try {
    symlinkSync(CLI_ENTRY, aliasEntry);

    // Act.
    const result = await spawnCliEntry(aliasEntry);

    // Assert: the entry gate MUST recognize the symlinked launch and run
    // the yargs dispatch (regression for the silent exit-0 no-op defect).
    assertSnippetDispatched(result);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("direct argv[1] path still dispatches CLI commands", async () => {
  // Arrange: canonical direct entry path (control case for the gate).
  // Act.
  const result = await spawnCliEntry(CLI_ENTRY);
  // Assert.
  assertSnippetDispatched(result);
});
