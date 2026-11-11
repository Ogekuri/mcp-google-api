import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: false,
  target: "esnext",
  outDir: "dist",
  outExtension: () => ({ js: ".js" }),
});
