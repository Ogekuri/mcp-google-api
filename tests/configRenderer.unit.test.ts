/**
 * @fileoverview HDT unit suite for the deterministic configuration tree renderer.
 * @details Verifies the shared `--print`/`--info` renderer in isolation with
 * complete golden strings (TST-025) and validates structural topology
 * independently against the rendered output of the real configuration views
 * (TST-026). Golden cases cover one root child, two root siblings, nested
 * first/middle/last siblings, a non-last parameter with several details, a last
 * parameter with several details, a branch owning details plus real children,
 * a selection table, an object-array table, an empty collection hint, and a
 * requested subtree. Deterministic by construction: no clock, randomness,
 * network, or environment dependence.
 * @satisfies REQ-209, REQ-210, REQ-211, REQ-212, TST-025, TST-026
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  asConfigTableDetail,
  displayWidth,
  renderConfigTable,
  renderConfigTree,
  TREE_BRANCH,
  TREE_CONTINUE,
  TREE_INDENT,
  TREE_LAST,
  type ConfigRenderNode,
} from "../src/utils/configRenderer.js";
import { buildConfigInfoView, buildConfigPrintView } from "../src/utils/configView.js";
import { CONFIG_DEFAULTS, type ConfigDocument, type ConfigSchemaContext } from "../src/utils/configSchema.js";

/**
 * @brief Builds one marker-free render node.
 * @param heading {string} Heading text.
 * @param details {string[][]} Attached detail blocks.
 * @param children {ConfigRenderNode[]} Real children.
 * @return {ConfigRenderNode} Render node.
 */
function node(heading: string, details: string[][] = [], children: ConfigRenderNode[] = []): ConfigRenderNode {
  return { heading, details: details.map((lines) => ({ lines })), children };
}

/** @brief Schema context matching the real registries for view construction. */
const CONTEXT: ConfigSchemaContext = {
  cliNames: ["antigravity", "claude", "codex", "copilot", "openclaw", "opencode", "pi"],
  toolNames: ["maps_geocode", "maps_search_places"],
};

/**
 * @brief Splits one rendered line into structural prefix segments and content.
 * @details A segment is exactly `│   ` or four spaces, so the split exposes the
 * real ancestor depth without relying on rendered text (REQ-209).
 * @param line {string} Rendered output line.
 * @return {{ segments: string[]; rest: string }} Extracted segments plus content.
 */
function splitPrefix(line: string): { segments: string[]; rest: string } {
  const segments: string[] = [];
  let index = 0;
  for (;;) {
    const candidate = line.slice(index, index + 4);
    if (candidate === TREE_CONTINUE || candidate === TREE_INDENT) {
      segments.push(candidate);
      index += 4;
    } else {
      return { segments, rest: line.slice(index) };
    }
  }
}

/**
 * @brief Independently validates the structural invariants of rendered output.
 * @details Asserts that every real node carries exactly one marker after `d`
 * ancestor segments, that no node follows the terminal sibling of its depth,
 * that every `├──` node is followed by a later sibling, that each attached detail
 * line reuses the owning node continuation prefix, and that no detail line
 * carries a tree marker (REQ-209, REQ-210). Section headings are additionally
 * checked for a `[Path: <last token>]` badge (REQ-211).
 * @param lines {string[]} Rendered output lines.
 * @param label {string} Diagnostic label of the rendered variant.
 * @return {number} Number of validated real nodes.
 */
function validateTreeStructure(lines: string[], label: string): number {
  const owners = new Map<number, { prefix: string; isLast: boolean }>();
  const closed = new Set<number>();
  let nodeCount = 0;
  lines.forEach((line, index) => {
    const { segments, rest } = splitPrefix(line);
    const depth = segments.length;
    const prefix = segments.join("");
    if (index === 0) {
      owners.set(-1, { prefix: "", isLast: true });
      assert.ok(!rest.startsWith(TREE_BRANCH) && !rest.startsWith(TREE_LAST), `${label}: root heading carries a marker`);
      return;
    }
    const isNode = rest.startsWith(TREE_BRANCH) || rest.startsWith(TREE_LAST);
    if (isNode) {
      nodeCount += 1;
      assert.ok(!closed.has(depth), `${label}: node after the terminal sibling at depth ${depth}: ${line}`);
      for (const candidate of [...closed]) {
        if (candidate > depth) {
          closed.delete(candidate);
        }
      }
      for (const candidate of [...owners.keys()]) {
        if (candidate > depth) {
          const deeper = owners.get(candidate);
          assert.ok(deeper?.isLast === true, `${label}: depth ${candidate} had a later sibling declared but never appeared`);
          if (deeper !== undefined) {
            assert.ok(deeper.isLast, `${label}: unterminated sibling list at depth ${candidate}`);
          }
          owners.delete(candidate);
        }
      }
      const isLast = rest.startsWith(TREE_LAST);
      owners.set(depth, { prefix, isLast });
      if (isLast) {
        closed.add(depth);
      }
      const heading = rest.slice(4);
      assert.ok(heading.length > 0, `${label}: empty node heading: ${line}`);
      assert.ok(!heading.startsWith(TREE_BRANCH) && !heading.startsWith(TREE_LAST), `${label}: doubled marker: ${line}`);
      const badge = /^([^ ]+) - \[Path: ([^\]]+)\] /u.exec(heading);
      if (badge !== null) {
        const tokens = badge[2].split(":");
        assert.equal(tokens[tokens.length - 1], badge[1], `${label}: section badge path mismatch: ${line}`);
      }
      return;
    }
    assert.ok(!rest.startsWith(TREE_BRANCH) && !rest.startsWith(TREE_LAST), `${label}: detail line carries a marker: ${line}`);
    const owner = owners.get(depth - 1) ?? (depth - 1 === 0 ? { prefix: "", isLast: true } : undefined);
    assert.ok(owner !== undefined, `${label}: detail line without owning node: ${line}`);
    const expected = (owner?.prefix ?? "") + (owner?.isLast === true ? TREE_INDENT : TREE_CONTINUE);
    assert.equal(prefix, expected, `${label}: detail prefix mismatch: ${line}`);
  });
  for (const [depth, owner] of owners) {
    assert.ok(depth < 0 || owner.isLast, `${label}: unterminated sibling list at depth ${depth}`);
  }
  return nodeCount;
}

test("test_config_tree_renderer_emits_single_root_child", () => {
  const lines = renderConfigTree(node("Root", [], [node("Solo")]));
  assert.deepEqual(lines, ["Root", "└── Solo"]);
  assert.equal(validateTreeStructure(lines, "single root child"), 1);
});

test("test_config_tree_renderer_emits_two_root_siblings", () => {
  const lines = renderConfigTree(node("Root", [], [node("First"), node("Second")]));
  assert.deepEqual(lines, ["Root", "├── First", "└── Second"]);
  validateTreeStructure(lines, "two root siblings");
});

test("test_config_tree_renderer_emits_nested_first_middle_last_siblings", () => {
  const lines = renderConfigTree(
    node("Root", [], [node("Branch", [], [node("One"), node("Two"), node("Three")])])
  );
  assert.deepEqual(lines, [
    "Root",
    "└── Branch",
    "    ├── One",
    "    ├── Two",
    "    └── Three",
  ]);
  validateTreeStructure(lines, "nested siblings");
});

test("test_config_tree_renderer_prefixes_details_of_non_last_and_last_nodes", () => {
  const lines = renderConfigTree(
    node("Root", [], [
      node("Section", [], [
        node("NonLast", [["detail one", "detail two"]], [node("Nested")]),
        node("Last", [["detail three"]]),
      ]),
      node("Trailing", [], [node("Leaf", [["detail four"]])]),
    ])
  );
  assert.deepEqual(lines, [
    "Root",
    "├── Section",
    "│   ├── NonLast",
    "│   │   detail one",
    "│   │   detail two",
    "│   │   └── Nested",
    "│   └── Last",
    "│       detail three",
    "└── Trailing",
    "    └── Leaf",
    "        detail four",
  ]);
  validateTreeStructure(lines, "detail prefixes");
});

test("test_config_tree_renderer_attaches_details_to_branch_before_real_children", () => {
  const lines = renderConfigTree(
    node("Root", [], [
      node("Branch", [["Reset block : --unset Branch"]], [node("ChildA"), node("ChildB")]),
    ])
  );
  assert.deepEqual(lines, [
    "Root",
    "└── Branch",
    "    Reset block : --unset Branch",
    "    ├── ChildA",
    "    └── ChildB",
  ]);
  validateTreeStructure(lines, "branch details");
});

test("test_config_tree_renderer_round_trips_a_requested_subtree_root", () => {
  const lines = renderConfigTree(node("Settings - [Path: Settings]", [["note"]], [node("A"), node("B")]));
  assert.deepEqual(lines, ["Settings - [Path: Settings]", "    note", "├── A", "└── B"]);
  validateTreeStructure(lines, "requested subtree");
});

test("test_config_tree_renderer_attaches_a_selection_table_to_its_owner", () => {
  const table = asConfigTableDetail({
    headers: ["Sel", "Value"],
    rows: [
      ["[*]", "automatic"],
      ["[ ]", "manual"],
    ],
  });
  const lines = renderConfigTree(
    node("Root", [], [{ heading: 'mode = "automatic" (default)', details: table, children: [] }])
  );
  assert.deepEqual(lines, [
    "Root",
    "└── mode = \"automatic\" (default)",
    "    ┌─────┬───────────┐",
    "    │ Sel │ Value     │",
    "    ├─────┼───────────┤",
    "    │ [*] │ automatic │",
    "    │ [ ] │ manual    │",
    "    └─────┴───────────┘",
  ]);
  validateTreeStructure(lines, "selection table");
});

test("test_config_tree_renderer_attaches_an_object_array_table", () => {
  const lines = renderConfigTree(
    node("Root", [], [
      {
        heading: "rows = (1 row | cell target: Section:rows:<Idx>:<Field> | add: Section:rows:+)",
        details: asConfigTableDetail({
          headers: ["Idx", "pattern", "regex"],
          rows: [["0", "\"VERSION\"", "\"[0-9]+\""]],
        }),
        children: [],
      },
    ])
  );
  assert.deepEqual(lines, [
    "Root",
    "└── rows = (1 row | cell target: Section:rows:<Idx>:<Field> | add: Section:rows:+)",
    "    ┌─────┬───────────┬──────────┐",
    "    │ Idx │ pattern   │ regex    │",
    "    ├─────┼───────────┼──────────┤",
    '    │ 0   │ "VERSION" │ "[0-9]+" │',
    "    └─────┴───────────┴──────────┘",
  ]);
  validateTreeStructure(lines, "object array table");
});

test("test_config_print_view_renders_an_empty_collection_hint_without_a_table", () => {
  const settings: ConfigDocument = { ...CONFIG_DEFAULTS, enabled: [] };
  const view = buildConfigPrintView(settings, CONTEXT);
  assert.ok(view.ok);
  const lines = renderConfigTree(view.root);
  const enabledLine = lines.find((line) => line.includes("enabled = "));
  assert.equal(enabledLine, '    ├── enabled = (empty list | add: --set Settings:enabled:+ "pi")');
  assert.ok(!lines.some((line) => line.includes("┌")), "no table may be rendered for an empty collection");
  validateTreeStructure(lines, "empty collection");
});

test("test_config_print_view_renders_values_and_a_requested_parameter_subtree", () => {
  const settings: ConfigDocument = { ...CONFIG_DEFAULTS, port: 3100, apiKey: "AIzaPlainTextKey0123456789" };
  const full = buildConfigPrintView(settings, CONTEXT);
  assert.ok(full.ok);
  const fullLines = renderConfigTree(full.root);
  assert.equal(fullLines[0], "Application_Configuration - Current configuration");
  assert.ok(fullLines.includes('    └── port = 3100 (custom | default: 3000)'));
  assert.ok(
    fullLines.includes('    ├── apiKey = "AIzaPlainTextKey0123456789" (custom | default: "")'),
    "stored values must never be masked"
  );
  validateTreeStructure(fullLines, "print full");

  const parameter = buildConfigPrintView(settings, CONTEXT, "Settings:port");
  assert.ok(parameter.ok);
  assert.deepEqual(renderConfigTree(parameter.root), ["port = 3100 (custom | default: 3000)"]);

  const section = buildConfigPrintView(settings, CONTEXT, "Settings");
  assert.ok(section.ok);
  const sectionLines = renderConfigTree(section.root);
  assert.equal(sectionLines[0], "Settings - [Path: Settings] Persisted mcp-google-api configuration");
  assert.ok(!sectionLines.some((line) => line.startsWith(TREE_CONTINUE)), "a requested subtree must not invent ancestors");
  validateTreeStructure(sectionLines, "print section");
});

test("test_config_info_view_renders_the_schema_tree_with_a_complete_command_set", () => {
  const view = buildConfigInfoView(CONTEXT);
  assert.ok(view.ok);
  const lines = renderConfigTree(view.root);
  assert.equal(lines[0], "Application_Configuration - Configuration schema");
  assert.ok(lines.includes("    Reset block : --unset Settings"));
  assert.ok(lines.includes('    ├── enabledTools - [String: \'*\' or comma-separated tool names] Exposed MCP tool allowlist'));
  assert.ok(lines.includes('        Set cmd : --set Settings:port 3100'));
  assert.ok(lines.includes('    │   Add item : --set Settings:enabled:+ "pi"'));
  assert.ok(lines.includes("    │   Full overwrite : --set Settings:enabled '[\"pi\"]'"));
  validateTreeStructure(lines, "info full");

  const parameter = buildConfigInfoView(CONTEXT, "Settings:enabled");
  assert.ok(parameter.ok);
  const parameterLines = renderConfigTree(parameter.root);
  assert.equal(parameterLines[0], "enabled - [StringArray: CLI names] CLI agents receiving MCP registration and packaged skills");
  assert.equal(parameterLines[1], '    Default : [] (restored via: --unset Settings:enabled)');
  validateTreeStructure(parameterLines, "info parameter");

  const section = buildConfigInfoView(CONTEXT, "Settings");
  assert.ok(section.ok);
  validateTreeStructure(renderConfigTree(section.root), "info section");
});

test("test_config_renderer_reports_unresolvable_paths_without_rendering", () => {
  const unknownSection = buildConfigPrintView(CONFIG_DEFAULTS, CONTEXT, "Globals");
  assert.ok(!unknownSection.ok);
  assert.match(unknownSection.error, /unknown configuration section "Globals"/);

  const unknownParameter = buildConfigInfoView(CONTEXT, "Settings:nope");
  assert.ok(!unknownParameter.ok);
  assert.match(unknownParameter.error, /unknown configuration parameter "nope"/);

  const writeOnly = buildConfigPrintView(CONFIG_DEFAULTS, CONTEXT, "Settings:enabled:+");
  assert.ok(!writeOnly.ok);
  assert.match(writeOnly.error, /write-only array operation/);

  const indexed = buildConfigPrintView(CONFIG_DEFAULTS, CONTEXT, "Settings:enabled:0");
  assert.ok(!indexed.ok);
  assert.match(indexed.error, /write-only array operation/);

  assert.equal(displayWidth("│   "), 4, "continuation segments are four display columns");
});
