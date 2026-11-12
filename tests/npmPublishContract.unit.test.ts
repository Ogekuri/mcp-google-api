/**
 * @fileoverview npm publication contract suite for package metadata and packed tarball contents.
 *
 * @brief Guards npm publication policies and best practices across package.json, README.md,
 * package-lock.json, and the `npm pack --dry-run` tarball listing.
 * @details UUT: the tracked publication manifests themselves plus the deterministic offline
 * packer listing (`npm pack --dry-run --json`; no network, no registry access, no tarball
 * write). Enforced contract: current non-deprecated SPDX license identifier `GPL-3.0-only`
 * in package.json (PKG-033) and in the README.md license badge plus License section with no
 * residual deprecated bare `GPL-3.0` token (PKG-034); no `package.json` `main` or `exports`
 * library entry, because the only runtime entry is the `bin` launcher (PKG-035); `CHANGELOG.md`
 * shipped through the `files` allowlist (PKG-036); package-lock.json root `name`/`version`
 * identity with package.json (PKG-037) plus root `bin` launcher-map identity with package.json
 * (PRJ-020 regression guard); packed paths restricted to the `bin/`, `dist/`, and `skills/`
 * runtime prefixes plus npm-invariant metadata files while excluding tests, local configuration,
 * secret files, and skills authoring documentation, with every `skills/` entry limited to
 * `manifest.json` or a `<skill-id>/` file (PKG-038, PKG-075); the `bin`/`dist`/`skills` `files`
 * allowlist with no `dist` archive negation (PKG-116); a packed `dist/` tree holding at most the
 * single runtime bundle `dist/cli.js` (PKG-078); no `private: true` publication blocker
 * (PKG-039); registry-valid package name shared by both manifests (PKG-040); the npm `prepare`
 * lifecycle hook declared so git-source installs (develop channel
 * `npm install -g github:...#<tag>`, REQ-171) build `dist/` into the packed tarball, keeping the
 * installed bin executable per PRJ-020/PRJ-021 without chained dependency installs (PKG-019).
 * Deterministic by construction: every input is a tracked, immutable-at-test-time repository file
 * or a local child-process listing whose only variability (built `dist/**` presence) stays inside
 * the allowlisted `dist/` prefix.
 * @note HDT level 0 (atomic): no internal call-graph dependencies; external npm child
 * invocation is isolated (offline `--dry-run`, bounded by an explicit timeout).
 * @satisfies PKG-033, PKG-034, PKG-035, PKG-036, PKG-037, PKG-038, PKG-039, PKG-040, PKG-075, PKG-078, PKG-116, PRJ-020, PRJ-021, REQ-171, TST-021
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PROJECT_ROOT: string = join(dirname(fileURLToPath(import.meta.url)), "..");

/** npm registry policy: maximum package-name length in characters. */
const NPM_MAX_NAME_LENGTH = 214;

/** Registry-valid package-name grammar: lowercase URL-safe letters, digits, hyphens. */
const NPM_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Deprecated SPDX identifier that MUST NOT appear as the declared license. */
const DEPRECATED_SPDX_ID = "GPL-3.0";

/** Current SPDX identifier required by the publication contract. */
const REQUIRED_SPDX_ID = "GPL-3.0-only";

/** Pack allowlist: every packed path MUST equal an invariant file or start with one prefix. */
const PACK_ALLOWED_INVARIANTS: ReadonlySet<string> = new Set([
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
]);

/** Pack allowlist: directory prefixes whose contents are runtime-shippable (PKG-038). */
const PACK_ALLOWED_PREFIXES: readonly string[] = ["bin/", "dist/", "skills/"];

/** Skills-root payload prefix: only the manifest and `<skill-id>/` files are runtime payload (PKG-024, PKG-075). */
const SKILLS_ROOT_PREFIX = "skills/";

/** Sole file permitted directly under the skills root; every other root entry is authoring documentation. */
const SKILLS_ROOT_MANIFEST = `${SKILLS_ROOT_PREFIX}manifest.json`;

/** The single JavaScript artifact the packed `dist/` tree may hold (PKG-078). */
const RUNTIME_BUNDLE = "dist/cli.js";

/** Minimal shape of one `npm pack --json` entry. */
interface PackEntry {
  files?: { path?: unknown }[];
}

/** Minimal shape of the package.json fields under contract. */
interface PackageManifest {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  license?: unknown;
  private?: unknown;
  main?: unknown;
  bin?: unknown;
  exports?: Record<string, unknown>;
  files?: unknown;
  scripts?: Record<string, unknown>;
}

/** Minimal shape of npm lockfile v3 identity fields. */
interface LockfileIdentity {
  name?: unknown;
  version?: unknown;
  packages?: Record<string, { name?: unknown; version?: unknown; bin?: unknown }>;
}

/**
 * @brief Loads and parses the tracked package.json manifest.
 * @details Synchronous read of the repository-root manifest; parse errors propagate as
 * test failures. Complexity: O(file size).
 * @pre `package.json` exists at the repository root.
 * @return {PackageManifest} Parsed manifest content.
 * @throws {Error} When the manifest is missing or is not valid JSON.
 */
function loadPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")) as PackageManifest;
}

/**
 * @brief Loads and parses the tracked package-lock.json lockfile.
 * @details Synchronous read of the repository-root lockfile; parse errors propagate as
 * test failures. Complexity: O(file size).
 * @pre `package-lock.json` exists at the repository root.
 * @return {LockfileIdentity} Parsed lockfile content.
 * @throws {Error} When the lockfile is missing or is not valid JSON.
 */
function loadLockfile(): LockfileIdentity {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, "package-lock.json"), "utf8")) as LockfileIdentity;
}

/**
 * @brief Reads the tracked README.md document.
 * @details Synchronous read of the repository-root README; the rendered npm landing page
 * source. Complexity: O(file size).
 * @pre `README.md` exists at the repository root.
 * @return {string} Raw README text.
 * @throws {Error} When the README is missing or unreadable.
 */
function readReadme(): string {
  return readFileSync(join(PROJECT_ROOT, "README.md"), "utf8");
}

/**
 * @brief Computes the offline `npm pack --dry-run` tarball file listing.
 * @details Spawns `npm pack --dry-run --json --ignore-scripts` in the repository root and
 * parses the JSON array printed on stdout. The invocation is fully offline (dry run writes
 * no tarball and contacts no registry) and `--ignore-scripts` skips the `prepare` lifecycle
 * build so stdout stays pure JSON regardless of lifecycle script output. Built-artifact
 * variability (present vs absent `dist/**`) is allowed by the caller's allowlist policy.
 * Complexity: O(n) in packed paths plus one bounded child-process round-trip.
 * @return {string[]} Packed tarball paths in npm listing order.
 * @throws {Error} When npm exits non-zero or stdout is not a JSON array.
 */
function packDryRunPaths(): string[] {
  const stdout = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entries = JSON.parse(stdout) as PackEntry[];
  const files = entries[0]?.files ?? [];
  return files.map((file) => String(file?.path ?? ""));
}

/**
 * @brief Classifies one packed tarball path against the allowlist policy.
 * @details A path is allowed iff it equals an npm-invariant metadata file or starts with
 * one of the runtime directory prefixes. Pure predicate; complexity O(p) in prefixes.
 * @param path {string} Packed tarball path.
 * @return {boolean} True when the path complies with the pack allowlist.
 */
function isAllowedPackPath(path: string): boolean {
  return PACK_ALLOWED_INVARIANTS.has(path) || PACK_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * @brief Classifies one packed skills-root path as runtime payload.
 * @details True for the skills manifest and for any file inside a `<skill-id>/` directory; root-level
 * authoring documents are not runtime payload and MUST NOT be published (PKG-038, PKG-075). Pure;
 * complexity O(n) in path length.
 * @param path {string} Packed tarball path.
 * @return {boolean} True when the entry is skills runtime payload.
 */
function isSkillsRuntimePayload(path: string): boolean {
  if (path === SKILLS_ROOT_MANIFEST) {
    return true;
  }
  const segments = path.slice(SKILLS_ROOT_PREFIX.length).split("/");
  return segments.length >= 2 && segments.every((segment) => segment.length > 0);
}

test("test_package_json_declares_current_spdx_license_id", () => {
  // PKG-033: the deprecated SPDX id GPL-3.0 is replaced by GPL-3.0-only.
  // Arrange
  const manifest = loadPackageManifest();
  // Act
  const license = manifest.license;
  // Assert
  const expected_output = REQUIRED_SPDX_ID;
  assert.equal(license, expected_output);
  assert.notEqual(license, DEPRECATED_SPDX_ID);
});

test("test_readme_license_statements_match_package_json_spdx_id", () => {
  // PKG-034: README badge alt text and License section carry GPL-3.0-only;
  // no residual bare GPL-3.0 token may remain outside the -only form.
  // PKG-114: the LICENSE link MUST be an absolute repository URL so it resolves
  // from the npm landing page, because the tarball ships LICENSE but npm does not
  // serve package-relative browsing links.
  // Arrange
  const readme = readReadme();
  const manifest = loadPackageManifest();
  // Act
  const bareDeprecatedTokens = readme.match(/GPL-3\.0(?!-only)/g) ?? [];
  // Assert
  assert.equal(manifest.license, REQUIRED_SPDX_ID);
  assert.equal(readme.includes(`License: ${REQUIRED_SPDX_ID}`), true);
  assert.equal(
    readme.includes(
      `${REQUIRED_SPDX_ID} — see [LICENSE](https://github.com/Ogekuri/mcp-google-api/blob/main/LICENSE)`
    ),
    true,
    "License section MUST link LICENSE through an absolute repository URL (PKG-114)"
  );
  assert.deepEqual(bareDeprecatedTokens, []);
});

test("test_package_json_declares_no_library_entry", () => {
  // PKG-035: the package is a single-bundle CLI; no `main` and no `exports` map may
  // advertise a library API, so no dist/index.js artifact is promised by the manifest.
  // Arrange
  const manifest = loadPackageManifest();
  // Act
  const hasMain = manifest.main !== undefined;
  const hasExports = manifest.exports !== undefined;
  // Assert
  assert.equal(hasMain, false, "package.json must not declare a main entry (PKG-035)");
  assert.equal(hasExports, false, "package.json must not declare an exports map (PKG-035)");
  assert.equal(typeof manifest.bin, "object", "the bin launcher remains the only runtime entry (PRJ-020)");
});

test("test_files_allowlist_ships_changelog_and_runtime_assets", () => {
  // PKG-036/PKG-116: the files allowlist declares CHANGELOG.md plus the bin, dist, and skills
  // runtime prefixes required by the published package, and carries no archive negation because
  // no release tarball ever lives in dist/.
  // Arrange
  const manifest = loadPackageManifest();
  // Act
  const files: string[] = Array.isArray(manifest.files) ? manifest.files.map(String) : [];
  // Assert
  for (const required of ["CHANGELOG.md", "bin", "dist", "skills"]) {
    assert.equal(files.includes(required), true, `files allowlist must include "${required}" (PKG-116)`);
  }
  assert.equal(files.includes("docs"), false, 'files allowlist must not include "docs" (PKG-038: non-runtime)');
  assert.equal(
    files.includes("!dist/*.tgz"),
    false,
    'files allowlist must not negate a dist archive: no archive is produced in dist/ (PKG-102, PKG-116)'
  );
});

/**
 * @brief Asserts that the release bundle configuration does not emit source maps.
 * @details Static regex inspection of `tsup.config.ts`; requires `sourcemap: false` and rejects
 * `sourcemap: true`. Pure; no build, no network. Complexity O(n) in config length.
 * @satisfies PKG-038
 */
test("test_tsup_release_build_emits_no_sourcemaps", () => {
  // PKG-038: source maps are non-runtime artifacts; the release bundle MUST NOT emit them.
  // Arrange
  const config = readFileSync(join(PROJECT_ROOT, "tsup.config.ts"), "utf8");
  // Act
  const emitsSourcemaps = /sourcemap\s*:\s*true/.test(config);
  const declaresNoSourcemaps = /sourcemap\s*:\s*false/.test(config);
  // Assert
  assert.equal(emitsSourcemaps, false, "tsup.config.ts must not set sourcemap: true (PKG-038)");
  assert.equal(declaresNoSourcemaps, true, "tsup.config.ts must declare sourcemap: false (PKG-038)");
});

test("test_lockfile_root_identity_matches_package_json", () => {
  // PKG-037: lockfile root name/version are identical to package.json.
  // Arrange
  const manifest = loadPackageManifest();
  const lockfile = loadLockfile();
  // Act
  const rootEntry = lockfile.packages?.[""] ?? {};
  // Assert
  const expected_output = { name: manifest.name, version: manifest.version };
  assert.equal(lockfile.name, expected_output.name);
  assert.equal(lockfile.version, expected_output.version);
  assert.equal(rootEntry.name, expected_output.name);
  assert.equal(rootEntry.version, expected_output.version);
});

/**
 * @brief Regression guard: the lockfile root `bin` launcher map is identical to package.json.
 * @details The bin-launcher change to the shipped `bin/mcp-google-api.mjs` launcher
 * (PRJ-020, PRJ-021 remediation guidance) left the tracked package-lock.json root entry
 * recording the superseded `dist/cli.js` path; every standard bootstrap (`npm install`)
 * then rewrote the tracked lockfile, dirtying a fresh clone right after setup. Level 0
 * (atomic): reads the two tracked manifests only; no network, clock, randomness, or
 * environment dependence.
 * @satisfies PKG-037, PRJ-020
 */
test("test_lockfile_root_bin_identity_matches_package_json", () => {
  // PKG-037/PRJ-020: the lockfile root entry records the same bin launcher map as package.json.
  // Arrange
  const manifest = loadPackageManifest();
  const lockfile = loadLockfile();
  const expectedBinMap = manifest.bin;
  // Act
  const rootEntry = lockfile.packages?.[""] ?? {};
  // Assert
  const expected_output = expectedBinMap;
  assert.equal(typeof expectedBinMap, "object", "package.json must declare a bin map (PRJ-020)");
  assert.deepEqual(rootEntry.bin, expected_output);
});

test("test_package_json_is_publishable_not_private", () => {
  // PKG-039: no "private": true publication blocker may be declared.
  // Arrange
  const manifest = loadPackageManifest();
  // Act
  const isPrivate = manifest.private === true;
  // Assert
  const expected_output = false;
  assert.equal(isPrivate, expected_output);
});

test("test_package_name_is_registry_valid", () => {
  // PKG-040: one registry-valid name (lowercase, URL-safe, <= 214 chars)
  // shared by package.json and package-lock.json.
  // Arrange
  const manifest = loadPackageManifest();
  const lockfile = loadLockfile();
  // Act
  const name = String(manifest.name ?? "");
  // Assert
  assert.equal(name.length <= NPM_MAX_NAME_LENGTH, true);
  assert.equal(NPM_NAME_PATTERN.test(name), true, `package name "${name}" violates npm naming policy`);
  assert.equal(lockfile.name, name);
});

test("test_prepare_lifecycle_script_builds_dist_for_git_source_packs", () => {
  // PRJ-020/PRJ-021/REQ-171: develop-channel installs pack the fetched git tree via
  // `npm install -g github:Ogekuri/mcp-google-api#<tag>`; npm builds the package only
  // through the `prepare` lifecycle hook during git-dep preparation. Without it the
  // packed tarball ships no `dist/` subtree (evidence: v0.22.4 pack listing) and the
  // installed bin fails with the PRJ-021 remediation error.
  // Arrange
  const manifest = loadPackageManifest();
  const scripts: Record<string, unknown> =
    manifest.scripts && typeof manifest.scripts === "object" ? (manifest.scripts as Record<string, unknown>) : {};
  // Act
  const raw = scripts.prepare;
  const prepare = typeof raw === "string" ? raw.trim() : "";
  // Assert
  const expected_output = "npm run build";
  assert.equal(
    prepare,
    expected_output,
    "package.json must define scripts.prepare building dist/ so git-source installs pack a runnable artifact (PRJ-020, REQ-171)",
  );
  assert.equal(
    /\bnpm\s+(ci|install)\b/.test(prepare),
    false,
    "prepare must not chain dependency installs (PKG-019 helper-script discipline)",
  );
});

test("test_packed_tarball_contents_follow_allowlist_policy", () => {
  // PKG-038/PKG-075: every packed path stays inside the allowlist (invariants plus the bin, dist,
  // and skills runtime prefixes); invariant metadata is present; tests, local configuration,
  // lockfile, secret-looking files, repository sources, and every archive are excluded.
  // PKG-078: any packed dist/ entry is exactly the single runtime bundle.
  // Arrange
  const forbiddenPrefixes = ["tests/", "usereq/", "scripts/", "src/", ".github/", ".git", "docs/"];
  const forbiddenFiles = new Set([
    "package-lock.json",
    ".gitignore",
    ".npmrc",
    ".env",
    "eslint.config.js",
    "tsconfig.json",
    "tsup.config.ts",
  ]);
  const secretPatterns = [/(^|\/)\.env$/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /(^|\/)id_rsa/i];
  // Act
  const paths = packDryRunPaths();
  // Assert
  assert.equal(paths.length > 0, true, "npm pack dry run must list at least one file");
  for (const path of paths) {
    assert.equal(
      isAllowedPackPath(path),
      true,
      `packed path "${path}" is outside the publication allowlist (PKG-038)`
    );
    assert.equal(forbiddenFiles.has(path), false, `packed path "${path}" must not ship (PKG-038)`);
    for (const prefix of forbiddenPrefixes) {
      assert.equal(path.startsWith(prefix), false, `packed path "${path}" must not ship (PKG-038)`);
    }
    for (const pattern of secretPatterns) {
      assert.equal(pattern.test(path), false, `packed path "${path}" looks like a secret file (PKG-038)`);
    }
    assert.equal(path.endsWith(".tgz"), false, `packed path "${path}" is a package archive (PKG-093)`);
    assert.equal(path.endsWith(".map"), false, `packed path "${path}" is a source map, non-runtime (PKG-038)`);
    assert.equal(path.endsWith(".ts"), false, `packed path "${path}" is a repository source (PKG-127)`);
    if (path.startsWith("dist/")) {
      assert.equal(path, RUNTIME_BUNDLE, `packed dist/ entry "${path}" must be the single runtime bundle (PKG-078)`);
    }
    if (path.startsWith(SKILLS_ROOT_PREFIX)) {
      assert.equal(
        isSkillsRuntimePayload(path),
        true,
        `packed skills entry "${path}" must be manifest.json or a <skill-id>/ file (PKG-038, PKG-075)`
      );
    }
  }
  for (const invariant of PACK_ALLOWED_INVARIANTS) {
    assert.equal(paths.includes(invariant), true, `tarball must ship invariant file "${invariant}"`);
  }
  assert.equal(paths.some((path) => path.startsWith(SKILLS_ROOT_PREFIX)), true, "tarball must ship skills");
  assert.equal(
    paths.includes(`${SKILLS_ROOT_PREFIX}README.md`),
    false,
    "skills authoring guide must not be packed (PKG-038, PKG-075)"
  );
});
