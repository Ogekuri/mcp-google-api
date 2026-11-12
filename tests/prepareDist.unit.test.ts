/**
 * @fileoverview Prepare-lifecycle contract suite for the packaged runtime bundle restoration.
 *
 * @brief Guards `tools/prepare-dist.mjs` and its `package.json` wiring: git-source installs must
 * obtain `dist/cli.js` without a compiler toolchain.
 * @details Reproducer for the develop-channel install failure
 * `npm install -g github:Ogekuri/mcp-google-api#<tag>` -> `prepare` -> `npm run build` ->
 * `sh: 1: tsup: not found` (exit 127). npm runs the root `prepare` lifecycle inside the git
 * dependency checkout before `node_modules/.bin` links are available, so a compiler-backed
 * prepare aborts REQ-171. The fix restores the runtime bundle from the committed release
 * tarball (PKG-091, PKG-113) when no compiler binary is linked.
 * Enforced contract:
 * - `package.json` `prepare` runs the dedicated prepare script and chains no dependency install
 *   (PKG-019, PRJ-020, PRJ-021, REQ-171).
 * - Without a linked compiler the committed release tarball is unpacked into `dist/cli.js`
 *   byte-for-byte, leaving the tarball in place (PKG-091, PKG-113).
 * - The committed release tarball takes precedence over a linked compiler, so installs stay
 *   deterministic and never delete the tracked tarball through a clean-output build
 *   (PKG-091, PKG-113, PKG-134).
 * - An already present runtime bundle is never overwritten, so the `prepublishOnly` build result
 *   survives the `prepare` hook of `npm publish` (PKG-005).
 * - Without compiler and without release tarball the script aborts non-zero with remediation.
 * @note HDT level 1: static manifest assertions plus sandboxed child-process runs in a private
 * temporary directory seeded with a fixture tarball; offline and deterministic.
 * @satisfies PKG-005, PKG-019, PKG-091, PKG-113, PKG-134, PRJ-020, PRJ-021, REQ-171
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root resolved from this suite location (cwd-independent). */
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Repository-relative path of the tracked prepare script under test. */
const SCRIPT_RELATIVE_PATH = "tools/prepare-dist.mjs";

/** Repository-relative runtime bundle the installed bin executes (PRJ-020). */
const RUNTIME_BUNDLE = join("dist", "cli.js");

/** Sandbox package name declaring the expected release tarball basename (PKG-091). */
const SANDBOX_NAME = "prepare-dist-fixture";

/** Sandbox package version declaring the expected release tarball basename (PKG-091). */
const SANDBOX_VERSION = "1.2.3";

/** Expected sandbox release tarball basename (PKG-091, PKG-113). */
const SANDBOX_TARBALL = `${SANDBOX_NAME}-${SANDBOX_VERSION}.tgz`;

/** Packed member holding the shipped runtime bundle inside the release tarball. */
const PACKED_BUNDLE_MEMBER = join("package", "dist", "cli.js");

/** Seeded bundle content transported by the fixture release tarball. */
const SEEDED_BUNDLE = "// seeded release bundle\nconsole.log(\"prepare-dist fixture\");\n";

/** Upper bound in milliseconds for one sandboxed prepare run. */
const SANDBOX_TIMEOUT_MS = 120000;

/** Marker file written by the compiler stub when it is executed. */
const COMPILER_MARKER = "compiler-ran.txt";

/**
 * @brief Creates an isolated sandbox declaring the fixture package identity.
 * @details Copies the tracked prepare script so the sandbox resolves as its own repository root,
 * seeds `package.json`, and creates the empty `dist` directory.
 * @return {string} Absolute sandbox directory path.
 */
function createSandbox(): string {
  const sandbox = mkdtempSync(join(tmpdir(), "mcp-google-api-prepare-"));
  mkdirSync(join(sandbox, "tools"), { recursive: true });
  writeFileSync(
    join(sandbox, "tools", "prepare-dist.mjs"),
    readFileSync(join(PROJECT_ROOT, SCRIPT_RELATIVE_PATH), "utf8"),
  );
  writeFileSync(
    join(sandbox, "package.json"),
    `${JSON.stringify({ name: SANDBOX_NAME, version: SANDBOX_VERSION }, null, 2)}\n`,
  );
  mkdirSync(join(sandbox, "dist"), { recursive: true });
  return sandbox;
}

/**
 * @brief Seeds the sandbox with a release tarball carrying the fixture runtime bundle.
 * @details Packs `<sandbox>/seed/package/dist/cli.js` through `tar` so the fixture mirrors the
 * npm-packed layout of the committed release artifact (PKG-091).
 * @param sandbox {string} Absolute sandbox directory path.
 * @return {void}
 */
function seedReleaseTarball(sandbox: string): void {
  const seedRoot = join(sandbox, "seed");
  mkdirSync(join(seedRoot, "package", "dist"), { recursive: true });
  writeFileSync(join(seedRoot, PACKED_BUNDLE_MEMBER), SEEDED_BUNDLE);
  const packed = spawnSync(
    "tar",
    ["-czf", join(sandbox, "dist", SANDBOX_TARBALL), "-C", seedRoot, "package"],
    { encoding: "utf8" },
  );
  assert.equal(packed.status, 0, `fixture tarball packing failed: ${packed.stderr}`);
}

/**
 * @brief Seeds the sandbox with an executable compiler stub linked by npm.
 * @details The stub records its execution through a marker file, so a test can prove whether
 * the prepare stage preferred the committed release tarball over a source build.
 * @param sandbox {string} Absolute sandbox directory path.
 * @return {void}
 */
function seedCompilerStub(sandbox: string): void {
  const binDir = join(sandbox, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const stubPath = join(binDir, process.platform === "win32" ? "tsup.cmd" : "tsup");
  writeFileSync(stubPath, `#!/bin/sh\nprintf ran > "${join(sandbox, COMPILER_MARKER)}"\nexit 0\n`);
  chmodSync(stubPath, 0o755);
}

/**
 * @brief Runs the sandboxed prepare script as a child process.
 * @param sandbox {string} Absolute sandbox directory path.
 * @return {{ status: number | null, stdout: string, stderr: string }} Captured child outcome.
 */
function runPrepare(sandbox: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [join(sandbox, "tools", "prepare-dist.mjs")], {
    cwd: sandbox,
    encoding: "utf8",
    timeout: SANDBOX_TIMEOUT_MS,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("test_prepare_lifecycle_runs_the_prepare_dist_script", () => {
  // Arrange
  const manifest = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, unknown>;
  };

  // Act
  const raw = manifest.scripts?.prepare;
  const prepare = typeof raw === "string" ? raw.trim() : "";

  // Assert
  assert.equal(
    prepare,
    `node ${SCRIPT_RELATIVE_PATH}`,
    "package.json scripts.prepare must run the compiler-free prepare script so git-source installs keep a runnable dist/ (PRJ-020, REQ-171)",
  );
  assert.equal(
    /\bnpm\s+(ci|install)\b/.test(prepare),
    false,
    "prepare must not chain dependency installs (PKG-019 helper-script discipline)",
  );
});

test("test_prepare_restores_bundle_from_committed_release_tarball_without_compiler", () => {
  // Arrange: no node_modules, no linked compiler; only the committed release tarball.
  const sandbox = createSandbox();
  try {
    seedReleaseTarball(sandbox);

    // Act
    const outcome = runPrepare(sandbox);

    // Assert: exit 0 and the exact packed bundle materialized (PKG-091, PKG-113, PRJ-020).
    assert.equal(outcome.status, 0, `prepare failed: ${outcome.stderr}`);
    const restored = readFileSync(join(sandbox, RUNTIME_BUNDLE), "utf8");
    assert.equal(restored, SEEDED_BUNDLE, "prepare must unpack package/dist/cli.js byte-for-byte");
    assert.equal(
      existsSync(join(sandbox, "dist", SANDBOX_TARBALL)),
      true,
      "prepare must keep the committed release tarball in place (PKG-091)",
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("test_prepare_prefers_the_committed_release_tarball_over_a_linked_compiler", () => {
  // Arrange: both bundle sources available; the release tarball must win (PKG-091, PKG-113).
  const sandbox = createSandbox();
  try {
    seedReleaseTarball(sandbox);
    seedCompilerStub(sandbox);

    // Act
    const outcome = runPrepare(sandbox);

    // Assert: the tracked release artifact is authoritative and no build wiped it.
    assert.equal(outcome.status, 0, `prepare failed: ${outcome.stderr}`);
    assert.equal(readFileSync(join(sandbox, RUNTIME_BUNDLE), "utf8"), SEEDED_BUNDLE);
    assert.equal(
      existsSync(join(sandbox, COMPILER_MARKER)),
      false,
      "prepare must not run a clean-output build while the committed release tarball exists (PKG-091, PKG-134)",
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("test_prepare_preserves_an_existing_runtime_bundle", () => {
  // Arrange: a previously built bundle and no release tarball source.
  const sandbox = createSandbox();
  try {
    const builtBundle = "// freshly compiled bundle\n";
    mkdirSync(join(sandbox, "dist"), { recursive: true });
    writeFileSync(join(sandbox, RUNTIME_BUNDLE), builtBundle);

    // Act
    const outcome = runPrepare(sandbox);

    // Assert: the prepublishOnly build result is never replaced (PKG-005, PRJ-020).
    assert.equal(outcome.status, 0, `prepare failed: ${outcome.stderr}`);
    assert.equal(readFileSync(join(sandbox, RUNTIME_BUNDLE), "utf8"), builtBundle);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("test_prepare_aborts_with_remediation_when_no_bundle_source_exists", () => {
  // Arrange: neither compiler nor release tarball is available.
  const sandbox = createSandbox();
  try {
    // Act
    const outcome = runPrepare(sandbox);

    // Assert: non-zero exit plus actionable remediation naming both paths (PRJ-021).
    assert.notEqual(outcome.status, 0, "prepare must abort when no bundle source exists");
    assert.match(outcome.stderr, /prepare-dist/i, "diagnostic must identify the failing stage");
    assert.match(outcome.stderr, /npm run build|npm install/i, "diagnostic must carry build remediation");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
