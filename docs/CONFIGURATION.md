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

The standard registration path is the configuration flow documented in [README.md](../README.md#quick-start): `enable <cli>` + `install` writes the stdio entry `mcp-google-api` (Node.js executable plus the global launcher `bin/mcp-google-api.mjs`, no embedded key) into each enabled CLI and installs the bundled skills. Every registered path inside the user home is written as a `~/`-rooted home reference; a path outside the home stays absolute. The entry executes the global installation regardless of the client working directory and replaces any legacy `npx` entry (PKG-138, PKG-139).

- **pi**: `~/.pi/agent/mcp.json` (user) — run `/reload` in the session after external changes; `/mcp` inspects the connection.
- **OpenClaw**: `~/.openclaw/openclaw.json` — reload the gateway or restart the agent session after installation.

Manual registration snippet (JSON, no key embedded; home references are `~/`-rooted as reported by `mcp-google-api show`, absolute paths stay as resolved):

```json
{
  "mcpServers": {
    "mcp-google-api": {
      "command": "~/.nvm/versions/node/v24/bin/node",
      "args": ["~/.npm-global/lib/node_modules/mcp-google-api/bin/mcp-google-api.mjs", "start", "--stdio"]
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

### Registration binding and `MCP connection closed`

The registered entry binds the Node.js executable plus the launcher of the
globally installed package, with every path inside the user home written as a
`~/`-rooted home reference (`$HOME` resolved at install time) and every path
outside the home left absolute. Home references are user-name independent, and
an MCP client that expands a leading `~/` in `command` and `args` resolves the
same global installation in every working directory, so a checkout hosting a
same-name `package.json` can no longer be executed in place of the installed
package. A client that passes arguments literally does not expand `~/` and
cannot resolve the launcher (LIM-010).

Legacy registrations used `npx -y mcp-google-api start --stdio`. `npm exec`
prefers the bin of a same-name local project, so a client spawned inside such a
checkout ran that checkout's own `dist/cli.js`; a stale or dependency-less build
then exited before answering the MCP handshake and the client reported
`MCP connection closed`. `install`, `api-key`, and the post-`--upgrade` refresh
rewrite every legacy entry with the home-referenced launcher, and `show`
marks a server row `STALE` while the stored binding differs from the resolved
global launcher.

`install` refuses to register from a source checkout or an npm `_npx` cache
copy, persisting nothing and naming the remediation (PKG-139):

```bash
npm install -g mcp-google-api@latest   # install the global package
mcp-google-api install                 # rewrite registrations with home-referenced paths
```

Reconnect the MCP client after the rewrite (pi: `/reload`) so the new entry is
spawned.
