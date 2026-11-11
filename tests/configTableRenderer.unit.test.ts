/**
 * @fileoverview HDT unit suite for the configuration table formatter.
 * @details Verifies that every rendered table is rectangular, that all border
 * characters align by terminal display width, that wide and combining characters
 * are measured correctly, that control characters are escaped instead of
 * breaking the layout, and that empty collections render no table at all
 * (TST-027). Deterministic by construction: pure functions only.
 * @satisfies REQ-217, REQ-218, TST-027
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  displayWidth,
  escapeDetailText,
  renderConfigTable,
  renderConfigTree,
  asConfigTableDetail,
  type ConfigTable,
} from "../src/utils/configRenderer.js";
import { buildConfigInfoView } from "../src/utils/configView.js";
import type { ConfigSchemaContext } from "../src/utils/configSchema.js";

/** @brief Schema context used to render the real `--info` tables. */
const CONTEXT: ConfigSchemaContext = {
  cliNames: ["antigravity", "claude", "codex", "copilot", "openclaw", "opencode", "pi"],
  toolNames: ["maps_geocode", "maps_search_places"],
};

/**
 * @brief Computes the display-width offsets of the interior column boundaries.
 * @details A boundary is the display offset of every `┬`/`┼`/`┴`/`│` separator;
 * alignment is judged on display width, not character index, so wide characters
 * inside cells cannot hide a misaligned border (REQ-217).
 * @param line {string} Rendered table line.
 * @return {number[]} Interior boundary offsets in display columns.
 */
function interiorBoundaries(line: string): number[] {
  const boundaries: number[] = [];
  let width = 0;
  for (const character of line) {
    if (character === "┬" || character === "┼" || character === "┴") {
      boundaries.push(width);
    }
    width += displayWidth(character);
  }
  return boundaries;
}

/**
 * @brief Classifies the separator glyphs of one table line.
 * @details Returns the display offsets of every `│`-class separator and the
 * total display width so column counts and endpoints can be compared
 * (REQ-217).
 * @param line {string} Rendered table line.
 * @return {{ separators: number[]; width: number; edges: string[] }} Separator offsets, total width, first and last characters.
 */
function analyzeLine(line: string): { separators: number[]; width: number; edges: string[] } {
  const separators: number[] = [];
  let width = 0;
  const characters = [...line];
  characters.forEach((character, index) => {
    if (index > 0 && index < characters.length - 1 && ["│", "┬", "┼", "┴"].includes(character)) {
      separators.push(width);
    }
    width += displayWidth(character);
  });
  return { separators, width, edges: [characters[0] ?? "", characters[characters.length - 1] ?? ""] };
}

/**
 * @brief Validates every box-drawing table inside rendered lines.
 * @details Asserts consistent column counts, identical separator offsets across
 * all border and data lines, shared first/last border characters, and that each
 * physical table line starts with the owning detail prefix (REQ-217).
 * @param lines {string[]} Rendered output lines.
 * @param label {string} Diagnostic label of the rendered output.
 * @return {number} Number of validated tables.
 */
function validateTables(lines: string[], label: string): number {
  let tables = 0;
  let index = 0;
  while (index < lines.length) {
    const start = lines[index].indexOf("┌");
    if (start < 0) {
      index += 1;
      continue;
    }
    const prefix = lines[index].slice(0, start);
    const block: string[] = [];
    let cursor = index;
    for (; cursor < lines.length; cursor += 1) {
      assert.ok(lines[cursor].startsWith(prefix), `${label}: table line lost its owner prefix: ${lines[cursor]}`);
      const content = lines[cursor].slice(prefix.length);
      block.push(content);
      if (content.startsWith("└")) {
        cursor += 1;
        break;
      }
    }
    const analyzed = block.map(analyzeLine);
    const boundaries = interiorBoundaries(block[0]);
    assert.ok(boundaries.length >= 0, `${label}: malformed column boundaries`);
    for (const entry of analyzed) {
      assert.deepEqual(entry.separators, boundaries, `${label}: separator offsets must align on display width`);
      assert.equal(entry.width, analyzed[0].width, `${label}: every table line must share one width`);
      assert.ok(["┌", "├", "└", "│"].includes(entry.edges[0]), `${label}: malformed left border`);
      assert.ok(["┐", "┤", "┘", "│"].includes(entry.edges[1]), `${label}: malformed right border`);
    }
    assert.ok(block[0].startsWith("┌") && block[0].endsWith("┐"), `${label}: malformed top border`);
    assert.ok(block[block.length - 1].startsWith("└") && block[block.length - 1].endsWith("┘"), `${label}: malformed bottom border`);
    assert.equal(displayWidth(block[0]), displayWidth(block[block.length - 1]), `${label}: border widths must match`);
    tables += 1;
    index = cursor;
  }
  return tables;
}

test("test_config_table_renderer_measures_display_width_of_wide_and_combining_characters", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("日本"), 4);
  assert.equal(displayWidth("e\u0301"), 1, "combining marks occupy zero columns");
  assert.equal(displayWidth("│   "), 4);
});

test("test_config_table_renderer_emits_rectangular_borders_padded_on_both_sides", () => {
  const table: ConfigTable = {
    headers: ["Idx", "Value"],
    rows: [
      ["0", '"pi"'],
      ["1", '"claude"'],
    ],
  };
  assert.deepEqual(renderConfigTable(table), [
    "┌─────┬──────────┐",
    "│ Idx │ Value    │",
    "├─────┼──────────┤",
    '│ 0   │ "pi"     │',
    '│ 1   │ "claude" │',
    "└─────┴──────────┘",
  ]);
});

test("test_config_table_renderer_aligns_wide_character_cells", () => {
  const lines = renderConfigTable({
    headers: ["Value", "Meaning"],
    rows: [
      ["maps_geocode", "位置情報"],
      ["maps_search_places", "検索"],
    ],
  });
  assert.equal(validateTables(lines, "wide characters"), 1);
  assert.equal(lines.length, 6);
});

test("test_config_table_renderer_escapes_control_characters_before_measuring", () => {
  assert.equal(escapeDetailText("line\nbreak"), "line\\nbreak");
  assert.equal(escapeDetailText("tab\there"), "tab\\there");
  assert.equal(escapeDetailText("carriage\rreturn"), "carriage\\rreturn");
  assert.equal(escapeDetailText("bell\u0007"), "bell\\u0007");
  const lines = renderConfigTable({
    headers: ["Value"],
    rows: [['"multi\nline"']],
  });
  assert.equal(validateTables(lines, "escaped control characters"), 1);
  assert.ok(lines.some((line) => line.includes('"multi\\nline"')), "newlines must render as two visible characters");
});

test("test_config_table_renderer_omits_empty_collections", () => {
  assert.deepEqual(renderConfigTable({ headers: ["Idx", "Value"], rows: [] }), []);
  assert.deepEqual(asConfigTableDetail({ headers: ["Idx", "Value"], rows: [] }), []);
  const lines = renderConfigTree({
    heading: "Root",
    details: asConfigTableDetail({ headers: ["Idx", "Value"], rows: [] }),
    children: [],
  });
  assert.deepEqual(lines, ["Root"]);
});

test("test_config_info_tables_are_rectangular_and_anchored_to_their_owner", () => {
  const view = buildConfigInfoView(CONTEXT);
  assert.ok(view.ok);
  const lines = renderConfigTree(view.root);
  assert.equal(validateTables(lines, "info view"), 2);

  const enabledRows = lines.filter(
    (line) => line.startsWith("    │   │ ") && line.includes('--set Settings:enabled:+ "')
  );
  assert.equal(enabledRows.length, CONTEXT.cliNames.length);
  for (const row of enabledRows) {
    assert.ok(row.startsWith("    │   │ "), `enabled table rows must carry the owner detail prefix: ${row}`);
  }
});
