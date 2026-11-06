# mcp-google-api (0.21.0)

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js >= 24">
  <img src="https://img.shields.io/badge/typescript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.7">
  <img src="https://img.shields.io/badge/license-GPL--3.0--only-491?style=flat-square" alt="License: GPL-3.0-only">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-6A7EC2?style=flat-square&logo=terminal&logoColor=white" alt="Platforms">
</p>

**MCP Google API server** — a [Model Context Protocol](https://modelcontextprotocol.io) server that exposes Google APIs to AI agents. The currently supported family is Google Maps: 18 read-only tools (geocoding, Places API (New) search, place details, directions, distance matrix, weather, air quality, timezone, elevation, static maps, and composite tools) served over stdio or Streamable HTTP.

- Requires Node.js **>= 24** and one Google Maps API key.
- Bundles the `eatspot-discovery` agent skill for budget-, quality-, and schedule-validated venue search.
- Tool catalog: [docs/TOOLS.md](docs/TOOLS.md) · Configuration reference: [docs/CONFIGURATION.md](docs/CONFIGURATION.md)

## Quick Start

The standard flow is: **install → configure the API key → choose the CLI agents → install the MCP server and skills → use it**.

### 1. Install

```bash
npm install -g mcp-google-api
```

### 2. Configure the API key

Create a Google Maps API key at <https://console.cloud.google.com/apis/credentials>, enable the services you need (see the table below), then persist the key:

```bash
mcp-google-api api-key "AIza..."
```

The key is stored in the configuration file `~/.config/mcp-google-api/config.json` and is the only key source the server reads at startup. `doctor` verifies the local setup with no network calls:

```bash
mcp-google-api doctor
```

### 3. Choose the CLI agents

Enable every CLI agent that must receive the MCP server and the bundled skills (supported: `pi`, `openclaw`, `codex`, `antigravity`, `claude`):

```bash
mcp-google-api enable pi
```

### 4. Install the MCP server and skills

```bash
mcp-google-api install
```

The command registers the stdio server entry `mcp-google-api` in every enabled CLI and installs the bundled skills, printing a per-CLI activity report. `mcp-google-api show` lists the current configuration and installation status; `mcp-google-api uninstall` reverses the installation.

### 5. Use it

Restart (or reload) the enabled CLI agents: the `mcp-google-api` MCP server appears with its tools. The server can also be started directly:

```bash
mcp-google-api start --stdio    # stdio transport (used by the registered CLI entries)
mcp-google-api start            # Streamable HTTP at http://127.0.0.1:3000/mcp
```

## Configuration commands

All configuration is persisted in `~/.config/mcp-google-api/config.json` through dedicated commands; no environment variables are used.

| Command | Purpose |
| --- | --- |
| `mcp-google-api api-key <key>` | Save the Google Maps API key and refresh every enabled CLI registration |
| `mcp-google-api enable <cli>` / `disable <cli>` | Manage the enabled-CLI set (`pi`, `openclaw`, `codex`, `antigravity`, `claude`) |
| `mcp-google-api install` / `uninstall` | Register/remove the MCP server entry and bundled skills for every enabled CLI |
| `mcp-google-api show` | Print the CLI configuration and installation status tables |
| `mcp-google-api tools <list|*>` | Restrict the exposed tools (default `*` = all 18) |
| `mcp-google-api host <host>` | HTTP bind host (default `127.0.0.1`; `0.0.0.0` for all interfaces) |
| `mcp-google-api port <port>` | HTTP listen port (default `3000`) |
| `mcp-google-api auto-update <enable|disable>` | Enable or disable the startup update check (enabled by default) |
| `mcp-google-api doctor [--live]` | Local self-check; `--live` probes the Geocoding, Places (New), and Routes APIs |
| `mcp-google-api --ver` / `--upgrade` / `--uninstall` | Version report, self-upgrade, package removal |

## Required Google Cloud APIs

| API to enable | Needed for |
| --- | --- |
| **Places API (New)** | Place search/details tools (required; `eatspot-discovery` needs it) |
| **Geocoding API** | `maps_geocode`, `maps_reverse_geocode`, `maps_batch_geocode`, address resolution |
| **Routes API** | `maps_directions`, `maps_distance_matrix`, `maps_plan_route` |
| **Time Zone API** / **Maps Elevation API** / **Maps Static API** | `maps_timezone` / `maps_elevation` / `maps_static_map` |
| **Weather API** / **Air Quality API** | `maps_weather` / `maps_air_quality` (regional coverage) |

Minimal operational subset: Places API (New) + Geocoding API. Enable the others only for the tools you use; restrict the exposed tool set with `mcp-google-api tools`.

## License

GPL-3.0-only — see [LICENSE](LICENSE).

## Acknowledgments

Special thanks to **CabLate** for the upstream contribution that seeded this project.
