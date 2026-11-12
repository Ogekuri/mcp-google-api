/**
 * @fileoverview Documentation contract suite for published README links and document language.
 *
 * @brief Guards the documentation surface of the published package: every README.md link that
 * targets a repository document must be an absolute repository URL, because `docs/` is excluded
 * from the packed tarball (PKG-038, PKG-114), and every project Markdown document must be written
 * in English (PKG-115).
 * @details UUT: the tracked Markdown documents themselves (`README.md`, `CHANGELOG.md`,
 * `docs/*.md`). Level 0 (atomic static assertions over repository files; no process spawn, no
 * network, no clock). Enforced contract:
 * - README.md MUST contain no relative link target other than an in-document anchor (`#...`),
 *   so links to `docs/TOOLS.md`, `docs/CONFIGURATION.md`, `LICENSE`, or `src/resources/skills/`
 *   resolve from the npm landing page (PKG-114).
 * - Every project Markdown document MUST be English: no accented Latin-extended characters and
 *   none of the tracked Italian marker words (PKG-115).
 * @note HDT level 0: pure file reads of tracked, immutable-at-test-time inputs.
 * @satisfies PKG-114, PKG-115, TST-030
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root resolved from this suite location (cwd-independent). */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Repository-relative path of the published README. */
const README_PATH = "README.md";

/** Repository-relative path of the changelog shipped in the tarball (PKG-036). */
const CHANGELOG_PATH = "CHANGELOG.md";

/** Repository-relative directory holding the user documentation. */
const DOCS_DIR = "docs";

/** Markdown link targets that MUST NOT appear in README.md because they are package-relative. */
const RELATIVE_LINK_TARGETS = [
  "docs/CONFIGURATION.md",
  "docs/TOOLS.md",
  "src/resources/skills/",
  "LICENSE",
];

/** Italian marker words that MUST NOT appear in any English project document (PKG-115). */
const NON_ENGLISH_MARKERS = [
  "tutti",
  "tutte",
  "degli",
  "della",
  "delle",
  "può",
  "sono",
  "viene",
  "vedi",
  "nella",
  "nello",
  "questo",
  "questa",
  "catalogo",
  "percorso",
  "locali",
];

/** Accented Latin characters that indicate non-English prose in the tracked documents. */
const ACCENTED_CHARACTERS = /[àèéìòùÀÈÉÌÒÙ]/;

/**
 * @brief Reads one repository file as UTF-8 text.
 * @details Synchronous read of a tracked, immutable-at-test-time input; no caching needed
 * because each test performs a single read per file. Complexity O(file size).
 * @param relativePath {string} Repository-relative path.
 * @return {string} Raw file content.
 * @throws {Error} When the file does not exist or cannot be read.
 */
function readRepositoryFile(relativePath: string): string {
  return readFileSync(join(PROJECT_ROOT, relativePath), "utf8");
}

/**
 * @brief Lists the repository-relative paths of every Markdown document under `docs/`.
 * @details Non-recursive directory read; every entry ending in `.md` is returned in directory
 * order. Complexity O(entries).
 * @return {string[]} Repository-relative Markdown paths.
 * @throws {Error} When the directory cannot be read.
 */
function listDocsMarkdownFiles(): string[] {
  return readdirSync(join(PROJECT_ROOT, DOCS_DIR))
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => `${DOCS_DIR}/${entry}`)
    .sort();
}

/**
 * @brief Extracts every Markdown link target from one document body.
 * @details Matches inline links only (`[label](target)`); image references are matched too
 * because badges use absolute URLs and must stay absolute. Complexity O(n) in body length.
 * @param body {string} Markdown document content.
 * @return {string[]} Raw link targets in document order.
 */
function extractLinkTargets(body: string): string[] {
  const targets: string[] = [];
  const pattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of body.matchAll(pattern)) {
    targets.push(match[1]);
  }
  return targets;
}

/**
 * @brief Classifies one link target as self-contained for the published package.
 * @details Allowed: in-document anchors (`#section`) and absolute URLs (`http://`, `https://`,
 * `mailto:`). Every repository-relative target is rejected because `docs/` and `src/` are not
 * browsable from the npm page (PKG-114). Pure; complexity O(1).
 * @param target {string} Raw Markdown link target.
 * @return {boolean} True when the target is absolute or an in-document anchor.
 */
function isSelfContainedLink(target: string): boolean {
  return target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target);
}

test("README documentation links are absolute so they resolve from the published package", () => {
  // PKG-114/PKG-038: docs/ and src/ are excluded from the tarball, so every repository-relative
  // link would 404 on the npm landing page; links MUST use absolute repository URLs.
  // Arrange
  const body = readRepositoryFile(README_PATH);
  // Act
  const targets = extractLinkTargets(body);
  const relativeTargets = targets.filter((target) => !isSelfContainedLink(target));
  // Assert
  assert.equal(targets.length > 0, true, "README must contain links to inspect");
  assert.deepEqual(relativeTargets, [], `README link targets must be absolute (PKG-114)`);
  for (const legacy of RELATIVE_LINK_TARGETS) {
    assert.equal(body.includes(`](${legacy})`), false, `README must not link relative target "${legacy}" (PKG-114)`);
  }
  assert.equal(
    body.includes("https://github.com/Ogekuri/mcp-google-api/blob/main/docs/TOOLS.md"),
    true,
    "README must link the tools catalog through its absolute repository URL (PKG-114)"
  );
  assert.equal(
    body.includes("https://github.com/Ogekuri/mcp-google-api/blob/main/docs/CONFIGURATION.md"),
    true,
    "README must link the configuration reference through its absolute repository URL (PKG-114)"
  );
});

test("every project Markdown document is written in English", () => {
  // PKG-115: README.md, CHANGELOG.md, and every docs/*.md document are English; non-English
  // prose is detected through accented Latin characters and a tracked Italian marker list.
  // Arrange
  const documents = [README_PATH, CHANGELOG_PATH, ...listDocsMarkdownFiles()];
  // Act
  const offenders: string[] = [];
  for (const document of documents) {
    const body = readRepositoryFile(document);
    if (ACCENTED_CHARACTERS.test(body)) {
      offenders.push(`${document}: accented character`);
      continue;
    }
    for (const marker of NON_ENGLISH_MARKERS) {
      const pattern = new RegExp(`\\b${marker}\\b`, "i");
      if (pattern.test(body)) {
        offenders.push(`${document}: "${marker}"`);
        break;
      }
    }
  }
  // Assert
  assert.equal(documents.includes(`${DOCS_DIR}/TOOLS.md`), true, "tool catalog document must exist");
  assert.equal(documents.includes(`${DOCS_DIR}/CONFIGURATION.md`), true, "configuration document must exist");
  assert.deepEqual(offenders, [], `non-English document markers found (PKG-115): ${offenders.join(", ")}`);
});
