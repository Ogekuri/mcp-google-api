> [!CAUTION]
> ### 🚨 STRICTLY EXPERIMENTAL — PROOF OF CONCEPT (PRE-ALPHA)
>
> ![Status: Proof of Concept](https://img.shields.io/badge/Status-Proof_of_Concept-red?style=flat-square) ![Stage: Pre-Alpha](https://img.shields.io/badge/Stage-Pre--Alpha-critical?style=flat-square) ![Maintenance: Personal Use Only](https://img.shields.io/badge/Scope-Personal_Use_Only-important?style=flat-square) ![Issues: Closed](https://img.shields.io/badge/Issues_%26_PRs-Not_Accepted-inactive?style=flat-square)
>
> **PLEASE READ CAREFULLY BEFORE USING THIS SOFTWARE:**
>
> * **Very Early Stage:** this project is a raw **Proof of Concept (PoC)** in a **pre-alpha** state. It is nowhere near production-ready and may contain severe bugs, breaking changes, or incomplete logic.
> * **Personal Use Only:** this repository is developed, maintained, and shared strictly for **personal use**.
> * **No Support or Feature Requests:** please **do not** open issues, bug reports, or feature requests. They will not be addressed or accepted at this stage.
> * **No Warranty:** this software is provided **"AS IS"**, without warranty of any kind, express or implied. Use it strictly for testing and evaluation purposes at your own sole risk.

# mcp-google-api / MCP Google API server (0.26.7)

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js >= 24">
  <img src="https://img.shields.io/badge/typescript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.7">
  <img src="https://img.shields.io/badge/license-GPL--3.0--only-491?style=flat-square" alt="License: GPL-3.0-only">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-6A7EC2?style=flat-square&logo=terminal&logoColor=white" alt="Platforms">
</p>

<p align="center">
  <strong>MCP Google API server — Google APIs for AI agents over the <a href="https://modelcontextprotocol.io">Model Context Protocol</a></strong>
  <br>
  The server exposes Google API families to AI agents over stdio or Streamable HTTP. The currently implemented family is <strong>Google Maps</strong>, providing 18 read-only tools: geocoding and reverse geocoding, Places API (New) text search with server-side filters (<code>priceLevels</code>, <code>minRating</code>, <code>strictTypeFiltering</code>), nearby search with client-side <code>openNow</code> and <code>minRating</code> post-filters, place details, directions, distance matrix, timezone, elevation, weather, air quality, static maps, batch geocode, and the composite tools explore-area, plan-route, compare-places, search-along-route, and local-rank-tracker. Tools are declared read-only, non-destructive, idempotent, and open-world via MCP annotations. The server ships the <strong>eatspot-discovery</strong> agent skill for budget-, quality-, category-, and schedule-validated venue search, and installs itself plus its skills into supported CLI agents (antigravity, claude, codex, copilot, openclaw, opencode, pi) with one command.
</p>

<p align="center">
  <a href="#feature-highlights">Feature Highlights</a> |
  <a href="#quick-start">Quick Start</a> |
  <a href="#requirements">Requirements</a> |
  <a href="#users-guide">User's Guide</a> |
  <a href="#acknowledgments">Acknowledgments</a>
</p>

<p align="center">
  🚧 <strong>STAGE:</strong> PRE-ALPHA 📝 — Proof-of-Concept (PoC), Work in Progress 🏗️ 🚧
  <br>
  ⚠️ <strong>IMPORTANT NOTICE</strong>: Created with <a href="https://www.npmjs.com/package/pi-usereq"><strong>PI-useReq/pi-usereq</strong></a> 🤖✨ ⚠️
</p>

# Feature Highlights

`install` registers the server and its agent skills in every enabled CLI agent; one configuration file holds every setting.

- **18 Google Maps tools** — geocoding, Places API (New) search and details, directions, distance matrix, weather, air quality, timezone, elevation, static maps, batch geocode, plus composite tools that chain geocoding, search, details, and routing (full catalog: [docs/TOOLS.md](https://github.com/Ogekuri/mcp-google-api/blob/main/docs/TOOLS.md)).
- **Two transports** — stdio for locally registered MCP clients and Streamable HTTP at `/mcp` with per-session isolation.
- **CLI agent integration** — `enable` selects agents (`antigravity`, `claude`, `codex`, `copilot`, `openclaw`, `opencode`, `pi`); `install` registers the server and synchronizes the bundled skills with a per-CLI activity report; `show` reports OK, MISSING, or STALE status.
- **Single-file configuration** — the Google Maps API key, enabled agents, exposed tools, HTTP host and port, and the update check live in `~/.config/mcp-google-api/config.json`, managed through dedicated commands or the configuration interface; no environment variables.
- **Per-request credentials** — HTTP requests may override the configured key with the `X-Google-Maps-API-Key` or `Authorization: Bearer` header; each session keeps its own key.
- **Standalone CLI** — `doctor` self-checks, `exec` one-shot tool calls, `batch-geocode` with bounded concurrency, `snippet` registration JSON.
- **Automatic update check** — compares the running version against the npm registry at startup (stderr only, never blocks startup, on by default); `--ver` and `--upgrade` management commands.

# Quick Start

Install the package, configure the API key, run the server. Optional configuration lives in the [User's Guide](#users-guide).

**1. Install** (Node.js >= 24):

```bash
npm install -g mcp-google-api
```

**2. Configure** — create a Google Maps API key at <https://console.cloud.google.com/apis/credentials>, enable the APIs for the tools you use ([Requirements](#requirements)), then persist the key:

```bash
mcp-google-api api-key "AIza..."
mcp-google-api doctor          # local self-check: Node, package, key, settings (no network)
```

**3. Run** — select the CLI agents to register (supported: `antigravity`, `claude`, `codex`, `copilot`, `openclaw`, `opencode`, `pi`), register the server, then start it:

```bash
mcp-google-api enable pi
mcp-google-api install         # registers the server + skills in every enabled CLI
mcp-google-api start --stdio   # stdio transport (used by the registered CLI entries)
mcp-google-api start           # Streamable HTTP at http://127.0.0.1:3000/mcp
```

Reload the enabled CLI agent after `install` so it loads the registered `mcp-google-api` server and its tools.

# Requirements

- **Node.js >= 24** (enforced by `doctor` and the release pipeline) and **npm** for installation.
- A **Google Cloud project** and one **Google Maps API key** (<https://console.cloud.google.com/apis/credentials>).
- **Google APIs enabled for the key.** Enable only the APIs used by the tools you run. `doctor` lists the Google APIs required by each enabled tool; `doctor --live` probes Geocoding, Places (New), and Routes.

| API to enable | Needed for |
| --- | --- |
| **Places API (New)** | Place search and details tools, composite tools that use them, and the `eatspot-discovery` skill |
| **Geocoding API** | `maps_geocode`, `maps_reverse_geocode`, `maps_batch_geocode`, and address resolution |
| **Routes API** | `maps_directions`, `maps_distance_matrix`, `maps_plan_route`, `maps_search_along_route` |
| **Time Zone API** | `maps_timezone` |
| **Maps Elevation API** | `maps_elevation` |
| **Maps Static API** | `maps_static_map` |
| **Weather API** | `maps_weather` (unsupported locations return a dedicated error) |
| **Air Quality API** | `maps_air_quality` |

- **MCP client** (optional): any Model Context Protocol client using stdio or Streamable HTTP. The CLI agents with automated registration are `antigravity`, `claude`, `codex`, `copilot`, `openclaw`, `opencode`, and `pi`.

After installation verify the setup with `mcp-google-api doctor` (no network calls) and optionally `mcp-google-api doctor --live` (billable probes). Restrict the exposed tool set with `mcp-google-api tools` (see [User's Guide](#users-guide)).

# User's Guide

## Configuration file

Every setting is persisted in `~/.config/mcp-google-api/config.json` through dedicated commands; **no environment variables are used**. `api-key` is the only API-key configuration path.

```json
{
  "enabled": ["pi"],
  "apiKey": "AIza...",
  "autoUpdate": true,
  "enabledTools": "*",
  "host": "127.0.0.1",
  "port": 3000
}
```

| Command | Field | Purpose |
| --- | --- | --- |
| `mcp-google-api api-key <key>` | `apiKey` | Validate (20-50 characters: letters, digits, hyphens, underscores), persist the Google Maps API key, then refresh every enabled CLI registration; masked in every report |
| `mcp-google-api enable <cli>` / `disable <cli>` | `enabled` | Add or remove a CLI agent (idempotent, case-insensitive; an unsupported name exits 2 with the ordered list of supported names) |
| `mcp-google-api tools <names\|*>` | `enabledTools` | Restrict the exposed tools with a comma-separated list, e.g. `maps_geocode,maps_search_places`; `*` exposes all 18 tools; unknown names are rejected; a persisted list matching zero tools falls back to the full set with an error log |
| `mcp-google-api host <host>` | `host` | HTTP bind host (default `127.0.0.1` loopback; `0.0.0.0` for all interfaces) |
| `mcp-google-api port <port>` | `port` | HTTP listen port, integer 1-65535 (default `3000`) |
| `mcp-google-api auto-update <enable\|disable\|1\|0>` | `autoUpdate` | Enable or disable the startup update check (enabled by default) |

The `--host` and `--port` flags (`-p`) override the persisted settings for a single `start` or `run` invocation. Missing or malformed settings content loads with normalized defaults. The configuration and registration commands (`enable`, `disable`, `auto-update`, `tools`, `host`, `port`, `api-key`, `install`, `uninstall`, `show`) accept `--home <dir>` to target an alternative home root.

## Configuration interface

The settings file is also readable and writable through canonical paths. The root section is `Settings` with parameters `enabled`, `apiKey`, `autoUpdate`, `enabledTools`, `host`, and `port`. Path segments are separated by `:` and are case-sensitive.

| Flag | Purpose |
| --- | --- |
| `--print [Path]` | Print current values as a tree (whole file, one section, or one parameter) |
| `--info [Path]` | Print the schema documentation as a tree |
| `--print-raw` | Print the settings file bytes unchanged |
| `--get Path` | Print one value as bare JSON (pipeable) |
| `--set Path Value` | Set a value; non-string parameters take a JSON literal |
| `--unset Path` | Restore the schema default, or delete one array element |

Array operations on `Settings:enabled`:

- `Settings:enabled:<Idx>` — read (`--get`), replace (`--set`), or delete (`--unset`); `0 <= Idx < length`.
- `Settings:enabled:+` or `Settings:enabled:append` — append one element (write only).
- `Settings:enabled:insert:<Idx>` — insert one element; `0 <= Idx <= length` (write only).

```bash
mcp-google-api --print
mcp-google-api --info Settings:enabled
mcp-google-api --get Settings:port
mcp-google-api --set Settings:port 3100
mcp-google-api --set Settings:enabled:+ "pi"
mcp-google-api --unset Settings:enabled:0
mcp-google-api --unset Settings:host
```

- The settings file and its directory are created from defaults when missing; an existing file is never rewritten by display commands.
- `--set` and `--unset` validate the whole document. Malformed JSON, wrong types, violated constraints, or invalid existing content exit 1 with a stderr diagnostic and leave the file unchanged.
- Successful `--set` and `--unset` print one confirmation naming the full canonical path.
- `enabled` accepts only supported CLI names (stored in lowercase) and rejects duplicates.
- `--set Settings:enabled` and `--set Settings:apiKey` update the settings file only; run `install` or `api-key` to refresh registrations and skills.

## CLI agents: registration and removal

`mcp-google-api install` registers, for every enabled CLI, the stdio entry `mcp-google-api` launching the absolute Node.js executable plus the absolute launcher of the globally installed package (`<npm global prefix>/…/bin/mcp-google-api.mjs`) with `start --stdio`, with no API key or environment payload embedded (the registered server reads its key from the settings file at startup), and synchronizes every bundled skill. Because the entry carries absolute paths, it always executes the global installation regardless of the MCP client launch directory, and it rewrites any legacy `npx -y mcp-google-api start --stdio` entry on the next run. `install` exits non-zero without writing any configuration when the running entrypoint is a source checkout or an npm `_npx` cache copy, naming `npm install -g mcp-google-api@latest`. It prints a per-CLI activity report and exits 1 on any per-CLI failure. `mcp-google-api uninstall` is the exact reciprocal; absent entries count as removed. Unrelated configuration entries are always preserved. With no enabled CLI both commands print an enable hint and exit 0. After changing a registration, reconnect the MCP client (pi: `/reload`) so the new entry is spawned.

| CLI | MCP configuration | Skills directory |
| --- | --- | --- |
| antigravity | `~/.gemini/settings.json` | `~/.gemini/config/skills` |
| claude | `~/.claude.json` | `~/.claude/skills` |
| codex | `~/.codex/config.toml` (`mcp_servers` table) | `~/.codex/skills` |
| copilot | `~/.copilot/mcp.json` (`mcpServers` map) | `~/.copilot/skills` |
| openclaw | `~/.openclaw/openclaw.json` | `~/.openclaw/workspace/skills` |
| opencode | `~/.config/opencode/opencode.json` (`mcp` map) | `~/.config/opencode/skills` |
| pi | `~/.pi/agent/mcp.json` | `~/.pi/agent/skills` |

- **pi**: reload the pi session after `install` or `uninstall` so the changed MCP configuration is loaded.
- **OpenClaw**: reload the gateway or restart the agent session so the new server is connected.
- `mcp-google-api show` prints the CLI Configuration table (all seven agents) and the Installation Status table (server plus each skill per enabled CLI, with OK, MISSING, or STALE status).
- `mcp-google-api install --debug-skills` additionally appends each skill's packaged debug overlay to the installed `SKILL.md`. Plain installs, `api-key`, and `--upgrade` refreshes never append it; `show` reports OK in both modes.

## Running the server

```bash
mcp-google-api start --stdio                    # stdio transport (stdout reserved for JSON-RPC; logs on stderr)
mcp-google-api start                            # Streamable HTTP at http://127.0.0.1:3000/mcp
mcp-google-api start --host 0.0.0.0 --port 3100 # override host and port for one run
mcp-google-api run --stdio                      # alias of start
```

- **Loopback default**: the HTTP server binds to `127.0.0.1`. The default was migrated from `0.0.0.0`; pass `--host 0.0.0.0` for one run, or persist it with `mcp-google-api host 0.0.0.0`, to listen on all interfaces.
- `SIGINT` and `SIGTERM` close all HTTP sessions and the listening socket before exit. The process exits non-zero when no instance can listen (invalid or taken port).
- stdio mode refuses to start without a configured key: it exits 1 with a stderr JSON error naming the `api-key` command. HTTP mode starts anyway and logs a warning; per-request header keys remain usable.
- The automatic update check runs at startup (on by default): a newer npm version is reported on stderr only, with the current version, the latest version, and an upgrade command. It never blocks startup.

### stdio vs Streamable HTTP

| | stdio | Streamable HTTP |
|---|---|---|
| Launch | `mcp-google-api start --stdio` (what `install` registers in MCP-client configs) | `mcp-google-api start` or `run`, with optional `--host` and `--port` |
| Channel | JSON-RPC 2.0 frames over stdin and stdout; stdout carries only protocol traffic, diagnostics go to stderr | HTTP POST, GET, and DELETE on `http://<host>:<port>/mcp`; GET serves SSE for server-to-client notifications |
| API key | resolved once at startup from the persisted `apiKey` setting; startup fails without one | per-request `X-Google-Maps-API-Key` or `Authorization: Bearer` header, then the session key, then the configured setting; startup only warns without one |
| Typical use | locally registered MCP clients (antigravity, claude, codex, copilot, openclaw, opencode, pi) launched by `install` | remote or multi-client access to one shared server, each client isolated by its `mcp-session-id` |

Use **stdio** when a local MCP client launches the server from its own configuration. Use **Streamable HTTP** when several clients, local or remote, share one server instance. Both transports expose the same 18 tools.

## Per-request API keys

On the HTTP transport each request may supply its own key with top priority: the `X-Google-Maps-API-Key` header, or an `Authorization: Bearer <key>` header. Each session (`mcp-session-id`) keeps its session key; the configured `apiKey` setting is the fallback. Concurrent clients can therefore use isolated credentials against one server.

## Diagnostics

```bash
mcp-google-api doctor                                    # local: Node >= 24, package version, key presence, effective settings (masked, with per-field source), Google APIs required per enabled tool
mcp-google-api doctor --live                             # billable probes: Geocoding, Places (New), Routes
mcp-google-api doctor --live --probes geocoding,routes   # probe only the selected subset
mcp-google-api doctor --live --apikey "AIza..."          # override the configured key for this run (alias -k)
```

`doctor` prints a machine-readable JSON report on stdout and diagnostics on stderr. It exits 0 only when no check fails.

## One-shot CLI tools

```bash
mcp-google-api exec maps_geocode '{"address":"Tokyo Tower"}'    # run one tool by its canonical maps_ name
mcp-google-api batch-geocode -i addresses.txt -o results.json   # one address per line; summary written to the file
cat addresses.txt | mcp-google-api batch-geocode -i -           # read addresses from stdin
```

- `exec` prints the tool result as pretty-printed JSON on stdout. It exits 1 with a JSON error on stderr when no key is configured, when the tool reports failure, when the parameters are not valid JSON, or when the tool name is unknown.
- `batch-geocode` requires `-i`/`--input` (`-` for stdin). `-c`/`--concurrency` sets the parallel request count (default 20, clamped 1-50). It writes a JSON summary `{ total, succeeded, failed, results }` to `-o`/`--output` or stdout, and exits 1 when any address failed.
- Both commands resolve the API key from the persisted `api-key` setting only.

## Registration snippets

```bash
mcp-google-api snippet --client pi                      # stdio snippet (npx launcher)
mcp-google-api snippet --transport http --port 3100     # Streamable HTTP URL snippet
mcp-google-api snippet --client pi --launcher node --command /abs/path/dist/cli.js
```

- `--client` accepts `generic`, `claude`, `cursor`, `pi`; `--launcher` accepts `npx`, `node`, `bin`; `--transport` accepts `stdio`, `http`.
- `--host` and `--port` shape the HTTP URL, and `--name` sets the server key inside `mcpServers` (default `mcp-google-api`).
- `snippet` prints a valid `mcpServers` JSON registration on stdout and guidance notes on stderr. It never writes files. Entries embed no API key and no environment payload; configure the key with `api-key`.

## Version management and removal

```bash
mcp-google-api --ver                        # installed, npm latest, and GitHub latest versions (three lines)
mcp-google-api --upgrade                    # npm install -g mcp-google-api@latest, then refresh skills and registrations
mcp-google-api --upgrade --develop          # install the latest tagged GitHub release (alias --dev)
mcp-google-api --upgrade --force            # force package re-download and complete reinstallation
mcp-google-api --upgrade --develop --force  # forced reinstall of the latest tagged GitHub release
mcp-google-api uninstall                    # remove MCP registrations and skills from every enabled CLI
mcp-google-api --uninstall                  # npm uninstall -g mcp-google-api
```

- `--upgrade` reinstalls the package on every invocation, with no pre-upgrade version comparison. After a successful upgrade it re-runs `install` through the upgraded package and prints the starting version, the updated version, and one entry per processed CLI.
- `--develop` (alias `--dev`) selects the latest tagged GitHub release regardless of the branch carrying the tag.
- `--force` can be combined with either channel, in any option order. Standard runs stay unforced.

# Documentation

## Reference documents

- [docs/TOOLS.md](https://github.com/Ogekuri/mcp-google-api/blob/main/docs/TOOLS.md) — catalog and parameters of the 18 exposed tools.
- [docs/CONFIGURATION.md](https://github.com/Ogekuri/mcp-google-api/blob/main/docs/CONFIGURATION.md) — configuration reference: settings file, commands, transports, per-request keys, registration.
- [docs/SKILLS_AUTHORING.md](https://github.com/Ogekuri/mcp-google-api/blob/main/docs/SKILLS_AUTHORING.md) — conventions for adding a packaged skill with a `manifest.json` entry and no source change.
- [skills/](https://github.com/Ogekuri/mcp-google-api/tree/main/skills) — bundled agent skills; `eatspot-discovery` implements budget (breakfast EUR 10 / lunch EUR 30 / dinner EUR 40 defaults), quality grades A-E, category and opening-hours validation, geographic search modes (3/10/20 km), and a binding anti-fabrication rule: every published Google Maps value must originate from an executed tool call.

## Data locations

- `~/.config/mcp-google-api/config.json` — settings file, created with mode `0600` because it holds the API key.
- `~/.cache/mcp-google-api/check_version_idle-time.json` — idle cache of the automatic update check.
- The server keeps tool results and session state in memory only. `install`, `uninstall`, `api-key`, and `--upgrade` write the registrations and skill directories of the enabled CLI agents (see [CLI agents: registration and removal](#cli-agents-registration-and-removal)).

## Known limitations

- `maps_search_nearby` may return fewer than 20 results when the client-side `openNow` and `minRating` filters discard matches after the query.
- `maps_static_map` does not enforce the documented 640x640 maximum size; only the 16384-character URL limit is enforced.
- Transit routing has regional coverage gaps (notably Japan and India), surfaced as errors or warnings rather than fallbacks.
- `maps_search_places` forwards `pageToken`, but the Places SDK silently drops it, so pagination has no server-side effect. `nextPageToken` is still returned when the API provides it.

# License

GPL-3.0-only — see [LICENSE](https://github.com/Ogekuri/mcp-google-api/blob/main/LICENSE). The SPDX identifier `GPL-3.0-only` matches the `package.json` `license` field.

# Acknowledgments

Special thanks to **CabLate** for the upstream contribution that seeded this project.
