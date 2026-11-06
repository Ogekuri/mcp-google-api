/**
 * @fileoverview HDT unit suite for the skill debug-overlay install architecture.
 * @details Covers the manifest `debug` declaration (REQ-152), the core/debug
 * document separation contract (REQ-153), the `install --debug-skills` option
 * (REQ-154), content-only plain installs (REQ-155), overlay appends (REQ-156),
 * append idempotency across reruns (REQ-157), and the `show` status
 * equivalence of both install modes (REQ-158). Every test runs against a
 * fresh temporary skills root and home root, so no real user path or network
 * endpoint is touched.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// cli.ts is also the executable entrypoint and detects direct execution from
// process.argv[1]. The repository directory name contains "mcp-google-api", so
// the test runner path would otherwise trigger the CLI entrypoint.
const originalArgv1 = process.argv[1];
process.argv[1] = "skill-debug-install-unit-test";
const { runInstallUninstallCommand } = await import("../src/cli.js");
process.argv[1] = originalArgv1;

const { CLI_TARGETS } = await import("../src/utils/cliTargets.js");
const { installEnabledCliResources, loadSkillsManifest } = await import("../src/utils/cliInstaller.js");
const { compareSkillTree } = await import("../src/utils/cliTargets.js");
const { saveCliSettings } = await import("../src/utils/cliSettings.js");

const CORE_DOCUMENT = "---\nname: demo-skill\ndescription: demo skill\n---\n\n# Demo core\n\nVersion 1.0.0\n";
const DEBUG_OVERLAY = "\n## PART II — DEBUG\n\nDEBUG_ENABLED = TRUE\n\n### D1. Register\n\nAppend-only overlay.\n";

interface SkillFixture {
  root: string;
  resourcesRoot: string;
  home: string;
  installedSkillDir: string;
}

/**
 * @brief Builds an isolated skills package plus enabled-CLI home root.
 * @details Writes one manifest skill (`demo-skill`) with a core document, a
 * debug overlay, and an auxiliary asset file, then enables the `pi` CLI in a
 * temporary home so installs resolve deterministic paths (REQ-113).
 * @return {SkillFixture} Temporary roots and the expected installed skill path.
 */
function createFixture(): SkillFixture {
  const root = mkdtempSync(join(tmpdir(), "mcp-google-api-skill-debug-"));
  const resourcesRoot = join(root, "skills");
  const skillDir = join(resourcesRoot, "demo-skill");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), CORE_DOCUMENT);
  writeFileSync(join(skillDir, "DEBUG.md"), DEBUG_OVERLAY);
  writeFileSync(join(skillDir, "notes.txt"), "asset\n");
  writeFileSync(
    join(resourcesRoot, "manifest.json"),
    JSON.stringify(
      {
        version: 1,
        skills: [
          {
            id: "demo-skill",
            name: "demo-skill",
            version: "1.0.0",
            language: "en",
            path: "demo-skill/SKILL.md",
            description: "demo",
            debug: "DEBUG.md",
          },
        ],
      },
      null,
      2
    ) + "\n"
  );
  const home = join(root, "home");
  saveCliSettings({ enabled: ["pi"], apiKey: "", autoUpdate: true }, home);
  return {
    root,
    resourcesRoot,
    home,
    installedSkillDir: join(CLI_TARGETS.pi.skillsDir(home), "demo-skill"),
  };
}

/**
 * @brief Reads one installed skill file as UTF-8 text.
 * @param fixture {SkillFixture} Active temporary fixture.
 * @param name {string} File name inside the installed skill directory.
 * @return {string} File content.
 */
function readInstalled(fixture: SkillFixture, name: string): string {
  return readFileSync(join(fixture.installedSkillDir, name), "utf-8");
}

/**
 * @brief Creates a CLI command stream sink capturing stdout and stderr.
 * @return {{stdout: {write(text: string): boolean}, stderr: {write(text: string): boolean}, out: string[], err: string[]}} Capturing streams.
 */
function createStreams(): {
  stdout: { write(text: string): boolean };
  stderr: { write(text: string): boolean };
  out: string[];
  err: string[];
} {
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

test("plain install copies content files only and never installs the debug overlay", (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const result = installEnabledCliResources({ home: fixture.home, resourcesRoot: fixture.resourcesRoot });

  assert.deepEqual(result.errors, []);
  assert.equal(result.summaries.length, 1);
  assert.equal(readInstalled(fixture, "SKILL.md"), CORE_DOCUMENT);
  assert.equal(readInstalled(fixture, "notes.txt"), "asset\n");
  assert.equal(existsSync(join(fixture.installedSkillDir, "DEBUG.md")), false);
  assert.equal(
    compareSkillTree(join(fixture.resourcesRoot, "demo-skill"), fixture.installedSkillDir, { debugPath: "DEBUG.md" }),
    "OK"
  );
});

test("debug install appends the overlay exactly once across reruns", (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  installEnabledCliResources({ home: fixture.home, resourcesRoot: fixture.resourcesRoot, includeDebugSkills: true });
  const first = readInstalled(fixture, "SKILL.md");
  installEnabledCliResources({ home: fixture.home, resourcesRoot: fixture.resourcesRoot, includeDebugSkills: true });
  const second = readInstalled(fixture, "SKILL.md");

  assert.equal(first, CORE_DOCUMENT + DEBUG_OVERLAY);
  assert.equal(second, CORE_DOCUMENT + DEBUG_OVERLAY);
  assert.equal(existsSync(join(fixture.installedSkillDir, "DEBUG.md")), false);
  assert.equal(
    compareSkillTree(join(fixture.resourcesRoot, "demo-skill"), fixture.installedSkillDir, { debugPath: "DEBUG.md" }),
    "OK"
  );
});

test("show-style comparison accepts both install modes and flags tampering", (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const packaged = join(fixture.resourcesRoot, "demo-skill");

  installEnabledCliResources({ home: fixture.home, resourcesRoot: fixture.resourcesRoot });
  assert.equal(compareSkillTree(packaged, fixture.installedSkillDir, { debugPath: "DEBUG.md" }), "OK");

  installEnabledCliResources({ home: fixture.home, resourcesRoot: fixture.resourcesRoot, includeDebugSkills: true });
  assert.equal(compareSkillTree(packaged, fixture.installedSkillDir, { debugPath: "DEBUG.md" }), "OK");

  writeFileSync(join(fixture.installedSkillDir, "SKILL.md"), "tampered\n");
  assert.equal(compareSkillTree(packaged, fixture.installedSkillDir, { debugPath: "DEBUG.md" }), "STALE");
});

test("manifest rejects a declared debug overlay that is missing from the skill directory", (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  rmSync(join(fixture.resourcesRoot, "demo-skill", "DEBUG.md"), { force: true });

  assert.throws(
    () => loadSkillsManifest(fixture.resourcesRoot),
    /manifest skill debug file not found/,
    "missing debug overlay must fail manifest loading"
  );
});

test("install command forwards the debug-skills flag and plain reruns drop the overlay", (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const debugStreams = createStreams();
  const debugExit = runInstallUninstallCommand("install", {
    home: fixture.home,
    resourcesRoot: fixture.resourcesRoot,
    includeDebugSkills: true,
    streams: debugStreams,
  });
  assert.equal(debugExit, 0);
  const debugPayload = JSON.parse(debugStreams.out.join(""));
  assert.equal(debugPayload.success, true);
  assert.deepEqual(debugPayload.summaries, [{ cli: "pi", server: 1, skills: 1 }]);
  assert.equal(readInstalled(fixture, "SKILL.md"), CORE_DOCUMENT + DEBUG_OVERLAY);

  const plainStreams = createStreams();
  const plainExit = runInstallUninstallCommand("install", {
    home: fixture.home,
    resourcesRoot: fixture.resourcesRoot,
    streams: plainStreams,
  });
  assert.equal(plainExit, 0);
  assert.deepEqual(JSON.parse(plainStreams.out.join("")).summaries, [{ cli: "pi", server: 1, skills: 1 }]);
  assert.equal(readInstalled(fixture, "SKILL.md"), CORE_DOCUMENT);
});
