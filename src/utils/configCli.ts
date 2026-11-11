/**
 * @file configCli.ts
 * @brief Command handlers and argument parsing of the configuration interface.
 * @details Implements the pre-yargs command surface `--print [Path]`,
 * `--info [Path]`, `--print-raw`, `--get Path`, `--set Path Value`, and
 * `--unset Path` (PRJ-023, REQ-200-REQ-208). Every handler bootstraps the
 * settings file from schema defaults (REQ-199), resolves the canonical path
 * against the canonical schema (REQ-194), renders through the shared tree and
 * table renderers (REQ-209, REQ-217), writes valid output to stdout, English
 * diagnostics to stderr, and returns exit code 0 or 1 (REQ-208, REQ-219).
 * @note No business logic of the MCP server, Google API clients, or existing
 * settings subcommands is changed; they keep writing through the same settings
 * module (REQ-223).
 * @satisfies DES-025, DES-028, PRJ-023, REQ-199, REQ-200, REQ-208
 */

import { readFileSync } from "node:fs";
import serverConfigs from "../config.js";
import {
  applyConfigSet,
  applyConfigUnset,
  parseConfigPath,
  readConfigValue,
  validateConfigDocument,
  type ConfigDocument,
  type ConfigSchemaContext,
} from "./configSchema.js";
import { renderConfigTree } from "./configRenderer.js";
import { buildConfigInfoView, buildConfigPrintView } from "./configView.js";
import {
  bootstrapCliSettings,
  loadCliSettings,
  readCliSettingsDocument,
  saveCliSettings,
} from "./cliSettings.js";
import { supportedCliNames } from "./cliTargets.js";

/**
 * @brief Configuration interface action selected by the first argument.
 * @details Exactly the six supported flags; no alternate mutation flag is
 * accepted (PRJ-023).
 * @satisfies PRJ-023
 */
export type ConfigAction = "--print" | "--info" | "--print-raw" | "--get" | "--set" | "--unset";

/**
 * @brief Ordered list of supported configuration interface actions.
 * @details Drives dispatch and the usage text (REQ-220).
 * @satisfies PRJ-023, REQ-220
 */
export const CONFIG_ACTIONS: readonly ConfigAction[] = ["--print", "--info", "--print-raw", "--get", "--set", "--unset"];

/**
 * @brief Parsed configuration interface invocation.
 * @details `path` is present for `--print`, `--info`, `--get`, `--set`, and
 * `--unset` (optional for the first two); `value` only for `--set`.
 * @satisfies PRJ-023
 */
export interface ConfigCommandInvocation {
  readonly action: ConfigAction;
  readonly path?: string;
  readonly value?: string;
}

/**
 * @brief Result of detecting a configuration interface invocation in argv.
 * @details `matched: false` means the argv belongs to yargs; `matched: true`
 * with `ok: false` carries an English usage diagnostic (REQ-208).
 * @satisfies REQ-208
 */
export type ConfigCommandParse =
  | { readonly matched: false }
  | { readonly matched: true; readonly ok: true; readonly invocation: ConfigCommandInvocation }
  | { readonly matched: true; readonly ok: false; readonly error: string };

/**
 * @brief Configurable output sink accepting text or raw bytes.
 * @details `--print-raw` writes the settings file bytes through this sink so the
 * raw JSON file content is preserved unchanged (REQ-202).
 * @satisfies REQ-202
 */
export interface ConfigOutputStream {
  write(chunk: string | Uint8Array): unknown;
}

/**
 * @brief Injectable stdout/stderr sinks of the configuration interface.
 * @details Defaults to the process streams; tests inject capturing sinks.
 * @satisfies REQ-208
 */
export interface ConfigCommandStreams {
  stdout: ConfigOutputStream;
  stderr: ConfigOutputStream;
}

/**
 * @brief Options shared by every configuration interface handler.
 * @details `home` scopes the settings file to an alternative home root; `streams`
 * injects the output sinks.
 * @satisfies REQ-199
 */
export interface ConfigCommandOptions {
  home?: string;
  streams?: ConfigCommandStreams;
}

/**
 * @brief Usage text of the configuration interface.
 * @details Published in the CLI help and in argument-shape diagnostics; every
 * example is a complete canonical path with a schema-valid value (REQ-220).
 * @satisfies REQ-220
 */
export const CONFIG_CLI_USAGE =
  "Configuration interface (canonical paths, section Settings):\n" +
  "  --print [Path]        Print current configuration values as a tree\n" +
  "  --info [Path]         Print the configuration schema documentation as a tree\n" +
  "  --print-raw           Print the raw settings file bytes unchanged\n" +
  "  --get Path            Print one value as JSON (pipeable, no decoration)\n" +
  "  --set Path Value      Set a value (JSON literal for non-string parameters)\n" +
  "  --unset Path          Restore a default, or delete one array element\n" +
  "Examples:\n" +
  "  mcp-google-api --print\n" +
  "  mcp-google-api --print Settings\n" +
  "  mcp-google-api --info Settings:enabled\n" +
  "  mcp-google-api --get Settings:port\n" +
  "  mcp-google-api --set Settings:port 3100\n" +
  '  mcp-google-api --set Settings:enabled:+ "pi"\n' +
  "  mcp-google-api --unset Settings:host";

/**
 * @brief Builds the schema validation context from the live registries.
 * @details Supported CLI names come from the CLI adapter registry (REQ-110,
 * REQ-221); tool names come from the registered MCP tool registry (PRJ-001,
 * REQ-222).
 * @return {ConfigSchemaContext} Registry inputs for constraint validation.
 * @note Complexity O(n) in registry size.
 * @satisfies REQ-221, REQ-222
 */
export function createConfigSchemaContext(): ConfigSchemaContext {
  return {
    cliNames: supportedCliNames()
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
    toolNames: serverConfigs[0].tools.map((tool) => tool.name),
  };
}

/**
 * @brief Detects and parses a configuration interface invocation.
 * @details Requires the action flag to be the first argument and validates the
 * exact argument count of each action, so no implicit mutation flag or partial
 * success is accepted (REQ-208).
 * @param args {readonly string[]} Post-entry argument vector (argv slice 2).
 * @return {ConfigCommandParse} Not-matched marker, invocation, or usage diagnostic.
 * @note Complexity O(n) in argument count. Pure.
 * @satisfies PRJ-023, REQ-208
 */
export function parseConfigCommand(args: readonly string[]): ConfigCommandParse {
  const action = CONFIG_ACTIONS.find((candidate) => candidate === args[0]);
  if (action === undefined) {
    return { matched: false };
  }
  const rest = args.slice(1);
  const reject = (error: string): ConfigCommandParse => ({ matched: true, ok: false, error });
  switch (action) {
    case "--print":
    case "--info": {
      if (rest.length > 1) {
        return reject(`${action} accepts at most one canonical path argument`);
      }
      return { matched: true, ok: true, invocation: rest.length === 0 ? { action } : { action, path: rest[0] } };
    }
    case "--print-raw": {
      if (rest.length !== 0) {
        return reject("--print-raw accepts no arguments");
      }
      return { matched: true, ok: true, invocation: { action } };
    }
    case "--get":
    case "--unset": {
      if (rest.length !== 1) {
        return reject(`${action} requires exactly one canonical path argument`);
      }
      return { matched: true, ok: true, invocation: { action, path: rest[0] } };
    }
    default: {
      if (rest.length !== 2) {
        return reject("--set requires a canonical path argument and exactly one value argument");
      }
      return { matched: true, ok: true, invocation: { action, path: rest[0], value: rest[1] } };
    }
  }
}

/**
 * @brief Resolves the effective output sinks of one handler call.
 * @param options {ConfigCommandOptions} Handler options.
 * @return {ConfigCommandStreams} Injected or process streams.
 * @note Complexity O(1). Pure.
 */
function resolveStreams(options: ConfigCommandOptions): ConfigCommandStreams {
  return options.streams ?? { stdout: process.stdout, stderr: process.stderr };
}

/**
 * @brief Reports one configuration command failure on stderr.
 * @details Diagnostics always go to stderr and the handler returns exit code 1
 * without stdout output (REQ-208).
 * @param streams {ConfigCommandStreams} Output sinks.
 * @param action {ConfigAction} Failing action flag.
 * @param message {string} English diagnostic.
 * @return {number} Exit code 1.
 * @note Complexity O(n) in message length.
 * @satisfies REQ-208, REQ-219
 */
function reportConfigFailure(streams: ConfigCommandStreams, action: ConfigAction, message: string): number {
  streams.stderr.write(`${action}: ${message}\n`);
  return 1;
}

/**
 * @brief Loads the current configuration after bootstrapping the settings file.
 * @details Tolerant load used by the read-only commands so a hand-edited file
 * still renders with schema defaults for invalid fields (DES-018); mutation
 * commands validate the document strictly instead (REQ-206).
 * @param home {string | undefined} Home-directory override.
 * @return {{ ok: true; settings: ConfigDocument } | { ok: false; error: string }} Settings or diagnostic.
 * @satisfies REQ-199, DES-018
 */
function loadConfigurationForRead(
  home?: string
): { readonly ok: true; readonly settings: ConfigDocument } | { readonly ok: false; readonly error: string } {
  try {
    bootstrapCliSettings(home);
    return { ok: true, settings: loadCliSettings(home) };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * @brief Loads and strictly validates the document targeted by a mutation.
 * @details Bootstraps the file, parses it without normalizing, and validates the
 * whole document against the schema so an invalid file is reported instead of
 * silently rewritten (REQ-206).
 * @param home {string | undefined} Home-directory override.
 * @param context {ConfigSchemaContext} Supported CLI and tool name registries.
 * @return {{ ok: true; settings: ConfigDocument } | { ok: false; error: string }} Validated settings or diagnostic.
 * @satisfies REQ-199, REQ-206
 */
function loadConfigurationForWrite(
  home: string | undefined,
  context: ConfigSchemaContext
): { readonly ok: true; readonly settings: ConfigDocument } | { readonly ok: false; readonly error: string } {
  try {
    bootstrapCliSettings(home);
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const read = readCliSettingsDocument(home);
  if (!read.ok) {
    return { ok: false, error: read.error };
  }
  const validated = validateConfigDocument(read.document, context);
  if (!validated.ok) {
    return { ok: false, error: `settings file is invalid: ${validated.error}` };
  }
  return { ok: true, settings: validated.value };
}

/**
 * @brief Renders `--print` or `--info` output for the whole tree or one path.
 * @details Both modes share `buildConfigPrintView`/`buildConfigInfoView` and the
 * single renderer, so topology is identical and only headings/details differ
 * (REQ-200, REQ-201, REQ-209). Output lines are written to stdout with a
 * trailing newline; failures produce a stderr diagnostic and exit 1 (REQ-208).
 * @param options {ConfigCommandOptions & { info: boolean; path?: string }} Mode and optional path.
 * @return {number} Exit code 0 on success, 1 on failure.
 * @see buildConfigPrintView
 * @see buildConfigInfoView
 * @see renderConfigTree
 * @satisfies REQ-200, REQ-201, REQ-209, REQ-212
 */
export function runConfigPrintCommand(
  options: ConfigCommandOptions & { info: boolean; path?: string }
): number {
  const streams = resolveStreams(options);
  const action: ConfigAction = options.info ? "--info" : "--print";
  const context = createConfigSchemaContext();
  if (options.info) {
    const view = buildConfigInfoView(context, options.path);
    if (!view.ok) {
      return reportConfigFailure(streams, action, view.error);
    }
    streams.stdout.write(renderConfigTree(view.root).join("\n") + "\n");
    return 0;
  }
  const loaded = loadConfigurationForRead(options.home);
  if (!loaded.ok) {
    return reportConfigFailure(streams, action, loaded.error);
  }
  const view = buildConfigPrintView(loaded.settings, context, options.path);
  if (!view.ok) {
    return reportConfigFailure(streams, action, view.error);
  }
  streams.stdout.write(renderConfigTree(view.root).join("\n") + "\n");
  return 0;
}

/**
 * @brief Writes the raw settings file bytes to stdout unchanged.
 * @details Byte-preserving debug output: no tree formatting, no re-serialization,
 * no heading, and no trailing text (REQ-202). The file is bootstrapped from
 * defaults first so the command always has a document to print (REQ-199).
 * @param options {ConfigCommandOptions} Handler options.
 * @return {number} Exit code 0 on success, 1 on failure.
 * @satisfies REQ-199, REQ-202
 */
export function runConfigPrintRawCommand(options: ConfigCommandOptions = {}): number {
  const streams = resolveStreams(options);
  let path: string;
  try {
    path = bootstrapCliSettings(options.home);
  } catch (error: unknown) {
    return reportConfigFailure(streams, "--print-raw", error instanceof Error ? error.message : String(error));
  }
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch (error: unknown) {
    return reportConfigFailure(streams, "--print-raw", error instanceof Error ? error.message : String(error));
  }
  streams.stdout.write(bytes);
  return 0;
}

/**
 * @brief Emits one addressed configuration value as bare JSON.
 * @details No labels, tree decoration, prompts, or confirmations, so the output
 * pipes into JSON tooling directly (REQ-203). Section targets yield a JSON
 * object, parameter targets their typed value, and index targets one element.
 * @param path {string} Canonical path argument.
 * @param options {ConfigCommandOptions} Handler options.
 * @return {number} Exit code 0 on success, 1 on failure.
 * @satisfies REQ-194, REQ-203, REQ-208
 */
export function runConfigGetCommand(path: string, options: ConfigCommandOptions = {}): number {
  const streams = resolveStreams(options);
  const parsed = parseConfigPath(path);
  if (!parsed.ok) {
    return reportConfigFailure(streams, "--get", parsed.error);
  }
  const loaded = loadConfigurationForRead(options.home);
  if (!loaded.ok) {
    return reportConfigFailure(streams, "--get", loaded.error);
  }
  const value = readConfigValue(loaded.settings, parsed.target);
  if (!value.ok) {
    return reportConfigFailure(streams, "--get", value.error);
  }
  streams.stdout.write(JSON.stringify(value.value) + "\n");
  return 0;
}

/**
 * @brief Applies one validated `--set` mutation and persists it atomically.
 * @details Parses the value into the schema type, applies the addressed
 * operation (`value`, `index`, `append`, `insert`), validates the resulting
 * document, persists it durably, and prints an English confirmation naming the
 * full canonical path (REQ-196, REQ-204, REQ-206, REQ-207).
 * @param path {string} Canonical path argument.
 * @param rawValue {string} Raw value argument.
 * @param options {ConfigCommandOptions} Handler options.
 * @return {number} Exit code 0 on success, 1 on failure.
 * @satisfies REQ-196, REQ-204, REQ-206, REQ-207
 */
export function runConfigSetCommand(path: string, rawValue: string, options: ConfigCommandOptions = {}): number {
  const streams = resolveStreams(options);
  const parsed = parseConfigPath(path);
  if (!parsed.ok) {
    return reportConfigFailure(streams, "--set", parsed.error);
  }
  const context = createConfigSchemaContext();
  const loaded = loadConfigurationForWrite(options.home, context);
  if (!loaded.ok) {
    return reportConfigFailure(streams, "--set", loaded.error);
  }
  const applied = applyConfigSet(loaded.settings, parsed.target, rawValue, context);
  if (!applied.ok) {
    return reportConfigFailure(streams, "--set", applied.error);
  }
  try {
    saveCliSettings(applied.settings, options.home);
  } catch (error: unknown) {
    return reportConfigFailure(streams, "--set", error instanceof Error ? error.message : String(error));
  }
  streams.stdout.write(`${applied.description}.\n`);
  return 0;
}

/**
 * @brief Applies one validated `--unset` mutation and persists it atomically.
 * @details Restores the schema default of a parameter or section, deletes one
 * array element for an index path and compacts the remaining indices, then
 * persists durably and prints an English confirmation naming the full canonical
 * path (REQ-196, REQ-205, REQ-206, REQ-207).
 * @param path {string} Canonical path argument.
 * @param options {ConfigCommandOptions} Handler options.
 * @return {number} Exit code 0 on success, 1 on failure.
 * @satisfies REQ-196, REQ-205, REQ-206, REQ-207
 */
export function runConfigUnsetCommand(path: string, options: ConfigCommandOptions = {}): number {
  const streams = resolveStreams(options);
  const parsed = parseConfigPath(path);
  if (!parsed.ok) {
    return reportConfigFailure(streams, "--unset", parsed.error);
  }
  const context = createConfigSchemaContext();
  const loaded = loadConfigurationForWrite(options.home, context);
  if (!loaded.ok) {
    return reportConfigFailure(streams, "--unset", loaded.error);
  }
  const applied = applyConfigUnset(loaded.settings, parsed.target, context);
  if (!applied.ok) {
    return reportConfigFailure(streams, "--unset", applied.error);
  }
  try {
    saveCliSettings(applied.settings, options.home);
  } catch (error: unknown) {
    return reportConfigFailure(streams, "--unset", error instanceof Error ? error.message : String(error));
  }
  streams.stdout.write(`${applied.description}.\n`);
  return 0;
}

/**
 * @brief Dispatches one parsed invocation to its handler.
 * @details Single dispatch surface of the configuration interface; the returned
 * code becomes the process exit code (REQ-208).
 * @param invocation {ConfigCommandInvocation} Parsed invocation.
 * @param options {ConfigCommandOptions} Handler options.
 * @return {number} Handler exit code.
 * @satisfies PRJ-023, REQ-208
 */
export function runConfigCommandInvocation(
  invocation: ConfigCommandInvocation,
  options: ConfigCommandOptions = {}
): number {
  switch (invocation.action) {
    case "--print":
      return runConfigPrintCommand({ ...options, info: false, path: invocation.path });
    case "--info":
      return runConfigPrintCommand({ ...options, info: true, path: invocation.path });
    case "--print-raw":
      return runConfigPrintRawCommand(options);
    case "--get":
      return runConfigGetCommand(invocation.path ?? "", options);
    case "--set":
      return runConfigSetCommand(invocation.path ?? "", invocation.value ?? "", options);
    default:
      return runConfigUnsetCommand(invocation.path ?? "", options);
  }
}

/**
 * @brief Handles the configuration interface when the argv matches one action.
 * @details Called before yargs dispatch: returns false when the argv belongs to
 * another command, otherwise executes the action, records the exit code on
 * `process.exitCode`, and returns true (DES-028, REQ-208).
 * @param args {readonly string[]} Post-entry argument vector (argv slice 2).
 * @param options {ConfigCommandOptions} Handler options.
 * @return {boolean} True when a configuration action handled the invocation.
 * @satisfies DES-028, PRJ-023, REQ-208
 */
export function runConfigCommandIfMatched(args: readonly string[], options: ConfigCommandOptions = {}): boolean {
  const parsed = parseConfigCommand(args);
  if (!parsed.matched) {
    return false;
  }
  const streams = resolveStreams(options);
  if (!parsed.ok) {
    streams.stderr.write(`${parsed.error}\n\n${CONFIG_CLI_USAGE}\n`);
    process.exitCode = 1;
    return true;
  }
  process.exitCode = runConfigCommandInvocation(parsed.invocation, options);
  return true;
}
