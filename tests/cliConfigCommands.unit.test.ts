/**
 * @fileoverview HDT unit suite for the settings-file configuration commands.
 * @details Covers the `tools <list|*>` allowlist command (REQ-167), the
 * `host <host>` bind-address command (REQ-168), the `port <port>` command
 * (REQ-169), and the human-readable `install`/`uninstall` activity report
 * (REQ-166). Every test runs against a fresh temporary home root, so no real
 * user path, network endpoint, or registry is touched.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// cli.ts is also the executable entrypoint and detects direct execution from
// process.argv[1]. Import it with a neutral argv value so the test process
// does not start an HTTP server as a side effect.
const originalArgv1 = process.argv[1];
process.argv[1] = "cli-config-commands-unit-test";
const { runHostCommand, runInstallUninstallCommand, runPortCommand, runToolsCommand } = await import("../src/cli.js");
process.argv[1] = originalArgv1;

const { loadCliSettings, saveCliSettings } = await import("../src/utils/cliSettings.js");

/** @brief Capturing CLI stream sink shared by every command under test. */
interface CapturingStreams {
  stdout: { write(text: string): boolean };
  stderr: { write(text: string): boolean };
  out: string[];
  err: string[];
}

/**
 * @brief Creates a CLI command stream sink capturing stdout and stderr.
 * @return {CapturingStreams} Capturing streams plus accumulated buffers.
 */
function createStreams(): CapturingStreams {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: {
      write(text: string): boolean {
        out.push(text);
        return true;
      },
    },
    stderr: {
      write(text: string): boolean {
        err.push(text);
        return true;
      },
    },
    out,
    err,
  };
}

/**
 * @brief Creates an isolated temporary home root for one test.
 * @param enabled {readonly string[]} CLI names persisted in the settings file.
 * @return {string} Absolute temporary home directory path.
 */
function createFakeHome(enabled: readonly string[] = []): string {
  const home = mkdtempSync(join(tmpdir(), "mcp-google-api-config-cmd-"));
  saveCliSettings({ ...loadCliSettings(), enabled: [...enabled] }, home);
  return home;
}

/**
 * @brief Reads the persisted settings JSON from a temporary home root.
 * @param home {string} Temporary home directory path.
 * @return {Record<string, unknown>} Parsed settings payload.
 */
function readSettings(home: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(home, ".config", "mcp-google-api", "config.json"), "utf-8")) as Record<
    string,
    unknown
  >;
}

test("tools command persists a validated subset and '*' with human-readable confirmations", () => {
  const home = createFakeHome();
  try {
    const streams = createStreams();
    const exitCode = runToolsCommand("maps_geocode, maps_search_places", { home, streams });
    assert.equal(exitCode, 0);
    assert.match(streams.out.join(""), /Enabled tools set to maps_geocode,maps_search_places\./);
    assert.deepEqual(readSettings(home).enabledTools, "maps_geocode,maps_search_places");

    const starStreams = createStreams();
    assert.equal(runToolsCommand("*", { home, streams: starStreams }), 0);
    assert.match(starStreams.out.join(""), /Enabled tools set to \* \(all \d+\)\./);
    assert.deepEqual(readSettings(home).enabledTools, "*");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("tools command rejects unknown or empty values without persisting anything", () => {
  const home = createFakeHome();
  try {
    saveCliSettings({ ...loadCliSettings(), enabledTools: "maps_geocode" }, home);
    for (const invalid of [undefined, "", "   ", "nope", "maps_geocode,nope"]) {
      const streams = createStreams();
      const exitCode = runToolsCommand(invalid, { home, streams });
      assert.equal(exitCode, 1, `input ${JSON.stringify(invalid)} must exit 1`);
      assert.ok(streams.err.join("").length > 0, "a human-readable stderr error is required");
      assert.deepEqual(readSettings(home).enabledTools, "maps_geocode", "nothing may be persisted on rejection");
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("host command persists a non-empty hostname and rejects empty input", () => {
  const home = createFakeHome();
  try {
    const streams = createStreams();
    assert.equal(runHostCommand("0.0.0.0", { home, streams }), 0);
    assert.match(streams.out.join(""), /HTTP bind host set to 0\.0\.0\.0\./);
    assert.deepEqual(readSettings(home).host, "0.0.0.0");

    const rejectStreams = createStreams();
    assert.equal(runHostCommand("  ", { home, streams: rejectStreams }), 1);
    assert.ok(rejectStreams.err.join("").includes("host:"));
    assert.deepEqual(readSettings(home).host, "0.0.0.0");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("port command persists an integer 1-65535 and rejects any other value", () => {
  const home = createFakeHome();
  try {
    const streams = createStreams();
    assert.equal(runPortCommand("4242", { home, streams }), 0);
    assert.match(streams.out.join(""), /HTTP port set to 4242\./);
    assert.deepEqual(readSettings(home).port, 4242);

    for (const invalid of [undefined, "", "0", "70000", "12.5", "abc"]) {
      const rejectStreams = createStreams();
      assert.equal(runPortCommand(invalid, { home, streams: rejectStreams }), 1, `port ${JSON.stringify(invalid)} must exit 1`);
      assert.ok(rejectStreams.err.join("").includes("port:"));
    }
    assert.deepEqual(readSettings(home).port, 4242, "nothing may be persisted on rejection");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install with zero enabled CLIs prints the enable hint and exits 0", () => {
  const home = createFakeHome([]);
  try {
    const streams = createStreams();
    const exitCode = runInstallUninstallCommand("install", {
      home,
      resourcesRoot: join(tmpdir(), "missing-skills-root"),
      streams,
    });
    assert.equal(exitCode, 0);
    assert.match(streams.out.join(""), /No CLI agent enabled\. Run 'mcp-google-api enable <cli name>' first\./);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
