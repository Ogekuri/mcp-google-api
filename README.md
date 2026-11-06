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

# mcp-google-api / MCP Google API server (0.21.0)

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js >= 24">
  <img src="https://img.shields.io/badge/typescript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.7">
  <img src="https://img.shields.io/badge/license-GPL--3.0--only-491?style=flat-square" alt="License: GPL-3.0-only">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-6A7EC2?style=flat-square&logo=terminal&logoColor=white" alt="Platforms">
</p>

**MCP Google API server** — Google APIs for AI agents over the [Model Context Protocol](https://modelcontextprotocol.io).

The server exposes Google API families to AI agents over stdio or Streamable HTTP. The currently implemented family is **Google Maps**, providing 18 read-only tools: geocoding and reverse geocoding, Places API (New) text/nearby search with server-side filters (`priceLevels`, `minRating`, `strictTypeFiltering`), place details, directions, distance matrix, timezone, elevation, weather, air quality, static maps, batch geocode, and the composite tools explore-area, plan-route, compare-places, search-along-route, and local-rank-tracker. Tools are declared read-only, non-destructive, idempotent, and open-world via MCP annotations. The server ships the **eatspot-discovery** agent skill for budget-, quality-, category-, and schedule-validated venue search, and installs itself plus its skills into supported CLI agents (pi, OpenClaw, Codex, Antigravity, Claude) with one command.

[Feature Highlights](#feature-highlights) | [Quick Start](#quick-start) | [User's Guide](#users-guide) | [Acknowledgments](#acknowledgments)

🚧 **DRAFT:** Proof-of-Concept (PoC) Version 📝 — Work in Progress 🏗️ 🚧

⚠️ **IMPORTANT NOTICE**: Created with [**PI-useReq/pi-usereq**](https://www.npmjs.com/package/pi-usereq) 🤖✨ ⚠️

# Feature Highlights

One command installs the server and its agent skills; one configuration file holds every setting.

- **18 Google Maps tools** — geocoding, Places API (New) search and details, directions, distance matrix, weather, air quality, timezone, elevation, static maps, batch geocode, plus composite tools that chain geocoding, search, details, and routing internally (full catalog: [docs/TOOLS.md](docs/TOOLS.md)).
- **Two transports** — stdio for local MCP clients and Streamable HTTP at `/mcp` with per-session state.
- **One-command CLI integration** — `enable` your agents (pi, OpenClaw, Codex, Antigravity, Claude), then `install` registers the server and synchronizes the bundled skills into every enabled CLI with a human-readable activity report; `show` reports OK/MISSING/STALE status.
- **Single-file configuration** — the Google Maps API key, enabled CLI agents, exposed tools, HTTP host/port, and the update check all live in `~/.config/mcp-google-api/config.json`, managed through dedicated commands; no environment variables.
- **Per-request credentials** — HTTP requests may override the configured key with the `X-Google-Maps-API-Key` or `Authorization: Bearer` headers; each session keeps its own key.
- **Standalone CLI** — `doctor` self-checks, `exec` one-shot tool calls, `batch-geocode` with bounded concurrency, `snippet` registration JSON.
- **Automatic update check** — compares the running version against the npm registry at startup (stderr only, never blocks startup, on by default) plus `--ver` and `--upgrade` management commands.

# Quick Start

Install the package, configure the API key, run the server. Optional configuration lives in the [User's Guide](#users-guide).

**1. Install** (Node.js >= 24):

```bash
npm install -g mcp-google-api
```

**2. Configure** — create a Google Maps API key at <https://console.cloud.google.com/apis/credentials>, enable the services you need ([Requirements](#requirements)), then persist the key:

```bash
mcp-google-api api-key "AIza..."
mcp-google-api doctor          # local self-check: Node, package, key, settings (no network)
```

**3. Run** — register the server into your CLI agents (supported: `pi`, `openclaw`, `codex`, `antigravity`, `claude`), then start it:

```bash
mcp-google-api enable pi
mcp-google-api install         # registers the server + skills in every enabled CLI
mcp-google-api start --stdio   # stdio transport (used by the registered CLI entries)
mcp-google-api start           # Streamable HTTP at http://127.0.0.1:3000/mcp
```

Restart (or reload) the enabled CLI agent: the `mcp-google-api` server appears with its tools.

# Requirements

- **Node.js >= 24** (enforced by `doctor` and the release pipeline) and **npm** for installation.
- A **Google Cloud project** with billing enabled and one **Google Maps API key** (<https://console.cloud.google.com/apis/credentials>).
- **Google APIs enabled on the key** (minimal operational subset in bold; enable the others only for the tools you use):

| API to enable | Needed for |
| --- | --- |
| **Places API (New)** | Place search/details tools — **required**; the `eatspot-discovery` skill needs it |
| **Geocoding API** | `maps_geocode`, `maps_reverse_geocode`, `maps_batch_geocode`, address resolution |
| **Routes API** | `maps_directions`, `maps_distance_matrix`, `maps_plan_route` |
| **Time Zone API** | `maps_timezone` |
| **Maps Elevation API** | `maps_elevation` |
| **Maps Static API** | `maps_static_map` |
| **Weather API** | `maps_weather` (limited regional coverage) |
| **Air Quality API** | `maps_air_quality` (limited regional coverage) |

- **MCP client** (optional): any Model Context Protocol client for stdio or Streamable HTTP; the supported CLI agents are pi, OpenClaw, Codex, Antigravity, and Claude.

Minimal subset: **Places API (New) + Geocoding API**. After installation verify the setup with `mcp-google-api doctor` (no network calls) and optionally `mcp-google-api doctor --live` (billable probes); restrict the exposed tool set with `mcp-google-api tools` (see [User's Guide](#users-guide)).

# User's Guide

## Configuration file

Every setting is persisted in `~/.config/mcp-google-api/config.json` through dedicated commands; **no environment variables are used**:

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
| `mcp-google-api api-key <key>` | `apiKey` | Validate (20-50 chars) and persist the Google Maps API key, then refresh every enabled CLI registration; masked in every report |
| `mcp-google-api enable <cli>` / `disable <cli>` | `enabled` | Add/remove a CLI agent (idempotent, case-insensitive) |
| `mcp-google-api tools <list|*>` | `enabledTools` | Restrict the exposed tools, e.g. `maps_geocode,maps_search_places`; `*` = all 18 (unknown names are rejected); a persisted list matching zero tools falls back to the full set with an error log |
| `mcp-google-api host <host>` | `host` | HTTP bind host (default `127.0.0.1` loopback; `0.0.0.0` for all interfaces) |
| `mcp-google-api port <port>` | `port` | HTTP listen port, integer 1-65535 (default `3000`) |
| `mcp-google-api auto-update <enable|disable|1|0>` | `autoUpdate` | Enable/disable the startup update check (enabled by default) |

The `--host` and `--port` flags override the persisted settings for a single `start`/`run` invocation. Missing or malformed settings content reloads with normalized defaults.

## CLI agents: registration and removal

`mcp-google-api install` registers, for every enabled CLI, the stdio entry `mcp-google-api` launching `npx -y mcp-google-api start --stdio` (no API key or environment payload embedded — the registered server reads its key from its own configuration file at startup) and synchronizes every bundled skill; it prints a per-CLI activity report and exits 1 on any per-CLI failure. `mcp-google-api uninstall` is the exact reciprocal (absent entries count as removed). Unrelated configuration entries are always preserved.

| CLI | MCP configuration | Skills directory |
| --- | --- | --- |
| pi | `~/.pi/agent/mcp.json` | `~/.pi/agent/skills` |
| openclaw | `~/.openclaw/openclaw.json` | `~/.openclaw/workspace/skills` |
| codex | `~/.codex/config.toml` (`mcp_servers` table) | `~/.codex/skills` |
| antigravity | `~/.gemini/settings.json` | `~/.gemini/config/skills` |
| claude | `~/.claude.json` | `~/.claude/skills` |

- **pi**: after installing, run `/reload` in the session if the configuration was changed externally; `/mcp` inspects status, tools, and connection errors.
- **OpenClaw**: reload the gateway or restart the agent session so the new server gets connected.
- `mcp-google-api show` prints the CLI Configuration table (all five agents) and the Installation Status table (server + each skill per enabled CLI with OK / MISSING / STALE).
- `mcp-google-api install --debug-skills` additionally appends each skill's packaged debug overlay to the installed `SKILL.md`; plain installs and `api-key`/`--upgrade` refreshes never append it, and `show` reports OK in both modes.

## Running the server

```bash
mcp-google-api start --stdio                    # stdio transport (stdout reserved for JSON-RPC; logs on stderr)
mcp-google-api start                            # Streamable HTTP at http://127.0.0.1:3000/mcp
mcp-google-api start --host 0.0.0.0 --port 3100 # override host/port for one run
mcp-google-api run                              # alias of start
```

- **Loopback default**: the HTTP server binds to `127.0.0.1` (migrated from the previous `0.0.0.0` default); pass `--host 0.0.0.0` or persist `mcp-google-api host 0.0.0.0` to listen on all interfaces.
- `SIGINT`/`SIGTERM` close all HTTP sessions and the listening socket before exit; the process exits non-zero when no instance can listen (invalid or taken port).
- stdio mode refuses to start without a configured key and exits 1 with a stderr error inviting `mcp-google-api api-key <key>`; HTTP mode starts anyway and logs a warning (per-request header keys remain usable).
- The automatic update check runs at startup (default on): a newer npm version is reported on stderr only with an upgrade command; it never blocks startup.

## Per-request API keys

On the HTTP transport each request may supply its own key with top priority: the `X-Google-Maps-API-Key` header, or an `Authorization: Bearer <key>` header. Each session (`mcp-session-id`) keeps its session key; the configured `apiKey` setting is the fallback. This lets concurrent clients use isolated credentials against one server.

## Diagnostics

```bash
mcp-google-api doctor                          # local: Node >= 24, package version, key presence, effective settings (masked, per-field source), required Google APIs per enabled tool
mcp-google-api doctor --live                   # billable probes: Geocoding, Places (New), Routes (independent results)
mcp-google-api doctor --live --probes geocoding,routes   # probe only the selected subset
mcp-google-api doctor --live --apikey "AIza..." # override the key for the probes only
```

`doctor` prints a machine-readable JSON report on stdout (diagnostics on stderr) and exits 0 only when no check fails.

## One-shot CLI tools

```bash
mcp-google-api exec geocode '{"address":"Tokyo Tower"}'        # run one tool; short/snake_case/maps_-prefixed names accepted
mcp-google-api batch-geocode -i addresses.txt -o results.json # geocode one address per line
cat addresses.txt | mcp-google-api batch-geocode -i -          # from stdin
```

- `exec` prints the tool result as JSON on stdout (exit 1 with a JSON error on stderr when no key is configured, the tool fails, the JSON is invalid, or the name is unknown).
- `batch-geocode` bounds concurrency with `--concurrency` (default 20, clamped 1-50), writes a JSON summary `{ total, succeeded, failed, results }` to `--output` or stdout, and exits 1 when any address failed.
- Both resolve the API key from the persisted `api-key` setting only.

## Registration snippets

```bash
mcp-google-api snippet --client pi          # stdio snippet (npx launcher)
mcp-google-api snippet --transport http --port 3100   # HTTP URL snippet
```

`snippet` prints a valid `mcpServers` JSON registration on stdout (guidance notes on stderr) and never writes files. Entries embed no API key and no environment payload; the notes point to the `api-key` command.

## Version management and removal

```bash
mcp-google-api --ver         # installed version, npmjs latest, GitHub latest (three lines)
mcp-google-api --upgrade     # npm install -g mcp-google-api@latest, then refresh skills and registrations with a summary
mcp-google-api uninstall     # remove MCP registrations + skills from every enabled CLI
mcp-google-api --uninstall   # npm uninstall -g mcp-google-api
```

`--upgrade` first checks the registry and skips cleanly when the installed version is already the latest; after a successful upgrade it re-runs `install` through the upgraded package and prints the starting → updated version transition plus one entry per processed CLI.

# Documentation

## Reference documents

- [docs/TOOLS.md](docs/TOOLS.md) — catalog and parameters of the 18 exposed tools.
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) — configuration reference: settings file, commands, transports, per-request keys, registration.
- [src/resources/skills/](src/resources/skills/) — bundled agent skills; `eatspot-discovery` implements budget (breakfast EUR 10 / lunch EUR 30 / dinner EUR 40 defaults), quality grades A-E, category and opening-hours validation, geographic search modes (3/10/20 km), and a binding anti-fabrication rule: every published Google Maps value must originate from an executed tool call.

## Architecture overview

- **Three layers**: tool modules define name, description, zod input schema, and handler; a facade chains them (including the composite tools); dedicated clients call the Google APIs (Places API (New) via the official SDK, Routes via REST with explicit field masks, the remaining services via the legacy Maps services client).
- **Transports**: one shared JSON-RPC core serves both stdio and Streamable HTTP; the HTTP transport creates a dedicated server instance and transport per session (`mcp-session-id`), and API keys propagate per request/session through an async-local context.
- **Safety**: every tool is annotated read-only, non-destructive, idempotent, and open-world; Places results default to English; Google error codes are mapped to actionable messages (invalid key / API not enabled, quota exceeded).
- **State**: all state is in-memory per process except the user-owned settings file and the update-check idle cache under `~/.cache/mcp-google-api/`.

## Known limitations

- `maps_search_nearby` may return fewer than 20 results when the client-side `openNow`/`minRating` filters discard matches after the query.
- Transit routing has regional coverage gaps (notably Japan and India), surfaced as errors or warnings rather than fallbacks.
- `maps_static_map` does not enforce the documented 640x640 maximum size; only the 16384-character URL limit is enforced.
- `maps_search_places` forwards `pageToken` but the Places SDK silently drops it, so pagination has no server-side effect; `nextPageToken` is still returned when present.
- Weather API and Air Quality API have limited regional coverage; unsupported locations return a dedicated error message.

# License

GPL-3.0-only — see [LICENSE](LICENSE). The SPDX identifier `GPL-3.0-only` matches the `package.json` `license` field.

# Acknowledgments

Special thanks to **CabLate** for the upstream contribution that seeded this project.
