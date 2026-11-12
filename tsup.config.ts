/**
 * @file tsup.config.ts
 * @brief ESM runtime bundle configuration of the `build` npm script.
 * @details Compiles the single runtime entry `src/cli.ts` into `dist/cli.js` (PKG-129). One entry
 *          means no code-split chunk is emitted, so the packed `dist/` tree holds exactly one
 *          JavaScript artifact (PKG-078). `clean` is `true` because every `dist/` output except the
 *          committed release tarball is disposable (PKG-090, PKG-091): stale outputs of an earlier
 *          build are removed by the compiler before compiling (PKG-130). Declaration files and
 *          source maps stay disabled because the package publishes no library entry
 *          (PKG-035, PKG-038).
 * @satisfies PKG-035, PKG-038, PKG-069, PKG-078, PKG-129, PKG-130
 * @see package.json `scripts.build`
 */
import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: ["src/cli.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: false,
  target: "esnext",
  outDir: "dist",
  outExtension: () => ({ js: ".js" }),
});
