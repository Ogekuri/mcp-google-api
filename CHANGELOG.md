# Changelog

## [0.8.0](https://github.com/Ogekuri/mcp-google-map/compare/v0.7.0..v0.8.0) - 2026-11-03
### 🚜  Changes
- BREAKING CHANGE: rename venue-discovery skill to eatspot-discovery [useReq] *(skills)*
  - Rename the bundled agent skill identifier venue-discovery to eatspot-discovery (display name EatSpot Discovery). Updates src/resources/skills/{venue-discovery => eatspot-discovery}/SKILL.md, manifest.json id/name/path, REQUIREMENTS.md PRJ-014/REQ-027/REQ-030/REQ-033/REQ-100..REQ-109, and README.md plus docs/CONFIGURATION.md cross-references.
- replace echoed install JSON with human-readable upgrade summary [useReq] *(upgrade)*
  - REQUIREMENTS: REQ-126 now mandates captured child install stdout; new
  - REQ-132..135 define the stdout summary (starting/updated versions,
  - install outcome, per-CLI results, unknown-version and fallback rules).
  - upgradeManager: runPostUpgradeSkillInstall captures child stdout and
  - parses per-CLI outcomes; runUpgradeCommand prints the summary on
  - stdout after a successful npm upgrade and returns the install code.
  - WORKFLOW/REFERENCES: TRACE-L, EDGE-06, EDGE-09 and symbol index
  - updated for the new post-upgrade rendering path.

## [0.7.0](https://github.com/Ogekuri/mcp-google-map/compare/v0.6.0..v0.7.0) - 2026-11-03
### 🚜  Changes
- gate server start on start/run, no-command help, silent version check [useReq] *(cli)*
  - REQUIREMENTS: PRJ-003/REQ-079/REQ-080/REQ-114/REQ-124 updated; REQ-129/130/131 and TST-017 added.
  - cli.ts: server runs only via start/run; bare invocation prints help with mcp-google-map v<version> header and --upgrade/--uninstall/--ver/--version epilog.
  - upgradeManager: no stderr output when no newer version exists (not an error).
  - clientSnippets/cliInstaller: stdio registrations launch 'mcp-google-map start --stdio'.
  - Scripts, README, CONFIGURATION docs, and spawn/snippet tests aligned; npm test 103 pass, tsc/eslint clean.

## [0.6.0](https://github.com/Ogekuri/mcp-google-map/compare/v0.5.0..v0.6.0) - 2026-11-02
### ⛰️  Features
- add --upgrade/--uninstall/--ver/--version with idle-gated version check [useReq] *(upgradeManager)*
  - Add src/utils/upgradeManager.ts: idle cache (~/.cache/mcp-google-map/), forced --ver/--version check, npm-based --upgrade with post-upgrade skill install, --uninstall (REQ-120..REQ-128)
  - Extract logging-free probeLatestVersion in autoUpdate.ts; startup check now idle-gated (REQ-082, REQ-121)
  - Fix registry accept header (406 -> application/json) so online version verification works
  - Update REQUIREMENTS (PRJ-003, CTN-008, DES-022, REQ-120..128), WORKFLOW (TRACE-L, EDGE-07/09), REFERENCES

## [0.5.0](https://github.com/Ogekuri/mcp-google-map/compare/v0.4.0..v0.5.0) - 2026-11-02
### ⛰️  Features
- add enable/disable/install/uninstall/show CLI configuration commands [useReq] *(cli)*
  - Add enable/disable/install/uninstall/show commands managing MCP-server
  - registration and packaged skills for pi, openclaw, codex, antigravity,
  - claude (REQ-110..REQ-119, PRJ-015, DES-017..DES-020)
  - Add cliSettings/cliTargets/cliInstaller/cliShow utils with atomic
  - read-modify-write preserving unrelated config entries (JSON mcpServers
  - and codex TOML mcp_servers)
  - Fix malformed skills manifest.json; ship src/resources/skills in the
  - npm package (PKG-024); document commands in README (PKG-023)
  - Update REQUIREMENTS/WORKFLOW/REFERENCES

### 🐛  Bug Fixes
- Fix .gitignore file.
- drop deprecated glob@10 via @googlemaps/places ^3.1.0 [useReq] *(deps)*
  - Install-time deprecation warnings traced to the production dependency tree: @googlemaps/places@2.x -> google-gax@5 -> rimraf@5 -> glob@10.5.0 (npm deprecation cites publicized security vulnerabilities).
  - Bump @googlemaps/places ^2.1.0 -> ^3.1.0: google-gax@^6 removes rimraf/glob from the tree; engines node >= 22 preserved; PlacesClient surface unchanged (tsc clean, 57 unit tests pass).
  - Add tests/dependencyTree.unit.test.ts reproducer: lockfile tree must contain no glob package and must lock @googlemaps/places at major 3. Remaining crypto-js and node-domexception deprecations plus the protobufjs install-scripts notice are upstream or npm-client-side.

### 🚜  Changes
- derive settings dir from program name, forbid generic skills dir [useReq] *(cli-settings)*
  - Add DES-021: settings directory MUST equal the distribution program
  - name mcp-google-map; shared/generic dirs like ~/.config/skills/ are
  - forbidden
  - Introduce SETTINGS_PROGRAM_NAME constant as single source of truth
  - for CLI_SETTINGS_RELATIVE in src/utils/cliSettings.ts
  - Drop the reference skills settings-path mention from documentation;
  - runtime path stays ~/.config/mcp-google-map/config.json (DES-018)
  - Regenerate REFERENCES.md
- drop GeoScout 6.2 lineage and bind filters to venue-discovery skill [useReq] *(skills)*
  - Remove all GeoScout 6.2 references: PRJ-014 rewritten, docs/GEOSCOUT.md deleted, README/docs/package.json/manifest/SKILL/NewPlacesService cleaned
  - Bind filters and raw-payload implementations to the in-project venue-discovery skill and vice-versa (REQ-027, REQ-030, REQ-033, new REQ-109)
  - Rename tests/geoscoutFilters.unit.test.ts to placesFilters.unit.test.ts (titles only; TST-003 updated); npm test 102/102 green
- add venue-discovery skill and skills resource framework [useReq] *(skills)*
  - Add src/resources/skills: manifest.json registry + README.md authoring guide (PRJ-012..014, REQ-097..108)
  - Add venue-discovery SKILL.md: GeoScout 6.2 translated to English and bound to mcp-google-map; all 18 tools mapped; budget/priceLevels/priceRange rules, grades A-E, categories, hours, geo modes, progressive search, output A-D + DEBUG
  - REQUIREMENTS.md: skills section; WORKFLOW.md: inert-resources note
- add setup+snippet commands, typed config, doctor probes, loopback *(cli)*
  - Requirements: PRJ-003/006/009-011, CTN-005/007-009, DES-014-016, REQ-008/009/070/079/087-096, PKG-003-005/018-022, TST-002/012-016; LIM-003 removed (doctor now enforces engines >= 22).
  - New: non-interactive setup onboarding, snippet generator, tool/API profiles, typed config resolver with --env-file and secret masking.
  - Doctor: engines floor 22, masked config diagnostics, per-tool API profiles, selectable --probes (legacy --live preserved).
  - HTTP: loopback default 127.0.0.1 (migration documented), non-zero exit on failed startup, SIGINT/SIGTERM orderly shutdown; stdio from ready artifact.
  - Tooling: no implicit script chains, npm run verify pipeline, CI 3-OS matrix with tarball install + no-Google-API smoke; docs aligned with supported CLI/headers.
  - Tests: 6 new unit suites; 93 unit tests pass; typecheck and build clean.

### 🎯  Cover Requirements
- add spawn-level env-file/HTTP/shutdown and CI-contract tests *(tests)*
  - Close verification-coverage gaps of the new contracts without SRS changes:
  - tests/cliSpawn.unit.test.ts: process-level --env-file tests (missing file non-zero exit with JSON error on the exit-1 path, Node>=24 exit-9 tolerated; existing file loads for both argv forms before doctor), HTTP server startup from an env-file port with loopback endpoint and SIGTERM orderly shutdown (exit 0, 'HTTP server stopped'), and the start-mcp.sh missing-artifact remediation guard (non-win32).
  - tests/ciContract.unit.test.ts: static regression guard for the CI contract (3-OS matrix, lockfile install, typecheck/test/build, tarball install, doctor smoke with placeholder key, e2e excluded).
  - src/cli.ts: export extractEnvFileOption for direct unit testing; no behavior change.
  - WORKFLOW.md unchanged (no runtime-model impact); REFERENCES.md regenerated.
  - Verification: 102/102 unit tests pass; typecheck and static-check clean.

## [0.4.0](https://github.com/Ogekuri/mcp-google-map/compare/v0.3.0..v0.4.0) - 2026-10-30
### 🚜  Changes
- enable startup update check by default with opt-out [useReq] *(auto-update)*
  - Add auto-update check at MCP server startup (stdio + HTTP), enabled by
  - default (REQ-082), comparing running version vs npm registry latest.
  - Add inverse-polarity disable variable MCP_AUTO_UPDATE_DISABLED
  - (1/true/yes case-insensitive) skipping all registry calls (REQ-083).
  - Report newer versions on stderr only with upgrade command (REQ-084);
  - fire-and-forget execution tolerates all failures without blocking
  - startup (REQ-085).
  - New src/utils/autoUpdate.ts with injectable fetch/logger/env; new
  - tests/autoUpdate.unit.test.ts covering TST-011 (55/55 pass).
  - Document variable in .env.example and docs/CONFIGURATION.md (REQ-086);
  - update REQUIREMENTS.md, WORKFLOW.md, REFERENCES.md.
- enforce publish version guard via prepublishOnly [useReq] *(packaging)*
  - Add PKG-017 to SRS 2.3: npm publish MUST fail when package.json version is 0.0.0-based or carries a prerelease/build suffix (stray 0.0.0-stage incident).
  - Add scripts/check-publish-version.mjs (Doxygen-documented): strict X.Y.Z pattern plus 0.0.0 placeholder prefix check; wired as first stage of prepublishOnly, preserving PKG-005 chain (typecheck, tests, build).
  - Verified: tsc --noEmit clean, 41/41 unit tests, npm publish --dry-run full chain, refusal cases 0.0.0-stage and 1.2.3-rc.1 exit 1.
  - Ops: unpublished mcp-google-map@0.0.0-stage from the npm registry.

## [0.3.0](https://github.com/Ogekuri/mcp-google-map/compare/v0.2.0..v0.3.0) - 2026-10-29
### 🚜  Changes
- document pi CLI and OpenClaw MCP registration and Google API prerequisites [useReq] *(docs)*
  - Add PKG-015/PKG-016: MCP client registration docs and configuration
  - prerequisites for pi CLI and OpenClaw in README and CONFIGURATION
  - README: fix stale 'From npm (once published)', add pi CLI, OpenClaw
  - and configuration-prerequisites sections linked to the Google API table
  - docs/CONFIGURATION.md: add 'Registrazione nei client MCP' section
  - No source or test changes; typecheck and 41 unit tests pass

## [0.2.0](https://github.com/Ogekuri/mcp-google-map/releases/tag/v0.2.0) - 2026-10-29
### ⛰️  Features
- Initial Commit.

### 🐛  Bug Fixes
- Bug fix.
- Fix version number.

### 🚜  Changes
- migrate tag pipeline with master gate, npm publish and commit changelog *(release)*
  - Rewrite .github/workflows/release.yml from /tmp/release-npm.yml desiderata
  - Trigger only canonical tags v[0-9]+.[0-9]+.[0-9]+ gated on origin/master
  - Publish to npm with provenance (OIDC) and --access public via NPM_TOKEN
  - Changelog via mikepenz/release-changelog-builder v6 (COMMIT mode)
  - Release asset: npm tarball instead of raw sources (fail on unmatched)
  - SRS: PKG-008 modified, PKG-009..PKG-014 added [useReq]
- add publication readiness with CI, release workflow and README fixes *(packaging)*
  - Add PKG-001..008 packaging/publication requirements (SRS section 2.3)
  - Fix README: Node/TS badges, remove TODOs, working anchors, Feature Highlights and Install/Uninstall sections (npm, npx, cross-platform)
  - Add .github/workflows/ci.yml (node 22: npm ci, typecheck, unit tests; e2e excluded)
  - Add .github/workflows/release.yml (tag: verify, build, npm pack, GitHub Release)
  - Add prepublishOnly script; rename doctor package label; bump 0.0.0 -> 0.1.0 [useReq]
- align SRS and workflow with places pagination fix [useReq] *(docs)*
  - Analyze commit ab2a65c and update canonical docs to the true state.
  - REQ-029 rewritten: pageSize/maxResultCount translated to a single
  - maxResultCount field clamped 1-20 (SDK proto lacks pageSize)
  - REQ-081 added: nextPageToken surfaced when the API returns one
  - LIM-007 added: pageToken forwarded but dropped by @googlemaps/places
  - protos (<= v3.1.0), so pagination has no server-side effect
  - TST-003 extended to the pageSize-to-maxResultCount translation test
  - WORKFLOW.md searchTextFull trace node updated; REFERENCES.md regenerated
  - No source changes: commit ab2a65c already implemented the fix (41/41 tests pass)

### 📚  Documentation
- Update REFERENCES.md document. [useReq] *(references)*


# History

- \[0.2.0\]: https://github.com/Ogekuri/mcp-google-map/releases/tag/v0.2.0
- \[0.3.0\]: https://github.com/Ogekuri/mcp-google-map/releases/tag/v0.3.0
- \[0.4.0\]: https://github.com/Ogekuri/mcp-google-map/releases/tag/v0.4.0
- \[0.5.0\]: https://github.com/Ogekuri/mcp-google-map/releases/tag/v0.5.0
- \[0.6.0\]: https://github.com/Ogekuri/mcp-google-map/releases/tag/v0.6.0
- \[0.7.0\]: https://github.com/Ogekuri/mcp-google-map/releases/tag/v0.7.0
- \[0.8.0\]: https://github.com/Ogekuri/mcp-google-map/releases/tag/v0.8.0

[0.2.0]: https://github.com/Ogekuri/mcp-google-map/releases/tag/v0.2.0
[0.3.0]: https://github.com/Ogekuri/mcp-google-map/compare/v0.2.0..v0.3.0
[0.4.0]: https://github.com/Ogekuri/mcp-google-map/compare/v0.3.0..v0.4.0
[0.5.0]: https://github.com/Ogekuri/mcp-google-map/compare/v0.4.0..v0.5.0
[0.6.0]: https://github.com/Ogekuri/mcp-google-map/compare/v0.5.0..v0.6.0
[0.7.0]: https://github.com/Ogekuri/mcp-google-map/compare/v0.6.0..v0.7.0
[0.8.0]: https://github.com/Ogekuri/mcp-google-map/compare/v0.7.0..v0.8.0
