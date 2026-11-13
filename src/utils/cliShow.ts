/**
 * @file cliShow.ts
 * @brief Render the CLI Configuration and Installation Status report tables.
 * @details Builds the human-readable `show` output: a CLI Configuration
 * table covering every supported CLI (enabled state, MCP configuration
 * path, skills destination path) and an Installation Status table listing
 * the managed MCP server and every manifest skill per enabled CLI with
 * OK / MISSING / STALE detection. Both tables render as box-drawing grids
 * (REQ-185, REQ-186).
 * @satisfies REQ-117, REQ-118, REQ-119, REQ-185, REQ-186
 */

import { join } from "node:path";
import { loadCliSettings, MCP_SERVER_NAME } from "./cliSettings.js";
import {
  CLI_TARGETS,
  compareSkillTree,
  readServerRegistration,
  type CliTargetId,
  type McpServerRegistration,
} from "./cliTargets.js";
import { loadSkillsManifest } from "./cliInstaller.js";
import {
  compareServerRegistration,
  formatServerRegistration,
  resolveInstalledLauncher,
  toHomeReference,
  type InstalledLauncherDeps,
} from "./installedLauncher.js";

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
 * @brief Render a box-drawing grid table with aligned and wrapped cells.
 * @details Column widths are the longest cell capped by `maxWidth`; the
 * header row is framed by the `┌─┬┐` top border and the `├─┼┤` separator,
 * data rows are emitted as `│`-delimited lines without inter-row borders,
 * the table closes with the `└─┴┘` bottom border, and multi-line cells are
 * padded to the row height (REQ-185, REQ-186).
 * @param headers {string[]} Column header labels.
 * @param rows {string[][]} Row cell values.
 * @param maxWidth {number} Maximum column width in characters.
 * @return {string} Rendered table text without trailing newline.
 * @satisfies REQ-185, REQ-186
 */
export function renderAsciiTable(headers: string[], rows: string[][], maxWidth = MAX_CELL_WIDTH): string {
  const widths = headers.map((header, index) => {
    const lengths = [header.length, ...rows.map((row) => (row[index] ?? "").length)];
    return Math.max(1, Math.min(Math.max(...lengths), Math.max(1, maxWidth)));
  });
  const borderLine = (left: string, middle: string, right: string): string =>
    left + widths.map((width) => "─".repeat(width + 2)).join(middle) + right;
  const renderRow = (cells: string[]): string[] => {
    const wrapped = cells.map((cell, index) => wrapCell(cell ?? "", widths[index]));
    const height = Math.max(...wrapped.map((part) => part.length));
    const lines: string[] = [];
    for (let line = 0; line < height; line += 1) {
      const parts = wrapped.map((part, index) => (part[line] ?? "").padEnd(widths[index]));
      lines.push("│ " + parts.join(" │ ") + " │");
    }
    return lines;
  };
  const output = [borderLine("┌", "┬", "┐"), ...renderRow(headers), borderLine("├", "┼", "┤")];
  for (const row of rows) {
    output.push(...renderRow(row));
  }
  output.push(borderLine("└", "┴", "┘"));
  return output.join("\n");
}

/**
 * @brief Build the CLI Configuration table rows.
 * @details One row per supported CLI in alphabetical registry order
 * (antigravity, claude, codex, copilot, openclaw, opencode, pi; REQ-117):
 * enabled yes/no, `~/`-rooted MCP configuration path, and `~/`-rooted skills
 * directory (REQ-240).
 * @param home {string | undefined} Home-directory override.
 * @return {string[][]} `(CLI, Enabled, MCP Config Path, Skills Config Path)` rows.
 * @satisfies REQ-117, REQ-240
 */
function buildCliRows(home?: string): string[][] {
  const enabled = new Set(loadCliSettings(home).enabled);
  return (Object.keys(CLI_TARGETS) as CliTargetId[]).map((id) => {
    const target = CLI_TARGETS[id];
    return [
      target.id,
      enabled.has(id) ? "yes" : "no",
      toHomeReference(target.mcpConfigPath(home), home),
      toHomeReference(target.skillsDir(home), home),
    ];
  });
}

/**
 * @brief Build the Installation Status table rows.
 * @details Emits rows only for enabled CLIs: one `Server` row for the
 * managed `mcp-google-api` entry plus one `Skill` row per manifest skill,
 * each with OK / MISSING / STALE detection. The server row compares the
 * stored launcher with the resolved global launcher and renders the stored
 * command line in the `Launcher` column with `~/`-rooted home references
 * (REQ-118, REQ-237, REQ-240). Skill comparison accepts both the plain and the
 * debug-overlay-extended installed `SKILL.md` (REQ-158).
 * @param home {string | undefined} Home-directory override.
 * @param resourcesRoot {string} Packaged skills resources root.
 * @param expected {McpServerRegistration | undefined} Resolved global launcher; omitted when unresolvable.
 * @return {string[][]} `(Type, Name, CLI, Enabled, Installed, Launcher)` rows.
 * @satisfies REQ-118, REQ-158, REQ-237, REQ-240, REQ-241
 */
function buildInstallRows(
  home: string | undefined,
  resourcesRoot: string,
  expected: McpServerRegistration | undefined
): string[][] {
  const enabled = loadCliSettings(home).enabled;
  const manifest = loadSkillsManifest(resourcesRoot);
  const rows: string[][] = [];
  for (const cli of enabled) {
    const target = CLI_TARGETS[cli as CliTargetId];
    if (target === undefined) continue;
    const binding = readServerRegistration(target, MCP_SERVER_NAME, home);
    rows.push([
      "Server",
      MCP_SERVER_NAME,
      target.id,
      "yes",
      compareServerRegistration(binding, expected, home),
      formatServerRegistration(binding, home),
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
        "",
      ]);
    }
  }
  return rows;
}

/**
 * @brief Resolve the launcher `show` compares stored bindings against.
 * @details Returns the injected launcher unchanged, otherwise resolves the
 * global installation tolerantly: an unresolvable root yields undefined so
 * the table degrades to presence-only status instead of failing (REQ-237).
 * @param options {object} `{ launcher?, launcherResolutionDeps? }`.
 * @return {McpServerRegistration | undefined} Expected global launcher, when available.
 * @note Complexity O(1) plus one child round-trip on the resolution path.
 * @satisfies REQ-237
 */
function resolveExpectedLauncher(options: {
  launcher?: McpServerRegistration;
  launcherResolutionDeps?: InstalledLauncherDeps;
}): McpServerRegistration | undefined {
  if (options.launcher !== undefined) {
    return options.launcher;
  }
  const resolution = resolveInstalledLauncher(options.launcherResolutionDeps ?? {});
  return resolution.ok ? resolution.launcher : undefined;
}

/**
 * @brief Build the complete `show` report text.
 * @details Renders the CLI Configuration table (always, REQ-119) and the
 * Installation Status table (empty when no CLI is enabled), in this order,
 * separated by a blank line. The Installation Status table carries the
 * `Launcher` column and marks a stored binding `STALE` when it differs from
 * the resolved global launcher (REQ-118, REQ-237). Manifest load failures
 * propagate so the command handler reports a JSON error.
 * @param options {object} `{ home?, resourcesRoot, launcher?, launcherResolutionDeps? }`.
 * @return {string} Report text with two titled tables.
 * @throws {Error} When the skills manifest cannot be loaded.
 * @satisfies REQ-117, REQ-118, REQ-119, REQ-237
 */
export function buildCliShowReport(options: {
  home?: string;
  resourcesRoot: string;
  launcher?: McpServerRegistration;
  launcherResolutionDeps?: InstalledLauncherDeps;
}): string {
  const expected = resolveExpectedLauncher(options);
  return [
    "CLI Configuration",
    renderAsciiTable(["CLI", "Enabled", "MCP Config Path", "Skills Config Path"], buildCliRows(options.home)),
    "",
    "Installation Status",
    renderAsciiTable(
      ["Type", "Name", "CLI", "Enabled", "Installed", "Launcher"],
      buildInstallRows(options.home, options.resourcesRoot, expected)
    ),
  ].join("\n");
}

export { STATUS_OK, STATUS_MISSING, STATUS_STALE };
