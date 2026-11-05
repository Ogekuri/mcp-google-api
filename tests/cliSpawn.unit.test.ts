import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// cli.ts is also the executable entrypoint and detects direct execution from
// process.argv[1]. Import it with a neutral argv value so the test process
// does not start an HTTP server as a side effect.
const originalArgv1 = process.argv[1];
process.argv[1] = "cli-spawn-unit-test";
const { extractEnvFileOption } = await import("../src/cli.js");
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
 * child), resolves when the child exits, and never rejects. Bounded by the
 * caller-visible timeout parameter for determinism.
 * @param args {string[]} CLI arguments appended after `src/cli.ts`.
 * @param timeoutMs {number} Hard kill deadline in milliseconds (default 30000).
 * @return {Promise<SpawnResult>} Exit code (null on kill) plus stdout/stderr.
 */
function spawnCli(args: string[], timeoutMs = 30000): Promise<SpawnResult> {
  return new Promise((resolveSpawn) => {
    const child = spawn(process.execPath, [TSX_CLI, CLI_ENTRY, ...args], {
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

test("extractEnvFileOption recognizes both argv forms and absence", () => {
  assert.deepEqual(extractEnvFileOption(["doctor"]), undefined);
  assert.deepEqual(extractEnvFileOption(["--env-file", "/a/b.env", "doctor"]), "/a/b.env");
  assert.deepEqual(extractEnvFileOption(["doctor", "--env-file=/c/d.env"]), "/c/d.env");
  assert.deepEqual(extractEnvFileOption(["--env-file"]), undefined);
});

test("missing --env-file fails the CLI process without stdout output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mgm-spawn-"));
  const missingPath = join(dir, "definitely-missing.env");
  try {
    const result = await spawnCli(["--env-file", missingPath, "doctor"]);

    assert.notEqual(result.code, null, "process must exit on its own, not be killed by the test timeout");
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.includes(missingPath), true);
    // Node >= 24 intercepts the missing --env-file value itself (exit 9)
    // before the CLI's explicit-env-file handler can run (CTN-005).
    assert.equal(result.code, 9);
    assert.match(result.stderr, /not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("existing --env-file=<path> loads before the doctor command runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mgm-spawn-"));
  const envPath = join(dir, "existing.env");
  writeFileSync(envPath, "GOOGLE_MAPS_API_KEY=AIzaSySpawnProbeKey123456789\n", "utf-8");
  try {
    const result = await spawnCli(["--env-file=" + envPath, "doctor"]);

    assert.equal(result.code, 0);
    const report = JSON.parse(result.stdout) as {
      success: boolean;
      checks: Array<{ name: string; status: string; detail: string }>;
    };
    assert.equal(report.success, true);
    assert.equal(report.checks.find((check) => check.name === "api-key")?.status, "pass");
    assert.equal(
      report.checks.find((check) => check.name === "env-file")?.detail.includes(`Explicit environment file loaded: ${envPath}`),
      true
    );
    // No secret in the report (masked only).
    assert.equal(result.stdout.includes("AIzaSySpawnProbeKey123456789"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("existing --env-file <path> (space form) reaches the command identically", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mgm-spawn-"));
  const envPath = join(dir, "existing.env");
  writeFileSync(envPath, "GOOGLE_MAPS_API_KEY=AIzaSySpawnProbeKey123456789\n", "utf-8");
  try {
    const result = await spawnCli(["--env-file", envPath, "doctor"]);

    assert.equal(result.code, 0);
    const report = JSON.parse(result.stdout) as { success: boolean };
    assert.equal(report.success, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no command prints the help text and exits 0 without starting a server", async () => {
  // Arrange: bare invocation (no subcommand) with the update check disabled.
  // Act:
  const result = await spawnCli([]);
  // Assert: REQ-129 (help instead of a server start, exit 0), REQ-130 (version
  // adjacent to the first mcp-google-map line), REQ-131 (management commands
  // documented in the help text).
  assert.equal(result.code, 0, `bare invocation must exit 0; stderr:\n${result.stderr}`);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /mcp-google-map v\d+\.\d+\.\d+/);
  assert.equal(result.stdout.includes("Usage: mcp-google-map <command>"), true);
  assert.equal(result.stdout.includes("--upgrade"), true);
  assert.equal(result.stdout.includes("--uninstall"), true);
  assert.equal(result.stdout.includes("--ver"), true);
  assert.equal(result.stdout.includes("--version"), true);
  // REQ-129: nothing was started (no server banner on any stream).
  assert.equal(result.stdout.includes("Google Maps MCP Server"), false);
  assert.equal(result.stderr.includes("Google Maps MCP Server"), false);
});

test("HTTP server applies --env-file before startup and stops orderly on SIGTERM", async (t) => {
  const port = await findFreePort();
  assert.ok(port > 0);
  const dir = mkdtempSync(join(tmpdir(), "mgm-spawn-"));
  const envPath = join(dir, "server.env");
  writeFileSync(
    envPath,
    `GOOGLE_MAPS_API_KEY=AIzaSySpawnProbeKey123456789\nMCP_SERVER_PORT=${port}\nMCP_AUTO_UPDATE_DISABLED=1\n`,
    "utf-8"
  );

  const child = spawn(process.execPath, [TSX_CLI, CLI_ENTRY, "start", "--env-file=" + envPath], {
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
    // REQ-079: port from the explicit env file was applied before startup.
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
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "start-mcp.sh fails with build remediation when the dist artifact is missing",
  { skip: process.platform === "win32" ? "bash launcher not guaranteed on win32" : false },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "mgm-spawn-"));
    const scriptCopy = join(dir, "start-mcp.sh");
    copyFileSync(join(PROJECT_ROOT, "scripts", "start-mcp.sh"), scriptCopy);
    try {
      const result = await new Promise<SpawnResult>((resolveSpawn) => {
        const child = spawn("bash", [scriptCopy], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf-8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf-8");
        });
        child.once("close", (code) => resolveSpawn({ code, stdout, stderr }));
        child.once("error", () => resolveSpawn({ code: null, stdout, stderr }));
      });

      assert.notEqual(result.code, 0);
      const combined = result.stdout + result.stderr;
      assert.equal(combined.includes("dist/cli.js missing"), true);
      assert.equal(combined.includes("npm run build"), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);
