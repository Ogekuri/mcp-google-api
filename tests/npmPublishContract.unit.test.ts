/**
 * @fileoverview npm publication contract suite for package metadata and packed tarball contents.
 *
 * @brief Guards npm publication policies and best practices across package.json, README.md,
 * package-lock.json, and the `npm pack --dry-run` tarball listing.
 * @details UUT: the tracked publication manifests themselves plus the deterministic offline
 * packer listing (`npm pack --dry-run --json`; no network, no registry access, no tarball
 * write). Enforced contract: current non-deprecated SPDX license identifier `GPL-3.0-only`
 * in package.json (PKG-033) and in the README.md license badge plus License section with no
 * residual deprecated bare `GPL-3.0` token (PKG-034); explicit ESM `exports` map with the
 * `.` entry targeting `./dist/index.js`, the `./package.json` subpath entry, and `main`
 * consistent with the `.` target (PKG-035); `CHANGELOG.md` shipped through the `files`
 * allowlist (PKG-036); package-lock.json root `name`/`version` identity with package.json
 * (PKG-037); packed paths restricted to allowlisted runtime prefixes plus npm-invariant
 * metadata files while excluding tests, local configuration, and secret files (PKG-038);
 * no `private: true` publication blocker (PKG-039); registry-valid package name shared by
 * both manifests (PKG-040). Deterministic by construction: every input is a tracked,
 * immutable-at-test-time repository file or a local child-process listing whose only
 * variability (built `dist/**` presence) stays inside the allowlisted `dist/` prefix.
 * @note HDT level 0 (atomic): no internal call-graph dependencies; external npm child
 * invocation is isolated (offline `--dry-run`, bounded by an explicit timeout).
 * @satisfies PKG-033, PKG-034, PKG-035, PKG-036, PKG-037, PKG-038, PKG-039, PKG-040, TST-021
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
  ".env.example",
]);

/** Pack allowlist: directory prefixes whose contents are runtime-shippable. */
const PACK_ALLOWED_PREFIXES: readonly string[] = ["dist/", "docs/", "src/resources/"];

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
  exports?: Record<string, unknown>;
  files?: unknown;
}

/** Minimal shape of npm lockfile v3 identity fields. */
interface LockfileIdentity {
  name?: unknown;
  version?: unknown;
  packages?: Record<string, { name?: unknown; version?: unknown }>;
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
 * @details Spawns `npm pack --dry-run --json` in the repository root and parses the JSON
 * array printed on stdout. The invocation is fully offline (dry run writes no tarball,
 * contacts no registry, and runs no lifecycle scripts because none of `prepack`,
 * `prepare`, or `postpack` is defined). Built-artifact variability (present vs absent
 * `dist/**`) is allowed by the caller's allowlist policy. Complexity: O(n) in packed
 * paths plus one bounded child-process round-trip.
 * @return {string[]} Packed tarball paths in npm listing order.
 * @throws {Error} When npm exits non-zero or stdout is not a JSON array.
 */
function packDryRunPaths(): string[] {
  const stdout = execFileSync("npm", ["pack", "--dry-run", "--json"], {
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
  // Arrange
  const readme = readReadme();
  const manifest = loadPackageManifest();
  // Act
  const bareDeprecatedTokens = readme.match(/GPL-3\.0(?!-only)/g) ?? [];
  // Assert
  assert.equal(manifest.license, REQUIRED_SPDX_ID);
  assert.equal(readme.includes(`License: ${REQUIRED_SPDX_ID}`), true);
  assert.equal(readme.includes(`${REQUIRED_SPDX_ID} — see [LICENSE](LICENSE)`), true);
  assert.deepEqual(bareDeprecatedTokens, []);
});

test("test_exports_map_targets_built_esm_entry", () => {
  // PKG-035: explicit ESM exports map; "." targets the built entry,
  // "./package.json" stays readable, main is consistent with the "." target.
  // Arrange
  const manifest = loadPackageManifest();
  // Act
  const exportsMap = manifest.exports ?? {};
  // Assert
  const expected_output = {
    dot: "./dist/index.js",
    packageJson: "./package.json",
    main: "./dist/index.js",
  };
  assert.equal(exportsMap["."], expected_output.dot);
  assert.equal(exportsMap["./package.json"], expected_output.packageJson);
  assert.equal(String(manifest.main ?? "").replace(/^\.\//, ""), expected_output.dot.replace(/^\.\//, ""));
});

test("test_files_allowlist_ships_changelog_and_runtime_assets", () => {
  // PKG-036: the files allowlist declares CHANGELOG.md plus every runtime
  // asset prefix required by the published package.
  // Arrange
  const manifest = loadPackageManifest();
  // Act
  const files: string[] = Array.isArray(manifest.files) ? manifest.files.map(String) : [];
  // Assert
  for (const required of ["CHANGELOG.md", "dist", "src/resources/skills", "docs", ".env.example"]) {
    assert.equal(files.includes(required), true, `files allowlist must include "${required}"`);
  }
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

test("test_packed_tarball_contents_follow_allowlist_policy", () => {
  // PKG-038: every packed path stays inside the allowlist (invariants plus
  // runtime prefixes); invariant metadata is present; tests, local
  // configuration, lockfile, and secret-looking files are excluded.
  // Arrange
  const forbiddenPrefixes = ["tests/", "usereq/", "scripts/", ".github/", ".git"];
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
  }
  for (const invariant of PACK_ALLOWED_INVARIANTS) {
    assert.equal(paths.includes(invariant), true, `tarball must ship invariant file "${invariant}"`);
  }
  assert.equal(paths.some((path) => path.startsWith("docs/")), true, "tarball must ship docs/");
  assert.equal(paths.some((path) => path.startsWith("src/resources/")), true, "tarball must ship skills");
});
