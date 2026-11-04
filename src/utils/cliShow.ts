/**
 * @file cliShow.ts
 * @brief Render the CLI Configuration and Installation Status report tables.
 * @details Builds the human-readable `show` output: a CLI Configuration
 * table covering every supported CLI (enabled state, MCP configuration
 * path, skills destination path) and an Installation Status table listing
 * the managed MCP server and every manifest skill per enabled CLI with
 * OK / MISSING / STALE detection.
 * @satisfies REQ-117, REQ-118, REQ-119
 */

import { join } from "node:path";
import { relative, resolve } from "node:path";
import { loadCliSettings, MCP_SERVER_NAME } from "./cliSettings.js";
import { CLI_TARGETS, compareSkillTree, isServerRegistered, type CliTargetId } from "./cliTargets.js";
import { loadSkillsManifest } from "./cliInstaller.js";

/**
 * @brief Maximum rendered width of one table cell in characters.
 * @details Long values wrap on word boundaries, mirroring the reference
 * `skills show` renderer.
 */
const MAX_CELL_WIDTH = 48;

/**
 * @brief Status value for a resource whose destination matches the package.
 */
const STATUS_OK = "OK";
/** @brief Status value for a resource with a missing destination. */
const STATUS_MISSING = "MISSING";
/** @brief Status value for a resource whose destination differs from the package. */
const STATUS_STALE = "STALE";

/**
 * @brief Wrap one cell value into fixed-width lines on word boundaries.
 * @details Collapses whitespace, splits overlong tokens into `width`-sized
 * chunks, and greedily packs words without exceeding `width`.
 * @param text {string} Cell value to wrap.
 * @param width {number} Maximum line width in characters; MUST be positive.
 * @return {string[]} Rendered lines; `[""]` for an empty value.
 */
function wrapCell(text: string, width: number): string[] {
  const normalized = String(text).split(/\s+/).filter((word) => word.length > 0);
  if (normalized.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (let word of normalized) {
    while (word.length > width) {
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/**
 * @brief Render an ASCII grid table with aligned and wrapped cells.
 * @details Column widths are the longest cell capped by `maxWidth`; every
 * row is emitted between `+---+` borders and multi-line cells are padded to
 * the row height.
 * @param headers {string[]} Column header labels.
 * @param rows {string[][]} Row cell values.
 * @param maxWidth {number} Maximum column width in characters.
 * @return {string} Rendered table text without trailing newline.
 */
export function renderAsciiTable(headers: string[], rows: string[][], maxWidth = MAX_CELL_WIDTH): string {
  const widths = headers.map((header, index) => {
    const lengths = [header.length, ...rows.map((row) => (row[index] ?? "").length)];
    return Math.max(1, Math.min(Math.max(...lengths), Math.max(1, maxWidth)));
  });
  const border = "+" + widths.map((width) => "-".repeat(width + 2)).join("+") + "+";
  const renderRow = (cells: string[]): string[] => {
    const wrapped = cells.map((cell, index) => wrapCell(cell ?? "", widths[index]));
    const height = Math.max(...wrapped.map((part) => part.length));
    const lines: string[] = [];
    for (let line = 0; line < height; line += 1) {
      const parts = wrapped.map((part, index) => (part[line] ?? "").padEnd(widths[index]));
      lines.push("| " + parts.join(" | ") + " |");
    }
    return lines;
  };
  const output = [border, ...renderRow(headers), border];
  for (const row of rows) {
    output.push(...renderRow(row));
    output.push(border);
  }
  return output.join("\n");
}

/**
 * @brief Build the CLI Configuration table rows.
 * @details One row per supported CLI in registry order: enabled yes/no,
 * home-relative MCP configuration path, and home-relative skills directory.
 * @param home {string | undefined} Home-directory override.
 * @return {string[][]} `(CLI, Enabled, MCP Config Path, Skills Config Path)` rows.
 * @satisfies REQ-117
 */
function buildCliRows(home?: string): string[][] {
  const root = home ?? (process.env.HOME ?? process.cwd());
  const enabled = new Set(loadCliSettings(home).enabled);
  return (Object.keys(CLI_TARGETS) as CliTargetId[]).map((id) => {
    const target = CLI_TARGETS[id];
    return [
      target.id,
      enabled.has(id) ? "yes" : "no",
      relative(resolve(root), resolve(target.mcpConfigPath(home))).split("\\").join("/"),
      relative(resolve(root), resolve(target.skillsDir(home))).split("\\").join("/"),
    ];
  });
}

/**
 * @brief Build the Installation Status table rows.
 * @details Emits rows only for enabled CLIs: one `Server` row for the
 * managed `mcp-google-map` entry plus one `Skill` row per manifest skill,
 * each with OK / MISSING / STALE detection. Skill comparison accepts both
 * the plain and the debug-overlay-extended installed `SKILL.md` (REQ-158).
 * @param home {string | undefined} Home-directory override.
 * @param resourcesRoot {string} Packaged skills resources root.
 * @return {string[][]} `(Type, Name, CLI, Enabled, Installed)` rows.
 * @satisfies REQ-118, REQ-158
 */
function buildInstallRows(home: string | undefined, resourcesRoot: string): string[][] {
  const enabled = loadCliSettings(home).enabled;
  const manifest = loadSkillsManifest(resourcesRoot);
  const rows: string[][] = [];
  for (const cli of enabled) {
    const target = CLI_TARGETS[cli as CliTargetId];
    if (target === undefined) continue;
    rows.push([
      "Server",
      MCP_SERVER_NAME,
      target.id,
      "yes",
      isServerRegistered(target, MCP_SERVER_NAME, home) ? STATUS_OK : STATUS_MISSING,
    ]);
    for (const skill of manifest) {
      rows.push([
        "Skill",
        skill.id,
        target.id,
        "yes",
        compareSkillTree(join(resourcesRoot, skill.id), join(target.skillsDir(home), skill.id), {
          ...(skill.debugPath === undefined ? {} : { debugPath: skill.debugPath }),
        }),
      ]);
    }
  }
  return rows;
}

/**
 * @brief Build the complete `show` report text.
 * @details Renders the CLI Configuration table (always, REQ-119) and the
 * Installation Status table (empty when no CLI is enabled), in this order,
 * separated by a blank line. Manifest load failures propagate so the command
 * handler reports a JSON error.
 * @param options {object} `{ home?, resourcesRoot }`.
 * @return {string} Report text with two titled tables.
 * @throws {Error} When the skills manifest cannot be loaded.
 * @satisfies REQ-117, REQ-118, REQ-119
 */
export function buildCliShowReport(options: { home?: string; resourcesRoot: string }): string {
  return [
    "CLI Configuration",
    renderAsciiTable(["CLI", "Enabled", "MCP Config Path", "Skills Config Path"], buildCliRows(options.home)),
    "",
    "Installation Status",
    renderAsciiTable(["Type", "Name", "CLI", "Enabled", "Installed"], buildInstallRows(options.home, options.resourcesRoot)),
  ].join("\n");
}

export { STATUS_OK, STATUS_MISSING, STATUS_STALE };
