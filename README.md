> [!CAUTION]
> ### 🚨 STRICTLY EXPERIMENTAL — PROOF OF CONCEPT (PRE-ALPHA)
> 
> ![Status: Proof of Concept](https://img.shields.io/badge/Status-Proof_of_Concept-red?style=flat-square) ![Stage: Pre-Alpha](https://img.shields.io/badge/Stage-Pre--Alpha-critical?style=flat-square) ![Maintenance: Personal Use Only](https://img.shields.io/badge/Scope-Personal_Use_Only-important?style=flat-square) ![Issues: Closed](https://img.shields.io/badge/Issues_%26_PRs-Not_Accepted-inactive?style=flat-square)
>
> **PLEASE READ CAREFULLY BEFORE USING THIS SOFTWARE:**
> 
> * **Very Early Stage:** This project is currently a raw **Proof of Concept (PoC)** in a **pre-alpha** state. It is nowhere near production-ready and may contain severe bugs, breaking changes, or incomplete logic.
> * **Personal Use Only:** This repository is developed, maintained, and shared strictly for **personal use**. 
> * **No Support or Feature Requests:** Please **do not** open issues, bug reports, or feature requests. They will not be addressed or accepted at this stage of development.
> * **No Warranty:** This software is provided **"AS IS"**, without warranty of any kind, express or implied. You may use it strictly for **testing and evaluation purposes** at your own sole risk.

# mcp-google-api (0.20.0)

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js >= 24">
  <img src="https://img.shields.io/badge/typescript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.7">
  <img src="https://img.shields.io/badge/license-GPL--3.0--only-491?style=flat-square" alt="License: GPL-3.0-only">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-6A7EC2?style=flat-square&logo=terminal&logoColor=white" alt="Platforms">
</p>

<p align="center">
<strong>MCP Google API — Google APIs for AI agents (stdio + Streamable HTTP)</strong><br>
A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes **Google APIs** to AI agents, designed to host multiple Google API families over time. The first supported family is **Google Maps Platform**, providing 18 tools: Places API (New) search with **server-side filters** (`priceLevels`, `minRating`, `strictTypeFiltering`), raw API payload access, geocoding, directions, distance matrix, and more.

Supported transports: **stdio** (local MCP clients) and **Streamable HTTP**.

> Ships the **eatspot-discovery** agent skill (`src/resources/skills/`) for budget-, quality-, category-, and schedule-validated venue search.

</p>

<p align="center">
  <a href="#feature-highlights">Feature Highlights</a> |
  <a href="#requirements">Requirements</a> |
  <a href="#install">Install / Uninstall</a> |
  <a href="#quick-start">Quick Start</a> |
  <a href="#command-line-interface">CLI</a> |
  <a href="#registering-in-an-mcp-client">MCP Clients</a> |
  <a href="#documentation">Docs</a>
</p>
<p align="center">
<br>
🚧 <strong>DRAFT:</strong> Proof-of-Concept (PoC) Version 📝 - Work in Progress 🏗️ 🚧<br>
⚠️ <strong>IMPORTANT NOTICE</strong>: Created with <a href="https://www.npmjs.com/package/pi-usereq"><strong>PI-useReq/pi-usereq</strong></a> 🤖✨ ⚠️<br>
<br>
</p>


## Feature Highlights

- **Google API tool surface** — 18 **Google Maps** tools today (the first supported API family), ready to grow with further Google API families: geocoding, reverse geocoding, Places API (New) text/nearby search, place details, directions, distance matrix, elevation, timezone, weather, air quality, static maps, batch geocode, plus composite tools (explore-area, plan-route, compare-places, search-along-route, local-rank-tracker). Full catalog: [docs/TOOLS.md](docs/TOOLS.md).
- **Server-side Places filters** — `priceLevels`, `minRating`, `openNow`, `includedType`, `strictTypeFiltering`, and location bias are forwarded to Places API (New) as request fields by `maps_search_places`; in `maps_search_nearby`, `openNow` and `minRating` are applied after the query, so filters can return fewer than 20 results.
- **Raw API payloads** — searches and details can return the untouched Google response (`includeRaw: true`) with explicit Field Masks.
- **Two transports** — stdio for local MCP clients (pi, Claude Desktop, Cursor, ...) and Streamable HTTP at `/mcp` with per-session API keys.
- **Per-request credentials** — key resolution from `X-Google-Maps-API-Key` or `Authorization: Bearer` headers, per-session keys, or the persisted `api-key` setting; one-shot CLI commands (`exec`, `doctor --live`, `batch-geocode`) read `--apikey` (default: `GOOGLE_MAPS_API_KEY` environment).
- **Standalone CLI** — `doctor` self-checks, `exec <tool>` one-shot calls, `batch-geocode` with bounded concurrency.
- **Automatic update check** — at server startup the server compares its version against the latest npm release and prints an upgrade notice on stderr; it never blocks startup and can be disabled with `mcp-google-api auto-update disable` (persisted `autoUpdate` setting; see [Configuration prerequisites](#configuration-prerequisites)).
- **EatSpot Discovery skill** — server-side `priceLevels`/`minRating`/`strictTypeFiltering` filters and raw payloads back the bundled `eatspot-discovery` skill (`src/resources/skills/`).

## Requirements

- Node.js **>= 24**
- A **Google Maps API key** (<https://console.cloud.google.com/apis/credentials>) with the services enabled — see below

## Required Google Cloud APIs

Mapping verified against the sources: every endpoint the server calls and the tools that call it. The table below covers the **Google Maps family** — the first supported API family; further Google API families will extend this table with the same enable → key → tools pattern.

| # | API to enable | Endpoint used by the server | Tools that require it | Needed for | Skill priority |
|---|---|---|---|---|---|
| 1 | **Places API (New)** | `places.googleapis.com` (`places:searchText`, `places:searchNearby`, `GET places/{id}`, photo media) via `@googlemaps/places` | `maps_search_places`, `maps_search_nearby`, `maps_place_details`, `maps_explore_area`, `maps_compare_places`, `maps_search_along_route`, `maps_local_rank_tracker` | Place search/details, `priceLevels`/`minRating` filters, `priceRange`, opening hours | **Required** |
| 2 | **Geocoding API** | `maps.googleapis.com/maps/api/geocode/json` via `@googlemaps/google-maps-services-js` | `maps_geocode`, `maps_reverse_geocode`, `maps_batch_geocode` (+ internal address-resolution fallback) | Address ↔ coordinate conversion | High |
| 3 | **Routes API** | `routes.googleapis.com` (`computeRoutes`, `computeRouteMatrix`) | `maps_directions`, `maps_distance_matrix`, `maps_plan_route` | Routes and distance matrix | Medium |
| 4 | **Time Zone API** | `maps.googleapis.com/maps/api/timezone/json` | `maps_timezone` | Time zone / local time | Low |
| 5 | **Maps Elevation API** *(in the console: "Maps Elevation API", service `elevation-backend`)* | `maps.googleapis.com/maps/api/elevation/json` | `maps_elevation` | Ground elevation | Low |
| 6 | **Maps Static API** | `maps.googleapis.com/maps/api/staticmap` | `maps_static_map` | PNG map image | Low |
| 7 | **Weather API** | `weather.googleapis.com/v1` (current, forecast/days, forecast/hours) | `maps_weather` | Current weather / forecasts | Low (regional availability) |
| 8 | **Air Quality API** | `airquality.googleapis.com/v1/currentConditions:lookup` | `maps_air_quality` | Air quality | Low (regional availability) |

Quick enablement (current GCP project):

```bash
PROJECT=your-project
gcloud services enable places-backend-new.googleapis.com \
  geocoding-backend.googleapis.com \
  routes.googleapis.com \
  timezone-backend.googleapis.com \
  elevation-backend.googleapis.com \
  static-maps-backend.googleapis.com \
  weather-backend.googleapis.com \
  airquality.googleapis.com --project=$PROJECT
```

### Notes

- For minimal eatspot-discovery use, **Places API (New)** + **Geocoding API** suffice; enable the others only for the corresponding tools (or limit exposure with `GOOGLE_MAPS_ENABLED_TOOLS`).
- **Maps Grounding Lite** and **Geolocation API** are **not required** by this server: the former belongs to Google's hosted MCP (`mapstools.googleapis.com`), the latter is used by no tool (there is no `ip_geolocate` in this fork).
- The legacy **Places API** is not needed: the server uses Places API (New) exclusively.
- Weather API and Air Quality API have limited regional coverage: outside coverage, the tool returns an unsupported-location error message.


## Install

**Prerequisites**: Node.js **>= 24** and a Google Maps API key (see [Requirements](#requirements)).

### Prebuilt package (recommended)

```bash
npm install -g mcp-google-api
mcp-google-api api-key "AIza..."   # persist the Google API key at ~/.config/mcp-google-api/config.json (masked in output)
mcp-google-api doctor               # local self-check: Node, package, key, config (no network)
mcp-google-api start --stdio        # MCP server over stdio
mcp-google-api start                # MCP server over Streamable HTTP at http://127.0.0.1:3000/mcp
```

One-shot alternative without a global install: `npx -y mcp-google-api start --stdio`.

> The server resolves its key exclusively from the persisted `api-key` setting (see [Configuration prerequisites](#configuration-prerequisites)). One-shot CLI commands (`exec`, `doctor --live`, `batch-geocode`) can instead read `GOOGLE_MAPS_API_KEY` from the environment or a `.env` scaffolded with `mcp-google-api setup --write-env`.

### From source (this repository) — cross-platform, no bash required

```bash
git clone https://github.com/Ogekuri/mcp-google-api.git
cd mcp-google-api
npm ci                             # install dependencies from the lockfile
npm run build                       # tsup -> dist/ (ESM)
node dist/cli.js start --stdio            # MCP server over stdio
node dist/cli.js start --host 127.0.0.1 --port 3000   # Streamable HTTP at /mcp
```

On Linux/macOS the bash helpers in `scripts/` wrap the same commands (`scripts/setup.sh`, `scripts/build.sh`, `scripts/start-mcp.sh`, `scripts/start-http.sh`, `scripts/test.sh`); each helper fails with remediation guidance instead of chaining implicit installs or builds. `scripts/mcp-google-api.sh` runs the local copy exactly like the installed bin — every argument is forwarded to the local `dist/cli.js` (e.g. `scripts/mcp-google-api.sh doctor`). On Windows use the `npm`/`node` commands above.

MCP client registration over stdio works cross-platform with plain `node` (no key is embedded: the server loads its key from the persisted `api-key` setting at startup):

```json
{
  "mcpServers": {
    "mcp-google-api": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-google-api/dist/cli.js", "start", "--stdio"]
    }
  }
}
```

## Uninstall

```bash
mcp-google-api uninstall                         # remove MCP registrations + skills from every enabled CLI
npm uninstall -g mcp-google-api    # npm-based install
rm -rf mcp-google-api              # from-source clone; also remove any MCP client registration
```

## Quick Start

The [prebuilt-package path](#install) is the recommended Quick Start: install, `api-key "AIza..."`, `doctor`, run. Registration snippets for any client are one command away (JSON on stdout, no files written):

```bash
mcp-google-api snippet --client claude                           # stdio snippet (npx launcher)
mcp-google-api snippet --client pi --env-key GOOGLE_MAPS_API_KEY # ${VAR} reference (client-specific expansion)
mcp-google-api snippet --transport http --port 3100              # HTTP URL snippet
```

> **Loopback default (migration)**: the HTTP server now binds to `127.0.0.1` by default; it previously bound `0.0.0.0`. To listen on all interfaces pass `--host 0.0.0.0` or set `MCP_SERVER_HOST=0.0.0.0`. In HTTP mode, `SIGINT`/`SIGTERM` close all sessions and the listening socket before exit.

## Command-line interface

All commands work through the `mcp-google-api` binary (npm install) or `node dist/cli.js` (from source).

```bash
mcp-google-api start --stdio                            # MCP server over stdio
mcp-google-api start --host 127.0.0.1 --port 3000       # MCP server over Streamable HTTP at /mcp (loopback default)
mcp-google-api setup --write-env                        # onboarding: readiness checks + .env scaffold (no network, no prompts)
mcp-google-api doctor                                   # local self-check: Node, package, key, config, tool profiles (no network)
mcp-google-api doctor --live --apikey "AIza..."         # also probes Geocoding, Places (New), Routes (billable calls)
mcp-google-api doctor --live --probes geocoding,routes  # probe only the selected APIs
mcp-google-api exec geocode '{"address":"Tokyo Tower"}' # one tool call from the terminal
mcp-google-api batch-geocode -i addresses.txt -o results.json
mcp-google-api enable pi claude                  # enable MCP registration + skills for specific CLIs
mcp-google-api api-key "AIza..."                # save the API key in the user settings and refresh every enabled CLI registration
mcp-google-api install                           # register the stdio server and install skills in every enabled CLI
mcp-google-api install --debug-skills            # also append each skill's packaged debug overlay to the installed SKILL.md
mcp-google-api uninstall                         # reciprocal removal of install in every enabled CLI
mcp-google-api show                              # CLI Configuration and Installation Status tables
mcp-google-api auto-update disable               # disable the startup update check (enable|disable|1|0)
mcp-google-api --env-file /path/to/.env doctor          # load an explicit environment file
mcp-google-api snippet --client cursor                  # print an MCP client registration snippet (no files written)
mcp-google-api --ver                                    # print installed, npmjs-latest, and GitHub-latest versions
mcp-google-api --upgrade                                # npm install -g mcp-google-api@latest, then refresh skills
mcp-google-api --uninstall                              # npm uninstall -g mcp-google-api
```

- `exec <tool> [params]` runs one tool and prints JSON; `params` is a JSON string. Tool names accept short (`geocode`), snake_case (`search_places`), and `maps_`-prefixed (`maps_geocode`) forms.
- `exec` writes results to stdout and errors to stderr; it exits 1 when no API key is configured, the tool reports a failure, the JSON is invalid, or the tool name is unknown.
- `batch-geocode` reads one address per line from `--input` (use `-` for stdin), geocodes with bounded concurrency (`--concurrency`, default 20, clamped to 1–50), writes a JSON summary `{ total, succeeded, failed, results }` to `--output` or stdout, and exits 1 if any address failed.
- `setup` is non-interactive: no prompts, no Google API calls, and no writes unless `--write-env` is passed; `--write-env` creates `.env` in `--env-dir` (default: current directory) only when it does not exist and never overwrites it.
- `snippet` prints a valid `mcpServers` JSON registration to stdout (guidance notes on stderr) and never writes or edits configuration files; by default it embeds a literal placeholder, and `--env-key NAME` emits a `${NAME}` reference whose expansion is client-specific.
- `--env-file <path>` loads exactly the given environment file for any command and exits 1 with a JSON error when the file is missing (no implicit `.env` fallback).
- `enable <cli>` / `disable <cli>` manage the persisted enabled-CLI set at `~/.config/mcp-google-api/config.json`; accepted names (case-insensitive): `pi`, `openclaw`, `codex`, `antigravity`, `claude`; unsupported names exit 2 listing the supported ones.
- `api-key <key>` validates the key (20-50 characters of letters, digits, hyphens, underscores), saves it as `apiKey` in the persisted settings at `~/.config/mcp-google-api/config.json` (masked in the JSON output), and immediately re-runs `install` for every enabled CLI; invalid keys fail with a JSON error and persist nothing.
- `install` registers for every enabled CLI the stdio server entry `mcp-google-api` (`npx -y mcp-google-api start --stdio`) with **no embedded key or environment setup** — the registered server loads its key at startup from the persisted `api-key` setting — and installs every bundled skill; `uninstall` is the reciprocal removal. Per-CLI targets: pi `~/.pi/agent/mcp.json` + `~/.pi/agent/skills`, openclaw `~/.openclaw/openclaw.json` + `~/.openclaw/workspace/skills`, codex `~/.codex/config.toml` (`mcp_servers` table) + `~/.codex/skills`, antigravity `~/.gemini/settings.json` + `~/.gemini/config/skills`, claude `~/.claude.json` + `~/.claude/skills`. Existing unrelated configuration entries are always preserved.
- `install --debug-skills` appends each skill's packaged debug overlay (declared by the manifest `debug` field, e.g. `eatspot-discovery/DEBUG.md`) to the installed `SKILL.md`; without the flag the debug file is neither copied nor appended, so installed skills carry no debug instructions. `--upgrade` and `api-key` always reinstall without the overlay, and `show` reports `OK` for skills installed in either mode.
- `show` prints two human-readable tables: CLI Configuration (CLI, Enabled, MCP Config Path, Skills Config Path for all five CLIs) and Installation Status (Type, Name, CLI, Enabled, Installed with OK/MISSING/STALE per enabled CLI).
- `auto-update <state>` accepts `enable`, `disable`, `1`, `0` (case-insensitive), persists the boolean into the settings `autoUpdate` field before printing a human-readable confirmation, and rejects any other value with a stderr error, persisting nothing.
- HTTP mode starts even without an API key and logs a warning (per-request header keys remain supported); `start`/`run` resolve the server key exclusively from the persisted `api-key` setting — stdio mode exits 1 with a JSON error on stderr inviting `mcp-google-api api-key <key>` when no key is configured. One-shot CLI commands (`exec`, `doctor --live`, `batch-geocode`) take the key from `--apikey` (default: `GOOGLE_MAPS_API_KEY` environment/`.env`). When no HTTP instance can start (invalid or taken port), the process exits non-zero.

## Registering in an MCP client

Generate the registration JSON with `mcp-google-api snippet --client <generic|claude|cursor|pi>` (see [Quick Start](#quick-start)), then paste it into the target file. Manual examples:

**stdio:"

```json
{
  "mcpServers": {
    "mcp-google-api": {
      "command": "/absolute/path/to/mcp-google-api/scripts/start-mcp.sh"
    }
  }
}
```

No key is embedded in the registration: the server loads its key at startup from the persisted `mcp-google-api api-key` setting.

**HTTP** (after `scripts/start-http.sh`):

```json
{
  "mcpServers": {
    "mcp-google-api": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

### pi CLI

pi reads MCP servers from `~/.pi/agent/mcp.json` (user) or `.pi/mcp.json` (project, requires trust). stdio entry for this server:

```json
{
  "mcpServers": {
    "maps": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-google-api/dist/cli.js", "start", "--stdio"]
    }
  }
}
```

- From a terminal: `pi mcp add maps -- node /absolute/path/to/mcp-google-api/dist/cli.js start --stdio`.
- The registration carries no key: configure the server once with `mcp-google-api api-key <key>` (persisted setting); an optional `"env": { "GOOGLE_MAPS_API_KEY": "${GOOGLE_MAPS_API_KEY}" }` block expands the environment variable client-side if you prefer per-client key injection for one-shot CLI use.
- After editing `mcp.json` outside the session, run `/reload` in pi; `/mcp` inspects status, tools, and connection errors.
- Tools appear with the `mcp__<server>__` prefix: `mcp__maps__maps_geocode`, `mcp__maps__maps_search_places`, ...

### OpenClaw

OpenClaw manages MCP servers in `~/.openclaw/openclaw.json` through its CLI (verified on OpenClaw 2026.4.21):

```bash
openclaw mcp set maps '{"command":"node","args":["/absolute/path/to/mcp-google-api/dist/cli.js","start","--stdio"],"description":"Google APIs (Maps family): Places API (New), geocoding, routes, weather"}'
```

- Without a local install: use `"command":"npx","args":["-y","mcp-google-api","start","--stdio"]` (runs the published npm package).
- After the change, reload the gateway or restart the agent session so the new server gets connected.
- Inspect and remove: `openclaw mcp list`, `openclaw mcp show maps`, `openclaw mcp unset maps`.
- The OpenClaw agent can install and configure the server on its own (shell + `openclaw mcp set`); creating the API key in Google Cloud Console remains a human task.

### Configuration prerequisites

1. **A single API key**: create it at <https://console.cloud.google.com/apis/credentials>, enable the services listed in the [Required Google Cloud APIs](#required-google-cloud-apis) table, and persist it with `mcp-google-api api-key "AIza..."` — the only configuration path the server reads at startup.
2. **Minimal operational subset**: Places API (New) + Geocoding API; enable the other services only for the tools you use.
3. **Restrict exposure**: `GOOGLE_MAPS_ENABLED_TOOLS=maps_geocode,maps_search_places,maps_place_details` reduces the registered tools (and the LLM context).
4. **Post-install verification**: `mcp-google-api doctor` (no network calls), then `mcp-google-api doctor --live --apikey "AIza..."` (real probes against Geocoding, Places, and Routes).
5. **Automatic update check**: enabled by default at server startup; disable or re-enable with `mcp-google-api auto-update <disable|enable>` (also `1`/`0`), persisted as the `autoUpdate` field of `~/.config/mcp-google-api/config.json`.

## Project structure

```
mcp-google-api/
├── src/            # MCP server sources
│   ├── cli.ts      # entry point (stdio/HTTP, exec and doctor commands)
│   ├── config.ts   # registration of the exposed tools
│   ├── core/       # BaseMcpServer: MCP SDK, stdio + Streamable HTTP
│   ├── services/   # Places API (New), Geocoding, Routes, environment
│   ├── tools/      # definition of the 18 MCP tools
│   └── utils/      # API key resolution, request context, update check
├── scripts/        # helper bash scripts (setup/build/start/test) + mcp-google-api.sh local launcher
├── docs/           # project documentation
└── tests/          # unit tests (mocked) + smoke/e2e (real API key)
```

## Documentation

- [docs/TOOLS.md](docs/TOOLS.md) — tool catalog and parameters
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) — environment variables, transports, API key
- [src/resources/skills/](src/resources/skills/) — bundled `eatspot-discovery` agent skill (budget filters, FieldMask, raw payload)

## Development

```bash
npm ci             # install dependencies from the lockfile
npm run verify     # single pipeline: typecheck + unit tests + build
npm run dev        # incremental watch build
npm run typecheck  # tsc --noEmit
npm test           # unit tests
```

## License

GPL-3.0-only — see [LICENSE](LICENSE).

## Acknowledgments

Special thanks to **CabLate** for the upstream contribution that seeded this project.
