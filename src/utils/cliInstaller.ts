/**
 * @file cliInstaller.ts
 * @brief Orchestrate MCP-server registration and skill installation for enabled CLIs.
 * @details Loads the enabled-CLI settings, reads the packaged skills
 * manifest, and for each enabled CLI registers the stdio `mcp-google-map`
 * entry in that CLI's MCP configuration plus synchronizes every manifest
 * skill into that CLI's skills directory. Uninstallation is the exact
 * reciprocal operation. Per-CLI failures are collected without stopping the
 * remaining CLIs.
 * @satisfies PRJ-015, DES-020, REQ-114, REQ-115, REQ-116
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadCliSettings, MCP_SERVER_NAME } from "./cliSettings.js";
import {
  applyServerRegistration,
  CLI_TARGETS,
  type CliTargetId,
  removeSkillDir,
  syncSkillTree,
} from "./cliTargets.js";

/**
 * @brief One manifest skill entry from `src/resources/skills/manifest.json`.
 * @details `id` names the packaged `<id>/` directory holding `SKILL.md`.
 */
export interface ManifestSkill {
  id: string;
  name: string;
  version: string;
  path: string;
  description: string;
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
 * @details Launcher `npx -y mcp-google-map start --stdio` with no `env`
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
 * @details Checks `<packageRoot>/src/resources/skills` — the layout used
 * both by from-source runs and by the published npm package, which ships the
 * same subtree (PKG-024).
 * @param packageRoot {string} Package installation root.
 * @return {string} Absolute skills resources root.
 * @throws {Error} When the skills root directory is missing.
 */
export function resolveSkillsResourcesRoot(packageRoot: string): string {
  const candidate = resolve(packageRoot, "src", "resources", "skills");
  if (!existsSync(candidate)) {
    throw new Error(`skills resources root not found: ${candidate}`);
  }
  return candidate;
}

/**
 * @brief Load and validate the packaged skills manifest.
 * @param resourcesRoot {string} Skills resources root directory.
 * @return {ManifestSkill[]} Manifest entries in file order.
 * @throws {Error} When the manifest is missing, malformed, or lists a missing
 * `SKILL.md` path.
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
    const skill = entry as Partial<ManifestSkill>;
    if (typeof skill.id !== "string" || typeof skill.path !== "string") {
      throw new Error(`skills manifest entry is missing id or path: ${manifestPath}`);
    }
    if (!existsSync(join(resourcesRoot, skill.path))) {
      throw new Error(`manifest skill file not found: ${join(resourcesRoot, skill.path)}`);
    }
    return {
      id: skill.id,
      name: skill.name ?? skill.id,
      version: skill.version ?? "",
      path: skill.path,
      description: skill.description ?? "",
    };
  });
}

/**
 * @brief Install the MCP server entry and every manifest skill per enabled CLI.
 * @details For each enabled CLI in settings order: registers the stdio entry
 * via `applyServerRegistration` (no key or environment payload; the server
 * reads its configuration file at startup, REQ-142), then synchronizes each
 * manifest skill directory `<resourcesRoot>/<skill-id>` into
 * `<skillsDir>/<skill-id>`.
 * Failures are collected per CLI and remaining CLIs still run.
 * @param options {object} `{ home?, resourcesRoot }`.
 * @return {CliOperationResult} Per-CLI summaries and failure diagnostics.
 * @throws {Error} When the skills manifest cannot be loaded (all CLIs fail).
 * @satisfies REQ-114, REQ-116
 */
export function installEnabledCliResources(options: {
  home?: string;
  resourcesRoot: string;
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
        syncSkillTree(join(options.resourcesRoot, skill.id), join(target.skillsDir(options.home), skill.id));
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
