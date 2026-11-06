/** @brief Supported MCP client targets; selects the documented target file. */
export type SnippetClient = "generic" | "claude" | "cursor" | "pi";

/** @brief Supported MCP transports for the generated registration entry. */
export type SnippetTransport = "stdio" | "http";

/** @brief stdio launcher strategy: `npx` one-shot, `node` with a script path, or the installed `bin`. */
export type SnippetLauncher = "npx" | "node" | "bin";

/**
 * @brief Options controlling snippet rendering.
 * @details All fields optional; defaults: client `generic`, transport `stdio`,
 * launcher `npx`, serverName `mcp-google-api`, HTTP host `127.0.0.1`, port 3000.
 */
export interface SnippetOptions {
  client?: SnippetClient;
  transport?: SnippetTransport;
  launcher?: SnippetLauncher;
  commandPath?: string;
  host?: string;
  port?: number;
  serverName?: string;
}

/**
 * @brief Rendered snippet plus stderr guidance notes.
 * @details `json` is a complete pretty-printed `mcpServers` registration
 * object (parses with `JSON.parse`); `notes` are human guidance lines the CLI
 * prints on stderr so stdout stays pure JSON (PRJ-008).
 */
export interface SnippetResult {
  json: string;
  notes: string[];
}

/** @brief Default loopback host used for HTTP snippet URLs. */
const SNIPPET_DEFAULT_HOST = "127.0.0.1";

/** @brief Default port used for HTTP snippet URLs. */
const SNIPPET_DEFAULT_PORT = 3000;

/**
 * @brief Target configuration file documented per `SnippetClient`.
 * @details Drives the stderr note that tells the user where to paste the
 * snippet; the JSON shape (`mcpServers`) is identical for all clients.
 */
const SNIPPET_CLIENT_TARGETS: Readonly<Record<SnippetClient, string>> = {
  generic: "your MCP client configuration file",
  claude: "Claude Desktop: claude_desktop_config.json",
  cursor: "Cursor: .cursor/mcp.json",
  pi: "pi CLI: ~/.pi/agent/mcp.json (user) or .pi/mcp.json (project)",
};

/**
 * @brief Renders a valid MCP-client registration snippet without writing files.
 * @details stdio transport: launcher `npx` -> `npx -y mcp-google-api start
 * --stdio`; `bin` -> installed `mcp-google-api start --stdio`; `node` ->
 * `node <commandPath> start --stdio` and throws when `commandPath` is
 * missing. HTTP transport: emits `{ url: "http://<host>:<port>/mcp" }`.
 * Entries embed no API key and no environment payload (REQ-093): the
 * registered server loads its key at startup from the persisted `api-key`
 * setting (REQ-142), and the stderr notes say so. Pure: no filesystem or
 * network access; output is JSON.stringify'd with 2-space indent.
 * Complexity O(1).
 * @param options {SnippetOptions} Rendering options; defaults apply when omitted.
 * @return {SnippetResult} Pretty-printed JSON snippet plus stderr notes.
 * @throws {Error} When launcher is `node` and `commandPath` is missing.
 * @satisfies PRJ-010, REQ-092, REQ-093
 */
export function renderClientSnippet(options: SnippetOptions = {}): SnippetResult {
  const client = options.client ?? "generic";
  const transport = options.transport ?? "stdio";
  const serverName = options.serverName ?? "mcp-google-api";

  const notes: string[] = [`Paste this snippet into ${SNIPPET_CLIENT_TARGETS[client]}.`];
  notes.push("This command prints the snippet only; it never writes or edits configuration files.");

  let entry: Record<string, unknown>;
  if (transport === "http") {
    const host = options.host ?? SNIPPET_DEFAULT_HOST;
    const port = options.port ?? SNIPPET_DEFAULT_PORT;
    entry = { url: `http://${host}:${port}/mcp` };
    notes.push(`Start the server first: mcp-google-api start --host ${host} --port ${port}.`);
  } else {
    const launcher = options.launcher ?? "npx";
    if (launcher === "node" && !options.commandPath) {
      throw new Error('--launcher node requires --command <path> pointing at dist/cli.js');
    }
    const command = launcher === "npx" ? "npx" : launcher === "bin" ? "mcp-google-api" : "node";
    const args =
      launcher === "npx"
        ? ["-y", "mcp-google-api", "start", "--stdio"]
        : launcher === "bin"
          ? ["start", "--stdio"]
          : [options.commandPath as string, "start", "--stdio"];
    if (launcher === "npx") {
      notes.push("The npx launcher runs the published package; npm must be available on PATH.");
    }
    entry = { command, args };
    notes.push("The registration carries no API key: configure it once with 'mcp-google-api api-key <key>'.");
  }

  const json = JSON.stringify({ mcpServers: { [serverName]: entry } }, null, 2);
  return { json, notes };
}
