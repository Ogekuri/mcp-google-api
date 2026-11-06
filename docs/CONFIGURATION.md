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
