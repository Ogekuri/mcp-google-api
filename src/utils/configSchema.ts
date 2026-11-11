/**
 * @file configSchema.ts
 * @brief Canonical configuration schema for the mcp-google-api settings file.
 * @details Single source of truth for the configuration section tree, canonical
 * CLI path grammar, typed value parsing, constraint validation, schema
 * defaults, and display encoding (DES-025, DES-029). The persisted document is
 * one flat JSON object; the schema projects it onto the top-level section
 * `Settings` so every consumer (path resolution, `--print`, `--info`, `--get`,
 * `--set`, `--unset`, and the CLI help) reads the same node set (REQ-193,
 * REQ-220). Sections and parameters are declared in the on-disk key order
 * (`enabled`, `apiKey`, `autoUpdate`, `enabledTools`, `host`, `port`).
 * @note Pure module: no filesystem, network, or process access.
 * @satisfies DES-025, DES-029, REQ-193, REQ-194
 */

import { resolveCliTarget } from "./cliTargets.js";

/**
 * @brief Virtual display root label of every rendered configuration tree.
 * @details Display-only: the label is never part of a canonical CLI path
 * (REQ-194). Complexity O(1); pure constant.
 * @satisfies REQ-194, REQ-211
 */
export const CONFIG_ROOT_LABEL = "Application_Configuration";

/**
 * @brief Scalar/collection type tag of one configuration parameter.
 * @details `StringArray` models a primitive array of strings addressed by
 * `:<Idx>`, `:+`, `:append`, and `:insert:<Idx>` (REQ-198).
 * @satisfies DES-025, REQ-198
 */
export type ConfigParameterType = "String" | "Boolean" | "Integer" | "StringArray";

/**
 * @brief Typed configuration document persisted at the settings path.
 * @details Mirrors the DES-018 JSON shape exactly; every field is required and
 * carries a schema default. `enabled` element order is the persistence order of
 * enabled CLI agents (REQ-221).
 * @satisfies DES-018, DES-025, REQ-193
 */
export interface ConfigDocument {
  enabled: string[];
  apiKey: string;
  autoUpdate: boolean;
  enabledTools: string;
  host: string;
  port: number;
}

/**
 * @brief Declaration of one configuration leaf parameter.
 * @details `token` is the byte-exact CLI and display identifier (REQ-193);
 * `constraints` renders the `--info` type badge; `example` is a schema-valid
 * value used by published `--info` commands (REQ-215).
 * @satisfies DES-025, REQ-193, REQ-215
 */
export interface ConfigParameter {
  readonly token: keyof ConfigDocument;
  readonly type: ConfigParameterType;
  readonly constraints: string;
  readonly description: string;
  readonly example: string | boolean | number | readonly string[];
}

/**
 * @brief Declaration of one configuration section node.
 * @details Section tokens are canonical CLI path prefixes and carry no
 * parameters below their direct children (REQ-193, REQ-211).
 * @satisfies DES-025, REQ-193, REQ-211
 */
export interface ConfigSection {
  readonly token: string;
  readonly description: string;
  readonly parameters: readonly ConfigParameter[];
}

/**
 * @brief The single canonical configuration section of this application.
 * @details `Settings` groups every persisted key; declaration order equals the
 * on-disk key order so `--print`, `--info`, `--get`, and persistence agree
 * byte for byte (REQ-193, REQ-218).
 * @satisfies DES-025, REQ-193
 */
export const CONFIG_SECTION: ConfigSection = {
  token: "Settings",
  description: "Persisted mcp-google-api configuration",
  parameters: [
    {
      token: "enabled",
      type: "StringArray",
      constraints: "CLI names",
      description: "CLI agents receiving MCP registration and packaged skills",
      example: ["pi"],
    },
    {
      token: "apiKey",
      type: "String",
      constraints: "any string",
      description: "Google Maps API key; empty when unset",
      example: "AIzaSyExampleKey0123456789",
    },
    {
      token: "autoUpdate",
      type: "Boolean",
      constraints: "true or false",
      description: "Automatic npm update check at server startup",
      example: false,
    },
    {
      token: "enabledTools",
      type: "String",
      constraints: "'*' or comma-separated tool names",
      description: "Exposed MCP tool allowlist",
      example: "maps_geocode,maps_search_places",
    },
    {
      token: "host",
      type: "String",
      constraints: "non-empty hostname",
      description: "HTTP bind hostname",
      example: "0.0.0.0",
    },
    {
      token: "port",
      type: "Integer",
      constraints: "1-65535",
      description: "HTTP listen port",
      example: 3100,
    },
  ],
};

/**
 * @brief Ordered configuration section registry.
 * @details Rendered tree root children; declaration order is stable (REQ-193).
 * @satisfies DES-025, REQ-193
 */
export const CONFIG_SECTIONS: readonly ConfigSection[] = [CONFIG_SECTION];

/**
 * @brief Schema defaults of every configuration field.
 * @details Single source of truth for load-time defaults, `--unset` restores,
 * and `--print` `(default)` status (DES-025, REQ-205, REQ-213). Values match
 * DES-018.
 * @satisfies DES-018, DES-025, REQ-205
 */
export const CONFIG_DEFAULTS: ConfigDocument = {
  enabled: [],
  apiKey: "",
  autoUpdate: true,
  enabledTools: "*",
  host: "127.0.0.1",
  port: 3000,
};

/**
 * @brief Runtime registry inputs required by constraint validation.
 * @details `cliNames` lists the supported CLI agents (REQ-110, REQ-221);
 * `toolNames` lists the registered MCP tool names (PRJ-001, REQ-222). Injected
 * by the caller so this module stays free of registry/model imports.
 * @satisfies REQ-221, REQ-222
 */
export interface ConfigSchemaContext {
  readonly cliNames: readonly string[];
  readonly toolNames: readonly string[];
}

/**
 * @brief Address form of one resolved canonical configuration path.
 * @details `value` addresses a section or a whole parameter; `index` a single
 * array element; `append`/`insert` are write-only operations (REQ-198).
 * @satisfies DES-025, REQ-194, REQ-198
 */
export type ConfigPathOperation = "value" | "index" | "append" | "insert";

/**
 * @brief Resolved target of one canonical configuration path.
 * @details `parameter` is absent for a section target; `index` is present for
 * `index` and `insert` operations; `canonicalPath` echoes the normalized path
 * used in confirmations and diagnostics (REQ-207).
 * @satisfies DES-025, REQ-194, REQ-207
 */
export interface ConfigPathTarget {
  readonly section: ConfigSection;
  readonly parameter?: ConfigParameter;
  readonly operation: ConfigPathOperation;
  readonly index?: number;
  readonly canonicalPath: string;
}

/**
 * @brief Result of resolving a canonical configuration path.
 * @details `ok: false` carries an English diagnostic naming the offending path
 * or token (REQ-195).
 * @satisfies REQ-195
 */
export type ConfigPathResult =
  | { readonly ok: true; readonly target: ConfigPathTarget }
  | { readonly ok: false; readonly error: string };

/**
 * @brief Result of one typed value parse or document validation.
 * @details `ok: false` carries an English diagnostic; callers MUST abort the
 * mutation without touching the settings file (REQ-206).
 * @satisfies REQ-206
 */
export type ConfigParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/**
 * @brief Result of one `--set`/`--unset` mutation over a typed document.
 * @details `settings` is a fresh validated document; `description` is the
 * English confirmation tail naming the canonical path (REQ-207).
 * @satisfies REQ-204, REQ-205, REQ-207
 */
export type ConfigMutationResult =
  | { readonly ok: true; readonly settings: ConfigDocument; readonly description: string }
  | { readonly ok: false; readonly error: string };

/**
 * @brief Full canonical path of one parameter.
 * @details `Section:Parameter`; used by confirmations, help, and errors (REQ-207).
 * @param section {ConfigSection} Owning section.
 * @param parameter {ConfigParameter} Addressed parameter.
 * @return {string} Canonical colon-separated path.
 * @note Complexity O(n) in token lengths. Pure.
 */
export function formatConfigPath(section: ConfigSection, parameter: ConfigParameter): string {
  return `${section.token}:${parameter.token}`;
}

/**
 * @brief Encodes one configuration value for human-readable display.
 * @details Strings become JSON-quoted strings (so newlines render as `\n`),
 * booleans/numbers JSON literals, arrays/objects JSON text (REQ-213, REQ-218).
 * Never masks or truncates the value (REQ-218).
 * @param value {unknown} Typed configuration value.
 * @return {string} Single-line display encoding.
 * @note Complexity O(n) in the value size. Pure.
 * @satisfies REQ-213, REQ-218
 */
export function formatConfigDisplayValue(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}

/**
 * @brief Renders the `--info` type badge of one parameter.
 * @details `[<Type>: <constraints>]` form (REQ-215); the badge follows the
 * byte-exact parameter token on the heading line (REQ-210).
 * @param parameter {ConfigParameter} Addressed parameter.
 * @return {string} Type badge without surrounding whitespace.
 * @note Complexity O(n). Pure.
 * @satisfies REQ-215
 */
export function describeConfigType(parameter: ConfigParameter): string {
  return `[${parameter.type}: ${parameter.constraints}]`;
}

/**
 * @brief Parses one non-negative array index token.
 * @details Accepts only a decimal non-negative integer (REQ-196); rejects
 * negatives, fractions, empty tokens, and non-numeric text with an English
 * diagnostic naming the owning path (REQ-195).
 * @param token {string} Raw path segment.
 * @param ownerPath {string} Canonical path of the owning array parameter.
 * @return {number | string} Parsed index, or the diagnostic message.
 * @note Complexity O(n) in token length. Pure.
 * @satisfies REQ-195, REQ-196
 */
function parseIndexToken(token: string, ownerPath: string): number | string {
  if (!/^\d+$/.test(token)) {
    return `"${token}" is not a valid array index for ${ownerPath}; expected a non-negative decimal index (0..len-1), ":+" to append, or ":insert:<Idx>" to insert`;
  }
  const index = Number(token);
  if (!Number.isSafeInteger(index)) {
    return `array index "${token}" for ${ownerPath} is out of the supported integer range`;
  }
  return index;
}

/**
 * @brief Resolves a canonical colon-separated configuration path.
 * @details Grammar: `Settings`, `Settings:<Parameter>`, and for the
 * `StringArray` parameter `Settings:enabled:<Idx>`, `Settings:enabled:+`,
 * `Settings:enabled:append`, `Settings:enabled:insert:<Idx>` (REQ-194,
 * REQ-198). Tokens are case-sensitive and matched against the schema only,
 * never against rendered labels (REQ-194). Unresolvable tokens yield an
 * English diagnostic listing the valid alternatives (REQ-195).
 * @param path {string} Raw path argument from the command line.
 * @return {ConfigPathResult} Resolved target, or the diagnostic message.
 * @note Complexity O(sections * parameters). Pure.
 * @satisfies REQ-194, REQ-195, REQ-198
 */
export function parseConfigPath(path: string): ConfigPathResult {
  const raw = (path ?? "").trim();
  if (raw.length === 0) {
    return {
      ok: false,
      error: `configuration path is empty; expected "${CONFIG_SECTION.token}" or "${CONFIG_SECTION.token}:<parameter>"`,
    };
  }
  const tokens = raw.split(":");
  const section = CONFIG_SECTIONS.find((candidate) => candidate.token === tokens[0]);
  if (section === undefined) {
    return {
      ok: false,
      error: `unknown configuration section "${tokens[0]}"; valid sections: ${CONFIG_SECTIONS.map((item) => item.token).join(", ")}`,
    };
  }
  if (tokens.length === 1) {
    return { ok: true, target: { section, operation: "value", canonicalPath: section.token } };
  }
  const parameter = section.parameters.find((candidate) => candidate.token === tokens[1]);
  if (parameter === undefined) {
    return {
      ok: false,
      error: `unknown configuration parameter "${tokens[1]}" in section "${section.token}"; valid parameters: ${section.parameters
        .map((item) => item.token)
        .join(", ")}`,
    };
  }
  const ownerPath = formatConfigPath(section, parameter);
  if (tokens.length === 2) {
    return { ok: true, target: { section, parameter, operation: "value", canonicalPath: ownerPath } };
  }
  if (parameter.type !== "StringArray") {
    return {
      ok: false,
      error: `${ownerPath} is a ${parameter.type} parameter and accepts no further path segments`,
    };
  }
  const operation = tokens[2];
  if (operation === "+" || operation === "append") {
    if (tokens.length !== 3) {
      return { ok: false, error: `${ownerPath}:${operation} accepts no further path segments` };
    }
    return {
      ok: true,
      target: { section, parameter, operation: "append", canonicalPath: `${ownerPath}:${operation}` },
    };
  }
  if (operation === "insert") {
    if (tokens.length !== 4) {
      return { ok: false, error: `insert requires exactly one index: ${ownerPath}:insert:<Idx>` };
    }
    const index = parseIndexToken(tokens[3], ownerPath);
    if (typeof index === "string") {
      return { ok: false, error: index };
    }
    return {
      ok: true,
      target: { section, parameter, operation: "insert", index, canonicalPath: `${ownerPath}:insert:${index}` },
    };
  }
  if (tokens.length !== 3) {
    return { ok: false, error: `${ownerPath}:<Idx> accepts no further path segments` };
  }
  const index = parseIndexToken(operation, ownerPath);
  if (typeof index === "string") {
    return { ok: false, error: index };
  }
  return {
    ok: true,
    target: { section, parameter, operation: "index", index, canonicalPath: `${ownerPath}:${index}` },
  };
}

/**
 * @brief Builds the out-of-range diagnostic of one array index path.
 * @details Names the full path, the rejected index, the valid range, and the
 * `:+` append alternative (REQ-197).
 * @param ownerPath {string} Canonical path of the owning array parameter.
 * @param index {number} Rejected index.
 * @param length {number} Current array length.
 * @param allowEnd {boolean} True for insertion, where `Idx == length` is valid.
 * @return {string} English diagnostic message.
 * @note Complexity O(1). Pure.
 * @satisfies REQ-197
 */
export function describeIndexRangeError(
  ownerPath: string,
  index: number,
  length: number,
  allowEnd: boolean
): string {
  const upper = allowEnd ? length : length - 1;
  const range = length === 0 && !allowEnd ? "none (the list is empty)" : `0..${upper}`;
  return `${ownerPath}: index ${index} is out of range; valid indices: ${range}; append with --set ${ownerPath}:+ <value>`;
}

/**
 * @brief Validates one candidate value against its parameter constraints.
 * @details Enforces the `enabled` CLI-name allowlist with canonical lowercase
 * normalization and duplicate rejection (REQ-221), the `enabledTools`
 * `*`/comma-list tool registry constraint (REQ-222), the `port` integer range
 * (REQ-222), the non-empty `host` constraint, the boolean `autoUpdate`
 * constraint, and the plain-string `apiKey` constraint (REQ-193).
 * @param parameter {ConfigParameter} Addressed parameter.
 * @param value {unknown} Candidate typed value.
 * @param context {ConfigSchemaContext} Supported CLI and tool name registries.
 * @return {{ ok: true; value: unknown } | { ok: false; error: string }} Normalized value or diagnostic.
 * @note Complexity O(n) in list length. Pure.
 * @satisfies REQ-206, REQ-221, REQ-222
 */
export function validateConfigValue(
  parameter: ConfigParameter,
  value: unknown,
  context: ConfigSchemaContext
): ConfigParseResult<unknown> {
  switch (parameter.token) {
    case "enabled": {
      if (!Array.isArray(value)) {
        return { ok: false, error: `must be a JSON array of CLI names, received ${formatConfigDisplayValue(value)}` };
      }
      const result: string[] = [];
      for (const item of value) {
        if (typeof item !== "string") {
          return { ok: false, error: `entry ${formatConfigDisplayValue(item)} is not a string` };
        }
        const target = resolveCliTarget(item);
        if (target === undefined && !context.cliNames.includes(item.trim().toLowerCase())) {
          return {
            ok: false,
            error: `entry "${item}" is not a supported CLI name; supported names: ${context.cliNames.join(", ")}`,
          };
        }
        const canonical = target?.id ?? item.trim().toLowerCase();
        if (result.includes(canonical)) {
          return { ok: false, error: `entry "${canonical}" is duplicated` };
        }
        result.push(canonical);
      }
      return { ok: true, value: result };
    }
    case "apiKey": {
      if (typeof value !== "string") {
        return { ok: false, error: `must be a string, received ${formatConfigDisplayValue(value)}` };
      }
      return { ok: true, value };
    }
    case "autoUpdate": {
      if (typeof value !== "boolean") {
        return { ok: false, error: `must be the JSON boolean true or false, received ${formatConfigDisplayValue(value)}` };
      }
      return { ok: true, value };
    }
    case "enabledTools": {
      if (typeof value !== "string") {
        return { ok: false, error: `must be a string, received ${formatConfigDisplayValue(value)}` };
      }
      const trimmed = value.trim();
      if (trimmed === "*") {
        return { ok: true, value: "*" };
      }
      const items = trimmed
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (items.length === 0) {
        return { ok: false, error: `must be "*" or a comma-separated tool list; accepted tools: ${context.toolNames.join(", ")}` };
      }
      const unknown = items.filter((item) => !context.toolNames.includes(item));
      if (unknown.length > 0) {
        return {
          ok: false,
          error: `unknown tool name(s): ${unknown.join(", ")}; accepted tools: ${context.toolNames.join(", ")} (or "*")`,
        };
      }
      return { ok: true, value: items.join(",") };
    }
    case "host": {
      if (typeof value !== "string" || value.trim().length === 0) {
        return { ok: false, error: `must be a non-empty hostname, received ${formatConfigDisplayValue(value)}` };
      }
      return { ok: true, value: value.trim() };
    }
    case "port": {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
        return { ok: false, error: `must be an integer in 1..65535, received ${formatConfigDisplayValue(value)}` };
      }
      return { ok: true, value };
    }
    default: {
      return { ok: false, error: `unsupported configuration parameter "${String(parameter.token)}"` };
    }
  }
}

/**
 * @brief Parses one raw `--set` argument into the addressed parameter type.
 * @details String parameters take the raw argument verbatim (`apiKey` may be
 * empty); every other type requires a valid JSON literal, so numbers and
 * booleans stay typed and malformed JSON fails without mutation (REQ-204,
 * REQ-206). A `StringArray` parameter requires a JSON array.
 * @param parameter {ConfigParameter} Addressed parameter.
 * @param raw {string} Raw argument text.
 * @param context {ConfigSchemaContext} Supported CLI and tool name registries.
 * @return {ConfigParseResult<unknown>} Parsed and validated value, or diagnostic.
 * @note Complexity O(n) in argument length. Pure.
 * @satisfies REQ-204, REQ-206
 */
export function parseConfigInput(
  parameter: ConfigParameter,
  raw: string,
  context: ConfigSchemaContext
): ConfigParseResult<unknown> {
  if (parameter.type === "String") {
    return validateConfigValue(parameter, raw, context);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const expected = parameter.type === "Boolean" ? "the JSON boolean true or false" : parameter.type === "Integer" ? "a JSON integer" : "a JSON array of CLI names";
    return { ok: false, error: `${parameter.token} expects ${expected}, received malformed JSON ${formatConfigDisplayValue(raw)}` };
  }
  return validateConfigValue(parameter, parsed, context);
}

/**
 * @brief Parses one raw `--set` argument as a single array element.
 * @details Used by `:+`, `:append`, `:insert:<Idx>`, and `:<Idx>` so a single
 * item is supplied per operation rather than an array (REQ-216).
 * @param parameter {ConfigParameter} Addressed `StringArray` parameter.
 * @param raw {string} Raw argument text carrying exactly one CLI name.
 * @param context {ConfigSchemaContext} Supported CLI and tool name registries.
 * @return {ConfigParseResult<string>} Canonical element, or diagnostic.
 * @note Complexity O(n). Pure.
 * @satisfies REQ-216, REQ-221
 */
export function parseConfigItem(
  parameter: ConfigParameter,
  raw: string,
  context: ConfigSchemaContext
): ConfigParseResult<string> {
  const validated = validateConfigValue(parameter, [raw], context);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }
  return { ok: true, value: (validated.value as string[])[0] };
}

/**
 * @brief Validates a complete candidate configuration document.
 * @details Reads every schema field, applies the schema default when the key is
 * absent, validates each value, and returns a normalized typed document. Unknown
 * keys are not part of the schema and are dropped on the next persistence
 * (REQ-206). Diagnostics name the offending canonical path.
 * @param document {unknown} Parsed JSON document.
 * @param context {ConfigSchemaContext} Supported CLI and tool name registries.
 * @return {ConfigParseResult<ConfigDocument>} Normalized document, or diagnostic.
 * @note Complexity O(parameters * value size). Pure.
 * @satisfies REQ-204, REQ-206
 */
export function validateConfigDocument(
  document: unknown,
  context: ConfigSchemaContext
): ConfigParseResult<ConfigDocument> {
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return { ok: false, error: "settings document must be a JSON object" };
  }
  const record = document as Record<string, unknown>;
  const settings: ConfigDocument = {
    enabled: [...CONFIG_DEFAULTS.enabled],
    apiKey: CONFIG_DEFAULTS.apiKey,
    autoUpdate: CONFIG_DEFAULTS.autoUpdate,
    enabledTools: CONFIG_DEFAULTS.enabledTools,
    host: CONFIG_DEFAULTS.host,
    port: CONFIG_DEFAULTS.port,
  };
  for (const section of CONFIG_SECTIONS) {
    for (const parameter of section.parameters) {
      const candidate = record[parameter.token];
      const value = candidate === undefined ? CONFIG_DEFAULTS[parameter.token] : candidate;
      const validated = validateConfigValue(parameter, value, context);
      if (!validated.ok) {
        return { ok: false, error: `${formatConfigPath(section, parameter)}: ${validated.error}` };
      }
      (settings as unknown as Record<string, unknown>)[parameter.token] = validated.value;
    }
  }
  return { ok: true, value: settings };
}

/**
 * @brief Copies a configuration document into a mutable independent object.
 * @param settings {ConfigDocument} Source document.
 * @return {ConfigDocument} Shallow copy with a copied `enabled` array.
 * @note Complexity O(n) in the `enabled` length. Pure.
 */
function copyConfigDocument(settings: ConfigDocument): ConfigDocument {
  return {
    enabled: [...settings.enabled],
    apiKey: settings.apiKey,
    autoUpdate: settings.autoUpdate,
    enabledTools: settings.enabledTools,
    host: settings.host,
    port: settings.port,
  };
}

/**
 * @brief Reads the value addressed by one resolved canonical path.
 * @details Section targets yield a JSON object in schema key order; parameter
 * targets yield the whole typed value; `index` targets yield one element;
 * `append`/`insert` are write-only and are rejected (REQ-198). Out-of-range
 * indices produce the REQ-197 diagnostic.
 * @param settings {ConfigDocument} Validated configuration document.
 * @param target {ConfigPathTarget} Resolved canonical path.
 * @return {ConfigParseResult<unknown>} Addressed value, or diagnostic.
 * @note Complexity O(1) plus O(n) for the section projection. Pure.
 * @satisfies REQ-196, REQ-197, REQ-198, REQ-203
 */
export function readConfigValue(settings: ConfigDocument, target: ConfigPathTarget): ConfigParseResult<unknown> {
  if (target.parameter === undefined) {
    const projection: Record<string, unknown> = {};
    for (const parameter of target.section.parameters) {
      projection[parameter.token] = settings[parameter.token];
    }
    return { ok: true, value: projection };
  }
  const parameter = target.parameter;
  const ownerPath = formatConfigPath(target.section, parameter);
  const value = settings[parameter.token];
  if (target.operation === "value") {
    return { ok: true, value };
  }
  if (target.operation !== "index") {
    return {
      ok: false,
      error: `${ownerPath}:${target.canonicalPath.split(":").slice(2).join(":")} is a write-only array operation and cannot be read; read ${ownerPath} instead`,
    };
  }
  const items = value as readonly unknown[];
  const index = target.index as number;
  if (index >= items.length) {
    return { ok: false, error: describeIndexRangeError(ownerPath, index, items.length, false) };
  }
  return { ok: true, value: items[index] };
}

/**
 * @brief Applies one `--set` operation to a configuration document.
 * @details Section targets require a full JSON object validated against the
 * schema; parameter targets parse the raw argument into the schema type;
 * `index` replaces one element, `append` appends one element, and `insert`
 * inserts one element at an in-range position (REQ-196, REQ-204, REQ-216).
 * @param settings {ConfigDocument} Currently validated document.
 * @param target {ConfigPathTarget} Resolved canonical path.
 * @param rawValue {string} Raw command-line value.
 * @param context {ConfigSchemaContext} Supported CLI and tool name registries.
 * @return {ConfigMutationResult} Mutated document plus confirmation, or diagnostic.
 * @note Complexity O(n) in the `enabled` length. Pure.
 * @satisfies REQ-196, REQ-197, REQ-204, REQ-216
 */
export function applyConfigSet(
  settings: ConfigDocument,
  target: ConfigPathTarget,
  rawValue: string,
  context: ConfigSchemaContext
): ConfigMutationResult {
  if (target.parameter === undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      return { ok: false, error: `${target.section.token} expects a JSON object, received malformed JSON ${formatConfigDisplayValue(rawValue)}` };
    }
    const validated = validateConfigDocument(parsed, context);
    if (!validated.ok) {
      return { ok: false, error: validated.error };
    }
    return { ok: true, settings: validated.value, description: `${target.section.token} replaced` };
  }
  const parameter = target.parameter;
  const ownerPath = formatConfigPath(target.section, parameter);
  const next = copyConfigDocument(settings);
  if (target.operation === "value") {
    const parsed = parseConfigInput(parameter, rawValue, context);
    if (!parsed.ok) {
      return { ok: false, error: `${ownerPath}: ${parsed.error}` };
    }
    (next as unknown as Record<string, unknown>)[parameter.token] = parsed.value;
    return {
      ok: true,
      settings: next,
      description: `${ownerPath} = ${formatConfigDisplayValue(parsed.value)}`,
    };
  }
  const items = next[parameter.token] as string[];
  if (target.operation === "append") {
    const parsed = parseConfigItem(parameter, rawValue, context);
    if (!parsed.ok) {
      return { ok: false, error: `${ownerPath}: ${parsed.error}` };
    }
    items.push(parsed.value);
    return {
      ok: true,
      settings: next,
      description: `${ownerPath}:${items.length - 1} = ${formatConfigDisplayValue(parsed.value)}`,
    };
  }
  if (target.operation === "insert") {
    const index = target.index as number;
    if (index > items.length) {
      return { ok: false, error: describeIndexRangeError(ownerPath, index, items.length, true) };
    }
    const parsed = parseConfigItem(parameter, rawValue, context);
    if (!parsed.ok) {
      return { ok: false, error: `${ownerPath}: ${parsed.error}` };
    }
    items.splice(index, 0, parsed.value);
    return {
      ok: true,
      settings: next,
      description: `${ownerPath}:${index} inserted ${formatConfigDisplayValue(parsed.value)}`,
    };
  }
  const index = target.index as number;
  if (index >= items.length) {
    return { ok: false, error: describeIndexRangeError(ownerPath, index, items.length, false) };
  }
  const parsed = parseConfigItem(parameter, rawValue, context);
  if (!parsed.ok) {
    return { ok: false, error: `${ownerPath}: ${parsed.error}` };
  }
  items[index] = parsed.value;
  return {
    ok: true,
    settings: next,
    description: `${ownerPath}:${index} = ${formatConfigDisplayValue(parsed.value)}`,
  };
}

/**
 * @brief Applies one `--unset` operation to a configuration document.
 * @details Section targets restore every schema default; parameter targets
 * restore the parameter default; `index` targets delete one element and compact
 * the remaining indices (REQ-196, REQ-205). Write-only operations are rejected
 * (REQ-198).
 * @param settings {ConfigDocument} Currently validated document.
 * @param target {ConfigPathTarget} Resolved canonical path.
 * @param context {ConfigSchemaContext} Supported CLI and tool name registries.
 * @return {ConfigMutationResult} Mutated document plus confirmation, or diagnostic.
 * @note Complexity O(n) in the `enabled` length. Pure.
 * @satisfies REQ-196, REQ-197, REQ-198, REQ-205
 */
export function applyConfigUnset(
  settings: ConfigDocument,
  target: ConfigPathTarget,
  context: ConfigSchemaContext
): ConfigMutationResult {
  if (target.parameter === undefined) {
    const defaults = validateConfigDocument({ ...CONFIG_DEFAULTS }, context);
    if (!defaults.ok) {
      return { ok: false, error: defaults.error };
    }
    return { ok: true, settings: defaults.value, description: `${target.section.token} restored to schema defaults` };
  }
  const parameter = target.parameter;
  const ownerPath = formatConfigPath(target.section, parameter);
  const next = copyConfigDocument(settings);
  if (target.operation === "value") {
    (next as unknown as Record<string, unknown>)[parameter.token] = Array.isArray(CONFIG_DEFAULTS[parameter.token])
      ? [...(CONFIG_DEFAULTS[parameter.token] as string[])]
      : CONFIG_DEFAULTS[parameter.token];
    return {
      ok: true,
      settings: next,
      description: `${ownerPath} restored to default ${formatConfigDisplayValue(CONFIG_DEFAULTS[parameter.token])}`,
    };
  }
  if (target.operation !== "index") {
    return {
      ok: false,
      error: `${target.canonicalPath} is a write-only array operation; --unset accepts ${ownerPath} or ${ownerPath}:<Idx>`,
    };
  }
  const items = next[parameter.token] as string[];
  const index = target.index as number;
  if (index >= items.length) {
    return { ok: false, error: describeIndexRangeError(ownerPath, index, items.length, false) };
  }
  items.splice(index, 1);
  return { ok: true, settings: next, description: `${target.canonicalPath} removed` };
}
