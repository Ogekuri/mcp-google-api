# Configuration

All `mcp-google-api` configuration is persisted in the user configuration file `~/.config/mcp-google-api/config.json` and managed through dedicated CLI commands. The server reads no environment variables.

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

## Google Maps API key

Create a key at <https://console.cloud.google.com/apis/credentials>, enable the services you use on it (see [README.md](../README.md#required-google-cloud-apis)), and persist it:

```bash
mcp-google-api api-key "AIza..."
```

The persisted key is the only key source read at server startup (masked in every report). On the HTTP transport each request may override it with the headers `X-Google-Maps-API-Key` or `Authorization: Bearer <key>`, and each MCP session keeps its own key.

## Settings commands

| Field | Command | Default |
| --- | --- | --- |
| `apiKey` | `mcp-google-api api-key <key>` | unset |
| `enabled` | `mcp-google-api enable <cli>` / `disable <cli>` | empty |
| `enabledTools` | `mcp-google-api tools <list|*>` | `*` (all 18 tools) |
| `host` | `mcp-google-api host <host>` | `127.0.0.1` (loopback) |
| `port` | `mcp-google-api port <port>` | `3000` |
| `autoUpdate` | `mcp-google-api auto-update <enable|disable>` | enabled |

Invalid values (unknown tool names, non-integer or out-of-range ports, empty hosts) are rejected with a human-readable error and nothing is persisted.

## Configuration interface

The whole settings file is also reachable through one schema-driven interface. Paths are
case-sensitive colon-separated tokens of the section `Settings`; the displayed
`Application_Configuration` root label is never part of a path. A missing settings file is
created from schema defaults before the command runs.

| Command | Effect |
| --- | --- |
| `mcp-google-api --print [Path]` | Print current values as a tree (whole tree when `Path` is absent) |
| `mcp-google-api --info [Path]` | Print the schema documentation tree, including reset/set commands |
| `mcp-google-api --print-raw` | Print the raw `config.json` bytes unchanged |
| `mcp-google-api --get Path` | Print one value as bare JSON (pipeable) |
| `mcp-google-api --set Path Value` | Validate and persist one value atomically |
| `mcp-google-api --unset Path` | Restore a schema default, or delete one array element |

Canonical paths: `Settings`, `Settings:apiKey`, `Settings:port`, `Settings:enabled:0`,
`Settings:enabled:+`, `Settings:enabled:append`, `Settings:enabled:insert:0`.

```bash
mcp-google-api --print Settings
mcp-google-api --info Settings:enabled
mcp-google-api --get Settings:port
mcp-google-api --set Settings:port 3100
mcp-google-api --set Settings:autoUpdate false
mcp-google-api --set Settings:enabled:+ pi
mcp-google-api --set Settings:enabled '["pi","claude"]'
mcp-google-api --unset Settings:enabled:0
mcp-google-api --unset Settings:host
```

Non-string parameters take JSON literals (`true`, `3100`, `["pi"]`); string parameters
(`apiKey`, `enabledTools`, `host`, and single `enabled` items) take the raw argument.
Rejected values, malformed JSON, and unresolvable paths leave the file untouched and exit 1
with an English stderr diagnostic; successful mutations print one confirmation naming the
full canonical path. Section or parameter resets restore declared schema defaults, so
`--unset Settings:enabled` restores the empty list rather than "clearing" it. Array
mutations update the settings file only; run `mcp-google-api install` to refresh MCP
registrations and installed skills after changing `enabled` or `apiKey`.

## Transports

```bash
mcp-google-api start --stdio    # stdio transport (registered CLI entries)
mcp-google-api start            # Streamable HTTP at http://<host>:<port>/mcp
```

- stdio: stdout is reserved for JSON-RPC; all server diagnostics go to stderr.
- HTTP: `--host`/`--port` flags override the persisted settings for one run; `SIGINT`/`SIGTERM` close all sessions and the listening socket before exit; the process exits non-zero when no instance can listen. The default bind address is loopback `127.0.0.1`; use `mcp-google-api host 0.0.0.0` to expose the server on all interfaces.

## Registering in MCP clients

The standard registration path is the configuration flow documented in [README.md](../README.md#quick-start): `enable <cli>` + `install` writes the stdio entry `mcp-google-api` (`npx -y mcp-google-api start --stdio`, no embedded key) into each enabled CLI and installs the bundled skills.

- **pi**: `~/.pi/agent/mcp.json` (user) — run `/reload` in the session after external changes; `/mcp` inspects the connection.
- **OpenClaw**: `~/.openclaw/openclaw.json` — reload the gateway or restart the agent session after installation.

Manual registration snippet (JSON, no key embedded):

```json
{
  "mcpServers": {
    "mcp-google-api": {
      "command": "npx",
      "args": ["-y", "mcp-google-api", "start", "--stdio"]
    }
  }
}
```

## Diagnostics

```bash
mcp-google-api doctor             # local self-check: Node >= 24, package, key, settings (no network)
mcp-google-api doctor --live      # billable probes against Geocoding, Places (New), and Routes
mcp-google-api show               # CLI configuration and installation status tables
```

### MCP connection closed after a rename or upgrade

The registered entry launches `npx -y mcp-google-api start --stdio`. When the
MCP client spawns this command from a directory that hosts a same-name local
project (for example a repository checkout), `npm exec` prefers that local
project's own `dist/cli.js` over the installed package. A stale `dist/` build
from before a distribution rename then launches old code that silently exits
without answering the MCP handshake, and the client reports
`MCP connection closed`.

Remediation (run inside that checkout, then reconnect the MCP client):

```bash
npm run verify        # typecheck + unit tests + fresh dist/ build
# or, to ignore the local checkout and use the published package only:
npm install -g mcp-google-api@latest
```

Since 0.22.0 the CLI prints a JSON diagnostic on stderr naming this exact
condition and the remediation commands instead of exiting silently, so a
stale-artifact launch is visible in MCP client logs.
