#!/usr/bin/env node
/**
 * @file check-release-artifacts.mjs
 * @brief Release artifact validator for the committed `dist/` release tarball.
 * @details Validates the tarball named by the first command-line argument, defaulting to
 *          `dist/<package name>-<version>.tgz` (PKG-103), offline, in this order: (1) tarball
 *          basename and identity against `<package name>-<version>.tgz` (PKG-137); (2) tarball
 *          listing against the invariant plus runtime-prefix allowlist and the required entry set
 *          (PKG-075), the rejection of every packed `src/` entry so repository sources never become
 *          release artifacts (PKG-125, PKG-127), the rejection of every packed `*.tgz` entry so no
 *          package archive is nested inside the packed payload (PKG-093), and the rejection of
 *          every `skills/` entry that is not `manifest.json` or a file inside a `<skill-id>/`
 *          directory, so skills authoring documentation never ships (PKG-038, PKG-075);
 *          (3) extraction into a private temp directory, then the packed `package/package.json`
 *          name and version against the repository `package.json`, the absence of a library entry
 *          (PKG-035) and every declared `bin` target (PKG-076); (4) every skill `path` and `debug`
 *          entry of the packed `skills/manifest.json` present (PKG-077); (5) the packed `dist/`
 *          tree holding exactly the single runtime bundle `dist/cli.js` with no other JavaScript
 *          artifact (PKG-078); (6) `node --check` on the packed `dist/cli.js` (PKG-079);
 *          (7) execution of the repository `dist/cli.js --help` with exit 0 and `mcp-google-api`
 *          on stdout while that build artifact still exists (PKG-079). Every failed check is
 *          collected and reported; the process exits 1 when any check fails.
 *          Complexity: O(E + F) where E is the tarball entry count and F the packed file byte total.
 * @satisfies PKG-035, PKG-038, PKG-075, PKG-076, PKG-077, PKG-078, PKG-079, PKG-093, PKG-103, PKG-125, PKG-127, PKG-137
 * @note Writes only under the OS temp directory (extraction, removed in `finally`). No network
 *       access, no packing, no dependency installation, no publication. stdout carries per-check
 *       `ok:` lines; stderr carries `FAILED:` diagnostics.
 * @pre The tarball exists; `dist/cli.js` exists while this validator runs during `scripts/build.sh`.
 * @post No repository file is modified; the temp extraction directory is removed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root resolved from this script location (cwd-independent). */
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Directory name npm uses as the root of every packed tarball entry. */
const PACKAGE_ROOT_DIR = "package";

/** Upper bound for captured `tar` stdout in bytes. */
const TAR_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** Timeout in milliseconds for the packaged CLI smoke run. */
const CLI_SMOKE_TIMEOUT_MS = 60000;

/** npm-invariant files always packed regardless of the `files` allowlist (PKG-038). */
const INVARIANT_FILES = new Set(["package.json", "README.md", "CHANGELOG.md", "LICENSE", "LICENSE.md", "LICENSE.txt"]);

/** Runtime directory prefixes permitted in the packed tarball (PKG-038); docs/ is non-runtime and excluded. */
const ALLOWED_PREFIXES = ["bin/", "dist/", "skills/"];

/** Skills-root payload prefix; only the manifest and `<skill-id>/` files may live here (PKG-038, PKG-075). */
const SKILLS_ROOT_PREFIX = "skills/";

/** Repository source prefix whose entries are build inputs, never release artifacts (PKG-125, PKG-127). */
const SOURCES_PREFIX = "src/";

/** Sole file permitted directly under the skills root; every other skills-root entry is a skill directory (PKG-075). */
const SKILLS_ROOT_MANIFEST = `${SKILLS_ROOT_PREFIX}manifest.json`;

/** The single JavaScript artifact the packed `dist/` tree may hold (PKG-078). */
const RUNTIME_BUNDLE = "dist/cli.js";

/** Entries that MUST exist in the packed tarball (PKG-075). */
const REQUIRED_ENTRIES = [
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "bin/mcp-google-api.mjs",
  RUNTIME_BUNDLE,
  SKILLS_ROOT_MANIFEST,
];

/** Packed entries whose syntax is verified with `node --check` (PKG-079). */
const SYNTAX_CHECKED_ENTRIES = [RUNTIME_BUNDLE];

/** Accumulated failure diagnostics; a non-empty list makes the process exit 1. */
const failures = [];

/**
 * @brief Records one failed check diagnostic.
 * @details Appends to the module-level `failures` list; no I/O. Complexity O(1).
 * @param message {string} Human-readable failure description naming the failed check.
 * @return {void}
 * @side_effect Mutates `failures`.
 */
function recordFailure(message) {
  failures.push(message);
}

/**
 * @brief Prints one passing-check line on stdout.
 * @details Complexity O(1).
 * @param message {string} Description of the satisfied check.
 * @return {void}
 * @side_effect Writes to stdout.
 */
function recordOk(message) {
  console.log(`[check-release-artifacts] ok: ${message}`);
}

/**
 * @brief Runs `tar` synchronously and returns its captured stdout.
 * @details Uses buffer encoding so binary member content is preserved. Throws on spawn error
 * or non-zero status, including the captured stderr text. Complexity O(output size).
 * @param args {string[]} Arguments forwarded verbatim to `tar`.
 * @return {Buffer} Captured stdout bytes.
 * @throws {Error} When `tar` cannot be spawned or exits non-zero.
 */
function runTar(args) {
  const result = spawnSync("tar", args, { maxBuffer: TAR_MAX_BUFFER_BYTES });
  if (result.error) {
    throw new Error(`tar could not be spawned: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`tar ${args.join(" ")} failed: ${result.stderr.toString("utf8").trim()}`);
  }
  return result.stdout;
}

/**
 * @brief Resolves the tarball path to validate.
 * @details Uses the first command-line argument when supplied, otherwise the default committed
 * artifact `dist/<package name>-<version>.tgz` (PKG-103). Relative arguments resolve against the
 * invoking working directory. Pure; complexity O(n) in path length.
 * @param repoPackage {{ name: string, version: string }} Repository `package.json` identity.
 * @return {string} Absolute tarball path.
 * @satisfies PKG-103, PKG-137
 */
function resolveTarballPath(repoPackage) {
  const argument = process.argv[2];
  if (typeof argument === "string" && argument.length > 0) {
    return resolve(argument);
  }
  return join(PROJECT_ROOT, "dist", `${repoPackage.name}-${repoPackage.version}.tgz`);
}

/**
 * @brief Verifies that the tarball exists, is non-empty, and carries the canonical basename.
 * @details The release artifact MUST be `<package name>-<version>.tgz`, so any other filename
 * fails the check with the observed name (PKG-137). Complexity O(1).
 * @param tarballPath {string} Absolute tarball path.
 * @param repoPackage {{ name: string, version: string }} Repository `package.json` identity.
 * @return {void}
 * @side_effect Calls `recordFailure` per violation.
 * @satisfies PKG-103, PKG-137
 */
function checkTarballIdentity(tarballPath, repoPackage) {
  const expected = `${repoPackage.name}-${repoPackage.version}.tgz`;
  const observed = basename(tarballPath);
  if (observed !== expected) {
    recordFailure(`release tarball basename must be ${expected}, found ${observed} (PKG-137)`);
  }
  if (!existsSync(tarballPath)) {
    recordFailure(`release tarball missing (PKG-103): ${tarballPath}`);
    return;
  }
  if (!statSync(tarballPath).isFile() || statSync(tarballPath).size === 0) {
    recordFailure(`release tarball is not a non-empty file (PKG-103): ${tarballPath}`);
    return;
  }
  recordOk(`release tarball ${observed} present and non-empty (PKG-103, PKG-137)`);
}

/**
 * @brief Lists the file entries of a tarball with the `package/` root prefix stripped.
 * @details Directory entries (trailing `/`) are skipped. Every entry MUST begin with
 * `package/`; any other root is a structural failure. Complexity O(E).
 * @param tarballPath {string} Absolute path to the `.tgz` file.
 * @return {string[]} Relative file paths in tarball order.
 * @throws {Error} When `tar` fails or an entry lacks the `package/` root.
 */
function listTarballFiles(tarballPath) {
  const names = runTar(["-tzf", tarballPath]).toString("utf8").split("\n").filter((line) => line.length > 0);
  const files = [];
  for (const name of names) {
    if (name.endsWith("/")) {
      continue;
    }
    if (!name.startsWith(`${PACKAGE_ROOT_DIR}/`)) {
      throw new Error(`tarball entry outside "${PACKAGE_ROOT_DIR}/" root: ${name}`);
    }
    files.push(name.slice(PACKAGE_ROOT_DIR.length + 1));
  }
  return files;
}

/**
 * @brief Classifies one packed skills-root path as runtime payload.
 * @details True for `skills/manifest.json` and for any file located strictly inside a `<skill-id>/`
 * directory, i.e. at least one non-empty segment after the skill id. Root-level files such as
 * authoring guides are not runtime payload (PKG-038, PKG-075). Pure; complexity O(n) in path length.
 * @param file {string} Relative packed file path.
 * @return {boolean} True when the entry is skills runtime payload.
 */
function isPackagedSkillPayload(file) {
  if (file === SKILLS_ROOT_MANIFEST) {
    return true;
  }
  const segments = file.slice(SKILLS_ROOT_PREFIX.length).split("/");
  return segments.length >= 2 && segments.every((segment) => segment.length > 0);
}

/**
 * @brief Verifies the packed file set against the allowlist, required entries, source and archive exclusion.
 * @details Each packed path MUST equal an invariant file or start with an allowed prefix (PKG-075).
 * Each required entry MUST be present (PKG-075). Every packed `src/` entry MUST be rejected with a
 * diagnostic naming the entry, because the release artifact is the npm tarball built from the
 * compiled bundle and repository sources are inputs only (PKG-125, PKG-127). Every packed `skills/`
 * entry MUST be the manifest or a file inside a `<skill-id>/` directory, so skills authoring
 * documentation resident in the repository is never published (PKG-038, PKG-075). Every packed
 * `*.tgz` entry MUST be rejected: no package archive may be nested inside the packed payload
 * (PKG-093). Complexity O(E * P) with P = allowlist size.
 * @param files {string[]} Relative packed file paths.
 * @return {void}
 * @side_effect Calls `recordFailure` per violation.
 * @satisfies PKG-038, PKG-075, PKG-093, PKG-125, PKG-127
 */
function checkStructure(files) {
  const failuresBefore = failures.length;
  const fileSet = new Set(files);
  for (const file of files) {
    if (file.startsWith(SOURCES_PREFIX)) {
      recordFailure(`repository source packed as a release artifact (PKG-127): ${file}`);
    } else if (!INVARIANT_FILES.has(file) && !ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      recordFailure(`packed path outside publication allowlist (PKG-038, PKG-075): ${file}`);
    }
    if (file.endsWith(".tgz")) {
      recordFailure(`nested package archive must not be packed (PKG-093): ${file}`);
    }
    if (file.startsWith(SKILLS_ROOT_PREFIX) && !isPackagedSkillPayload(file)) {
      recordFailure(`skills-root entry is not manifest.json or a <skill-id>/ file (PKG-038, PKG-075): ${file}`);
    }
  }
  for (const required of REQUIRED_ENTRIES) {
    if (!fileSet.has(required)) {
      recordFailure(`required entry missing from tarball (PKG-075): ${required}`);
    }
  }
  if (failures.length === failuresBefore) {
    recordOk(`tarball structure: ${files.length} files, allowlist, required entries, and source exclusion satisfied`);
  }
}

/**
 * @brief Collects every string leaf of a `bin` declaration.
 * @details Recurses through object values; non-string leaves are ignored. Pure; complexity O(n)
 * in declaration size.
 * @param value {unknown} Declaration value (string, object, array, or other).
 * @return {string[]} Declared target paths, still carrying any leading `./`.
 */
function collectStringTargets(value) {
  if (typeof value === "string") {
    return [value];
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap((nested) => collectStringTargets(nested));
  }
  return [];
}

/**
 * @brief Verifies the packed `package/package.json` identity and declared bin targets.
 * @details Compares packed `name` and `version` with the repository `package.json` (PKG-076). Each
 * `bin` target, normalized by stripping a leading `./`, MUST exist in the tarball file set
 * (PKG-076). A packed `main` or `exports` field is rejected because the package declares no library
 * entry (PKG-035). Complexity O(T) with T = declared target count.
 * @param repoPackage {{ name: string, version: string, bin?: unknown }} Repository `package.json` contents.
 * @param packedPackageJsonPath {string} Extracted `package/package.json` path.
 * @param files {string[]} Relative packed file paths.
 * @return {void}
 * @side_effect Calls `recordFailure` per violation.
 * @satisfies PKG-035, PKG-076
 */
function checkIdentityAndTargets(repoPackage, packedPackageJsonPath, files) {
  const packed = JSON.parse(readFileSync(packedPackageJsonPath, "utf8"));
  if (packed.name !== repoPackage.name || packed.version !== repoPackage.version) {
    recordFailure(
      `packed identity mismatch (PKG-076): packed ${packed.name}@${packed.version}, repository ${repoPackage.name}@${repoPackage.version}`,
    );
  } else {
    recordOk(`packed identity ${packed.name}@${packed.version} matches repository package.json (PKG-076)`);
  }
  if (packed.main !== undefined || packed.exports !== undefined) {
    recordFailure(
      `packed manifest declares a library entry (PKG-035): main=${packed.main} exports=${JSON.stringify(packed.exports)}`,
    );
  }
  const fileSet = new Set(files);
  const targets = collectStringTargets(repoPackage.bin).map((target) => target.replace(/^\.\//, ""));
  for (const target of targets) {
    if (!fileSet.has(target)) {
      recordFailure(`declared bin target missing from tarball (PKG-076): ${target}`);
    }
  }
  recordOk(`${targets.length} declared bin targets present in tarball (PKG-076)`);
}

/**
 * @brief Verifies that every skill path declared in the packed manifest exists in the tarball.
 * @details Reads `skills/manifest.json` from the extraction. Skill `path` resolves relative to the
 * skills root; skill `debug` resolves relative to the skill directory, i.e. the directory of `path`
 * (REQ-152). Each resolved entry MUST exist in the tarball file set (PKG-077). Complexity O(S).
 * @param packageDir {string} Extracted `package/` directory.
 * @param files {string[]} Relative packed file paths.
 * @return {void}
 * @side_effect Calls `recordFailure` per missing skill file.
 * @satisfies PKG-077
 */
function checkSkillManifest(packageDir, files) {
  const manifest = JSON.parse(readFileSync(join(packageDir, SKILLS_ROOT_PREFIX, "manifest.json"), "utf8"));
  const fileSet = new Set(files);
  const skills = Array.isArray(manifest.skills) ? manifest.skills : [];
  for (const skill of skills) {
    if (typeof skill.path !== "string") {
      recordFailure("skill manifest entry without a string path (PKG-077)");
      continue;
    }
    const entries = [`${SKILLS_ROOT_PREFIX}${skill.path}`];
    if (typeof skill.debug === "string") {
      entries.push(`${SKILLS_ROOT_PREFIX}${posix.join(posix.dirname(skill.path), skill.debug)}`);
    }
    for (const entry of entries) {
      if (!fileSet.has(entry)) {
        recordFailure(`skill manifest entry missing from tarball (PKG-077): ${entry}`);
      }
    }
  }
  recordOk(`${skills.length} skill manifest entries resolve to packed files (PKG-077)`);
}

/**
 * @brief Verifies that the packed `dist/` tree holds exactly the single runtime bundle.
 * @details The published payload is the compiled program only: the packed `dist/` file set MUST be
 * exactly `dist/cli.js`, so no shared chunk and no second entry ships (PKG-078). A missing or
 * differently named `dist/` artifact is reported with the observed entry. Complexity O(E).
 * @param files {string[]} Relative packed file paths.
 * @return {void}
 * @side_effect Calls `recordFailure` per violation.
 * @satisfies PKG-078
 */
function checkDistLayout(files) {
  const packedDist = files.filter((file) => file.startsWith("dist/"));
  const unexpected = packedDist.filter((file) => file !== RUNTIME_BUNDLE);
  for (const file of unexpected) {
    recordFailure(`packed dist/ entry is not the single runtime bundle (PKG-078): ${file}`);
  }
  if (!packedDist.includes(RUNTIME_BUNDLE)) {
    recordFailure(`runtime bundle missing from packed dist/ (PKG-078): ${RUNTIME_BUNDLE}`);
  }
  if (unexpected.length === 0 && packedDist.includes(RUNTIME_BUNDLE)) {
    recordOk(`packed dist/ holds exactly ${RUNTIME_BUNDLE} (PKG-078)`);
  }
}

/**
 * @brief Runs `node --check` on each named packed entry.
 * @details Syntax-only verification; executes nothing. Complexity O(E) child spawns.
 * @param packageDir {string} Extracted `package/` directory.
 * @param entries {string[]} Relative entries to check.
 * @return {void}
 * @side_effect Spawns one `node --check` child per entry; calls `recordFailure` on failure.
 */
function checkSyntax(packageDir, entries) {
  for (const entry of entries) {
    const result = spawnSync(process.execPath, ["--check", join(packageDir, entry)], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
      recordFailure(`syntax check failed (PKG-079): ${entry} ${result.stderr ?? ""}`.trim());
    }
  }
  recordOk(`syntax verified for ${entries.join(", ")} (PKG-079)`);
}

/**
 * @brief Executes the repository `dist/cli.js --help` as an offline smoke run.
 * @details The validated tarball was packed from this repository tree in the same build run, so
 * this execution exercises the shipped entry (PKG-079). The bundle MUST still exist when the
 * validator runs; `scripts/build.sh` removes it only after validation (PKG-135, PKG-136).
 * Requires exit 0 and the `mcp-google-api` name on stdout (PKG-079). Complexity O(1) plus child
 * runtime bounded by timeout.
 * @return {void}
 * @side_effect Spawns one Node.js child process; calls `recordFailure` on failure.
 * @satisfies PKG-079
 */
function checkCliSmoke() {
  const cliEntry = join(PROJECT_ROOT, RUNTIME_BUNDLE);
  if (!existsSync(cliEntry)) {
    recordFailure(`repository runtime bundle missing, run 'npm run build' first (PKG-079): ${RUNTIME_BUNDLE}`);
    return;
  }
  const result = spawnSync(process.execPath, [cliEntry, "--help"], {
    encoding: "utf8",
    timeout: CLI_SMOKE_TIMEOUT_MS,
  });
  if (result.error) {
    recordFailure(`packaged CLI smoke run could not execute (PKG-079): ${result.error.message}`);
    return;
  }
  if (result.status !== 0 || !result.stdout.includes("mcp-google-api")) {
    recordFailure(
      `packaged CLI smoke run failed (PKG-079): exit ${result.status}, stderr: ${result.stderr.trim()}`,
    );
    return;
  }
  recordOk("packaged dist/cli.js --help exits 0 with mcp-google-api on stdout (PKG-079)");
}

/**
 * @brief Runs every artifact check in fixed order against the committed release tarball.
 * @details Reads the repository `package.json`, resolves the tarball path from the first argument
 * or the committed default (PKG-103), verifies its basename and presence (PKG-137), lists and
 * structurally checks the tarball, extracts it into a private temp directory, and runs the
 * identity, target, manifest, dist-layout, syntax, and smoke checks. The temp directory is removed
 * in `finally`. Complexity O(E + F).
 * @return {void}
 * @throws {Error} When the listing is structurally invalid or extraction fails.
 * @side_effect Creates and removes one temp directory under the OS temp root.
 */
function main() {
  const repoPackage = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8"));
  const tarballPath = resolveTarballPath(repoPackage);
  checkTarballIdentity(tarballPath, repoPackage);
  if (!existsSync(tarballPath)) {
    return;
  }
  const workRoot = mkdtempSync(join(tmpdir(), "check-release-artifacts-"));
  try {
    const files = listTarballFiles(tarballPath);
    checkStructure(files);
    runTar(["-xzf", tarballPath, "-C", workRoot]);
    const packageDir = join(workRoot, PACKAGE_ROOT_DIR);
    checkIdentityAndTargets(repoPackage, join(packageDir, "package.json"), files);
    checkSkillManifest(packageDir, files);
    checkDistLayout(files);
    checkSyntax(packageDir, SYNTAX_CHECKED_ENTRIES);
    checkCliSmoke();
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  recordFailure(error instanceof Error ? error.message : String(error));
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[check-release-artifacts] FAILED: ${failure}`);
  }
  process.exit(1);
}
console.log("[check-release-artifacts] all release artifact checks passed.");
