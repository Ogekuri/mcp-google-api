import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// cli.ts is also the executable entrypoint and detects direct execution from
// process.argv[1]. Import it with a neutral argv value so the test process
// does not start an HTTP server as a side effect.
const originalArgv1 = process.argv[1];
process.argv[1] = "cli-spawn-unit-test";
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
 * @brief Spawns the CLI via the tsx runtime and collects its exit state.
 * @details Runs `node <tsx-cli> src/cli.ts <args>` with a scrubbed environment
 * (MCP_AUTO_UPDATE_DISABLED=1 guarantees zero registry network calls in the
 * child), optionally relocating the child HOME to an isolated directory so the
 * spawned CLI reads settings from a provisioned fixture instead of the host
 * machine's real `~/.config/mcp-google-api/config.json` — hermeticity that makes
 * local runs reproduce the clean CI runner state exactly. Resolves when the
 * child exits, and never rejects. Bounded by the caller-visible timeout
 * parameter for determinism.
 * @param args {string[]} CLI arguments appended after `src/cli.ts`.
 * @param timeoutMs {number} Hard kill deadline in milliseconds (default 30000).
 * @param options {object} `{ home? }` — child HOME override isolating settings reads.
 * @return {Promise<SpawnResult>} Exit code (null on kill) plus stdout/stderr.
 */
function spawnCli(args: string[], timeoutMs = 30000, options: { home?: string } = {}): Promise<SpawnResult> {
  return new Promise((resolveSpawn) => {
    const env = { ...process.env, MCP_AUTO_UPDATE_DISABLED: "1" };
    if (options.home !== undefined) {
      env.HOME = options.home;
    }
    const child = spawn(process.execPath, [TSX_CLI, CLI_ENTRY, ...args], {
      cwd: PROJECT_ROOT,
      env,
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
 * @brief Resolves a currently free TCP port on the loopback interface.
 * @details Binds a `net.Server` to port 0, reads the assigned ephemeral port,
 * and closes the listener. Standard free-port probe with a minimal race
 * window; used only for the spawned HTTP server test.
 * @return {Promise<number>} A port that was free at probe time.
 */
function findFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once("error", rejectPort);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

/**
 * @brief Polls an accumulated stderr buffer until a marker appears.
 * @details Used to await readiness lines ("started successfully") from the
 * spawned HTTP server before signaling; bounded by a hard deadline.
 * @param readStderr {() => string} accessor over the growing stderr buffer.
 * @param marker {string} substring to wait for.
 * @param timeoutMs {number} deadline in milliseconds (default 20000).
 * @return {Promise<boolean>} True when the marker appeared before the deadline.
 */
async function waitForMarker(readStderr: () => string, marker: string, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readStderr().includes(marker)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return readStderr().includes(marker);
}

/**
 * @brief Provisions one isolated home directory with the DES-018 settings fixture.
 * @details Creates a unique temp directory containing
 * `.config/mcp-google-api/config.json` with a valid-format test API key and the
 * default HTTP endpoint fields, so a spawned CLI child reading this home observes
 * a complete settings file regardless of the host machine state (hermeticity,
 * CTN-002: the key travels only through the settings file, never the
 * environment). Complexity O(file size); the caller MUST remove the directory.
 * @return {string} Isolated home directory path.
 */
function provisionIsolatedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "cli-spawn-home-"));
  const settingsDir = join(home, ".config", "mcp-google-api");
  mkdirSync(settingsDir, { recursive: true });
  const settings = {
    enabled: [],
    apiKey: "doctor-spawn-key-0123456789abcdef",
    autoUpdate: false,
    enabledTools: "*",
    host: "127.0.0.1",
    port: 3000,
  };
  writeFileSync(join(settingsDir, "config.json"), JSON.stringify(settings, null, 2), "utf8");
  return home;
}

/**
 * @brief Pins the REQ-070 hermetic success contract: doctor exits 0 on provisioned settings.
 * @details Regression guard for the CI discrepancy fixed here: the previous fixture
 * inherited the host HOME, so the assertion passed only on machines holding a real
 * `~/.config/mcp-google-api/config.json` with an API key and failed on every clean
 * runner (exit 1, api-key check fail). The child now reads an isolated, provisioned
 * home, making local and CI execution identical. Level 1 (spawned child isolated in
 * a temp home; MCP_AUTO_UPDATE_DISABLED=1 keeps it network-free).
 * @satisfies REQ-070, REQ-089, TST-017, CTN-002
 */
test("doctor exits 0 with a settings-derived report and no environment dependence", async () => {
  // Arrange: isolated home with the complete DES-018 settings fixture.
  const home = provisionIsolatedHome();
  try {
    // Act
    const result = await spawnCli(["doctor"], 30000, { home });
    // Assert
    const expected_output = { exitCode: 0, success: true };
    assert.notEqual(result.code, null, "process must exit on its own, not be killed by the test timeout");
    assert.equal(result.code, expected_output.exitCode, `doctor must exit 0 with provisioned settings; stderr:\n${result.stderr}`);
    const report = JSON.parse(result.stdout) as {
      success: boolean;
      checks: Array<{ name: string; status: string; detail: string }>;
    };
    assert.equal(report.success, expected_output.success);
    assert.equal(report.checks.find((check) => check.name === "node")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "api-key")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "env-file"), undefined);
    assert.match(
      report.checks.find((check) => check.name === "config")?.detail ?? "",
      /host=127\.0\.0\.1 \(settings\)/
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/**
 * @brief Pins the REQ-070 clean-environment contract: doctor exits 1 without any key.
 * @details Reproduces the exact CI runner state that surfaced the hermeticity defect:
 * an isolated home with NO settings file. Doctor MUST fail the api-key presence check
 * and exit non-zero (REQ-070: exit 0 only when no check fails), printing the JSON
 * report on stdout with empty stderr. Without this pin, a machine holding a real
 * configured settings file masks the clean-environment path and the discrepancy only
 * surfaces at release-gate time.
 * @satisfies REQ-070, TST-002
 */
test("doctor exits 1 on a clean isolated home without a configured API key", async () => {
  // Arrange: isolated home with no settings file (the clean CI runner state).
  const home = mkdtempSync(join(tmpdir(), "cli-spawn-clean-home-"));
  try {
    // Act
    const result = await spawnCli(["doctor"], 30000, { home });
    // Assert
    const expected_output = { exitCode: 1, success: false, apiKeyStatus: "fail" };
    assert.notEqual(result.code, null, "process must exit on its own, not be killed by the test timeout");
    assert.equal(result.code, expected_output.exitCode, `doctor must exit 1 without an API key; stderr:\n${result.stderr}`);
    const report = JSON.parse(result.stdout) as {
      success: boolean;
      checks: Array<{ name: string; status: string; detail: string }>;
    };
    assert.equal(report.success, expected_output.success);
    assert.equal(report.checks.find((check) => check.name === "api-key")?.status, expected_output.apiKeyStatus);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("no command prints the help text and exits 0 without starting a server", async () => {
  // Arrange: bare invocation (no subcommand) with the update check disabled.
  // Act:
  const result = await spawnCli([]);
  // Assert: REQ-129 (help instead of a server start, exit 0), REQ-130 (version
  // adjacent to the first mcp-google-api line), REQ-131 (management commands
  // documented in the help text).
  assert.equal(result.code, 0, `bare invocation must exit 0; stderr:\n${result.stderr}`);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /mcp-google-api v\d+\.\d+\.\d+/);
  assert.equal(result.stdout.includes("Usage: mcp-google-api <command>"), true);
  assert.equal(result.stdout.includes("--upgrade"), true);
  assert.equal(result.stdout.includes("--uninstall"), true);
  assert.equal(result.stdout.includes("--ver"), true);
  assert.equal(result.stdout.includes("--version"), true);
  // REQ-129: nothing was started (no server banner on any stream).
  assert.equal(result.stdout.includes("MCP Google API server"), false);
  assert.equal(result.stderr.includes("MCP Google API server"), false);
});

test("HTTP server starts from the --port flag with the MCP Google API server banner and stops orderly on SIGTERM", async (t) => {
  const port = await findFreePort();
  assert.ok(port > 0);

  const child = spawn(process.execPath, [TSX_CLI, CLI_ENTRY, "start", "--port", String(port)], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, MCP_AUTO_UPDATE_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf-8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf-8");
  });

  const exitPromise = new Promise<number | null>((resolveExit) => {
    child.once("close", (code) => resolveExit(code));
  });

  try {
    const ready = await waitForMarker(() => stderr, "MCP Server started successfully!");
    assert.equal(ready, true, `server never became ready; stderr:\n${stderr}`);
    // REQ-165: startup diagnostics identify the application as
    // "MCP Google API server".
    assert.equal(stderr.includes("MCP Google API server"), true);
    // REQ-079: the --port flag was applied before startup.
    assert.equal(stderr.includes(`http://127.0.0.1:${port}/mcp`), true);
    // CTN-003/PRJ-008: stdout stays empty (protocol/diagnostics separation).
    assert.equal(stdout, "");

    if (process.platform === "win32") {
      child.kill();
      await exitPromise;
      t.diagnostic("SIGTERM orderly-shutdown assertions skipped on win32");
    } else {
      child.kill("SIGTERM");
      const code = await exitPromise;
      assert.equal(code, 0, `graceful shutdown must exit 0; stderr:\n${stderr}`);
      assert.equal(stderr.includes("Received SIGTERM"), true);
      assert.equal(stderr.includes("HTTP server stopped."), true);
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
});
