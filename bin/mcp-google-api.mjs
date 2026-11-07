#!/usr/bin/env node
/**
 * @file mcp-google-api.mjs
 * @brief Installed distribution bin launcher executing the mcp-google-api Node.js CLI (PRJ-020).
 * @details Mirrors `scripts/mcp-google-api.sh` for the installed package: resolves the
 * real package root from this script's own location (realpath-safe against npm's
 * symlinked global `bin/` links and renamed launchers), verifies the packaged
 * `dist/cli.js` entry exists, and either forwards every argument unchanged to that
 * Node.js entry with inherited stdio, propagating its exit code (PRJ-020, PRJ-019
 * semantics), or prints exactly one JSON build-remediation diagnostic on stderr
 * naming the package root and the build/refresh commands, exiting non-zero
 * (PRJ-021; remediation guidance in the REQ-094 family). No implicit install or
 * build steps are ever executed (PRJ-019). A plain Node.js ESM script is used
 * instead of pointing the npm `bin` field directly at `dist/cli.js` because a built
 * artifact cannot detect its own absence: the launcher must stay runnable on stale
 * or unbuilt distributions to deliver the remediation path. On Windows, npm wraps
 * this file in a `.cmd` shim that invokes `node`, so the shebang is informational.
 * @satisfies PRJ-016, PRJ-020, PRJ-021
 * @note stdout is reserved for the launched CLI; this launcher writes only to
 * stderr, and only on the missing-artifact remediation path (PRJ-021).
 * @warning The remediation diagnostic is emitted by this launcher, never by
 * `dist/cli.js`: a missing artifact bypasses every CLI-side guard (REQ-094 covers
 * dispatch from an existing artifact; PRJ-021 covers the artifact-missing case).
 */
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const launcherPath = realpathSync(fileURLToPath(import.meta.url));
const packageRoot = dirname(dirname(launcherPath));
const cliEntry = join(packageRoot, "dist", "cli.js");

if (!existsSync(cliEntry)) {
  process.stderr.write(
    JSON.stringify(
      {
        error: "dist/cli.js missing",
        packageRoot,
        remediation:
          "build first: npm ci && npm run build (source checkout) or refresh the global install: npm install -g mcp-google-api@latest",
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(1);
}

const child = spawnSync(process.execPath, [cliEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(child.status ?? 1);
