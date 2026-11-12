#!/usr/bin/env node
/**
 * @file prune-generated-dist.mjs
 * @brief Generated-output pruner of the `build` lifecycle, replacing the tsup `clean` option.
 * @details Removes every stale generated artifact of earlier builds from `dist/` before the tsup
 *          compile runs, classifying entries with the PKG-072 generated set
 *          (`*.js`, `*.js.map`, `*.d.ts`, `*.d.ts.map`, `*.tsbuildinfo`, `*.tmp`) while excluding
 *          every `*.tgz` archive, because the committed release archive
 *          `dist/<name>-<version>.tgz` is a tracked release artifact owned exclusively by
 *          `scripts/build.sh` (PKG-102, PKG-117, PKG-119). A preflight guard aborts before the first
 *          removal when `node_modules/.bin/tsup` is absent, so a toolchain-less invocation never
 *          destroys the tracked runtime bundle (PKG-120). Non-generated entries, symbolic links,
 *          and directories are never removed; directories left empty by a removal are pruned
 *          deepest-first, `dist/` itself only when it ends up empty. An absent `dist/` is a
 *          successful no-op (fresh checkout, `prepare` of a git-ref install).
 * @requires node:fs (existsSync, readdirSync, lstatSync, rmSync, rmdirSync), node:path (join, dirname), node:url
 * @satisfies PKG-117, PKG-118, PKG-119, PKG-120
 * @note Exit code 0 when the pruner removed nothing or every stale output; 1 when `dist/` is not a
 *       directory, when the compiler binary is absent (no removal is then performed, PKG-120), or
 *       when a removal fails. stdout carries `[prune-generated-dist]` diagnostics only.
 * @warning Called by `tools/build-dist-lifecycle.mjs`, the `package.json` `scripts.build` orchestrator
 *          that owns the PKG-121 restore-on-failure step; never call it from `scripts/build.sh`, whose
 *          cleanup phase (PKG-071, PKG-105, PKG-106) already owns the full generated set including
 *          every `*.tgz`.
 * @see tsup.config.ts (`clean: false`), scripts/build.sh, tools/build-dist-lifecycle.mjs
 */
import { existsSync, lstatSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repository root resolved from this script location, so the pruner is cwd-independent.
 * @type {string}
 */
const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Build output directory owned by both the compiler and the release build script.
 * @type {string}
 */
const DIST_DIR = join(PROJECT_ROOT, "dist");

/**
 * Generated-output suffixes of the PKG-072 classification minus `*.tgz`.
 * @details Every suffix makes a `dist/` regular file a generated artifact of an earlier build; the
 *          `*.tgz` archive class is deliberately absent so the committed release archive survives
 *          every `prepare` and `build` run (PKG-117).
 * @type {readonly string[]}
 */
const GENERATED_SUFFIXES = Object.freeze([".js", ".js.map", ".d.ts", ".d.ts.map", ".tsbuildinfo", ".tmp"]);

/**
 * Archive suffix preserved by every pruner run regardless of the packaged version.
 * @type {string}
 */
const ARCHIVE_SUFFIX = ".tgz";

/**
 * Diagnostic tag prefixed to every emitted line.
 * @type {string}
 */
const TAG = "[prune-generated-dist]";

/**
 * Installed compiler binary whose absence forbids every removal (PKG-120).
 * @details The pruner runs immediately before the compiler in the `build` lifecycle, so a missing
 *          compiler would leave `dist/` without its tracked runtime bundle; the guard aborts before
 *          the first `rmSync` call instead.
 * @type {string}
 */
const TSUP_BIN = join(PROJECT_ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsup.cmd" : "tsup");

/**
 * @brief Reports one informational line on stdout.
 * @details Concatenates the tag, the supplied fragments, and a newline. No return value; writes to
 *          stdout only.
 * @param {...string} fragments {string} Diagnostic fragments joined by one space.
 * @return {void}
 * @side_effect Writes one stdout line.
 */
function log(...fragments) {
  process.stdout.write(`${TAG} ${fragments.join(" ")}\n`);
}

/**
 * @brief Classifies one dist-relative file name as a removable generated output.
 * @details Pure suffix classification: true when the name ends with a PKG-072 generated suffix and
 *          does not end with the archive suffix. Complexity O(k) with k suffixes.
 * @param {string} name {string} File name relative to `dist/` (POSIX segments allowed).
 * @return {boolean} True when the file is a stale generated output safe to remove (PKG-119).
 * @satisfies PKG-119
 */
function isRemovableGeneratedOutput(name) {
  if (name.endsWith(ARCHIVE_SUFFIX)) {
    return false;
  }
  return GENERATED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * @brief Removes one empty directory, tolerating directories that still hold entries.
 * @details Uses `rmdirSync` so a non-empty directory is preserved by design (it carries
 *          non-generated content). Complexity O(1) plus one directory listing on failure.
 * @param {string} directory {string} Candidate ancestor directory of a removed artifact.
 * @return {void}
 * @side_effect Removes `directory` when it is empty.
 */
function pruneEmptyDirectory(directory) {
  try {
    rmdirSync(directory);
    log(`pruned emptied directory: ${directory}`);
  } catch {
    // Non-empty directory: preserved by design (PKG-118).
  }
}

/**
 * @brief Recursively collects the removal plan of one `dist/` subtree.
 * @details Walks the subtree without following symbolic links, appending every regular file that
 *          passes `isRemovableGeneratedOutput` to `plan` and recording the directory listing of each
 *          visited directory so emptied ancestors can be pruned deepest-first. Complexity O(n) in
 *          `dist/` entry count.
 * @param {string} directory {string} Absolute directory to scan.
 * @param {string} relativePrefix {string} Path prefix relative to `dist/` ("" for the root).
 * @param {{ files: string[], directories: string[] }} plan {object} Accumulator: absolute files to
 *        remove plus absolute directories visited deepest-last.
 * @return {void}
 * @side_effect Appends to `plan` only; never mutates the filesystem.
 */
function collectRemovalPlan(directory, relativePrefix, plan) {
  const entries = readdirSync(directory, { withFileTypes: false });
  plan.directories.push(directory);
  for (const entry of entries) {
    const absolutePath = join(directory, entry);
    const relativePath = relativePrefix === "" ? entry : `${relativePrefix}/${entry}`;
    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
      continue;
    }
    if (stats.isDirectory()) {
      collectRemovalPlan(absolutePath, relativePath, plan);
      continue;
    }
    if (stats.isFile() && isRemovableGeneratedOutput(relativePath)) {
      plan.files.push(absolutePath);
    }
  }
}

/**
 * @brief Removes every stale generated output from `dist/` and prunes emptied directories.
 * @details No-op when `dist/` is absent; aborts with exit code 1 when the compiler binary is absent
 *          (no removal performed, PKG-120), when `dist/` is not a directory, or when a removal
 *          fails. Removed artifacts and pruned directories are reported on stdout. Complexity O(n)
 *          in `dist/` entry count.
 * @return {number} Exit code: 0 on success; 1 on an unusable `dist/`, a missing compiler, or a
 *         failed removal.
 * @throws {NodeJS.ErrnoException} Propagated by `readdirSync`/`rmSync` before the caller maps it to
 *         exit code 1.
 * @satisfies PKG-117, PKG-118, PKG-119, PKG-120
 * @post Every removable generated output is gone and every `*.tgz` archive is untouched, or no entry
 *       was removed when the preflight aborted.
 */
function pruneGeneratedDist() {
  let rootStats;
  try {
    rootStats = lstatSync(DIST_DIR);
  } catch {
    log("nothing to prune: dist/ is absent");
    return 0;
  }
  if (!rootStats.isDirectory()) {
    process.stderr.write(`${TAG} FAILED: ${DIST_DIR} is not a directory\n`);
    return 1;
  }
  if (!existsSync(TSUP_BIN)) {
    process.stderr.write(
      `${TAG} FAILED: ${TSUP_BIN} missing; no generated output removed (PKG-120); install dependencies with 'npm ci' first\n`,
    );
    return 1;
  }
  /** @type {{ files: string[], directories: string[] }} */
  const plan = { files: [], directories: [] };
  collectRemovalPlan(DIST_DIR, "", plan);
  for (const file of plan.files) {
    rmSync(file, { force: true });
    log(`removed stale generated output: ${file}`);
  }
  for (const directory of plan.directories.slice().reverse()) {
    pruneEmptyDirectory(directory);
  }
  log(`pruned ${plan.files.length} stale generated output(s) from ${DIST_DIR}/`);
  return 0;
}

process.exitCode = pruneGeneratedDist();
