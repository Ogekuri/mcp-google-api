/**
 * @file Static contract suite for the git-tracked `dist/` release-artifact distribution model.
 * @details UUT: the tracked `.gitignore` rule contract plus the tracked
 * `tools/check-release-artifacts.mjs` nested-tarball guard source — the behavior contract IS the
 * file content, so the suite reads the tracked, immutable inputs directly. Level 0 (atomic static
 * assertions; no internal call-graph dependencies). External dependencies to isolate: none beyond
 * `node:fs` reads of repository-tracked files (deterministic by design; no network, no clock, no
 * environment dependence, no git subprocess, no `dist/` existence assumption).
 *
 * Contract under test (PKG mapping):
 * - `.gitignore` MUST NOT exclude the `dist/` directory as a whole: the included-paths section
 *   carries the inverse re-inclusions for the `dist/` directory and its recursive file tree (PKG-090).
 * - The `scripts/build.sh` release artifacts are distributed through the git repository by
 *   version-controlling every `dist/` entry: no active (non-comment, non-negated) `.gitignore`
 *   rule may name the `dist/` directory or its files (PKG-091).
 * - The two `dist/` re-inclusion rules precede the CTN-009 `!tools/` and CTN-010 `!bin/`
 *   exceptions so those remain the tail of the included-paths section (PKG-092).
 * - `tools/check-release-artifacts.mjs` rejects every packed `dist/` entry matching `*.tgz`, so a
 *   repository-tracked release tarball is never nested inside a newly packed package (PKG-093).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GITIGNORE_PATH = join(PROJECT_ROOT, ".gitignore");
const VALIDATOR_PATH = join(PROJECT_ROOT, "tools", "check-release-artifacts.mjs");

/** Exact re-inclusion rules required by PKG-090 inside the included-paths section. */
const DIST_REINCLUSION_RULES = ["!dist/", "!dist/**/*"];

/**
 * Historical dist-excluding rule shapes named by the change request; none may survive as an
 * active rule (PKG-091). The component-boundary check is the primary guard; this set pins the
 * user-named examples explicitly.
 */
const FORBIDDEN_DIST_RULES = [
  "dist/",
  "/dist/",
  "dist/**/*",
  "/dist/**/*.whl",
  "/dist/**/*.tar.gz",
  "dist/**/*.tar.gz",
  "dist/**/*.whl",
  "dist/**/*.zip",
  "dist/**/*.egg",
  "dist/**/*.egg-info/",
  "dist/**/*.js",
  "dist/**/*.js.map",
  "dist/**/*.d.ts",
  "dist/**/*.d.ts.map",
  "dist/**/*.tgz",
  "dist/**/*.tsbuildinfo",
  "dist/**/*.tmp",
];

/**
 * @brief Loads a tracked repository file as UTF-8 text for contract assertions.
 * @details Tracked files are immutable inputs during the test run, so no caching layer is
 * needed. Missing files fail the test through the thrown error. Complexity O(file size).
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

/**
 * @brief Finds the index of a `.gitignore` section header comment by normalized title.
 * @details Normalization removes `#` characters, collapses whitespace, and rewrites the
 * historical header typos `Exlude`/`Exlucde` to `Exclude`, so the match is tolerant of banner
 * padding and spelling drift. Complexity O(lines).
 * @param lines {string[]} Trimmed `.gitignore` lines.
 * @param title {string} Case-insensitive section title, e.g. "include specific files and directories".
 * @return {number} Zero-based line index of the header.
 * @throws {Error} When the section header is absent.
 */
function findSectionHeaderIndex(lines: string[], title: string): number {
  const normalizedTitle = title.toLowerCase();
  const index = lines.findIndex((line) => {
    if (!line.startsWith("#")) {
      return false;
    }
    const normalized = line
      .replace(/#/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/exluc?de/g, "exclude");
    return normalized === normalizedTitle;
  });
  if (index < 0) {
    throw new Error(`.gitignore section header not found: ${title}`);
  }
  return index;
}

test("gitignore included-paths section re-includes the dist tree", () => {
  // PKG-090: the dist/ directory as a whole MUST NOT be excluded; the included-paths
  // section MUST carry the inverse re-inclusions `!dist/` and `!dist/**/*`.
  // Arrange
  const lines = gitignoreLines(readTrackedFile(GITIGNORE_PATH));
  const includeStart = findSectionHeaderIndex(lines, "include specific files and directories");
  const excludeStart = findSectionHeaderIndex(lines, "exclude specific files and directories");
  // Act
  const sectionRules = lines.slice(includeStart, excludeStart);
  // Assert
  for (const expected_rule of DIST_REINCLUSION_RULES) {
    assert.equal(
      sectionRules.includes(expected_rule),
      true,
      `included-paths section must carry the re-inclusion "${expected_rule}" (PKG-090)`,
    );
  }
});

test("gitignore places the dist re-inclusions before the tools and bin tail exceptions", () => {
  // PKG-092: the `!dist/` and `!dist/**/*` re-inclusions MUST precede the CTN-009 `!tools/`
  // and CTN-010 `!bin/` exceptions so those stay at the tail of the included-paths section.
  // Arrange
  const lines = gitignoreLines(readTrackedFile(GITIGNORE_PATH));
  // Act
  const distIndex = lines.indexOf("!dist/");
  const distGlobIndex = lines.indexOf("!dist/**/*");
  const toolsIndex = lines.indexOf("!tools/");
  const binIndex = lines.indexOf("!bin/");
  // Assert
  for (const [name, index] of [
    ["!dist/", distIndex],
    ["!dist/**/*", distGlobIndex],
    ["!tools/", toolsIndex],
    ["!bin/", binIndex],
  ] as const) {
    assert.equal(index >= 0, true, `.gitignore must contain the rule "${name}" (PKG-092)`);
  }
  assert.equal(distIndex < toolsIndex, true, `"!dist/" must precede "!tools/" (PKG-092)`);
  assert.equal(distGlobIndex < toolsIndex, true, `"!dist/**/*" must precede "!tools/" (PKG-092)`);
  assert.equal(distIndex < binIndex, true, `"!dist/" must precede "!bin/" (PKG-092)`);
  assert.equal(distGlobIndex < binIndex, true, `"!dist/**/*" must precede "!bin/" (PKG-092)`);
});

test("gitignore carries no active rule excluding dist entries", () => {
  // PKG-091: every dist/ entry is version-controlled, so no active non-negated rule may name
  // the dist/ directory or its files. Comment lines and the `!dist/` re-inclusions are allowed;
  // the generic exclude-all banner patterns (`/*`, `*.*`) and directory-wide double-star rules do
  // not name dist/ and are overridden by the PKG-090 re-inclusions. The component-boundary regex
  // matches the `dist` path segment only, so unrelated rules such as `sdist/` pass.
  // Arrange
  const lines = gitignoreLines(readTrackedFile(GITIGNORE_PATH));
  const distComponentPattern = /(^|\/)dist([/*]|$)/;
  // Act
  const excludingRules = parseActiveRules(lines).filter((rule) => !rule.negated);
  const distNamingRules = excludingRules.filter((rule) => distComponentPattern.test(rule.rule));
  // Assert
  assert.deepEqual(
    distNamingRules,
    [],
    `active exclusion rules must not name dist/ entries (PKG-091): ${JSON.stringify(distNamingRules)}`,
  );
  for (const forbidden of FORBIDDEN_DIST_RULES) {
    assert.equal(
      excludingRules.some((rule) => rule.rule === forbidden),
      false,
      `active exclusion rule "${forbidden}" must not survive in .gitignore (PKG-091)`,
    );
  }
});

test("release artifact validator rejects nested packed dist tarballs", () => {
  // PKG-093: with dist/ version-controlled, a stale tracked release tarball could be packed by a
  // non-canonical raw `npm pack`; the validator MUST reject every packed `dist/*.tgz` entry.
  // Arrange
  const source = readTrackedFile(VALIDATOR_PATH);
  // Act
  const guardsDistPrefix = /file\.startsWith\("dist\/"\)/.test(source);
  const guardsTarballSuffix = /file\.endsWith\("\.tgz"\)/.test(source);
  const namesRequirement = source.includes("PKG-093");
  // Assert
  const expected_output = true;
  assert.equal(guardsDistPrefix, expected_output, "validator must test the packed dist/ prefix (PKG-093)");
  assert.equal(guardsTarballSuffix, expected_output, "validator must test the packed *.tgz suffix (PKG-093)");
  assert.equal(namesRequirement, expected_output, "validator guard must be traceable to PKG-093");
});
