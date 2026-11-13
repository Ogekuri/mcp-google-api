# Changelog

## [0.26.7](https://github.com/Ogekuri/mcp-google-api/compare/v0.26.0..v0.26.7) - 2026-11-13
### ⛰️  Features
- Update gitalias config.
- add scripts/clean.sh build-artifact cleaner [useReq] *(clean)*
  PKG-094..PKG-101 new: standalone cwd-independent cleaner removing exactly the PKG-072 generated dist/ files, pruning emptied ancestor directories including dist/ itself, preserving non-generated entries and symlinks, idempotent absent-dist no-op, PASS/FAILED reporting, no install/publish/destructive-git; scripts/clean.sh new: EXIT-trapped temp list, NUL-delimited sweep, deepest-first rmdir pruning; TST-030 new: tests/cleanScript.unit.test.ts, 2 static + 6 sandbox tests (8 total); SRS 1.2 tree line updated for scripts/clean.sh

### 🐛  Bug Fixes
- anchor npm publish tarball spec to the local file path [useReq] *(release-npm)*
  The release publish step passed the bare relative tarball spec dist/mcp-google-api-<version>.tgz to npm, which npm parses as a hosted git shorthand (github:dist/mcp-google-api-<version>.tgz), runs git ls-remote and aborts with exit 128 before publishing (PKG-042, PKG-113). Prefixing the spec with ./ forces local-file resolution of the committed tarball. Adds a ciContract reproducer asserting the path-anchored publish argument.
- restore dist bundle without a compiler toolchain [useReq] *(prepare-lifecycle)*
  Defect: develop-channel 'npm install -g github:...#<tag>' aborts during git-dep preparation with 'sh: 1: tsup: not found' (exit 127), because npm runs the root prepare hook before node_modules/.bin links exist.
  Fix: package.json prepare now runs tools/prepare-dist.mjs, which no-ops on an existing dist/cli.js, otherwise unpacks package/dist/cli.js from the committed release tarball, and falls back to the build lifecycle only when no tarball exists; missing sources abort with remediation.
  Tests: new prepareDist suite (4 sandboxed/static cases) reproduces the compiler-less prepare and pins tarball precedence; npmPublishContract prepare assertion updated.
  Docs: usereq/docs/WORKFLOW.md EDGE-09 prepare path. Requirements unchanged.
- Remove dist/ files.
- Remove build artifacts.
- Preserve non-generated dist entries [useReq] *(build)*
  Defect: successful builds dropped empty directories and symlinks from dist/.
  Fix: snapshot traversal restores non-generated entries and aborts on output-path collisions.
  Tests: add sandbox coverage for directory, symlink, and rollback preservation.
  Requirements remain unchanged; addresses PKG-071 and PKG-072.
- Drop docs and sourcemaps from tarball, verify relative imports [useReq] *(build)*
  Defect: packed tarball shipped non-runtime docs/ and dist source maps, violating PKG-038.
  Defect: build.sh exited 0 when an emitted entry imported a missing relative chunk (PKG-069, PKG-074).
  Fix: package.json files drops docs; tsup.config.ts sourcemap false; validator allowlist drops docs/.
  Fix: build.sh verifies relative import targets of cli.js and index.js and node --check on index.js.
  Tests: npmPublishContract reproducers updated; new releaseBuildScript sandbox suite added.
  Requirements unchanged; PKG-036, PKG-013, REQ-152, REQ-153, PKG-075..079 preserved.

### 🚜  Changes
- install the develop release asset and force-remove the global tree [useReq] *(upgradeManager)*
  Requirements: REQ-171/REQ-172/REQ-225/REQ-228 move the develop channel to the
  GitHub Release tarball asset install; REQ-182/REQ-183/REQ-226/REQ-227/REQ-229
  replace the reify recovery with a forced global-tree removal plus single retry
  and one bounded restore child; REQ-230 acceptance; TST-023/TST-034; LIM-008.
  Source: buildDevelopUpgradeCommand emits the release asset URL, new
  resolveGlobalPackageDir and purgeGlobalPackageTree with injectable fs/platform.
  Tests: upgradeManager suite covers asset install, no git-ref spec, recovery
  removal, retry, restore, and unresolvable global root.
- ship the committed dist release tarball [useReq] *(release-packaging)*
  scripts/build.sh packs, validates, and retains dist/<name>-<version>.tgz; build removes the compiled bundle so dist/ holds only the release artifact; tools/check-release-artifacts.mjs validates the committed tarball path; release workflow consumes the pre-built artifact through git cat-file, no build; package files exclude the committed archive from any repacking; requirements, .gitignore, and contract suites updated
- clean foreign-version dist artifacts before compiling *(build-script)*
  Requirements: PKG-071 now covers every version-stamped artifact of an
  earlier build; new PKG-132 (foreign MAJOR.MINOR.PATCH token = obsolete) and
  PKG-133 (abort when a foreign-version entry survives the compile); TST-031
  extended to the version-aware cleanup and to the cleanup-before-compile order.
  scripts/build.sh reads the package version during preflight, classifies every
  dist/ path through is_obsolete_artifact (generated suffix or foreign version
  token) and removes those entries as the first phase, strictly before
  `npm run build`, then verifies after the compile that no foreign-version
  artifact remains; version-free non-generated entries are preserved.
- BREAKING CHANGE: single-entry npm distribution without committed dist/ *(packaging)*
  Requirements: PKG-024/035/038/067/069/073/074/075-079/090-093/102/104/
  108-111/113/116/125-131 revised; PKG-070/117-122 removed; PRJ-012/013 and
  REQ-099 point the skills payload at skills/; TST-020/021/029/031 rewritten,
  TST-032/033 moved to tests/buildOutputContract.unit.test.ts.
  Code: tsup compiles only src/cli.ts (dist/cli.js, no chunk, no dist/index.js);
  package.json drops main/exports, `build` calls tsup directly and `files`
  allowlists bin/dist/skills; .gitignore excludes dist/ and git drops every
  tracked dist entry; skills/ moves out of src/ and resolveSkillsResourcesRoot
  resolves <packageRoot>/skills; tools/build-dist-lifecycle.mjs and
  tools/prune-generated-dist.mjs are removed; build.sh regenerates and verifies
  the single bundle without archives; release workflow runs npm ci + build
  before packing; check-release-artifacts validates the new payload.
- encode sources-to-tarball release pipeline [useReq] *(release-artifacts)*
  Requirements: add PKG-125 (sources -> build -> dist -> npm pack -> package),
  PKG-126 (single tarball release asset, no source archives), PKG-127 (validator
  rejects packed src/ outside the skills payload), PKG-128 (workflow verifies the
  release asset set before release creation).
  Implementation: tools/check-release-artifacts.mjs gains isUnpackagedSource() and a
  PKG-127 failure diagnostic for every packed repository source; release-npm.yml
  gains the 'Verify release asset set' step asserting exactly one *.tgz and zero
  source archives.
  Tests: npm test 208/208 pass; validator packs and validates the real tarball.
- build into a temporary directory without touching dist [useReq] *(pre-release-check)*
  Rework scripts/pre-release-check.sh so the release gate is fully independent
  of the repository dist/ directory:
  emit the production ESM bundle into a private temporary directory outside
  the repository working tree (PKG-061, PKG-123, PKG-124)
  verify the temporary entries (existence, non-empty, node --check) instead of
  running scripts/build.sh and tools/check-release-artifacts.mjs (PKG-080)
  drop every dist/ snapshot, removal, and restore step; cleanup now removes
  only the private temporary work directory (PKG-062, PKG-084)
  update TST-024 suite and drop tar from the required toolchain (PKG-081)
- guard and restore dist/ in the build lifecycle [useReq] *(packaging)*
  Requirements: add PKG-120 (abort before dist/ removal without tsup), PKG-121 (restore generated dist/ outputs on compile failure), PKG-122 (never leave the tracked runtime bundle absent) and TST-033.; Tools: new tools/build-dist-lifecycle.mjs orchestrates preflight, generated-output snapshot, prune, compile, and restore-on-failure as the single scripts.build entry; tools/prune-generated-dist.mjs gains the tsup preflight guard.; package.json scripts.build now runs the orchestrator; scripts/build.sh docs track the new compile phase.; Tests: buildArchivePreservation suite adds PKG-120/PKG-121/PKG-122 regressions and the lifecycle wiring guard.; Dist: regenerated dist/ runtime bundle (byte-identical) and repacked dist/mcp-google-api-0.26.2.tgz for the new manifest.
- preserve committed dist release archive across build lifecycle [useReq] *(build)*
  REQUIREMENTS: add PKG-117/PKG-118/PKG-119 (lifecycle archive preservation, tracked dist immutability, generated-only pruning) and TST-032; cross-reference PKG-102.; tsup.config.ts: clean false so the outDir wipe can no longer delete dist/<name>-<version>.tgz.; tools/prune-generated-dist.mjs: generated-only pruner (PKG-072 set minus *.tgz) wired ahead of tsup; non-generated entries and archives preserved, non-directory dist/ aborts.; package.json: build script runs the pruner then tsup; prepare unchanged for git-ref installs.; tests/buildArchivePreservation.unit.test.ts: sandboxed lifecycle proves archive byte identity, stale-output pruning, preservation and config/wiring guards.; dist: regenerate the tracked release archive for the new package.json payload.
- persist release archive in dist and exclude it from the payload [useReq] *(build)*
  PKG-102/108/109 revised: build.sh moves the verified tarball to dist/<name>-<version>.tgz and keeps it through the final cleanup, removing only stale archives and intermediate files.; PKG-116 added: package.json files negates !dist/*.tgz so the committed archive never nests in its own packed payload (PKG-093 retained).; check-release-artifacts.mjs exempts repository dist/*.tgz from the reverse PKG-078 identity pass.; TST-021 extended; TST-031 added; releaseBuildScript and npmPublishContract suites cover the archive contract.; dist/ release tree committed (3 JS artifacts plus mcp-google-api-0.26.2.tgz).
- wrap help at word boundaries and document absolute doc links [useReq] *(cli-help)*
  Add PKG-114 (README doc links absolute for the published package), PKG-115 (English Markdown docs), REQ-224 (no help token split), TST-030 plus TST-017 extension.; src/cli.ts: disable cliui character wrapping and pre-wrap usage/epilog through wrapHelpText/formatHelpEntry helpers.; README.md: docs, skills tree, and LICENSE links now use absolute repository URLs.; docs/TOOLS.md: translated to English preserving every tool, parameter, and default.; tests/docsContract.unit.test.ts added; npmPublishContract license-link assertion updated; dist/cli.js rebuilt.
- ship only runtime skills payload and commit dist artifacts [useReq] *(packaging)*
  Move the skills authoring guide to docs/SKILLS_AUTHORING.md so it is never packed.; Validator rejects any src/resources/skills/ entry that is not manifest.json or a <skill-id>/ file.; Packed tarball shrinks to 11 runtime files (skills README no longer shipped).; Commit the dist/ bundle so the tagged release commit carries the packed artifacts (PKG-091, PKG-110).; Requirements: PRJ-013, PKG-024, PKG-038, PKG-075 revised, TST-021 extended; npmPublishContract suite asserts the skills-root policy.
- pack and publish committed dist artifacts without building [useReq] *(release-workflow)*
  Release workflow packs the dist/ artifacts committed in the tagged release commit.; Remove npm ci, npm run build, scripts/pre-release-check.sh and all build-preparatory checks from automation.; Pack with npm pack --ignore-scripts and publish with --ignore-scripts so prepare/prepublishOnly never build.; Validate packed tarball against committed dist/ before publish and GitHub Release.; Requirements: PKG-005/014/026/027/028/043 revised, PKG-063 removed, PKG-110..PKG-113 added, TST-020 updated; ciContract suite rewritten.
- merge obsolete-build cleaning into build.sh [useReq] *(build-script)*
  Remove scripts/clean.sh; build.sh now owns the whole cleanup lifecycle.; build.sh cleans every earlier build from dist/ before compiling, all versions.; Prune emptied directories, preserve non-generated entries.; Final phase removes intermediate artifacts (*.tgz, *.tsbuildinfo, *.tmp) and the private work directory, failing when any survives.; Requirements PKG-065/PKG-071 updated, PKG-094..PKG-101 and TST-030 removed, PKG-104..PKG-109 added.
- BREAKING CHANGE: Reduce dist/ release output to runtime ESM artifacts [useReq] *(build)*
  PKG-069: build emits only the ESM runtime bundle and shared chunks; tsup dts disabled (tsup.config.ts); PKG-102: scripts/build.sh packs the npm tarball into a private temp directory and removes it before exit; PKG-103: tools/check-release-artifacts.mjs packs the repository into a private temp directory; Validator no longer requires dist/cli.d.ts, dist/index.d.ts, or a dist/*.tgz tarball; PKG-072 classification kept so legacy .d.ts and .tgz outputs are still cleaned (PKG-071, PKG-096); tests/releaseBuildScript.unit.test.ts asserts the runtime-only dist/ contract; Breaking: published package no longer ships TypeScript declaration files
- distribute build artifacts via git-tracked dist/ [useReq] *(dist)*
  PKG-091 reworked: dist/ release artifacts are version-controlled; .gitignore drops every dist-excluding rule (PKG-090/092 re-inclusions kept); .gitignore: removed dist/**/*.js|js.map|d.ts|d.ts.map|tgz|tsbuildinfo|tmp exclusions; PKG-093 new: check-release-artifacts.mjs rejects packed dist/*.tgz entries, preventing nested release tarballs under the tracked-dist model; TST-029 new: tests/gitignoreDist.unit.test.ts static contract (4 tests); Commit regenerated dist/ artifacts (ESM bundle, declarations, npm tarball 0.26.2)
- add build.sh and artifact validation, harden cleanup [useReq] *(release)*
  REQUIREMENTS: amend PKG-058/PKG-059; add PKG-065..PKG-092 (build, validator, gate integrity, .gitignore); scripts/build.sh: standalone dist/ generation (tsup + npm pack), restores snapshot on failure; tools/check-release-artifacts.mjs: tarball structure, identity, skill manifest, dist byte-identity, smoke run; scripts/pre-release-check.sh: preflight, build and artifact stages, dist/ snapshot restore, git integrity check, signal exit codes; .gitignore: drop blanket dist/ exclusion; re-include dist/ and ignore generated outputs by specific rules
- add schema-driven configuration interface [useReq] *(config)*
  Add --print/--info/--print-raw/--get/--set/--unset backed by one canonical
  configuration schema (Settings: enabled, apiKey, autoUpdate, enabledTools,
  host, port) with typed parsing, strict whole-document validation, and
  durable atomic writes (fsync + rename + mode preservation).
  Render both trees through one deterministic renderer and one display-width
  table formatter, with details attached to their owning nodes.
  Requirements: PRJ-023, DES-025..DES-029, REQ-193..REQ-223, LIM-009.
  Tests: configRenderer, configTableRenderer, configCommands (TST-025..TST-028).
- align --ver/--version report to padded labels [useReq] *(upgradeManager)*
  REQUIREMENTS: REQ-120/REQ-162/REQ-163/REQ-181 reworded to the aligned three-line report; REQ-192 added pinning 'Current Installed : <version>'.
  SRC: add pure renderVersionReportLine helper (label padEnd 17) consumed by runVersionCommand; sync stale probe doc in autoUpdate.ts.
  DOCS: WORKFLOW.md TRACE-L/EDGE-06/EDGE-10 runtime model updated; REFERENCES.md regenerated. Verified: static-check clean, typecheck exit 0, npm test 153/153 passed.
- add --force forced-reinstall option to --upgrade [useReq] *(upgrade)*
  REQUIREMENTS: add REQ-187..REQ-191 (force option, forced channel commands,
  standard unforced child, help documentation) and PKG-064 (README coverage);
  extend TST-017/TST-023 verification mapping.
  upgradeManager: UPGRADE_FORCE_OPTION, parseUpgradeForce, --force-aware
  parseManagementCommand shapes (any option order), buildDevelopUpgradeCommand
  force flag, ManagementCommandOptions.force, forced/standard update child.
  cli: forward --force to runManagementCommand; help epilog documents it.; tests: force parser/builder/child-spawn coverage (153/153 pass).; README: document --upgrade --develop/--dev and --force; fix stale
  skip-on-latest sentence (REQ-146).
  WORKFLOW/REFERENCES: runtime model and symbol index refreshed.

## [0.26.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.25.0..v0.26.0) - 2026-11-08
### 🚜  Changes
- add opencode CLI support and alphabetical CLI listing [useReq] *(cliTargets)*
  REQ-110/DES-017 updated: opencode joins the supported CLI registry; supported-name listings print alphabetically.; REQ-112/REQ-113 updated: opencode MCP config at ~/.config/opencode/opencode.json (JSON mcp map) and skills at ~/.config/opencode/skills.; REQ-117 updated: show CLI Configuration table covers all seven CLIs in alphabetical order; CLI_TARGETS registry reordered alphabetically.; JSON read-modify-write helpers gained a mapKey parameter (default mcpServers, mcp for opencode) preserving unrelated keys; CliTarget gained jsonMcpMapKey.; Unit suite 146/146 green; behavioral proof verified paths, mcp-map install/uninstall round-trip, and alphabetical show rows.
- rebuild dist binaries on every launcher run [useReq] *(mcp-google-api.sh)*
  PRJ-019 amended: the dev launcher rebuilds dist from the current sources before every execution and aborts non-zero when the rebuild fails; dependency installs stay explicit (npm ci).; PRJ-022 added: every argument is forwarded unchanged to the rebuilt dist/cli.js with exit-code propagation via exec.; PKG-019 amended: the helper-script no-implicit-install/build rule now carves out the PRJ-018 development launcher.; Build output routes to stderr so the exec'd CLI keeps stdout clean for stdio JSON-RPC framing (CTN-003).; No src/ changes; unit suite 146/146 green; live proof verified rebuild, exit propagation, and JSON-pure stdout.
- render show tables as box-drawing grid [useReq] *(cliShow)*
  REQ-185 added: the show CLI Configuration and Installation Status tables render as box-drawing grids using the specific border characters.; REQ-186 added: data rows emit without inter-row border lines, with exactly one header separator and a closing bottom border.; renderAsciiTable now builds borders via a parametric borderLine helper (top/header/body/bottom) and pipe-delimited rows; column sizing, cell wrapping, and alignment are unchanged.; WORKFLOW.md TRACE-K and EDGE-06 runtime model updated; REFERENCES.md regenerated; no test files modified.
- print enable/disable result as human-readable confirmation [useReq] *(cli)*
  PRJ-008 updated: enable and disable join the human-readable stdout operation-report exceptions.; REQ-184 added: enable/disable print a human-readable confirmation naming the resolved CLI and the resulting enabled state, exit 0.; runEnableDisableCliCommand now writes plain-text confirmations on both success branches (state change and idempotent no-op); the unsupported-name JSON stderr diagnostic and exit 2 are unchanged (REQ-110).; WORKFLOW.md TRACE-K and EDGE-06 runtime model updated; REFERENCES.md regenerated; no test files modified.
- render GitHub probe failure reason in version report [useReq] *(upgradeManager)*
  REQ-181 added: --ver/--version now prints 'GitHub latest: unknown (<reason>)' when the GitHub releases probe fails, <reason> carrying the probe diagnostic message.; REQ-164 updated to reference the REQ-181 failed-probe diagnostic rendering.; probeLatestGitHubVersion embeds the GitHub API error message body field (e.g. HTTP 404 rate limit) via the new tolerant readGitHubErrorDetail helper.; WORKFLOW.md TRACE-L and EDGE-06/EDGE-10 runtime model updated; REFERENCES.md regenerated; no test files modified.

## [0.25.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.24.0..v0.25.0) - 2026-11-08
### 🐛  Bug Fixes
- make doctor spawn tests hermetic with isolated home [useReq] *(cliSpawn)*
  Root cause of the CI-only failure: the doctor spawn test inherited the
  host HOME, so it read the developer machine's real
  ~/.config/mcp-google-api/config.json; locally the real API key made the
  REQ-070 api-key check pass (exit 0), while the clean CI runner had no
  settings file, so doctor correctly exited 1 and the gate failed.
  spawnCli now accepts an injectable HOME override; the doctor success
  test provisions an isolated home with the DES-018 settings fixture and
  a valid-format test key, so local runs reproduce the CI runner state
  exactly and the discrepancy can no longer hide before publication.
  Add a REQ-070 regression pin: doctor exits 1 on a clean isolated home
  without a configured API key (the exact CI failure state).
  Evidence: clean-HOME reproduction exited 1 with api-key fail before the
  fix; after the fix the suite passes 4/4 both with the real and a clean
  HOME; full suite 146/146; local pre-release gate green (exit 0).
  No source changes: doctor clean-env exit-1 behavior is REQ-070-correct.

## [0.24.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.23.0..v0.24.0) - 2026-11-08
### ⛰️  Features
- add pre-release-check.sh release gate [useReq] *(scripts)*
  Ship scripts/pre-release-check.sh running the release-gating stages
  in mandatory order: publish-version guard, typecheck, unit tests,
  production build, aborting at the first failed stage (PKG-058/059).
  The script exits 0 only when every stage passes, runs from any cwd
  by resolving the repository root, and never installs dependencies
  or publishes (PKG-060).
  Add tests/preReleaseCheck.unit.test.ts (TST-024): static contract on
  stage order, fail-fast wiring, repository-root cd, and no install/
  publish commands, plus a sandbox run proving fail-fast exit 1 on an
  injected failing stage.
  Runtime verification: full run green (guard 0.23.0 publishable,
  typecheck clean, 143/143 unit tests, build success, exit 0); real
  fail-fast observed on a missing-toolchain run (typecheck FAILED ->
  exit 1, later stages skipped).

### 🐛  Bug Fixes
- sync package-lock bin path with package.json launcher [useReq] *(packaging)*
  The committed package-lock.json root bin entry still recorded the
  superseded dist/cli.js launcher, so every standard bootstrap
  (npm install) rewrote the tracked lockfile and left a fresh clone dirty.
  Regenerate the lockfile bin entry to bin/mcp-google-api.mjs, matching
  the package.json launcher contract (PRJ-020).
  Add a level-0 regression guard test asserting lockfile/package.json
  bin-map identity to tests/npmPublishContract.unit.test.ts, closing
  the TST-021 coverage gap that let the drift go undetected.
  Evidence: reproducer red on the stale lockfile, green after the fix;
  full suite 138/138 pass, typecheck clean, static analysis clean.

### 🚜  Changes
- gate pipeline on pre-release test checks [useReq] *(release)*
  Add a Pre-release check step to .github/workflows/release-npm.yml
  running scripts/pre-release-check.sh after npm ci and before every
  build, pack, publish, and release-creation step, so versions whose
  tests fail produce no release artifact and are never published
  (PKG-063).
  The gate executes the PKG-058 stages (publish-version guard,
  typecheck, unit tests, build) in fail-fast order (PKG-059) and never
  installs dependencies or publishes (PKG-060).
  Update the workflow header and pack-step comments; the release
  pipeline defines no direct test commands - all test stages live in
  the gate script.
  SRS: add PKG-063 and extend TST-020 with the gate contract.; Tests: ciContract asserts gate presence, placement, and absence of
  direct test commands; suite 6/6, full suite 145/145.
- clean run-created artifacts in pre-release-check [useReq] *(scripts)*
  scripts/pre-release-check.sh now snapshots the repository state before
  the stages and removes on exit every artifact directory the run created
  (e.g. the tsup dist/ tree), on both success and fail-fast paths, so the
  repository is left as found (PKG-061).
  Pre-existing artifact directories are preserved untouched (PKG-062).; SRS: add PKG-061/PKG-062 and extend TST-024 with the cleanup contract.; Tests: shared sandbox helper plus two behavioral proofs - run-created
  dist removed on the fail-fast path, pre-existing dist sentinel intact.
  Verification: suite 7/7; full run 145/145 tests with dist removed after
  the run; pre-existing dist preserved in a second scenario; static
  analysis clean; git status clean after every run.

## [0.23.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.22.0..v0.23.0) - 2026-11-07
### ⛰️  Features
- add copilot CLI agent support (DES-017, REQ-110/112/113/117) [useReq] *(cli-targets)*
  Requirements: extend DES-017, REQ-110, REQ-112, REQ-113, REQ-117 with the copilot target; Source: add COPILOT_TARGET adapter (~/.copilot/mcp.json JSON mcpServers + ~/.copilot/skills) to CLI_TARGETS registry in src/utils/cliTargets.ts; Docs: README supported-agents list/table and WORKFLOW/REFERENCES runtime model updated; Verification: eslint/tsc clean, npm test 132/132 pass, enable/show/install runtime smoke on isolated HOME

### 🐛  Bug Fixes
- build dist via prepare lifecycle for GitHub installs [useReq] *(packaging)*
  Develop-channel installs (npm install -g github:Ogekuri/mcp-google-api#<tag>,
  REQ-171) packed the fetched git tree without dist/: no build lifecycle ran, so
  every installed package hit the PRJ-021 remediation error and the post-upgrade
  install child failed (evidence: v0.22.4 pack listing had 0 dist entries).
  package.json: declare scripts.prepare = npm run build so npm git-dep
  preparation builds dist/ into the packed tarball (PRJ-020; verified by
  local git-sim packs: 8 dist entries incl. dist/cli.js).
  tests/npmPublishContract.unit.test.ts: add failing-first reproducer test
  pinning the prepare lifecycle contract (no chained installs, PKG-019) and
  restore deterministic pack listing via --ignore-scripts.
  usereq/docs/WORKFLOW.md: document the prepare build inside EDGE-09.
- spawn package-manager child with neutral home cwd [useReq] *(upgrade)*
  Defect: --upgrade (npm and --dev|--develop channels) and --uninstall
  spawned npm from the caller's working directory. When invoked from the
  source checkout of the same package (scripts/mcp-google-api.sh cd's to
  the repo root), npm reconciled the git-ref global install against that
  same-name local project and corrupted reify: TAR_ENTRY_ERROR ENOENT
  floods on hono/@modelcontextprotocol/sdk/@grpc/grpc-js plus a fatal
  lifecycle 'spawn sh ENOENT' (protobufjs) against a cwd deleted
  mid-reify.
  Fix: runPackageManagerCommand spawns the child with cwd = os.homedir()
  (explicit neutral directory, env/prefix unchanged); stdio inheritance,
  exit propagation, and the REQ-128 manual-command hint are unchanged.
  Reproducer test (HDT Level 1) added to tests/upgradeManager.unit.test.ts:
  asserts the child cwd is the user home and never the caller cwd; suite
  went 11 pass / 1 fail before the fix to 136/136 after.
- report skipped server-start dispatch with build remediation [useReq] *(cli)*
  Root cause of the persistent pi 'MCP connection closed' after the 0.21.0 rename:
  the REQ-114 launcher 'npx -y mcp-google-api start --stdio' resolves a same-name
  local project in the spawn cwd, launching a stale pre-rename dist artifact that
  skips dispatch and exits 0 silently (reproduced: exit 0, zero stdout bytes).
  Add describeUndispatchedServerStart() and handleUndispatchedEntry() to the CLI
  entry gate: server-start-shaped argv that matches no gate rule now emits a JSON
  build-remediation diagnostic on stderr (REQ-094) and exits 1; stdout stays
  JSON-RPC-clean (CTN-003); non-server-start argv keeps the silent exit-0 no-op.
  Extend tests/cliEntryGate.unit.test.ts with failing-first reproducers (3 tests);
  full suite 132/132 green; typecheck, static checks, and build clean.
  Document the stale-artifact remediation in docs/CONFIGURATION.md; update
  WORKFLOW.md TRACE-A/EDGE-06 and regenerate REFERENCES.md.

### 🚜  Changes
- make --upgrade update unconditionally [useReq] *(upgradeManager)*
  --upgrade now reinstalls mcp-google-api@latest in every invocation,
  without any pre-upgrade version comparison (REQ-146 rewrite).
  Removed the pre-upgrade registry necessity check and the
  already-latest skip path (REQ-144, REQ-145, REQ-147 deleted) and the
  pre-upgrade-latest summary shortcut (REQ-181 deleted); REQ-172
  reworded since the comparison no longer exists.
  The summary updated version now comes from the post-upgrade probe
  (REQ-134); unused isUpgradeNecessary removed.
  Requirements, workflow model, and references updated; typecheck and
  136 unit tests pass.
- self-heal npm reify ENOENT in --upgrade [useReq] *(upgradeManager)*
  --upgrade update children (npm and --develop/--dev channels) run with
  captured output echoed on stderr (REQ-125, REQ-171).
  A non-zero exit carrying an ENOENT reify diagnostic triggers one
  tolerated npm uninstall -g clean-slate child plus a single retry,
  repairing corrupted global trees whose dependency lifecycle spawns
  fail like the reported 'spawn sh ENOENT' (REQ-182, REQ-183).
  Requirements, workflow model, and references updated; typecheck and
  136 unit tests pass.
- resolve npmjs latest via packument manifest [useReq] *(upgradeManager)*
  --ver/--version now probe the npm packument manifest with the
  abbreviated Accept header and print dist-tags.latest (REQ-179, REQ-180).
  --upgrade reports the pre-upgrade npmjs latest as the summary updated
  version and skips the post-upgrade probe when resolved (REQ-181).
  REQUIREMENTS/WORKFLOW/REFERENCES updated; typecheck and 136 unit
  tests pass.
- ship mcp-google-api launcher bin with remediation [useReq] *(bin)*
  PRJ-020: the installed mcp-google-api bin executes the packaged
  dist/cli.js Node entry forwarding every argument unchanged with no
  implicit install/build steps (analogous to scripts/mcp-google-api.sh).
  PRJ-021: new launcher bin/mcp-google-api.mjs (realpath-safe package-root
  resolution) prints JSON build-remediation guidance on stderr and exits
  non-zero when dist/cli.js is missing - impossible to deliver from the
  built artifact itself.
  package.json: bin repointed to bin/mcp-google-api.mjs; files allowlist
  ships bin/ (verified in npm pack --dry-run); .gitignore gains !bin/
  exceptions (CTN-010).
  PKG-038 publication fixture updated for the bin/ prefix; verified live:
  launcher forwards (--help, exit 0) and remediates (exit 1, JSON stderr);
  136/136 tests, typecheck and eslint clean.
- add develop-channel coverage for --upgrade --dev|--develop [useReq] *(test)*
  TST-023: new test requirement mapping REQ-170/171/172/173/177/178 to
  tests/upgradeManager.unit.test.ts.
  HDT Level 0: buildDevelopUpgradeCommand builds the raw tag install
  command npm install -g github:Ogekuri/mcp-google-api#<tag>.
  HDT Level 1: the develop channel probes only the GitHub releases
  endpoint bypassing the idle cache (REQ-177), spawns the tagged install
  with the raw tag_name (REQ-171), always proceeds even when the probed
  tag equals the installed version (REQ-172), reports the probed version
  in the summary (REQ-173), and fails fast on probe error without
  spawning any child process (REQ-178).
  No src/ changes: verification confirmed the implementation already
  satisfied the request; 135/135 tests, typecheck and eslint clean.
- move publish guard to tools/ with gitignore exception [useReq] *(tools)*
  Move scripts/check-publish-version.mjs to tools/ (PKG-057 updated):
  the ../package.json resolution keeps working at the same directory
  depth; guard verified executable from the new path (exit 0).
  Wire package.json check:publish-version to the new path; the
  prepublishOnly chain (PKG-005, PKG-017) is unchanged.
  .gitignore: append !tools/ and !tools/**/* at the tail of the
  negated-inclusion included-paths section (CTN-009); git check-ignore
  confirms the guard is version-controlled.
  requirements: scripts/ tree entry reduced to the mcp-google-api.sh
  launcher; tools/ entry added for the publish guard.
- BREAKING CHANGE: remove redundant shell helpers, document HTTP vs stdio [useReq] *(scripts)*
  Delete scripts/build.sh, start-http.sh, start-mcp.sh, test.sh: thin
  wrappers over npm run build/start/test/test:e2e; PKG-019 keeps the
  single npm run verify pipeline and REQ-094 forbids implicit builds.
  scripts/ now holds only mcp-google-api.sh (PRJ-018, PRJ-019) and the
  retained check-publish-version.mjs publish guard: required prepublishOnly
  stage, not an end-user accessory (PKG-057, PKG-005, PKG-017).
  README: new 'stdio vs Streamable HTTP' comparison section (PKG-054,
  PKG-055, PKG-056).
  Remove the obsolete start-mcp.sh remediation test whose subject was
  deleted; no src/ changes, WORKFLOW.md unaffected.
- --dev|--develop installs the latest tagged GitHub release [useReq] *(upgrade)*
  REQ-170..173: --upgrade --develop|--dev now selects the latest tagged
  GitHub release regardless of the branch carrying the tag; REQ-177 adds
  the forced releases-API probe bypassing the idle cache gate; REQ-178
  fails fast with a stderr diagnostic and no child spawn on probe failure.
  upgradeManager: GITHUB_UPGRADE_REPOSITORY + buildDevelopUpgradeCommand(tag)
  replace PACKAGE_DEVELOP_UPGRADE_COMMAND; develop branch probes GitHub first,
  installs github:Ogekuri/mcp-google-api#<tag>, and reports the probed version.
  autoUpdate: GitHubLatestVersionProbe ok outcome now carries the raw tag_name.; cli: help text and dispatch comments document the new channel semantics.
- BREAKING CHANGE: remove legacy exec aliases, placeholder key, entry-gate fallback [useReq] *(cli)*
  BREAKING: exec accepts only canonical maps_ tool names (REQ-073); short/snake_case/batch-geocode-tool aliases removed from EXEC_TOOLS, execTool switch, help examples, and README.; BREAKING: legacy INSTALL_API_KEY_PLACEHOLDER config value no longer loads as unset (DES-023, REQ-142); empty values still do.; BREAKING: superseded isRunDirectly basename entry-gate removed; isEntryMainModule() alone decides dispatch.; DOCTOR_PROBES use canonical tool names; tests canonicalized per user-requested legacy removal.; Verified: typecheck, static-check clean, npm test 132/132; exec geocode now rejected as unknown tool.
- make --help user-facing and document --develop/--dev [useReq] *(cli)*
  REQ-174: help descriptions limited to user-facing usage; removed internal details (persisted configuration, settings file, dispatch order, dist/cli.js path).; REQ-175: --upgrade epilog documents the --develop | --dev GitHub develop-branch option.; REQ-176: --ver described accurately as installed, npmjs-latest, and GitHub-latest versions.; Verified facts kept: exec alias list (batch-geocode-tool) and search-nearby example params match the schema.; Verified: static-check clean, npm test 132/132 (help contract REQ-129/130/131 intact).
- add --develop/--dev GitHub develop-branch upgrade channel [useReq] *(upgrade-manager)*
  REQ-170..173: --upgrade accepts --develop with equivalent --dev alias selecting the GitHub develop branch.; REQ-125/REQ-144 scoped to the default npm channel; develop channel skips the registry gate and already-latest path.; upgradeManager: UpgradeChannel, PACKAGE_DEVELOP_UPGRADE_COMMAND (npm install -g github:Ogekuri/mcp-google-api#develop), parseUpgradeChannel; parseManagementCommand accepts the --upgrade + --develop/--dev pair.; Develop-channel summary reports unknown as the updated version; default npm path unchanged.; WORKFLOW.md TRACE-A/L and EDGE-07/09 updated; REFERENCES.md regenerated.; Verified: typecheck, static-check clean, npm test 132/132.
- encode README header block structure and centered quick index [useReq] *(readme)*
  Add requirements PKG-046..PKG-053: [!CAUTION] pre-header, exact title format, centered badge/description/quick-index/status blocks, fixed H1 section order, quick-start step order.; Rebuild README header: centered description block (strong summary + br + detail), HTML quick-index anchors now including Requirements, single status+notice centered block.; No source-code change; WORKFLOW.md runtime model unaffected; REFERENCES.md regenerated unchanged.; Verified: static-check clean; npm test 132/132 pass.

## [0.22.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.21.0..v0.22.0) - 2026-11-06
### 🐛  Bug Fixes
- symlink-aware main-module gate restores CLI dispatch [useReq] *(cli)*
  The entry gate compared import.meta.url with a string-concatenated file:// argv[1], false for every symlinked launcher (npm global bin links, _npx .bin shims), so a stale pre-rename dist silently exited 0 with no output after the 0.21.0 bin rename; pi reported 'MCP connection closed'.; Add isEntryMainModule(): symmetric realpathSync comparison of argv[1] and the module URL; name-independent dispatch for symlink launches, false on plain imports.; Add tests/cliEntryGate.unit.test.ts reproducer (symlink dispatch + direct control); update WORKFLOW.md TRACE-A; regenerate REFERENCES.md.; Verification: reproducer fails pre-fix and passes post-fix; npm run verify green (typecheck, 135/135 tests, build); eslint clean.

### 🚜  Changes
- BREAKING CHANGE: remove env-var configuration, add settings commands and readable install report [useReq] *(cli)*
  Remove GOOGLE_MAPS_API_KEY/GOOGLE_MAPS_ENABLED_TOOLS/MCP_SERVER_* env support and all .env/--env-file/setup logic (REQ removed: PRJ-011, CTN-007, CTN-009, REQ-087/088; dotenv dep and .env.example dropped); Add tools/host/port config commands persisting enabledTools, host, port in ~/.config/mcp-google-api/config.json (REQ-167/168/169, DES-018); install/uninstall now print a human-readable per-CLI activity report (REQ-166); post-upgrade parser updated; Startup banners identify the app as 'MCP Google API server' (REQ-165); README.md documents the standard flow only; CONFIGURATION.md rewritten around the settings file; Requirements/docs updated (REQ-165..169, TST-022); tests aligned, new cliConfigCommands suite; all 129 unit tests pass

## [0.21.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.20.0..v0.21.0) - 2026-11-06
### 🚜  Changes
- pin release automation compliance to the mcp-google-api npm package [useReq] *(release-npm)*
  Add PKG-045: publish, pack, and release-asset glob derive from the distribution package name mcp-google-api.; Verified automation compliance: release-npm.yml publishes package.json name, npm pack emits mcp-google-api-<ver>.tgz, asset glob mcp-google-api-*.tgz, .galias.conf regex matches the renamed lockfile; version guard name-agnostic; registry confirms mcp-google-api exists on npmjs.; Zero superseded-name references in automation paths; REFERENCES.md regenerated unchanged.; Verification: typecheck clean, static-check clean, 133/133 unit tests pass (ciContract 6/6), build success.
- add mcp-google-api.sh local launcher mirroring the installed bin [useReq] *(scripts)*
  Add scripts/mcp-google-api.sh named after the installed mcp-google-api distribution bin (PRJ-018).; Forward every argument unchanged to the local dist/cli.js entry with the full CLI surface; no implicit install/build steps, missing-artifact remediation message instead (PRJ-019, PKG-019).; Update SRS scripts/ tree comment and requirements; REFERENCES.md regenerated unchanged.; Verification: static-check clean, 133/133 unit tests pass; launcher guard/help/forwarding functionally verified.
- BREAKING CHANGE: rename project to mcp-google-api and widen scope to all Google APIs [useReq] *(pkg)*
  Rename package, bin, CLI script name, npm/GitHub probe endpoints, MCP entry, settings (~/.config/mcp-google-api), and idle cache paths (PRJ-016, REQ-082, 114, 115, 121, 125, 127, 162, 163).; Widen scope to Google APIs at large with Google Maps as the currently implemented family (PRJ-017, CTN-008, DES-018, DES-021).; Reword README Acknowledgments to credit CabLate without the superseded name (PKG-044).; Update SRS, WORKFLOW.md, README/docs, CHANGELOG, release workflow glob, skills, and unit-test assertions; regenerate REFERENCES.md.; Verification: typecheck clean, static-check clean, 133/133 unit tests pass, build success.

### 📚  Documentation
- Update TODO.md file.

## [0.20.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.19.0..v0.20.0) - 2026-11-05
### 🚜  Changes
- GitHub version probe targets the Ogekuri repository [useReq] *(upgrade-manager)*
  Re-point DEFAULT_GITHUB_RELEASES_API_URL (src/utils/autoUpdate.ts) from
  the upstream cablate/mcp-google-map (latest release v0.0.69) to the
  distribution repository Ogekuri/mcp-google-map (latest release v0.19.0),
  fixing the wrong 'GitHub latest:' line of --ver/--version.
  Update REQ-163 to pin the GitHub probe repository to
  Ogekuri/mcp-google-map; sync TRACE-L, external boundaries, and EDGE-10
  in WORKFLOW.md; REFERENCES.md regenerated unchanged.

## [0.19.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.18.0..v0.19.0) - 2026-11-05
### 🚜  Changes
- --ver/--version prints installed, npmjs, and GitHub latest versions [useReq] *(upgrade-manager)*
  Rewrite runVersionCommand (REQ-120): concurrent npm-registry and
  GitHub-releases probes bypassing the idle cache gate (REQ-161), printing
  the three-line stdout report: installed version, 'npmjs latest: <v>'
  (REQ-162), 'GitHub latest: <v>' with leading v stripped (REQ-163), and
  'unknown' placeholders on undeterminable versions (REQ-164).
  Add probeLatestGitHubVersion, GitHubProbeDeps, GitHubLatestVersionProbe,
  and DEFAULT_GITHUB_RELEASES_API_URL to autoUpdate.ts.
  Extract resolveProbeLatestVersion; resolveUpdatedVersion delegates to it.; Update SRS (REQ-120, REQ-161..REQ-164), WORKFLOW.md (TRACE-L, EDGE-06,
  EDGE-07, EDGE-10), and regenerate REFERENCES.md.
- add Acknowledgments section crediting CabLate's mcp-google-map [useReq] *(readme)*
  Requirements: add PKG-044 (Acknowledgments as the last README.md section naming CabLate and the project URL).; README: append the Acknowledgments section after License, thanking CabLate for the mcp-google-map contribution.; Verification: full unit suite 133/133 pass; static analysis clean.
- publish to npm only for master tags; develop tags release without publish [useReq] *(release-npm)*
  Requirements: update PKG-008/PKG-009/PKG-026/PKG-028, add PKG-042/PKG-043, update TST-020.; Workflow: branch gate resolves origin/master and origin/develop reachability, fails on neither, exports step outputs; npm publish runs only for master-reachable tags.; Develop-only version tags now build, pack, and create the GitHub Release with the tarball asset without npm publication.; Tests: refactor ciContract suite to the updated contract; targeted suite 6/6, full suite 133/133 pass.

## [0.18.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.17.0..v0.18.0) - 2026-11-05
### 📚  Documentation
- Update README.md file.

## [0.17.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.16.0..v0.17.0) - 2026-11-05
### 🚜  Changes
- BREAKING CHANGE: migrate runtime floor to Node.js 24 and drop Node 22 workarounds [useReq] *(runtime)*
  package.json engines >=24; @types/node ^24; lockfile refreshed (root identity kept); NODE_ENGINE_FLOOR 22->24: doctor and setup checks, Doxygen docs updated; README badge/prerequisites, docs/CONFIGURATION.md floor, scripts/setup.sh gate at >=24; tests: doctor/setup floor 24 (22.x now fails); remove transitional Node<=23 --env-file tolerance (exit 9 contract); release workflow already Node24-pinned (24.15.0, checkout@v5/setup-node@v5); requirements CTN-005/REQ-070/PKG-014 updated, PKG-041 added; verification: typecheck clean, 132/132 unit tests pass, static-check clean
- enforce npm publication compliance contract [useReq] *(pkg)*
  Add PKG-033..PKG-040 and TST-021 codifying npm publication policies; Declare SPDX GPL-3.0-only in package.json, package-lock.json, README badge/section; Add package.json exports map (dist entry + package.json subpath); Ship CHANGELOG.md via the files allowlist; Add tests/npmPublishContract.unit.test.ts: metadata, lockfile identity, private-flag, name policy, npm pack --dry-run tarball allowlist

## [0.16.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.15.0..v0.16.0) - 2026-11-05
### 🚜  Changes
- publish npm via OIDC Trusted Publishing [useReq] *(release)*
  REQUIREMENTS: PKG-010 switches npm publishing to OIDC Trusted Publishing (no long-lived tokens); add PKG-030 id-token: write permission, PKG-031 no publish-token secret/env, PKG-032 npm >= 11.5.1 floor on the pinned runtime; extend TST-020.
  release-npm.yml: remove the publish-token secret/environment from the publish step; authentication is minted from the workflow OIDC token. Tag trigger, master gate, single job, build/pack/changelog/GitHub Release mechanics unchanged.
  tests: ciContract publish test asserts OIDC permission, token absence, and the pinned runtime floor; npm test passes 124/124.

## [0.15.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.14.0..v0.15.0) - 2026-11-04
### 🚜  Changes
- remove CI automation and release-time testing [useReq] *(ci)*
  Delete .github/workflows/ci.yml and PKG-004: no push/PR automation.; Release pipeline keeps gate, build, pack, publish, changelog, release;
  typecheck, unit tests, and the doctor smoke check are removed
  (PKG-021 deleted; PKG-005/008/027 updated).
  package.json prepublishOnly now runs version guard + build only.; tests/ciContract.unit.test.ts rewritten per TST-020: asserts ci.yml
  absence, master-gate ordering, and no test/smoke steps in release-npm.yml.
  Development-phase minimum verification stays local via npm scripts
  (PKG-019: typecheck, test, verify).

## [0.14.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.13.0..v0.14.0) - 2026-11-04
### 🚜  Changes
- BREAKING CHANGE: rename npm release workflow file to release-npm.yml [useReq] *(ci)*
  Rename .github/workflows/release.yml to .github/workflows/release-npm.yml
  as mandated by new PKG-029; the single master-tag-gated release job
  (PKG-008/PKG-009/PKG-027/PKG-028) is unchanged in content.
  Update the ci.yml header comment to reference the new workflow file name.; Point tests/ciContract.unit.test.ts at release-npm.yml and extend TST-020
  to cover PKG-029.
  REQUIREMENTS.md: add PKG-029, refresh structure tree and TST-020 mapping.
- collapse release into single master-tag-gated job [useReq] *(ci)*
  requirements: PKG-009 gates the single release job; add PKG-027 (exactly one integrated release job) and PKG-028 (fail before any install/build/pack/publish when tag not on origin/master, so develop tags never build); update TST-020; release.yml: merge check-branch into one release job; master-reachability gate is the first step and exits 1 before npm ci/build/pack/publish; no parallel or separate release jobs remain; tests: ciContract gate test verifies the single-job contract and gate-before-build ordering

## [0.13.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.11.0..v0.13.0) - 2026-11-04
### 🚜  Changes
- restrict package build to master version-tag release workflow [useReq] *(ci)*
  Activate the package build only on a canonical version tag whose commit
  is reachable from master (PKG-008, PKG-009, PKG-026):
  ci.yml: drop build/pack/tarball-install/doctor smoke steps from push/PR
  CI, which now runs lockfile install, typecheck, and unit tests only.
  release.yml: build, pack, install the tarball into a temporary
  environment, and run the no-Google doctor smoke check inside the
  master-gated build-release job before npm publish (PKG-021).
  tests/ciContract.unit.test.ts: re-target the workflow contract suite to
  the new trigger/build placement and add release ordering assertions.
  REQUIREMENTS.md: sharpen PKG-008, retarget PKG-021, add PKG-026/TST-020.

## [0.11.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.10.0..v0.11.0) - 2026-11-04
### 🐛  Bug Fixes
- document geocode payload contract and bounded debug capture [useReq] *(skills)*
  eatspot-discovery skill v1.2.0 fixes two concrete agent-run failures:
  Section 13.1 now documents the real flat maps_geocode payload and
  forbids dereferencing the internal {success,data} envelope (root
  cause of TypeError on response.data.location during debug-register
  aggregation).
  Section D9 adds a mandatory bounded-capture procedure with declared
  TRUNCATED payloads and register-entry integrity rules (re-execute
  missing entries; mark NOT_ACCESSIBLE), preventing loss of executed
  call records on size-limit aborts.
  manifest.json version synced to 1.2.0; new contract unit test
  tests/eatspotSkillContract.unit.test.ts guards both rules.

### 🚜  Changes
- append skill debug overlays only on install --debug-skills [useReq] *(skills)*
  Move eatspot-discovery debug instructions into DEBUG.md; Add optional manifest debug overlay and layout-aware skill sync; Append overlay only with install --debug-skills; show accepts both modes; Post-upgrade and api-key reinstalls never append the overlay; Requirements: REQ-152..REQ-160, REQ-126, DES-020, PRJ-012/013, TST-018/019
- BREAKING CHANGE: config-file-only settings, human-readable api-key, auto-update [useReq] *(cli)*
  REQ-083/DES-018/DES-023/DES-024: configuration comes only from
  ~/.config/mcp-google-map/config.json ({enabled, apiKey, autoUpdate});
  startup resolves the API key from settings (default empty key) and the
  auto-update check only runs when the autoUpdate flag is true (default on).
  New auto-update enable|disable|1|0 command persists the flag. Env-var
  configuration and connector env/key embedding removed (REQ-114, REQ-142).
  api-key prints a human-readable operation report (REQ-137..139).
  install/exec/batch-geocode drop --apikey and read the settings key.
  Verified: tsc --noEmit clean; eslint clean; npm test 110/110 passing.
- gate --upgrade on a latest-version necessity check [useReq] *(upgrade)*
  REQ-144..147: --upgrade first runs a forced registry probe bypassing the idle gate.
  Already-latest installs print the version on stdout and exit 0 with no child spawn.
  Newer or undeterminable outcomes proceed with the npm update, post-upgrade install,
  and stdout summary. Updates REQUIREMENTS.md, WORKFLOW.md (TRACE-L, EDGE-07, external
  boundaries), and regenerated REFERENCES.md. Verified: tsc --noEmit clean; npm test
  110/110 passing (upgradeManager suite exercises the proceed path).

## [0.10.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.9.0..v0.10.0) - 2026-11-03
### ⛰️  Features
- add api-key command, install placeholder, and stdio key guard [useReq] *(api-key)*
  Add api-key <key> CLI: validate REQ-020 format, persist key in
  ~/.config/mcp-google-map/config.json (apiKey field), then reinstall
  every enabled CLI with the new key (REQ-136..REQ-139)
  install: resolve embedded key as --apikey > persisted settings >
  GOOGLE_MAPS_API_KEY; embed placeholder naming api-key when unset
  (REQ-140, REQ-141, DES-023)
  start/run: effective-key resolution incl. persisted settings and
  placeholder-as-unset; stdio mode exits 1 with stderr JSON inviting
  api-key when no key resolves (REQ-142, REQ-143)
  Docs: REQUIREMENTS/WORKFLOW/REFERENCES updated; README documents the
  command, key priority, and startup guard (PKG-025)

## [0.9.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.8.0..v0.9.0) - 2026-11-03
### 🐛  Bug Fixes
- spawn post-upgrade install via upgraded package bin [useReq] *(upgrade)*
  The --upgrade post-upgrade child spawned 'npx -y mcp-google-map install',
  an unversioned npx spec resolved from the npx cache/registry instead of the
  package just upgraded by 'npm install -g'. A stale cached CLI copy could run
  its default command (pre-v0.7.0 releases start the MCP HTTP server there),
  never exit, and block the parent spawnSync forever: the user observed the
  MCP server running instead of the 'install' command (REQ-126 violation).
  POST_UPGRADE_INSTALL_COMMAND is now ['mcp-google-map', 'install']: the
  globally installed bin of the just-upgraded package, already on PATH in
  the exact --upgrade scenario; captured stdout and stderr-inherited spawn
  mechanics unchanged (REQ-125, REQ-126, REQ-128).
  Add tests/upgradeManager.unit.test.ts reproducer: post-upgrade child must
  be the upgraded package bin with captured stdout; upgrade-child failure
  propagation; no-CLI no-op; spawn-failure manual hint; uninstall child;
  parseManagementCommand exact-match dispatch (PRJ-003, REQ-125, REQ-127).
  Update WORKFLOW.md TRACE-L, External Boundaries and EDGE-09; regenerate
  REFERENCES.md. Full suite: 110 tests passing; typecheck and static
  checks clean.

## [0.8.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.7.0..v0.8.0) - 2026-11-03
### 🚜  Changes
- BREAKING CHANGE: rename venue-discovery skill to eatspot-discovery [useReq] *(skills)*
  Rename the bundled agent skill identifier venue-discovery to eatspot-discovery (display name EatSpot Discovery). Updates src/resources/skills/{venue-discovery => eatspot-discovery}/SKILL.md, manifest.json id/name/path, REQUIREMENTS.md PRJ-014/REQ-027/REQ-030/REQ-033/REQ-100..REQ-109, and README.md plus docs/CONFIGURATION.md cross-references.
- replace echoed install JSON with human-readable upgrade summary [useReq] *(upgrade)*
  REQUIREMENTS: REQ-126 now mandates captured child install stdout; new
  REQ-132..135 define the stdout summary (starting/updated versions,
  install outcome, per-CLI results, unknown-version and fallback rules).
  upgradeManager: runPostUpgradeSkillInstall captures child stdout and
  parses per-CLI outcomes; runUpgradeCommand prints the summary on
  stdout after a successful npm upgrade and returns the install code.
  WORKFLOW/REFERENCES: TRACE-L, EDGE-06, EDGE-09 and symbol index
  updated for the new post-upgrade rendering path.

## [0.7.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.6.0..v0.7.0) - 2026-11-03
### 🚜  Changes
- gate server start on start/run, no-command help, silent version check [useReq] *(cli)*
  REQUIREMENTS: PRJ-003/REQ-079/REQ-080/REQ-114/REQ-124 updated; REQ-129/130/131 and TST-017 added.; cli.ts: server runs only via start/run; bare invocation prints help with mcp-google-map v<version> header and --upgrade/--uninstall/--ver/--version epilog.; upgradeManager: no stderr output when no newer version exists (not an error).; clientSnippets/cliInstaller: stdio registrations launch 'mcp-google-map start --stdio'.; Scripts, README, CONFIGURATION docs, and spawn/snippet tests aligned; npm test 103 pass, tsc/eslint clean.

## [0.6.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.5.0..v0.6.0) - 2026-11-02
### ⛰️  Features
- add --upgrade/--uninstall/--ver/--version with idle-gated version check [useReq] *(upgradeManager)*
  Add src/utils/upgradeManager.ts: idle cache (~/.cache/mcp-google-map/), forced --ver/--version check, npm-based --upgrade with post-upgrade skill install, --uninstall (REQ-120..REQ-128); Extract logging-free probeLatestVersion in autoUpdate.ts; startup check now idle-gated (REQ-082, REQ-121); Fix registry accept header (406 -> application/json) so online version verification works; Update REQUIREMENTS (PRJ-003, CTN-008, DES-022, REQ-120..128), WORKFLOW (TRACE-L, EDGE-07/09), REFERENCES

## [0.5.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.4.0..v0.5.0) - 2026-11-02
### ⛰️  Features
- add enable/disable/install/uninstall/show CLI configuration commands [useReq] *(cli)*
  Add enable/disable/install/uninstall/show commands managing MCP-server
  registration and packaged skills for pi, openclaw, codex, antigravity,
  claude (REQ-110..REQ-119, PRJ-015, DES-017..DES-020)
  Add cliSettings/cliTargets/cliInstaller/cliShow utils with atomic
  read-modify-write preserving unrelated config entries (JSON mcpServers
  and codex TOML mcp_servers)
  Fix malformed skills manifest.json; ship src/resources/skills in the
  npm package (PKG-024); document commands in README (PKG-023)
  Update REQUIREMENTS/WORKFLOW/REFERENCES

### 🐛  Bug Fixes
- Fix .gitignore file.
- drop deprecated glob@10 via @googlemaps/places ^3.1.0 [useReq] *(deps)*
  Install-time deprecation warnings traced to the production dependency tree: @googlemaps/places@2.x -> google-gax@5 -> rimraf@5 -> glob@10.5.0 (npm deprecation cites publicized security vulnerabilities).
  Bump @googlemaps/places ^2.1.0 -> ^3.1.0: google-gax@^6 removes rimraf/glob from the tree; engines node >= 22 preserved; PlacesClient surface unchanged (tsc clean, 57 unit tests pass).
  Add tests/dependencyTree.unit.test.ts reproducer: lockfile tree must contain no glob package and must lock @googlemaps/places at major 3. Remaining crypto-js and node-domexception deprecations plus the protobufjs install-scripts notice are upstream or npm-client-side.

### 🚜  Changes
- derive settings dir from program name, forbid generic skills dir [useReq] *(cli-settings)*
  Add DES-021: settings directory MUST equal the distribution program
  name mcp-google-map; shared/generic dirs like ~/.config/skills/ are
  forbidden
  Introduce SETTINGS_PROGRAM_NAME constant as single source of truth
  for CLI_SETTINGS_RELATIVE in src/utils/cliSettings.ts
  Drop the reference skills settings-path mention from documentation;
  runtime path stays ~/.config/mcp-google-map/config.json (DES-018)
  Regenerate REFERENCES.md
- drop GeoScout 6.2 lineage and bind filters to venue-discovery skill [useReq] *(skills)*
  Remove all GeoScout 6.2 references: PRJ-014 rewritten, docs/GEOSCOUT.md deleted, README/docs/package.json/manifest/SKILL/NewPlacesService cleaned; Bind filters and raw-payload implementations to the in-project venue-discovery skill and vice-versa (REQ-027, REQ-030, REQ-033, new REQ-109); Rename tests/geoscoutFilters.unit.test.ts to placesFilters.unit.test.ts (titles only; TST-003 updated); npm test 102/102 green
- add venue-discovery skill and skills resource framework [useReq] *(skills)*
  Add src/resources/skills: manifest.json registry + README.md authoring guide (PRJ-012..014, REQ-097..108); Add venue-discovery SKILL.md: GeoScout 6.2 translated to English and bound to mcp-google-map; all 18 tools mapped; budget/priceLevels/priceRange rules, grades A-E, categories, hours, geo modes, progressive search, output A-D + DEBUG; REQUIREMENTS.md: skills section; WORKFLOW.md: inert-resources note
- add setup+snippet commands, typed config, doctor probes, loopback *(cli)*
  Requirements: PRJ-003/006/009-011, CTN-005/007-009, DES-014-016, REQ-008/009/070/079/087-096, PKG-003-005/018-022, TST-002/012-016; LIM-003 removed (doctor now enforces engines >= 22).
  New: non-interactive setup onboarding, snippet generator, tool/API profiles, typed config resolver with --env-file and secret masking.; Doctor: engines floor 22, masked config diagnostics, per-tool API profiles, selectable --probes (legacy --live preserved).; HTTP: loopback default 127.0.0.1 (migration documented), non-zero exit on failed startup, SIGINT/SIGTERM orderly shutdown; stdio from ready artifact.; Tooling: no implicit script chains, npm run verify pipeline, CI 3-OS matrix with tarball install + no-Google-API smoke; docs aligned with supported CLI/headers.; Tests: 6 new unit suites; 93 unit tests pass; typecheck and build clean.

### 🎯  Cover Requirements
- add spawn-level env-file/HTTP/shutdown and CI-contract tests *(tests)*
  Close verification-coverage gaps of the new contracts without SRS changes:
  tests/cliSpawn.unit.test.ts: process-level --env-file tests (missing file non-zero exit with JSON error on the exit-1 path, Node>=24 exit-9 tolerated; existing file loads for both argv forms before doctor), HTTP server startup from an env-file port with loopback endpoint and SIGTERM orderly shutdown (exit 0, 'HTTP server stopped'), and the start-mcp.sh missing-artifact remediation guard (non-win32).; tests/ciContract.unit.test.ts: static regression guard for the CI contract (3-OS matrix, lockfile install, typecheck/test/build, tarball install, doctor smoke with placeholder key, e2e excluded).; src/cli.ts: export extractEnvFileOption for direct unit testing; no behavior change.; WORKFLOW.md unchanged (no runtime-model impact); REFERENCES.md regenerated.; Verification: 102/102 unit tests pass; typecheck and static-check clean.

## [0.4.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.3.0..v0.4.0) - 2026-10-30
### 🚜  Changes
- enable startup update check by default with opt-out [useReq] *(auto-update)*
  Add auto-update check at MCP server startup (stdio + HTTP), enabled by
  default (REQ-082), comparing running version vs npm registry latest.
  Add inverse-polarity disable variable MCP_AUTO_UPDATE_DISABLED
  (1/true/yes case-insensitive) skipping all registry calls (REQ-083).
  Report newer versions on stderr only with upgrade command (REQ-084);
  fire-and-forget execution tolerates all failures without blocking
  startup (REQ-085).
  New src/utils/autoUpdate.ts with injectable fetch/logger/env; new
  tests/autoUpdate.unit.test.ts covering TST-011 (55/55 pass).
  Document variable in .env.example and docs/CONFIGURATION.md (REQ-086);
  update REQUIREMENTS.md, WORKFLOW.md, REFERENCES.md.
- enforce publish version guard via prepublishOnly [useReq] *(packaging)*
  Add PKG-017 to SRS 2.3: npm publish MUST fail when package.json version is 0.0.0-based or carries a prerelease/build suffix (stray 0.0.0-stage incident).
  Add scripts/check-publish-version.mjs (Doxygen-documented): strict X.Y.Z pattern plus 0.0.0 placeholder prefix check; wired as first stage of prepublishOnly, preserving PKG-005 chain (typecheck, tests, build).
  Verified: tsc --noEmit clean, 41/41 unit tests, npm publish --dry-run full chain, refusal cases 0.0.0-stage and 1.2.3-rc.1 exit 1.
  Ops: unpublished mcp-google-map@0.0.0-stage from the npm registry.

## [0.3.0](https://github.com/Ogekuri/mcp-google-api/compare/v0.2.0..v0.3.0) - 2026-10-29
### 🚜  Changes
- document pi CLI and OpenClaw MCP registration and Google API prerequisites [useReq] *(docs)*
  Add PKG-015/PKG-016: MCP client registration docs and configuration
  prerequisites for pi CLI and OpenClaw in README and CONFIGURATION
  README: fix stale 'From npm (once published)', add pi CLI, OpenClaw
  and configuration-prerequisites sections linked to the Google API table
  docs/CONFIGURATION.md: add 'Registrazione nei client MCP' section; No source or test changes; typecheck and 41 unit tests pass

## [0.2.0](https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.2.0) - 2026-10-29
### ⛰️  Features
- Initial Commit.

### 🐛  Bug Fixes
- Bug fix.
- Fix version number.

### 🚜  Changes
- migrate tag pipeline with master gate, npm publish and commit changelog *(release)*
  Rewrite .github/workflows/release.yml from /tmp/release-npm.yml desiderata; Trigger only canonical tags v[0-9]+.[0-9]+.[0-9]+ gated on origin/master; Publish to npm with provenance (OIDC) and --access public via NPM_TOKEN; Changelog via mikepenz/release-changelog-builder v6 (COMMIT mode); Release asset: npm tarball instead of raw sources (fail on unmatched); SRS: PKG-008 modified, PKG-009..PKG-014 added [useReq]
- add publication readiness with CI, release workflow and README fixes *(packaging)*
  Add PKG-001..008 packaging/publication requirements (SRS section 2.3); Fix README: Node/TS badges, remove TODOs, working anchors, Feature Highlights and Install/Uninstall sections (npm, npx, cross-platform); Add .github/workflows/ci.yml (node 22: npm ci, typecheck, unit tests; e2e excluded); Add .github/workflows/release.yml (tag: verify, build, npm pack, GitHub Release); Add prepublishOnly script; rename doctor package label; bump 0.0.0 -> 0.1.0 [useReq]
- align SRS and workflow with places pagination fix [useReq] *(docs)*
  Analyze commit ab2a65c and update canonical docs to the true state.
  REQ-029 rewritten: pageSize/maxResultCount translated to a single
  maxResultCount field clamped 1-20 (SDK proto lacks pageSize)
  REQ-081 added: nextPageToken surfaced when the API returns one; LIM-007 added: pageToken forwarded but dropped by @googlemaps/places
  protos (<= v3.1.0), so pagination has no server-side effect
  TST-003 extended to the pageSize-to-maxResultCount translation test; WORKFLOW.md searchTextFull trace node updated; REFERENCES.md regenerated; No source changes: commit ab2a65c already implemented the fix (41/41 tests pass)

### 📚  Documentation
- Update REFERENCES.md document. [useReq] *(references)*


# History

- \[0.2.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.2.0
- \[0.3.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.3.0
- \[0.4.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.4.0
- \[0.5.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.5.0
- \[0.6.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.6.0
- \[0.7.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.7.0
- \[0.8.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.8.0
- \[0.9.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.9.0
- \[0.10.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.10.0
- \[0.11.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.11.0
- \[0.13.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.13.0
- \[0.14.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.14.0
- \[0.15.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.15.0
- \[0.16.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.16.0
- \[0.17.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.17.0
- \[0.18.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.18.0
- \[0.19.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.19.0
- \[0.20.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.20.0
- \[0.21.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.21.0
- \[0.22.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.22.0
- \[0.23.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.23.0
- \[0.24.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.24.0
- \[0.25.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.25.0
- \[0.26.0\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.26.0
- \[0.26.7\]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.26.7

[0.2.0]: https://github.com/Ogekuri/mcp-google-api/releases/tag/v0.2.0
[0.3.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.2.0..v0.3.0
[0.4.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.3.0..v0.4.0
[0.5.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.4.0..v0.5.0
[0.6.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.5.0..v0.6.0
[0.7.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.6.0..v0.7.0
[0.8.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.7.0..v0.8.0
[0.9.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.8.0..v0.9.0
[0.10.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.9.0..v0.10.0
[0.11.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.10.0..v0.11.0
[0.13.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.11.0..v0.13.0
[0.14.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.13.0..v0.14.0
[0.15.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.14.0..v0.15.0
[0.16.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.15.0..v0.16.0
[0.17.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.16.0..v0.17.0
[0.18.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.17.0..v0.18.0
[0.19.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.18.0..v0.19.0
[0.20.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.19.0..v0.20.0
[0.21.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.20.0..v0.21.0
[0.22.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.21.0..v0.22.0
[0.23.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.22.0..v0.23.0
[0.24.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.23.0..v0.24.0
[0.25.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.24.0..v0.25.0
[0.26.0]: https://github.com/Ogekuri/mcp-google-api/compare/v0.25.0..v0.26.0
[0.26.7]: https://github.com/Ogekuri/mcp-google-api/compare/v0.26.0..v0.26.7
