import assert from "node:assert/strict";
import test from "node:test";
import {
  renderClientSnippet,
  type SnippetClient,
} from "../src/utils/clientSnippets.js";

test("default snippet renders a valid JSON npx stdio registration without key material", () => {
  const snippet = renderClientSnippet();
  const parsed = JSON.parse(snippet.json) as {
    mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  };
  const entry = parsed.mcpServers["mcp-google-api"];
  assert.equal(entry.command, "npx");
  assert.deepEqual(entry.args, ["-y", "mcp-google-api", "start", "--stdio"]);
  assert.equal(entry.env, undefined);
  assert.equal(snippet.json.includes("API_KEY"), false);
  assert.ok(snippet.notes.some((note) => note.includes("never writes or edits configuration files")));
  assert.ok(snippet.notes.some((note) => note.includes("api-key")));
});

test("node launcher requires a command path and embeds it when provided", () => {
  assert.throws(() => renderClientSnippet({ launcher: "node" }), /--launcher node requires --command/);

  const snippet = renderClientSnippet({ launcher: "node", commandPath: "/abs/path/dist/cli.js" });
  const parsed = JSON.parse(snippet.json) as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
  assert.equal(parsed.mcpServers["mcp-google-api"].command, "node");
  assert.deepEqual(parsed.mcpServers["mcp-google-api"].args, ["/abs/path/dist/cli.js", "start", "--stdio"]);
});

test("bin launcher renders the installed binary command", () => {
  const snippet = renderClientSnippet({ launcher: "bin" });
  const parsed = JSON.parse(snippet.json) as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
  assert.equal(parsed.mcpServers["mcp-google-api"].command, "mcp-google-api");
  assert.deepEqual(parsed.mcpServers["mcp-google-api"].args, ["start", "--stdio"]);
});

test("http transport renders the /mcp URL with host and port overrides", () => {
  const defaultSnippet = JSON.parse(renderClientSnippet({ transport: "http" }).json) as {
    mcpServers: Record<string, { url: string }>;
  };
  assert.equal(defaultSnippet.mcpServers["mcp-google-api"].url, "http://127.0.0.1:3000/mcp");

  const customSnippet = JSON.parse(
    renderClientSnippet({ transport: "http", host: "10.0.0.1", port: 8123 }).json
  ) as { mcpServers: Record<string, { url: string }> };
  assert.equal(customSnippet.mcpServers["mcp-google-api"].url, "http://10.0.0.1:8123/mcp");
});

test("every client and transport combination produces parseable JSON", () => {
  const clients: SnippetClient[] = ["generic", "claude", "cursor", "pi"];
  for (const client of clients) {
    for (const transport of ["stdio", "http"] as const) {
      const snippet = renderClientSnippet({ client, transport });
      const parsed = JSON.parse(snippet.json) as { mcpServers: Record<string, unknown> };
      assert.ok(parsed.mcpServers["mcp-google-api"] !== undefined, `${client}/${transport} entry missing`);
      assert.ok(snippet.notes.length > 0);
    }
  }
});
