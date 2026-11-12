/**
 * @file cliInstaller.ts
 * @brief Orchestrate MCP-server registration and skill installation for enabled CLIs.
 * @details Loads the enabled-CLI settings, reads the packaged skills
 * manifest, and for each enabled CLI registers the stdio `mcp-google-api`
 * entry in that CLI's MCP configuration plus synchronizes every manifest
 * skill into that CLI's skills directory. Uninstallation is the exact
 * reciprocal operation. Per-CLI failures are collected without stopping the
 * remaining CLIs. Each manifest skill MAY declare a debug overlay file that
 * is installed only when debug skills are requested.
 * @satisfies PRJ-015, DES-020, REQ-114, REQ-115, REQ-116, REQ-152, REQ-155, REQ-156
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadCliSettings, MCP_SERVER_NAME } from "./cliSettings.js";
import {
  applyServerRegistration,
  CLI_TARGETS,
  type CliTargetId,
  type SkillContentLayout,
  removeSkillDir,
  syncSkillTree,
} from "./cliTargets.js";

/**
 * @brief One manifest skill entry from `skills/manifest.json`.
 * @details `id` names the packaged `<id>/` directory holding `SKILL.md`;
 * `debugPath` is the optional debug overlay path relative to that directory
 * (REQ-152).
 * @satisfies REQ-152
 */
export interface ManifestSkill {
  id: string;
  name: string;
  version: string;
  path: string;
  description: string;
  debugPath?: string;
}

/**
 * @brief Per-CLI outcome of one install or uninstall run.
 * @details `server` counts the MCP registration (0 or 1); `skills` counts
 * processed manifest skills for that CLI.
 */
export interface CliOperationSummary {
  cli: string;
  server: number;
  skills: number;
}

/**
 * @brief Aggregate outcome of one install or uninstall run.
 * @details Both lists are empty when no CLI is enabled (REQ-116, REQ-119).
 */
export interface CliOperationResult {
  summaries: CliOperationSummary[];
  errors: string[];
}

/**
 * @brief Build the stdio MCP-server registration entry.
 * @details Launcher `npx -y mcp-google-api start --stdio` with no `env`
 * payload: the registered server resolves its API key from its own
 * configuration file at startup (REQ-142), so CLI registrations never embed
 * keys or environment setup (REQ-114).
 * @return {object} Registration entry consumed by every supported CLI.
 * @satisfies REQ-114
 */
export function buildServerRegistration(): { command: string; args: string[] } {
  return { command: "npx", args: ["-y", MCP_SERVER_NAME, "start", "--stdio"] };
}

/**
 * @brief Resolve the packaged skills root for the running installation.
 * @details Checks `<packageRoot>/skills` — the layout used
 * both by from-source runs and by the published npm package, which ships the
 * same subtree at the package root (PKG-024).
 * @param packageRoot {string} Package installation root.
 * @return {string} Absolute skills resources root.
 * @throws {Error} When the skills root directory is missing.
 * @satisfies PKG-024
 */
export function resolveSkillsResourcesRoot(packageRoot: string): string {
  const candidate = resolve(packageRoot, "skills");
  if (!existsSync(candidate)) {
    throw new Error(`skills resources root not found: ${candidate}`);
  }
  return candidate;
}

/**
 * @brief Load and validate the packaged skills manifest.
 * @details Validates each entry's `id`, `path`, and optional `debug` overlay;
 * the overlay path is resolved relative to the skill directory. Malformed
 * overlay declarations and missing referenced files fail the whole manifest.
 * @param resourcesRoot {string} Skills resources root directory.
 * @return {ManifestSkill[]} Manifest entries in file order.
 * @throws {Error} When the manifest is missing, malformed, or lists a missing
 * `SKILL.md` or debug overlay path.
 * @satisfies REQ-152
 */
export function loadSkillsManifest(resourcesRoot: string): ManifestSkill[] {
  const manifestPath = join(resourcesRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`skills manifest not found: ${manifestPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (error: unknown) {
    throw new Error(`skills manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const skills = (parsed as { skills?: unknown } | null)?.skills;
  if (!Array.isArray(skills)) {
    throw new Error(`skills manifest has no skills array: ${manifestPath}`);
  }
  return skills.map((entry) => {
    const skill = entry as Partial<ManifestSkill> & { debug?: unknown };
    if (typeof skill.id !== "string" || typeof skill.path !== "string") {
      throw new Error(`skills manifest entry is missing id or path: ${manifestPath}`);
    }
    const skillFile = join(resourcesRoot, skill.path);
    if (!existsSync(skillFile)) {
      throw new Error(`manifest skill file not found: ${skillFile}`);
    }
    if (skill.debug !== undefined && (typeof skill.debug !== "string" || skill.debug.trim() === "")) {
      throw new Error(`manifest skill debug path is invalid: ${manifestPath}`);
    }
    const debugPath = typeof skill.debug === "string" ? skill.debug : undefined;
    if (debugPath !== undefined && !existsSync(join(dirname(resolve(skillFile)), debugPath))) {
      throw new Error(`manifest skill debug file not found: ${join(dirname(resolve(skillFile)), debugPath)}`);
    }
    return {
      id: skill.id,
      name: skill.name ?? skill.id,
      version: skill.version ?? "",
      path: skill.path,
      description: skill.description ?? "",
      ...(debugPath === undefined ? {} : { debugPath }),
    };
  });
}

/**
 * @brief Build the install layout of one manifest skill.
 * @details Resolves the declared debug overlay and whether its content must be
 * appended to the installed `SKILL.md` (REQ-155, REQ-156). Skills without a
 * declared overlay always resolve to the empty layout.
 * @param skill {ManifestSkill} Manifest skill entry.
 * @param includeDebug {boolean} True when `--debug-skills` was requested.
 * @return {SkillContentLayout} Layout consumed by `syncSkillTree`.
 * @satisfies REQ-155, REQ-156, REQ-157
 */
export function resolveSkillContentLayout(skill: ManifestSkill, includeDebug: boolean): SkillContentLayout {
  return {
    ...(skill.debugPath === undefined ? {} : { debugPath: skill.debugPath }),
    includeDebug: includeDebug && skill.debugPath !== undefined,
  };
}

/**
 * @brief Install the MCP server entry and every manifest skill per enabled CLI.
 * @details For each enabled CLI in settings order: registers the stdio entry
 * via `applyServerRegistration` (no key or environment payload; the server
 * reads its configuration file at startup, REQ-142), then synchronizes each
 * manifest skill directory `<resourcesRoot>/<skill-id>` into
 * `<skillsDir>/<skill-id>` with the resolved content layout: the declared
 * debug overlay is excluded as a standalone file and appended to the installed
 * `SKILL.md` only when `includeDebugSkills` is true.
 * Failures are collected per CLI and remaining CLIs still run.
 * @param options {object} `{ home?, resourcesRoot, includeDebugSkills? }`.
 * @return {CliOperationResult} Per-CLI summaries and failure diagnostics.
 * @throws {Error} When the skills manifest cannot be loaded (all CLIs fail).
 * @satisfies REQ-114, REQ-116, REQ-155, REQ-156, REQ-157
 */
export function installEnabledCliResources(options: {
  home?: string;
  resourcesRoot: string;
  includeDebugSkills?: boolean;
}): CliOperationResult {
  const manifest = loadSkillsManifest(options.resourcesRoot);
  const entry = buildServerRegistration();
  const result: CliOperationResult = { summaries: [], errors: [] };
  for (const cli of loadCliSettings(options.home).enabled) {
    const target = CLI_TARGETS[cli as CliTargetId];
    if (target === undefined) {
      result.errors.push(`Unsupported CLI: ${cli}`);
      continue;
    }
    try {
      applyServerRegistration(target, MCP_SERVER_NAME, entry, options.home);
      let skills = 0;
      for (const skill of manifest) {
        syncSkillTree(
          join(options.resourcesRoot, skill.id),
          join(target.skillsDir(options.home), skill.id),
          resolveSkillContentLayout(skill, options.includeDebugSkills === true)
        );
        skills += 1;
      }
      result.summaries.push({ cli: target.id, server: 1, skills });
    } catch (error: unknown) {
      result.errors.push(`${target.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

/**
 * @brief Remove the MCP server entry and managed skills per enabled CLI.
 * @details Reciprocal of `installEnabledCliResources`: removes the managed
 * server entry and deletes each manifest skill directory. Missing entries
 * count as removed without failure; per-CLI failures are collected and
 * remaining CLIs still run.
 * @param options {object} `{ home?, resourcesRoot }`.
 * @return {CliOperationResult} Per-CLI summaries and failure diagnostics.
 * @throws {Error} When the skills manifest cannot be loaded (all CLIs fail).
 * @satisfies REQ-115, REQ-116
 */
export function uninstallEnabledCliResources(options: {
  home?: string;
  resourcesRoot: string;
}): CliOperationResult {
  const manifest = loadSkillsManifest(options.resourcesRoot);
  const result: CliOperationResult = { summaries: [], errors: [] };
  for (const cli of loadCliSettings(options.home).enabled) {
    const target = CLI_TARGETS[cli as CliTargetId];
    if (target === undefined) {
      result.errors.push(`Unsupported CLI: ${cli}`);
      continue;
    }
    try {
      applyServerRegistration(target, MCP_SERVER_NAME, undefined, options.home);
      let skills = 0;
      for (const skill of manifest) {
        removeSkillDir(join(target.skillsDir(options.home), skill.id));
        skills += 1;
      }
      result.summaries.push({ cli: target.id, server: 0, skills });
    } catch (error: unknown) {
      result.errors.push(`${target.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
