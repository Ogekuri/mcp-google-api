/**
 * @file Static contract suite for the git-tracked `dist/` exclusion model.
 * @details UUT: the tracked `.gitignore` rule contract plus the tracked
 * `tools/check-release-artifacts.mjs` nested-tarball guard source — the behavior contract IS the
 * file content, so the suite reads the tracked, immutable inputs directly. Level 0 (atomic static
 * assertions; no internal call-graph dependencies). External dependencies to isolate: none beyond
 * `node:fs` reads of repository-tracked files (deterministic by design; no network, no clock, no
 * environment dependence, no git subprocess, no `dist/` existence assumption).
 *
 * Contract under test (PKG mapping):
 * - `.gitignore` MUST exclude the `dist/` build output directory (PKG-090).
 * - No `dist/` entry may be version-controlled: no re-inclusion rule, no negation of the `dist/`
 *   exclusion, may survive anywhere in `.gitignore` (PKG-091).
 * - The CTN-009 `!tools/` and CTN-010 `!bin/` exceptions MUST stay at the tail of the
 *   included-paths section, after the `skills/` re-inclusion (PKG-092).
 * - `tools/check-release-artifacts.mjs` rejects every packed `*.tgz` entry at any path, so no
 *   package archive is nested inside the packed payload (PKG-093).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GITIGNORE_PATH = join(PROJECT_ROOT, ".gitignore");
const VALIDATOR_PATH = join(PROJECT_ROOT, "tools", "check-release-artifacts.mjs");

/** Active rule that excludes the build output directory (PKG-090). */
const REQUIRED_DIST_RULE = "dist/";

/** Re-inclusion shapes that would version-control build output (PKG-091). */
const FORBIDDEN_DIST_RULES = ["!dist/", "!dist/**/*", "!dist/**", "!dist"];

/**
 * @brief Loads a tracked repository file as UTF-8 text for contract assertions.
 * @details Tracked files are immutable inputs during the test run, so no caching layer is needed.
 * Missing files fail the test through the thrown error. Complexity O(file size).
 * @param absolutePath {string} Absolute path of the tracked file.
 * @return {string} Raw UTF-8 text of the file.
 * @throws {Error} When the file does not exist or cannot be read.
 */
function readTrackedFile(absolutePath: string): string {
  return readFileSync(absolutePath, "utf-8");
}

/**
 * @brief Splits `.gitignore` text into trimmed lines.
 * @param text {string} Raw `.gitignore` content.
 * @return {string[]} Trimmed lines in file order; trailing newline artifacts removed.
 */
function gitignoreLines(text: string): string[] {
  return text.split("\n").map((line) => line.trim());
}

/**
 * @brief Extracts the active `.gitignore` rules with their negation flag.
 * @details A rule is active when its trimmed line is non-empty and does not start with `#`.
 * A leading `!` marks a re-inclusion (negated) rule. Complexity O(lines).
 * @param lines {string[]} Trimmed `.gitignore` lines.
 * @return {{ rule: string; negated: boolean }[]} Active rules in file order.
 */
function parseActiveRules(lines: string[]): { rule: string; negated: boolean }[] {
  const rules: { rule: string; negated: boolean }[] = [];
  for (const line of lines) {
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    rules.push({ rule: line.replace(/^!+/, ""), negated: line.startsWith("!") });
  }
  return rules;
}

test("gitignore excludes the dist build output directory", () => {
  // PKG-090: dist/ is compiled on demand, so an active rule must exclude it.
  // Arrange
  const rules = parseActiveRules(gitignoreLines(readTrackedFile(GITIGNORE_PATH)));
  // Act
  const excludingRules = rules.filter((rule) => !rule.negated).map((rule) => rule.rule);
  // Assert
  assert.equal(
    excludingRules.includes(REQUIRED_DIST_RULE),
    true,
    `.gitignore must carry the active exclusion "${REQUIRED_DIST_RULE}" (PKG-090)`,
  );
});

test("gitignore re-includes no dist entry", () => {
  // PKG-091: every dist/ entry is build output; no negation may version-control it.
  // Arrange
  const lines = gitignoreLines(readTrackedFile(GITIGNORE_PATH));
  // Act
  const reInclusions = lines.filter((line) => line.startsWith("!") && /(^|\/)dist([/*]|$)/.test(line));
  // Assert
  assert.deepEqual(
    reInclusions,
    [],
    `no dist/ re-inclusion rule may survive (PKG-091): ${JSON.stringify(reInclusions)}`,
  );
  for (const forbidden of FORBIDDEN_DIST_RULES) {
    assert.equal(lines.includes(forbidden), false, `rule "${forbidden}" must not survive (PKG-091)`);
  }
});

test("gitignore keeps the tools and bin exceptions at the tail of the included-paths section", () => {
  // PKG-092: the skills re-inclusion precedes the CTN-009 `!tools/` and CTN-010 `!bin/`
  // exceptions, which remain the last include rules of the section.
  // Arrange
  const lines = gitignoreLines(readTrackedFile(GITIGNORE_PATH));
  // Act
  const skillsIndex = lines.indexOf("!skills/");
  const toolsIndex = lines.indexOf("!tools/");
  const binIndex = lines.indexOf("!bin/");
  // Assert
  for (const [name, index] of [
    ["!skills/", skillsIndex],
    ["!tools/", toolsIndex],
    ["!bin/", binIndex],
  ] as const) {
    assert.equal(index >= 0, true, `.gitignore must contain the rule "${name}" (PKG-092)`);
  }
  assert.equal(skillsIndex < toolsIndex, true, `"!skills/" must precede "!tools/" (PKG-092)`);
  assert.equal(toolsIndex < binIndex, true, `"!tools/" must precede "!bin/" (PKG-092)`);
});

test("release artifact validator rejects nested packed tarballs", () => {
  // PKG-093: a packed `*.tgz` entry would nest a package archive inside the payload; the
  // validator MUST reject it at any path, not only under dist/.
  // Arrange
  const source = readTrackedFile(VALIDATOR_PATH);
  // Act
  const guardsTarballSuffix = /file\.endsWith\("\.tgz"\)/.test(source);
  const namesRequirement = source.includes("PKG-093");
  const distOnlyGuard = /file\.startsWith\("dist\/"\)\s*&&\s*file\.endsWith\("\.tgz"\)/.test(source);
  // Assert
  assert.equal(guardsTarballSuffix, true, "validator must test the packed *.tgz suffix (PKG-093)");
  assert.equal(namesRequirement, true, "validator guard must be traceable to PKG-093");
  assert.equal(distOnlyGuard, false, "the tarball guard must not be limited to dist/ (PKG-093)");
});
