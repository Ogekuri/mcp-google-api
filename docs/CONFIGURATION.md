# Configurazione

## Google Maps API key

Ottieni una chiave da <https://console.cloud.google.com/apis/credentials> e abilita sulla chiave i servizi che usi:

| Servizio console (nome API) | Tool che lo richiedono | Note |
| --- | --- | --- |
| **Places API (New)** (`places-backend-new`) | `maps_search_places`, `maps_search_nearby`, `maps_place_details`, `maps_explore_area`, `maps_compare_places`, `maps_search_along_route`, `maps_local_rank_tracker` | Obbligatoria per GeoScout; unica API di ricerca locali usata dal server |
| **Geocoding API** (`geocoding-backend`) | `maps_geocode`, `maps_reverse_geocode`, `maps_batch_geocode` | Anche fallback interno di risoluzione indirizzi |
| **Routes API** (`routes`) | `maps_directions`, `maps_distance_matrix`, `maps_plan_route` | |
| **Time Zone API** (`timezone-backend`) | `maps_timezone` | |
| **Maps Elevation API** (`elevation-backend`) | `maps_elevation` | In console appare come "Maps Elevation API" |
| **Maps Static API** (`static-maps-backend`) | `maps_static_map` | Immagine PNG | |
| **Weather API** (`weather-backend`) | `maps_weather` | Copertura regionale limitata |
| **Air Quality API** (`airquality`) | `maps_air_quality` | Copertura regionale limitata |

Non richieste da questo server: **Maps Grounding Lite** (solo MCP hosted Google) e **Geolocation API** (nessun tool la usa). L'elenco completo con priorità è in [README.md](../README.md#api-google-cloud-richieste).

The API key can be supplied as follows (decreasing per-request priority on the HTTP transport):

1. HTTP header `X-Google-Maps-API-Key` — per request, useful in multi-session setups
2. HTTP header `Authorization: Bearer <key>` — per request
3. CLI flag `--apikey "AIza..."` or environment variable `GOOGLE_MAPS_API_KEY` (or a line in `.env`) — process default

## Variabili d'ambiente

Definite in `.env` (copia da `.env.example`):

| Variabile | Default | Descrizione |
| --- | --- | --- |
| `GOOGLE_MAPS_API_KEY` | — | **Obbligatoria.** Chiave Google Maps |
| `MCP_SERVER_PORT` | `3000` | Porta del trasporto HTTP |
| `MCP_SERVER_HOST` | `127.0.0.1` | HTTP bind address. Default migrated from `0.0.0.0` to loopback `127.0.0.1`; set `0.0.0.0` to expose on all interfaces |
| `GOOGLE_MAPS_ENABLED_TOOLS` | `*` | Allowlist separata da virgole dei tool esposti (riduce il contesto per l'LLM). Esempio: `maps_search_places,maps_place_details,maps_geocode` |
| `MCP_AUTO_UPDATE_DISABLED` | unset (check enabled by default) | Set `1`, `true`, or `yes` to disable the automatic update check performed at server startup; any other value keeps it enabled |

Any command also accepts `--env-file <path>`: it loads exactly that file (exit 1 with a JSON error when missing) and replaces the implicit `.env` discovery chain for that invocation.

## Trasporti

### stdio (predefinito per client locali)

```bash
scripts/start-mcp.sh            # node dist/cli.js --stdio
```

stdout è riservato ai messaggi JSON-RPC; tutti i log del server vanno su stderr.

### Streamable HTTP

```bash
scripts/start-http.sh                       # http://127.0.0.1:3000/mcp
MCP_SERVER_PORT=8123 scripts/start-http.sh  # porta personalizzata
scripts/start-http.sh --port 8123 --host 0.0.0.0
```

Each MCP session (`mcp-session-id`) can carry its own API key via the `X-Google-Maps-API-Key` or `Authorization: Bearer` headers: tool calls use the session key, not the global default. The server binds to `127.0.0.1` by default (migration from `0.0.0.0`); `SIGINT`/`SIGTERM` close all sessions and the listening socket before exit; startup exits non-zero when no instance can listen.

## Registrazione nei client MCP

### pi CLI

Voce stdio per `~/.pi/agent/mcp.json` (utente) o `.pi/mcp.json` (progetto, richiede trust):

```json
{
  "mcpServers": {
    "maps": {
      "command": "node",
      "args": ["/percorso/assoluto/a/mcp-google-map/dist/cli.js", "--stdio"],
      "env": { "GOOGLE_MAPS_API_KEY": "${GOOGLE_MAPS_API_KEY}" }
    }
  }
}
```

- `${VAR}` espande variabili d'ambiente: la chiave non resta cablata nel file di configurazione.
- `pi mcp add maps -- node /percorso/assoluto/a/mcp-google-map/dist/cli.js --stdio` registra da terminale; `/reload` in sessione dopo modifiche esterne; `/mcp` ispeziona la connessione.

### OpenClaw

```bash
openclaw mcp set maps '{"command":"node","args":["/percorso/assoluto/a/mcp-google-map/dist/cli.js","--stdio"],"env":{"GOOGLE_MAPS_API_KEY":"AIza..."},"description":"Google Maps MCP"}'
```

- Alternativa senza installazione: `"command":"npx","args":["-y","mcp-google-map","--stdio"]`.
- Ricaricare il gateway o riavviare la sessione agente dopo la modifica; `openclaw mcp list` / `openclaw mcp show maps` per verificare.

### Prerequisiti chiave e API Google

- **Una sola chiave** `GOOGLE_MAPS_API_KEY` (priorità di risoluzione in [Google Maps API key](#google-maps-api-key)); servizi da abilitare e sottoinsieme minimo (Places API (New) + Geocoding API): tabella in [README.md](../README.md#api-google-cloud-richieste).
- Limitare i tool esposti con [`GOOGLE_MAPS_ENABLED_TOOLS`](#variabili-dambiente).
- Verifica post-installazione: `node dist/cli.js doctor` e `node dist/cli.js doctor --live --apikey "AIza..."`.

## Comandi CLI

```bash
node dist/cli.js --stdio                                          # stdio server
node dist/cli.js --port 3000 --host 127.0.0.1                     # HTTP server (loopback default)
node dist/cli.js setup --write-env                                # onboarding: checks + .env scaffold (no network)
node dist/cli.js exec search-places '{"query":"pizzeria Torino"}' # one tool call (params is a JSON string)
node dist/cli.js doctor                                           # local diagnostics (no network)
node dist/cli.js doctor --live --apikey "AIza..."                 # + real probes (all three APIs)
node dist/cli.js doctor --live --probes geocoding,routes          # + selected probes only
node dist/cli.js --env-file /path/to/.env doctor                  # explicit environment file
node dist/cli.js snippet --client pi                              # registration snippet (stdout JSON, no files written)
```

## Diagnostica

```bash
node dist/cli.js doctor
```

Verifica versione Node, presenza della API key e (con `--live`) effettua chiamate reali ai servizi Google. The Node floor is `>= 22`, aligned with `package.json` `engines`; the local report also prints the effective configuration (masked key, per-field sources) and the Google APIs required by each enabled tool.
