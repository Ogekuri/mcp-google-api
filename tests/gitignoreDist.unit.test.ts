/**
 * @file Static contract suite for the git-tracked `dist/` release-tarball model.
 * @details UUT: the tracked `.gitignore` rule contract plus the tracked
 * `tools/check-release-artifacts.mjs` nested-tarball guard source — the behavior contract IS the
 * file content, so the suite reads the tracked, immutable inputs directly. Level 0 (atomic static
 * assertions; no internal call-graph dependencies). External dependencies to isolate: none beyond
 * `node:fs` reads of repository-tracked files (deterministic by design; no network, no clock, no
 * environment dependence, no git subprocess, no `dist/` existence assumption).
 *
 * Contract under test (PKG mapping):
 * - `.gitignore` MUST re-include `dist/` and its `*.tgz` release tarball so the current-version
 *   artifact is version-controlled (PKG-090, PKG-091).
 * - `.gitignore` MUST NOT carry a plain `dist/` exclusion that would drop the committed tarball, and
 *   no other `dist/` output may be re-included (PKG-090, PKG-091).
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

/** Active rule re-including the release artifact directory (PKG-090). */
const REQUIRED_DIST_INCLUSION = "!/dist/";

/** Active rule re-including the version-stamped release tarball (PKG-090, PKG-091). */
const REQUIRED_TARBALL_INCLUSION = "!/dist/*.tgz";

/** Plain exclusion shape that would drop the committed release tarball (PKG-090). */
const FORBIDDEN_DIST_EXCLUSION = "dist/";

/**
 * @brief Normalizes `.gitignore` text into trimmed lines.
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

test("gitignore version-controls the dist release tarball", () => {
  // PKG-090/PKG-091: dist/ and its *.tgz artifact are re-included so the tagged commit carries
  // the release tarball the workflow resolves.
  // Arrange
  const rules = parseActiveRules(gitignoreLines(readFileSync(GITIGNORE_PATH, "utf-8")));
  // Act
  const negatedRules = rules.filter((rule) => rule.negated).map((rule) => rule.rule);
  // Assert
  assert.equal(
    negatedRules.includes(REQUIRED_DIST_INCLUSION.slice(1)),
    true,
    `.gitignore must re-include "dist/" (PKG-090)`,
  );
  assert.equal(
    negatedRules.includes(REQUIRED_TARBALL_INCLUSION.slice(1)),
    true,
    `.gitignore must re-include "dist/*.tgz" (PKG-090, PKG-091)`,
  );
});

test("gitignore keeps the dist release directories out of the exclusion section", () => {
  // PKG-090: a plain `dist/` exclusion rule would override the version-controlled tarball.
  // Arrange
  const lines = gitignoreLines(readFileSync(GITIGNORE_PATH, "utf-8"));
  // Act
  const excludingRules = lines.filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!"));
  // Assert
  assert.equal(
    excludingRules.includes(FORBIDDEN_DIST_EXCLUSION),
    false,
    `.gitignore must not exclude "${FORBIDDEN_DIST_EXCLUSION}" (PKG-090)`,
  );
  const reInclusions = lines.filter((line) => line.startsWith("!") && /(^|\/)dist([/*]|$)/.test(line));
  assert.deepEqual(reInclusions, [REQUIRED_DIST_INCLUSION, REQUIRED_TARBALL_INCLUSION]);
});

test("gitignore keeps the tools and bin exceptions at the tail of the included-paths section", () => {
  // PKG-092: the skills and dist re-inclusions precede the CTN-009 `!tools/` and CTN-010 `!bin/`
  // exceptions, which remain the last include rules of the section.
  // Arrange
  const lines = gitignoreLines(readFileSync(GITIGNORE_PATH, "utf-8"));
  // Act
  const skillsIndex = lines.indexOf("!skills/");
  const distIndex = lines.indexOf(REQUIRED_TARBALL_INCLUSION);
  const toolsIndex = lines.indexOf("!tools/");
  const binIndex = lines.indexOf("!bin/");
  // Assert
  for (const [name, index] of [
    ["!skills/", skillsIndex],
    [REQUIRED_TARBALL_INCLUSION, distIndex],
    ["!tools/", toolsIndex],
    ["!bin/", binIndex],
  ] as const) {
    assert.equal(index >= 0, true, `.gitignore must contain the rule "${name}" (PKG-092)`);
  }
  assert.equal(skillsIndex < toolsIndex, true, `"!skills/" must precede "!tools/" (PKG-092)`);
  assert.equal(distIndex < toolsIndex, true, `${REQUIRED_TARBALL_INCLUSION} must precede "!tools/" (PKG-092)`);
  assert.equal(toolsIndex < binIndex, true, `"!tools/" must precede "!bin/" (PKG-092)`);
});

test("release artifact validator rejects nested packed tarballs", () => {
  // PKG-093: a packed `*.tgz` entry would nest a package archive inside the payload; the
  // validator MUST reject it at any path, not only under dist/.
  // Arrange
  const source = readFileSync(VALIDATOR_PATH, "utf-8");
  // Act
  const guardsTarballSuffix = /file\.endsWith\("\.tgz"\)/.test(source);
  const namesRequirement = source.includes("PKG-093");
  const distOnlyGuard = /file\.startsWith\("dist\/"\)\s*&&\s*file\.endsWith\("\.tgz"\)/.test(source);
  // Assert
  assert.equal(guardsTarballSuffix, true, "validator must test the packed *.tgz suffix (PKG-093)");
  assert.equal(namesRequirement, true, "validator guard must be traceable to PKG-093");
  assert.equal(distOnlyGuard, false, "the tarball guard must not be limited to dist/ (PKG-093)");
});
