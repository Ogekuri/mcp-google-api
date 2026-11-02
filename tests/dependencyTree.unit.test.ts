/**
 * @fileoverview Packaging invariant tests for the published production dependency tree.
 *
 * @brief Guards package-lock.json against deprecated/security-flagged transitive packages.
 * @details Reproducer suite for the install-time deprecation warnings reported on
 * `npm install -g mcp-google-map`. Resolution chain observed with @googlemaps/places@2.x:
 * `@googlemaps/places@2.5.0` -> `google-gax@5.0.8` -> `rimraf@5.0.10` -> `glob@10.5.0`
 * (npm deprecation: "widely publicized security vulnerabilities"). Upgrading the declared
 * range to `@googlemaps/places ^3.1.0` (google-gax@^6, which has no rimraf/glob dependency)
 * removes the package from the tree.
 * Deterministic by construction: reads only tracked repository files (package.json,
 * package-lock.json); no network, clock, randomness, or environment dependence.
 * @note HDT level 0 (atomic): unit under test is the repository dependency manifest.
 * @satisfies CTN-005
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const packageRoot: string = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Shape of a single `packages` entry in npm lockfile v3. */
interface LockfilePackageEntry {
  version?: string;
  deprecated?: string;
}

/** Minimal shape of npm lockfile v3. */
interface Lockfile {
  packages?: Record<string, LockfilePackageEntry>;
}

/**
 * @brief Loads and parses package-lock.json from the repository root.
 * @details Synchronous read of the tracked lockfile; parsing errors propagate.
 * @pre package-lock.json exists at the repository root.
 * @return {Lockfile} Parsed lockfile content.
 * @throws {Error} When the lockfile is missing or is not valid JSON.
 * @note Complexity: O(file size).
 */
function loadLockfile(): Lockfile {
  const raw: string = readFileSync(join(packageRoot, "package-lock.json"), "utf8");
  return JSON.parse(raw) as Lockfile;
}

test("test_lockfile_production_tree_excludes_deprecated_glob_packages", () => {
  // Arrange
  const lockfile: Lockfile = loadLockfile();
  const entries: Record<string, LockfilePackageEntry> = lockfile.packages ?? {};

  // Act: collect every tree position occupied by the glob package (any nesting depth).
  const globEntries: string[] = Object.keys(entries).filter((key) =>
    /(^|\/)node_modules\/glob$/.test(key)
  );

  // Assert: deprecated glob@10 (publicized security vulnerabilities) must not be installed.
  assert.deepEqual(
    globEntries,
    [],
    `deprecated glob package present in dependency tree: ${globEntries.join(", ")}`
  );
});

test("test_lockfile_declares_places_sdk_major_3", () => {
  // Arrange
  const lockfile: Lockfile = loadLockfile();
  const entry: LockfilePackageEntry | undefined =
    lockfile.packages?.["node_modules/@googlemaps/places"];

  // Act
  const major: number | undefined = entry?.version
    ? Number.parseInt(entry.version.split(".")[0] ?? "", 10)
    : undefined;

  // Assert: resolved @googlemaps/places must be google-gax@6-based SDK v3.
  assert.ok(entry, "@googlemaps/places entry missing from package-lock.json");
  assert.equal(
    major,
    3,
    `@googlemaps/places locked to major ${String(major)}, expected 3 (google-gax@6 tree)`
  );
});
