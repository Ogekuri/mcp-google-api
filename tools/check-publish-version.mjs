#!/usr/bin/env node
/**
 * @file check-publish-version.mjs
 * @brief npm publish version guard enforcing PKG-017 as first stage of the `prepublishOnly` chain.
 * @details Refuses publication when the declared package version is placeholder-based
 *          (prefix `0.0.0`, e.g. `0.0.0`, `0.0.0-stage`) or carries a semver prerelease or
 *          build suffix (e.g. `0.2.0-stage`, `1.2.3+build.1`), because such versions violate
 *          PKG-006 and enabled the stray `0.0.0-stage` registry publication.
 *          Version resolution order: `npm_package_version` environment variable (set by npm
 *          inside lifecycle scripts), else `package.json` parsed from the parent directory of
 *          this script (robust against arbitrary cwd). Exit code 0 allows the publish chain to
 *          continue; exit code 1 aborts `prepublishOnly` and therefore the whole `npm publish`.
 * @satisfies PKG-017
 * @note stdout is never used: all diagnostics go to stderr as `[check-publish-version]` lines.
 * @warning This guard protects repository-controlled publish invocations only; an external
 *          script that bypasses `npm publish` in the package directory is out of its reach.
 * @see package.json `scripts.prepublishOnly`, `tools/check-publish-version.mjs`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Strict release SemVer pattern: exactly `X.Y.Z`, no prerelease, no build metadata.
 */
const STRICT_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Placeholder version prefix that must never reach the public registry (PKG-006, PKG-017).
 */
const PLACEHOLDER_VERSION_PREFIX = "0.0.0";

/**
 * @brief Classifies a candidate package version as publishable or refused.
 * @details Pure predicate; O(1) time, O(1) space. Publishable iff the version matches
 *          `^\d+\.\d+\.\d+$` exactly AND does not start with `0.0.0`. Prerelease
 *          (`-stage`, `-rc.1`) and build (`+001`) suffixes fail the strict pattern;
 *          every `0.0.0*` version fails the placeholder prefix check.
 * @satisfies PKG-017, PKG-006
 * @param[in] version {string | undefined} Candidate version string to classify.
 * @return {{ ok: true, version: string } | { ok: false, version: string, reason: string }}
 *          Verdict object; when `ok` is `false`, `reason` is a machine-readable refusal cause.
 */
export function classifyPublishVersion(version) {
  if (typeof version !== "string" || !STRICT_SEMVER_PATTERN.test(version)) {
    return {
      ok: false,
      version: String(version),
      reason: `version "${String(version)}" is not a strict X.Y.Z release version (prerelease and build suffixes are forbidden)`,
    };
  }
  if (version.startsWith(PLACEHOLDER_VERSION_PREFIX)) {
    return {
      ok: false,
      version,
      reason: `version "${version}" is 0.0.0-based (placeholder versions must never be published)`,
    };
  }
  return { ok: true, version };
}

/**
 * @brief Resolves the declared package version for this publish invocation.
 * @details Returns `npm_package_version` when set (npm lifecycle context), otherwise parses
 *          the `package.json` located at the parent directory of this script via
 *          `new URL("../package.json", import.meta.url)`. Complexity: O(file size).
 * @return {string} Declared version string.
 * @throws {SyntaxError} If the fallback `package.json` is not valid JSON.
 * @throws {Error} If the fallback `package.json` cannot be read.
 */
function resolveDeclaredVersion() {
  const fromLifecycle = process.env.npm_package_version;
  if (typeof fromLifecycle === "string" && fromLifecycle.length > 0) {
    return fromLifecycle;
  }
  const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
  return JSON.parse(readFileSync(packageJsonPath, "utf-8")).version;
}

const verdict = classifyPublishVersion(resolveDeclaredVersion());
if (!verdict.ok) {
  console.error(`[check-publish-version] REFUSED: ${verdict.reason}`);
  console.error(
    "[check-publish-version] Set one identical non-0.0.0 X.Y.Z version in package.json, package-lock.json and README.md (PKG-006) before publishing."
  );
  process.exit(1);
}
console.error(`[check-publish-version] version ${verdict.version} is publishable`);
