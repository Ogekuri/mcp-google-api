/**
 * @file configView.ts
 * @brief Builds the `--print` and `--info` configuration trees from the schema.
 * @details Both views share one node model and one renderer
 * (`src/utils/configRenderer.ts`); only headings and attached detail formatters
 * differ (DES-027, DES-029). Trees are built exclusively from schema nodes and
 * typed values, never from rendered strings or hard-coded fragments
 * (DES-029). `--print` shows current values (REQ-200, REQ-213, REQ-214);
 * `--info` shows schema documentation with complete, schema-valid example
 * commands (REQ-201, REQ-215, REQ-216).
 * @note Pure module: no I/O, no process access.
 * @satisfies DES-027, DES-029, REQ-200, REQ-201
 */

import {
  CONFIG_DEFAULTS,
  CONFIG_ROOT_LABEL,
  CONFIG_SECTIONS,
  describeConfigType,
  formatConfigDisplayValue,
  formatConfigPath,
  parseConfigPath,
  type ConfigDocument,
  type ConfigParameter,
  type ConfigSchemaContext,
  type ConfigSection,
} from "./configSchema.js";
import {
  asConfigTableDetail,
  renderConfigTable,
  type ConfigDetail,
  type ConfigRenderNode,
} from "./configRenderer.js";

/**
 * @brief English meaning of every supported CLI agent token.
 * @details Rendered inside the `enabled` `Allowed Values` table so the token
 * stays byte-identical to the schema and the description follows it
 * (REQ-210, REQ-219).
 * @satisfies REQ-219
 */
const CLI_MEANINGS: Readonly<Record<string, string>> = {
  antigravity: "Antigravity agent",
  claude: "Claude Code CLI",
  codex: "Codex CLI",
  copilot: "GitHub Copilot CLI",
  openclaw: "OpenClaw agent",
  opencode: "OpenCode CLI",
  pi: "pi coding agent",
};

/**
 * @brief Result of building one configuration view.
 * @details `ok: false` carries an English diagnostic for stderr (REQ-208).
 * @satisfies REQ-208
 */
export type ConfigViewResult =
  | { readonly ok: true; readonly root: ConfigRenderNode }
  | { readonly ok: false; readonly error: string };

/**
 * @brief Quotes one published `--info` example value for the shell.
 * @details JSON arrays/objects are wrapped in single quotes; booleans and
 * numbers stay bare JSON literals; plain strings are double-quoted with
 * backslash and quote escapes (REQ-215, REQ-216). Examples never carry prose
 * notes so every published command is copy/pasteable.
 * @param value {unknown} Schema-valid example value.
 * @return {string} Shell-quoted literal.
 * @note Complexity O(n). Pure.
 * @satisfies REQ-215, REQ-216
 */
export function quoteShellLiteral(value: unknown): string {
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return `'${JSON.stringify(value)}'`;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * @brief Builds the heading of one section node.
 * @details `Token - [Path: <canonical path>] Description` keeps the token
 * byte-identical and places the canonical path badge on the heading line
 * (REQ-210, REQ-211).
 * @param section {ConfigSection} Section node.
 * @return {string} Marker-free heading text.
 * @note Complexity O(n). Pure.
 * @satisfies REQ-210, REQ-211
 */
function sectionHeading(section: ConfigSection): string {
  return `${section.token} - [Path: ${section.token}] ${section.description}`;
}

/**
 * @brief Builds the `--print` node of one section and its real children.
 * @details Children are the schema parameters in declaration order; each
 * parameter node carries its own value rendering plus attached tables or action
 * hints (REQ-200, REQ-213, REQ-214).
 * @param settings {ConfigDocument} Current typed configuration.
 * @param section {ConfigSection} Section node.
 * @param context {ConfigSchemaContext} Supported CLI and tool name registries.
 * @return {ConfigRenderNode} Section node with real children.
 * @note Complexity O(parameters). Pure.
 * @satisfies REQ-200, REQ-213, REQ-214
 */
function buildPrintSectionNode(
  settings: ConfigDocument,
  section: ConfigSection,
  context: ConfigSchemaContext
): ConfigRenderNode {
  return {
    heading: sectionHeading(section),
    details: [],
    children: section.parameters.map((parameter) => buildPrintParameterNode(settings, section, parameter, context)),
  };
}

/**
 * @brief Builds the `--print` node of one parameter.
 * @details Scalars render `Token = <value> (default)` or
 * `Token = <value> (custom | default: <JSON default>)` with strings JSON-quoted
 * (REQ-213). The `enabled` array renders `(N items | row target: ... | add: ...)`
 * with an `Idx | Value` table, or an empty-list hint carrying a complete `--set`
 * command when empty (REQ-214, REQ-218).
 * @param settings {ConfigDocument} Current typed configuration.
 * @param section {ConfigSection} Owning section.
 * @param parameter {ConfigParameter} Addressed parameter.
 * @param context {ConfigSchemaContext} Supported CLI and tool name registries.
 * @return {ConfigRenderNode} Parameter node with attached details.
 * @note Complexity O(n) in collection size. Pure.
 * @satisfies REQ-213, REQ-214, REQ-218
 */
function buildPrintParameterNode(
  settings: ConfigDocument,
  section: ConfigSection,
  parameter: ConfigParameter,
  context: ConfigSchemaContext
): ConfigRenderNode {
  const ownerPath = formatConfigPath(section, parameter);
  const value = settings[parameter.token];
  const defaultValue = CONFIG_DEFAULTS[parameter.token];
  if (parameter.type === "StringArray") {
    const items = value as readonly string[];
    const exampleItem = (parameter.example as readonly string[])[0] ?? "pi";
    if (items.length === 0) {
      return {
        heading: `${parameter.token} = (empty list | add: --set ${ownerPath}:+ ${quoteShellLiteral(exampleItem)})`,
        details: [],
        children: [],
      };
    }
    return {
      heading: `${parameter.token} = (${items.length} ${items.length === 1 ? "item" : "items"} | row target: ${ownerPath}:<Idx> | add: ${ownerPath}:+)`,
      details: asConfigTableDetail({
        headers: ["Idx", "Value"],
        rows: items.map((item, index) => [String(index), formatConfigDisplayValue(item)]),
      }),
      children: [],
    };
  }
  void context;
  const status =
    formatConfigDisplayValue(value) === formatConfigDisplayValue(defaultValue)
      ? "(default)"
      : `(custom | default: ${formatConfigDisplayValue(defaultValue)})`;
  return {
    heading: `${parameter.token} = ${formatConfigDisplayValue(value)} ${status}`,
    details: [],
    children: [],
  };
}

/**
 * @brief Builds the `Allowed Values` table of the `enabled` parameter.
 * @details One row per supported CLI in registry order with the schema token,
 * whether it belongs to the default set, its English meaning, and a complete
 * append command (REQ-215, REQ-216, REQ-221).
 * @param section {ConfigSection} Owning section.
 * @param parameter {ConfigParameter} Addressed parameter.
 * @param context {ConfigSchemaContext} Supported CLI name registry.
 * @return {ConfigTable} `Value | Default | Meaning | Set cmd` rows.
 * @note Complexity O(cli names). Pure.
 * @satisfies REQ-215, REQ-216, REQ-221
 */
function enabledAllowedValuesTable(
  section: ConfigSection,
  parameter: ConfigParameter,
  context: ConfigSchemaContext
): { headers: string[]; rows: string[][] } {
  const ownerPath = formatConfigPath(section, parameter);
  return {
    headers: ["Value", "Default", "Meaning", "Set cmd"],
    rows: context.cliNames.map((name) => [
      name,
      CONFIG_DEFAULTS.enabled.includes(name) ? "yes" : "no",
      CLI_MEANINGS[name] ?? "CLI agent",
      `--set ${ownerPath}:+ ${quoteShellLiteral(name)}`,
    ]),
  };
}

/**
 * @brief Builds the `Allowed Values` table of the `enabledTools` parameter.
 * @details Row `*` documents the full registry and every registered tool name
 * follows as its own token row (REQ-215, REQ-222).
 * @param context {ConfigSchemaContext} Registered tool name registry.
 * @return {ConfigTable} `Value | Meaning` rows.
 * @note Complexity O(tool names). Pure.
 * @satisfies REQ-215, REQ-222
 */
function enabledToolsAllowedValuesTable(context: ConfigSchemaContext): { headers: string[]; rows: string[][] } {
  return {
    headers: ["Value", "Meaning"],
    rows: [
      ["*", `all ${context.toolNames.length} registered tools`],
      ...context.toolNames.map((name) => [name, "registered MCP tool"]),
    ],
  };
}

/**
 * @brief Builds the `--info` node of one section and its real children.
 * @details The section shows its canonical path badge plus a complete
 * `Reset block` command before its real children (REQ-211, REQ-215).
 * @param section {ConfigSection} Section node.
 * @param context {ConfigSchemaContext} Supported CLI and tool name registries.
 * @return {ConfigRenderNode} Section node with real children.
 * @note Complexity O(parameters). Pure.
 * @satisfies REQ-211, REQ-215
 */
function buildInfoSectionNode(section: ConfigSection, context: ConfigSchemaContext): ConfigRenderNode {
  return {
    heading: sectionHeading(section),
    details: [{ lines: [`Reset block : --unset ${section.token}`] }],
    children: section.parameters.map((parameter) => buildInfoParameterNode(section, parameter, context)),
  };
}

/**
 * @brief Builds the `--info` node of one parameter.
 * @details Heading `Token - [Type: constraints] description` followed by a
 * `Default` detail carrying its restoring `--unset` command and a `Set cmd`
 * detail with a schema-valid shell-quoted example (REQ-215). Array parameters
 * additionally publish overwrite, append, insert, replace, delete, and reset
 * commands whose item arguments carry exactly one element (REQ-216).
 * @param section {ConfigSection} Owning section.
 * @param parameter {ConfigParameter} Addressed parameter.
 * @param context {ConfigSchemaContext} Supported CLI and tool name registries.
 * @return {ConfigRenderNode} Parameter node with attached details.
 * @note Complexity O(n) in registry size. Pure.
 * @satisfies REQ-215, REQ-216, REQ-222
 */
function buildInfoParameterNode(
  section: ConfigSection,
  parameter: ConfigParameter,
  context: ConfigSchemaContext
): ConfigRenderNode {
  const ownerPath = formatConfigPath(section, parameter);
  const heading = `${parameter.token} - ${describeConfigType(parameter)} ${parameter.description}`;
  const details: ConfigDetail[] = [
    {
      lines: [
        `Default : ${formatConfigDisplayValue(CONFIG_DEFAULTS[parameter.token])} (restored via: --unset ${ownerPath})`,
      ],
    },
  ];
  if (parameter.token === "enabled") {
    const exampleItem = quoteShellLiteral((parameter.example as readonly string[])[0] ?? "pi");
    const exampleArray = quoteShellLiteral(parameter.example);
    details.push(
      { lines: [`Add item : --set ${ownerPath}:+ ${exampleItem}`] },
      { lines: [`Insert item : --set ${ownerPath}:insert:0 ${exampleItem}`] },
      { lines: [`Replace item : --set ${ownerPath}:0 ${exampleItem}`] },
      { lines: [`Delete item : --unset ${ownerPath}:0`] },
      { lines: [`Full overwrite : --set ${ownerPath} ${exampleArray}`] },
      { lines: [`Reset array : --unset ${ownerPath}`] },
      { lines: ["Allowed Values:"] }
    );
    const table = enabledAllowedValuesTable(section, parameter, context);
    details.push({ lines: renderConfigTable(table) });
    return { heading, details, children: [] };
  }
  details.push({ lines: [`Set cmd : --set ${ownerPath} ${quoteShellLiteral(parameter.example)}`] });
  if (parameter.token === "enabledTools") {
    details.push({ lines: ["Allowed Values:"] });
    details.push({ lines: renderConfigTable(enabledToolsAllowedValuesTable(context)) });
  }
  return { heading, details, children: [] };
}

/**
 * @brief Builds the `--print` view of the whole configuration or one target.
 * @details Absent path renders the complete tree under the virtual
 * `Application_Configuration` heading; a section path renders that section as the
 * unconnected root; a parameter path renders that parameter alone with its
 * attached details (REQ-200, REQ-212). Write-only array operations cannot be
 * printed and yield a diagnostic naming the readable path (REQ-198).
 * @param settings {ConfigDocument} Current typed configuration.
 * @param context {ConfigSchemaContext} Supported CLI and tool name registries.
 * @param path {string | undefined} Raw optional path argument.
 * @return {ConfigViewResult} Display root, or diagnostic.
 * @note Complexity O(nodes). Pure.
 * @satisfies REQ-198, REQ-200, REQ-212
 */
export function buildConfigPrintView(
  settings: ConfigDocument,
  context: ConfigSchemaContext,
  path?: string
): ConfigViewResult {
  const raw = (path ?? "").trim();
  if (raw.length === 0) {
    return {
      ok: true,
      root: {
        heading: `${CONFIG_ROOT_LABEL} - Current configuration`,
        details: [],
        children: CONFIG_SECTIONS.map((section) => buildPrintSectionNode(settings, section, context)),
      },
    };
  }
  const parsed = parseConfigPath(raw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const target = parsed.target;
  if (target.parameter === undefined) {
    return { ok: true, root: buildPrintSectionNode(settings, target.section, context) };
  }
  if (target.operation !== "value") {
    return {
      ok: false,
      error: `${target.canonicalPath} is a write-only array operation and has no printable value; print ${formatConfigPath(target.section, target.parameter)} instead`,
    };
  }
  return { ok: true, root: buildPrintParameterNode(settings, target.section, target.parameter, context) };
}

/**
 * @brief Builds the `--info` view of the whole schema or one target.
 * @details Same node set and renderer as `--print`; only headings and details
 * change (REQ-201, REQ-212). Write-only array operations cannot be documented
 * directly and yield a diagnostic naming the documented path (REQ-198).
 * @param context {ConfigSchemaContext} Supported CLI and tool name registries.
 * @param path {string | undefined} Raw optional path argument.
 * @return {ConfigViewResult} Display root, or diagnostic.
 * @note Complexity O(nodes). Pure.
 * @satisfies REQ-198, REQ-201, REQ-212
 */
export function buildConfigInfoView(context: ConfigSchemaContext, path?: string): ConfigViewResult {
  const raw = (path ?? "").trim();
  if (raw.length === 0) {
    return {
      ok: true,
      root: {
        heading: `${CONFIG_ROOT_LABEL} - Configuration schema`,
        details: [],
        children: CONFIG_SECTIONS.map((section) => buildInfoSectionNode(section, context)),
      },
    };
  }
  const parsed = parseConfigPath(raw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const target = parsed.target;
  if (target.parameter === undefined) {
    return { ok: true, root: buildInfoSectionNode(target.section, context) };
  }
  if (target.operation !== "value") {
    return {
      ok: false,
      error: `${target.canonicalPath} is a write-only array operation and has no schema node of its own; document ${formatConfigPath(target.section, target.parameter)} instead`,
    };
  }
  return { ok: true, root: buildInfoParameterNode(target.section, target.parameter, context) };
}
