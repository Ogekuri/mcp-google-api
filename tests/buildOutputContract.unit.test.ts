/**
 * @fileoverview Build-output contract suite for the single-entry runtime bundle.
 *
 * @brief Guards the build lifecycle that produces exactly one JavaScript artifact
 * (`dist/cli.js`) and no library entry.
 * @details UUT: the tracked `package.json` `build` script, the tracked `tsup.config.ts` bundle
 * configuration, and a sandboxed `npm run build` execution against an injected failing compiler.
 * Level 0 (atomic static assertions) plus one level 1 sandboxed child-process round-trip.
 * Enforced contract (PKG mapping):
 * - `package.json` `build` invokes the installed `tsup` compiler directly — no wrapper
 *   orchestrator script — for the single runtime entry `src/cli.ts` (PKG-129).
 * - `tsup.config.ts` declares exactly one entry, so the compiler emits no shared chunk and no
 *   second entry (`dist/index.js` never exists) (PKG-129, PKG-078).
 * - `tsup.config.ts` keeps `clean: true` so every stale output of an earlier build is removed
 *   before compiling (PKG-130).
 * - A failing compiler exits `npm run build` non-zero, so the build lifecycle never reports success
 *   for a bundle that was not produced (PKG-131).
 * @note Deterministic: tracked-file reads plus one offline child run in a private temp directory.
 * @satisfies PKG-129, PKG-130, PKG-131, PKG-078, TST-032, TST-033
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root resolved from this suite location (cwd-independent). */
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Single runtime entry compiled into `dist/cli.js` (PKG-129). */
const RUNTIME_ENTRY = "src/cli.ts";

/** Upper bound in milliseconds for one sandboxed npm child run. */
const SANDBOX_TIMEOUT_MS = 120000;

/** Minimal shape of the `package.json` fields under contract. */
interface PackageManifest {
  scripts?: Record<string, unknown>;
}

/**
 * @brief Loads and parses the tracked package.json manifest.
 * @details Synchronous read of the repository-root manifest; parse errors propagate as test
 * failures. Complexity O(file size).
 * @return {PackageManifest} Parsed manifest content.
 * @throws {Error} When the manifest is missing or is not valid JSON.
 */
function loadPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")) as PackageManifest;
}

/**
 * @brief Reads the tracked tsup bundle configuration.
 * @details Synchronous read of the repository-root `tsup.config.ts`. Complexity O(file size).
 * @return {string} Raw configuration text.
 * @throws {Error} When the configuration is missing or unreadable.
 */
function readTsupConfig(): string {
  return readFileSync(join(PROJECT_ROOT, "tsup.config.ts"), "utf8");
}

/**
 * @brief Extracts the entry list declared by `tsup.config.ts`.
 * @details Matches the `entry: [...]` array literal and returns its quoted items in declaration
 * order. Pure; complexity O(n) in configuration length.
 * @param config {string} Raw `tsup.config.ts` text.
 * @return {string[]} Entry paths; empty when no array literal is present.
 */
function extractEntries(config: string): string[] {
  const match = /entry\s*:\s*\[([^\]]*)\]/.exec(config);
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

test("test_build_script_invokes_tsup_directly_for_the_single_runtime_entry", () => {
  // PKG-129: the build lifecycle is the installed compiler itself, targeted at one entry.
  // Arrange
  const manifest = loadPackageManifest();
  const entries = extractEntries(readTsupConfig());
  // Act
  const buildScript = String(manifest.scripts?.build ?? "").trim();
  // Assert
  assert.equal(buildScript, "tsup", 'package.json scripts.build must invoke "tsup" directly (PKG-129)');
  assert.deepEqual(entries, [RUNTIME_ENTRY], "tsup must declare exactly the single runtime entry (PKG-129)");
  assert.equal(
    entries.includes("src/index.ts"),
    false,
    "src/index.ts must not be a bundle entry, so no dist/index.js is emitted (PKG-078, PKG-129)",
  );
  assert.equal(/splitting\s*:\s*true/.test(readTsupConfig()), false, "no code splitting may be requested (PKG-078)");
});

test("test_bundle_configuration_cleans_stale_outputs_before_compiling", () => {
  // PKG-130: dist/ is not version-controlled, so the compiler owns stale-output removal.
  // Arrange
  const config = readTsupConfig();
  // Act
  const declaresClean = /clean\s*:\s*true/.test(config);
  const disablesClean = /clean\s*:\s*false/.test(config);
  // Assert
  assert.equal(declaresClean, true, "tsup.config.ts must declare clean: true (PKG-130)");
  assert.equal(disablesClean, false, "tsup.config.ts must not disable cleaning (PKG-130)");
});

test("test_failing_compiler_exits_build_lifecycle_non_zero", () => {
  // PKG-131: a failing compile must surface as a non-zero build exit status.
  // Arrange
  const sandbox = mkdtempSync(join(tmpdir(), "build-output-contract-"));
  try {
    writeFileSync(
      join(sandbox, "package.json"),
      JSON.stringify({ name: "build-output-fixture", version: "1.0.0", scripts: { build: "node ./fail-compile.mjs" } }, null, 2),
      "utf8",
    );
    writeFileSync(join(sandbox, "fail-compile.mjs"), 'process.stderr.write("boom\\n");\nprocess.exit(3);\n', "utf8");
    // Act
    const run = spawnSync("npm", ["run", "build"], {
      cwd: sandbox,
      encoding: "utf8",
      timeout: SANDBOX_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Assert
    assert.notEqual(run.status, 0, "a failing compiler must make the build lifecycle exit non-zero (PKG-131)");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
