/**
 * @file index.ts
 * @brief Internal shared module: stderr `Logger` plus the facade re-exports used by module tests.
 * @details Not a package entry point: `package.json` declares no `main` or `exports` map, so the
 *          published artifact is the single CLI bundle `dist/cli.js` (PKG-035, PKG-129). This module
 *          exists only for in-repository imports: `Logger` is consumed by most modules and
 *          `PlacesSearcher`/`NewPlacesService` by the unit suites.
 * @satisfies PKG-035, PKG-129, REQ-015
 */
export const Logger = {
  log: (...args: any[]) => {
    console.error("[INFO]", ...args);
  },
  error: (...args: any[]) => {
    console.error("[ERROR]", ...args);
  },
};

export { PlacesSearcher } from "./services/PlacesSearcher.js";
export { NewPlacesService } from "./services/NewPlacesService.js";
