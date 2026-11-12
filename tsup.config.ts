/**
 * @file tsup.config.ts
 * @brief ESM runtime bundle configuration of the `build` npm script.
 * @details Emits the `dist/` entries `index.js`, `cli.js`, and their shared chunk with no
 *          declaration files and no source maps (PKG-038). `clean` stays `false` because tsup's
 *          directory wipe would delete the committed release archive
 *          `dist/<name>-<version>.tgz`, which only `scripts/build.sh` may create (PKG-102,
 *          PKG-117); the generated-only pruner `tools/prune-generated-dist.mjs` runs before the
 *          compiler through `scripts.build` and owns stale-output removal (PKG-119).
 * @satisfies PKG-038, PKG-069, PKG-117, PKG-118, PKG-119
 * @see tools/prune-generated-dist.mjs, package.json `scripts.build`
 */
import { defineConfig } from "tsup";

export default defineConfig({
  clean: false,
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: false,
  target: "esnext",
  outDir: "dist",
  outExtension: () => ({ js: ".js" }),
});
