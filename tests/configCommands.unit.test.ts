/**
 * @fileoverview HDT unit suite for the configuration interface commands.
 * @details Verifies `--print`, `--info`, `--print-raw`, `--get`, `--set`, and
 * `--unset` semantics against isolated temporary home roots: schema bootstrap,
 * typed parsing, bounds, resets, canonical path resolution, stdout/stderr
 * separation, exit codes, byte-preserving raw output, atomic-write failure
 * survival, and the no-mutation guarantee on every rejection (TST-028).
 * Deterministic by construction: temporary directories, no network, no real
 * user path.
 * @satisfies REQ-193, REQ-194, REQ-195, REQ-196, REQ-197, REQ-198, REQ-199,
 * REQ-200, REQ-201, REQ-202, REQ-203, REQ-204, REQ-205, REQ-206, REQ-207,
 * REQ-208, REQ-213, REQ-214, REQ-215, REQ-216, REQ-217, REQ-218, REQ-219,
 * REQ-220, REQ-221, REQ-222, TST-028
 */

import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONFIG_CLI_USAGE,
  parseConfigCommand,
  runConfigCommandInvocation,
  runConfigGetCommand,
  runConfigPrintCommand,
  runConfigPrintRawCommand,
  runConfigSetCommand,
  runConfigUnsetCommand,
  type ConfigCommandStreams,
} from "../src/utils/configCli.js";

/**
 * @brief Capturing CLI stream sink shared by every command under test.
 * @details Captures text and raw byte writes so `--print-raw` can be compared
 * byte for byte (REQ-202).
 */
interface CapturingStreams extends ConfigCommandStreams {
  out: string[];
  err: string[];
  bytes: Uint8Array[];
}

/**
 * @brief Creates a capturing stream sink.
 * @return {CapturingStreams} Streams plus accumulated buffers.
 */
function createStreams(): CapturingStreams {
  const out: string[] = [];
  const err: string[] = [];
  const bytes: Uint8Array[] = [];
  return {
    stdout: {
      write(chunk: string | Uint8Array): boolean {
        if (typeof chunk === "string") {
          out.push(chunk);
        } else {
          bytes.push(chunk);
          out.push(Buffer.from(chunk).toString("utf-8"));
        }
        return true;
      },
    },
    stderr: {
      write(chunk: string | Uint8Array): boolean {
        err.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
        return true;
      },
    },
    out,
    err,
    bytes,
  };
}

/**
 * @brief Creates an isolated temporary home root.
 * @return {string} Absolute temporary home directory path.
 */
function createHome(): string {
  return mkdtempSync(join(tmpdir(), "mcp-google-api-config-cli-"));
}

/**
 * @brief Resolves the settings file path inside a temporary home root.
 * @param home {string} Temporary home directory path.
 * @return {string} Settings file path.
 */
function settingsPath(home: string): string {
  return join(home, ".config", "mcp-google-api", "config.json");
}

/**
 * @brief Reads the persisted settings JSON of a temporary home root.
 * @param home {string} Temporary home directory path.
 * @return {Record<string, unknown>} Parsed settings payload.
 */
function readSettings(home: string): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath(home), "utf-8")) as Record<string, unknown>;
}

test("test_config_print_bootstraps_schema_defaults_without_overwriting_an_existing_file", () => {
  const home = createHome();
  try {
    const streams = createStreams();
    assert.equal(runConfigPrintCommand({ home, streams, info: false }), 0);
    assert.match(streams.out.join(""), /^Application_Configuration - Current configuration\n/);
    assert.ok(existsSync(settingsPath(home)), "the settings file must be created from schema defaults");
    assert.deepEqual(readSettings(home), {
      enabled: [],
      apiKey: "",
      autoUpdate: true,
      enabledTools: "*",
      host: "127.0.0.1",
      port: 3000,
    });

    writeFileSync(settingsPath(home), '{"port":4242}', "utf-8");
    const second = createStreams();
    assert.equal(runConfigPrintCommand({ home, streams: second, info: false }), 0);
    assert.equal(readFileSync(settingsPath(home), "utf-8"), '{"port":4242}', "an existing file must never be rewritten");
    assert.match(second.out.join(""), /port = 4242 \(custom \| default: 3000\)/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("test_config_print_renders_contiguous_array_rows_and_detail_prefixes", () => {
  const home = createHome();
  try {
    const streams = createStreams();
    assert.equal(runConfigSetCommand("Settings:enabled:+", "pi", { home, streams }), 0);
    assert.equal(runConfigSetCommand("Settings:enabled:+", "claude", { home, streams }), 0);
    const view = createStreams();
    assert.equal(runConfigPrintCommand({ home, streams: view, info: false }), 0);
    const text = view.out.join("");
    assert.match(text, /enabled = \(2 items \| row target: Settings:enabled:<Idx> \| add: Settings:enabled:\+\)/);
    assert.match(text, /│ {3}┌─────┬──────────┐/);
    assert.match(text, /│ {3}│ 0 {3}│ "pi" {5}│/);
    assert.match(text, /│ {3}│ 1 {3}│ "claude" │/);
    assert.equal(view.err.length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("test_config_info_documents_schema_defaults_and_complete_commands", () => {
  const home = createHome();
  try {
    const streams = createStreams();
    assert.equal(runConfigPrintCommand({ home, streams, info: true }), 0);
    const text = streams.out.join("");
    assert.match(text, /^Application_Configuration - Configuration schema\n/);
    assert.match(text, /Reset block : --unset Settings\n/);
    assert.match(text, /Default : 3000 \(restored via: --unset Settings:port\)/);
    assert.match(text, /Set cmd : --set Settings:port 3100/);
    assert.match(text, /Add item : --set Settings:enabled:\+ "pi"/);
    assert.match(text, /Insert item : --set Settings:enabled:insert:0 "pi"/);
    assert.match(text, /Replace item : --set Settings:enabled:0 "pi"/);
    assert.match(text, /Delete item : --unset Settings:enabled:0/);
    assert.match(text, /Full overwrite : --set Settings:enabled '\["pi"\]'/);
    assert.match(text, /Reset array : --unset Settings:enabled/);
    assert.match(text, /Allowed Values:/);
    assert.equal(streams.err.length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("test_config_get_emits_bare_json_for_values_branches_and_elements", () => {
  const home = createHome();
  try {
    const streams = createStreams();
    assert.equal(runConfigGetCommand("Settings:port", { home, streams }), 0);
    assert.equal(streams.out.join(""), "3000\n");
    assert.equal(runConfigSetCommand("Settings:port", "3100", { home }), 0);

    const scalar = createStreams();
    assert.equal(runConfigGetCommand("Settings:port", { home, streams: scalar }), 0);
    assert.equal(scalar.out.join(""), "3100\n");

    const boolean = createStreams();
    assert.equal(runConfigGetCommand("Settings:autoUpdate", { home, streams: boolean }), 0);
    assert.equal(boolean.out.join(""), "true\n");

    assert.equal(runConfigSetCommand("Settings:enabled:+", "pi", { home }), 0);
    const element = createStreams();
    assert.equal(runConfigGetCommand("Settings:enabled:0", { home, streams: element }), 0);
    assert.equal(element.out.join(""), '"pi"\n');

    const branch = createStreams();
    assert.equal(runConfigGetCommand("Settings", { home, streams: branch }), 0);
    assert.deepEqual(JSON.parse(branch.out.join("")), {
      enabled: ["pi"],
      apiKey: "",
      autoUpdate: true,
      enabledTools: "*",
      host: "127.0.0.1",
      port: 3100,
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("test_config_get_rejects_write_only_and_out_of_range_paths_without_stdout", () => {
  const home = createHome();
  try {
    for (const path of ["Settings:enabled:+", "Settings:enabled:append", "Settings:enabled:insert:0"]) {
      const streams = createStreams();
      assert.equal(runConfigGetCommand(path, { home, streams }), 1, `${path} must not be readable`);
      assert.equal(streams.out.join(""), "", "no partial stdout output on failure");
      assert.match(streams.err.join(""), /write-only array operation/);
    }
    const outOfRange = createStreams();
    assert.equal(runConfigGetCommand("Settings:enabled:3", { home, streams: outOfRange }), 1);
    assert.match(outOfRange.err.join(""), /Settings:enabled: index 3 is out of range/);
    assert.match(outOfRange.err.join(""), /valid indices: none \(the list is empty\)/);
    assert.match(outOfRange.err.join(""), /append with --set Settings:enabled:\+ <value>/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("test_config_set_rejects_invalid_types_and_values_without_mutation", () => {
  const home = createHome();
  try {
    assert.equal(runConfigPrintRawCommand({ home }), 0);
    const original = readFileSync(settingsPath(home), "utf-8");
    const rejections: [string, string][] = [
      ["Settings:port", "abc"],
      ["Settings:port", "0"],
      ["Settings:port", "70000"],
      ["Settings:port", "12.5"],
      ["Settings:port", "true"],
      ["Settings:autoUpdate", "yes"],
      ["Settings:autoUpdate", "1"],
      ["Settings:enabled", "pi"],
      ["Settings:enabled", '["nope"]'],
      ["Settings:enabled", '["pi","pi"]'],
      ["Settings:enabled:+", "nope"],
      ["Settings:enabledTools", "maps_unknown"],
      ["Settings:host", "   "],
      ["Settings:unknown", "value"],
      ["Unknown:port", "3100"],
    ];
    for (const [path, value] of rejections) {
      const streams = createStreams();
      assert.equal(runConfigSetCommand(path, value, { home, streams }), 1, `${path} = ${value} must be rejected`);
      assert.equal(streams.out.join(""), "", "a rejected set must not print a confirmation");
      assert.ok(streams.err.join("").length > 0, "a rejected set must print a stderr diagnostic");
      assert.equal(readFileSync(settingsPath(home), "utf-8"), original, "a rejected set must not mutate the file");
    }
    const malformed = createStreams();
    assert.equal(runConfigSetCommand("Settings:enabled", "[", { home, streams: malformed }), 1);
    assert.match(malformed.err.join(""), /malformed JSON/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("test_config_set_applies_value_index_insert_and_append_operations", () => {
  const home = createHome();
  try {
    const streams = createStreams();
    assert.equal(runConfigSetCommand("Settings:enabled:+", "pi", { home, streams }), 0);
    assert.match(streams.out.join(""), /Settings:enabled:0 = "pi"\./);
    assert.equal(runConfigSetCommand("Settings:enabled:append", "codex", { home }), 0);
    assert.equal(runConfigSetCommand("Settings:enabled:insert:0", "claude", { home }), 0);
    assert.deepEqual(readSettings(home).enabled, ["claude", "pi", "codex"]);

    const replace = createStreams();
    assert.equal(runConfigSetCommand("Settings:enabled:1", "pi", { home, streams: replace }), 0);
    assert.match(replace.out.join(""), /Settings:enabled:1 = "pi"\./);

    const array = createStreams();
    assert.equal(runConfigSetCommand("Settings:enabled", '["opencode"]', { home, streams: array }), 0);
    assert.match(array.out.join(""), /Settings:enabled = \["opencode"\]\./);
    assert.deepEqual(readSettings(home).enabled, ["opencode"]);

    assert.equal(runConfigSetCommand("Settings:port", "3100", { home }), 0);
    assert.equal(runConfigSetCommand("Settings:autoUpdate", "false", { home }), 0);
    assert.equal(runConfigSetCommand("Settings:enabledTools", "maps_geocode,maps_search_places", { home }), 0);
    assert.equal(runConfigSetCommand("Settings:host", "0.0.0.0", { home }), 0);
    assert.equal(runConfigSetCommand("Settings:apiKey", "AIzaPlainTextKey0123456789", { home }), 0);
    assert.deepEqual(readSettings(home), {
      enabled: ["opencode"],
      apiKey: "AIzaPlainTextKey0123456789",
      autoUpdate: false,
      enabledTools: "maps_geocode,maps_search_places",
      host: "0.0.0.0",
      port: 3100,
    });

    const branch = createStreams();
    assert.equal(
      runConfigSetCommand("Settings", '{"host":"127.0.0.1","port":4321}', { home, streams: branch }),
      0
    );
    assert.match(branch.out.join(""), /Settings replaced\./);
    assert.equal(readSettings(home).port, 4321);
    assert.equal(readSettings(home).host, "127.0.0.1");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("test_config_set_and_unset_report_out_of_range_indices_and_keep_the_file", () => {
  const home = createHome();
  try {
    assert.equal(runConfigSetCommand("Settings:enabled:+", "pi", { home }), 0);
    const original = readFileSync(settingsPath(home), "utf-8");
    const replace = createStreams();
    assert.equal(runConfigSetCommand("Settings:enabled:5", "claude", { home, streams: replace }), 1);
    assert.match(replace.err.join(""), /valid indices: 0\.\.0/);
    assert.match(replace.err.join(""), /append with --set Settings:enabled:\+ <value>/);

    const insert = createStreams();
    assert.equal(runConfigSetCommand("Settings:enabled:insert:9", "claude", { home, streams: insert }), 1);
    assert.match(insert.err.join(""), /valid indices: 0\.\.1/);

    const unset = createStreams();
    assert.equal(runConfigUnsetCommand("Settings:enabled:4", { home, streams: unset }), 1);
    assert.match(unset.err.join(""), /index 4 is out of range/);
    assert.equal(readFileSync(settingsPath(home), "utf-8"), original, "a rejected mutation must not change the file");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("test_config_unset_restores_defaults_and_deletes_array_elements", () => {
  const home = createHome();
  try {
    assert.equal(runConfigSetCommand("Settings:port", "3100", { home }), 0);
    assert.equal(runConfigSetCommand("Settings:enabled", '["pi","claude"]', { home }), 0);
    assert.equal(runConfigSetCommand("Settings:host", "0.0.0.0", { home }), 0);

    const element = createStreams();
    assert.equal(runConfigUnsetCommand("Settings:enabled:0", { home, streams: element }), 0);
    assert.match(element.out.join(""), /Settings:enabled:0 removed\./);
    assert.deepEqual(readSettings(home).enabled, ["claude"]);

    const parameter = createStreams();
    assert.equal(runConfigUnsetCommand("Settings:port", { home, streams: parameter }), 0);
    assert.match(parameter.out.join(""), /Settings:port restored to default 3000\./);
    assert.equal(readSettings(home).port, 3000);

    const section = createStreams();
    assert.equal(runConfigUnsetCommand("Settings", { home, streams: section }), 0);
    assert.match(section.out.join(""), /Settings restored to schema defaults\./);
    assert.deepEqual(readSettings(home), {
      enabled: [],
      apiKey: "",
      autoUpdate: true,
      enabledTools: "*",
      host: "127.0.0.1",
      port: 3000,
    });

    const writeOnly = createStreams();
    assert.equal(runConfigUnsetCommand("Settings:enabled:+", { home, streams: writeOnly }), 1);
    assert.match(writeOnly.err.join(""), /write-only array operation/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("test_config_print_raw_preserves_file_bytes_unchanged", () => {
  const home = createHome();
  try {
    assert.equal(runConfigPrintRawCommand({ home }), 0);
    const formatted = '{\n    "port":  4200,\n  "host":"localhost", "enabled": ["pi"]\n}\n';
    writeFileSync(settingsPath(home), formatted, "utf-8");
    const streams = createStreams();
    assert.equal(runConfigPrintRawCommand({ home, streams }), 0);
    assert.equal(streams.bytes.length, 1, "raw output must be written as bytes");
    assert.equal(Buffer.from(streams.bytes[0]).toString("utf-8"), formatted);
    assert.equal(streams.err.length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("test_config_mutations_reject_invalid_or_malformed_documents_without_rewriting", () => {
  const home = createHome();
  try {
    mkdirSync(join(home, ".config", "mcp-google-api"), { recursive: true });
    writeFileSync(settingsPath(home), '{"port":"abc"}', "utf-8");
    const invalid = createStreams();
    assert.equal(runConfigSetCommand("Settings:host", "0.0.0.0", { home, streams: invalid }), 1);
    assert.match(invalid.err.join(""), /Settings:port: must be an integer in 1\.\.65535/);
    assert.equal(readFileSync(settingsPath(home), "utf-8"), '{"port":"abc"}');

    writeFileSync(settingsPath(home), "{broken", "utf-8");
    const malformed = createStreams();
    assert.equal(runConfigUnsetCommand("Settings:port", { home, streams: malformed }), 1);
    assert.match(malformed.err.join(""), /not valid JSON/);
    assert.equal(readFileSync(settingsPath(home), "utf-8"), "{broken");

    writeFileSync(settingsPath(home), "[]", "utf-8");
    const array = createStreams();
    assert.equal(runConfigSetCommand("Settings:port", "3100", { home, streams: array }), 1);
    assert.match(array.err.join(""), /must contain a JSON object/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("test_config_atomic_write_failure_preserves_the_original_file", () => {
  const home = createHome();
  const directory = join(home, ".config", "mcp-google-api");
  try {
    assert.equal(runConfigPrintRawCommand({ home }), 0);
    const original = readFileSync(settingsPath(home), "utf-8");
    chmodSync(directory, 0o500);
    const streams = createStreams();
    assert.equal(runConfigSetCommand("Settings:port", "3100", { home, streams }), 1);
    assert.match(streams.err.join(""), /settings write failed/);
    chmodSync(directory, 0o700);
    assert.equal(readFileSync(settingsPath(home), "utf-8"), original, "the previous valid file must survive a failed update");
    assert.ok(!existsSync(`${settingsPath(home)}.tmp`), "the temporary file must be cleaned up");
  } finally {
    chmodSync(directory, 0o700);
    rmSync(home, { recursive: true, force: true });
  }
});

test("test_config_command_parser_enforces_exact_argument_shapes", () => {
  assert.deepEqual(parseConfigCommand(["start"]), { matched: false });
  assert.deepEqual(parseConfigCommand([]), { matched: false });
  assert.deepEqual(parseConfigCommand(["--print"]), {
    matched: true,
    ok: true,
    invocation: { action: "--print" },
  });
  assert.deepEqual(parseConfigCommand(["--print", "Settings"]), {
    matched: true,
    ok: true,
    invocation: { action: "--print", path: "Settings" },
  });
  assert.deepEqual(parseConfigCommand(["--set", "Settings:port", "3100"]), {
    matched: true,
    ok: true,
    invocation: { action: "--set", path: "Settings:port", value: "3100" },
  });
  const tooManyPaths = parseConfigCommand(["--info", "Settings", "Settings:port"]);
  assert.ok(tooManyPaths.matched && !tooManyPaths.ok);
  const missingValue = parseConfigCommand(["--set", "Settings:port"]);
  assert.ok(missingValue.matched && !missingValue.ok);
  const extraRaw = parseConfigCommand(["--print-raw", "Settings"]);
  assert.ok(extraRaw.matched && !extraRaw.ok);
  const missingGet = parseConfigCommand(["--get"]);
  assert.ok(missingGet.matched && !missingGet.ok);
  assert.match(CONFIG_CLI_USAGE, /--get Settings:port/);
  assert.match(CONFIG_CLI_USAGE, /--set Settings:enabled:\+ "pi"/);
});

test("test_config_command_dispatch_routes_every_action", () => {
  const home = createHome();
  try {
    const setStreams = createStreams();
    assert.equal(
      runConfigCommandInvocation(
        { action: "--set", path: "Settings:port", value: "3100" },
        { home, streams: setStreams }
      ),
      0
    );
    assert.match(setStreams.out.join(""), /Settings:port = 3100\./);

    const getStreams = createStreams();
    assert.equal(
      runConfigCommandInvocation({ action: "--get", path: "Settings:port" }, { home, streams: getStreams }),
      0
    );
    assert.equal(getStreams.out.join(""), "3100\n");

    const infoStreams = createStreams();
    assert.equal(runConfigCommandInvocation({ action: "--info" }, { home, streams: infoStreams }), 0);
    assert.match(infoStreams.out.join(""), /Configuration schema/);

    const printStreams = createStreams();
    assert.equal(
      runConfigCommandInvocation({ action: "--print", path: "Settings" }, { home, streams: printStreams }),
      0
    );
    assert.match(printStreams.out.join(""), /^Settings - \[Path: Settings\]/);

    const rawStreams = createStreams();
    assert.equal(runConfigCommandInvocation({ action: "--print-raw" }, { home, streams: rawStreams }), 0);
    assert.equal(rawStreams.bytes.length, 1);

    const unsetStreams = createStreams();
    assert.equal(
      runConfigCommandInvocation({ action: "--unset", path: "Settings:port" }, { home, streams: unsetStreams }),
      0
    );
    assert.match(unsetStreams.out.join(""), /restored to default 3000/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
