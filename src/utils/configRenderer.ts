/**
 * @file configRenderer.ts
 * @brief Deterministic renderer for every hierarchical configuration layout.
 * @details One recursive tree renderer and one display-width table formatter
 * shared by `--print` and `--info` (DES-027). Structural topology depends only
 * on the real node tree: `├── `, `└── `, `│   `, and four-space segments are
 * derived from sibling positions, never from display column widths, text
 * length, or hard-coded spacing (REQ-209, REQ-210). Attached details reuse the
 * owning node continuation prefix and never carry tree edge markers
 * (REQ-210). Tables are built from column definitions and rows with widths
 * computed from terminal display width, so borders stay aligned for wide and
 * combining characters (REQ-217).
 * @note Pure module: no I/O, no ANSI output, no environment access.
 * @satisfies DES-027, REQ-209, REQ-210, REQ-217
 */

/**
 * @brief One attached detail block of a configuration node.
 * @details `lines` are independent logical output lines; the renderer prefixes
 * each of them with the owning node's continuation prefix (REQ-210).
 * @satisfies REQ-210
 */
export interface ConfigDetail {
  readonly lines: readonly string[];
}

/**
 * @brief One real configuration node of a rendered tree.
 * @details `heading` is marker-free; `children` are real configuration nodes
 * only, so metadata never adds a tree level (REQ-209, REQ-210).
 * @satisfies REQ-209, REQ-210
 */
export interface ConfigRenderNode {
  readonly heading: string;
  readonly details: readonly ConfigDetail[];
  readonly children: readonly ConfigRenderNode[];
}

/**
 * @brief Tabular payload attached to one configuration parameter.
 * @details `headers` and each row share the same column count; an empty `rows`
 * list is rendered as no output so callers can omit empty collection tables
 * entirely (REQ-218).
 * @satisfies REQ-217, REQ-218
 */
export interface ConfigTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** @brief Structural marker of a non-terminal real node. @satisfies REQ-209 */
export const TREE_BRANCH = "├── ";

/** @brief Structural marker of the terminal real node of one sibling list. @satisfies REQ-209 */
export const TREE_LAST = "└── ";

/** @brief Ancestor continuation segment emitted while an ancestor has a later sibling. @satisfies REQ-209 */
export const TREE_CONTINUE = "│   ";

/** @brief Ancestor/own continuation segment emitted while no later sibling follows. @satisfies REQ-209 */
export const TREE_INDENT = "    ";

/** @brief Spaces padded on both sides of every rendered table cell. @satisfies REQ-217 */
const TABLE_PADDING = 1;

/**
 * @brief Code-point width classification used by the display-width routine.
 * @details East Asian Wide/Fullwidth ranges occupy two terminal columns;
 * combining marks occupy zero (REQ-217). Ranges are intentionally coarse: every
 * supported range makes border alignment correct for the affected scripts.
 * @param code {number} Unicode code point.
 * @return {number} 0 for combining marks, 2 for wide code points, else 1.
 * @note Complexity O(1). Pure.
 * @satisfies REQ-217
 */
function codePointWidth(code: number): number {
  if (code === 0) return 0;
  if (code < 32 || (code >= 0x7f && code < 0xa0)) return 1;
  if ((code >= 0x0300 && code <= 0x036f) || (code >= 0x1ab0 && code <= 0x1aff) || (code >= 0x20d0 && code <= 0x20ff)) {
    return 0;
  }
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/**
 * @brief Computes the terminal display width of one text fragment.
 * @details Sums code-point widths so wide (CJK/emoji) characters count as two
 * and combining marks count as zero (REQ-217). Never assumes byte length.
 * @param text {string} Text fragment.
 * @return {number} Display width in terminal columns.
 * @note Complexity O(n) in code points. Pure.
 * @satisfies REQ-217
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    width += codePointWidth(character.codePointAt(0) ?? 0);
  }
  return width;
}

/**
 * @brief Escapes control characters so one physical line stays one logical line.
 * @details Tabs, carriage returns, and newlines become the two-character
 * sequences `\t`, `\r`, and `\n`; other C0/C1 controls become `\uXXXX`
 * escapes (REQ-210, REQ-218). Escaping happens before width measurement.
 * @param text {string} Raw cell text.
 * @return {string} Escaped single-line text.
 * @note Complexity O(n). Pure.
 * @satisfies REQ-210, REQ-217
 */
export function escapeDetailText(text: string): string {
  let escaped = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\n") {
      escaped += "\\n";
    } else if (character === "\r") {
      escaped += "\\r";
    } else if (character === "\t") {
      escaped += "\\t";
    } else if (code < 32 || (code >= 0x7f && code < 0xa0)) {
      escaped += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      escaped += character;
    }
  }
  return escaped;
}

/**
 * @brief Pads one escaped cell to a fixed display width.
 * @details Right padding only; left padding is contributed by the caller's
 * uniform cell padding so every border character aligns (REQ-217).
 * @param text {string} Escaped cell text.
 * @param width {number} Target content width in display columns.
 * @return {string} Padded cell text.
 * @note Complexity O(n). Pure.
 * @satisfies REQ-217
 */
function padCell(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

/**
 * @brief Renders one box-drawing table as attached detail lines.
 * @details Column widths are the maximum display width of the header and all
 * cells plus one space of padding on both sides; the top border uses
 * `┌ ┬ ┐`, the header separator `├ ┼ ┤`, data rows `│`, and the bottom border
 * `└ ┴ ┘`, so `┬`, `┼`, and `┴` align with every `│` (REQ-217). An empty row
 * list returns no lines so empty collections omit the table entirely (REQ-218).
 * Cells carrying newlines or control characters are escaped before measuring
 * widths and are never truncated (REQ-210, REQ-218).
 * @param table {ConfigTable} Headers plus rows.
 * @return {string[]} Rendered lines without any tree prefix.
 * @note Complexity O(rows * columns). Pure.
 * @satisfies REQ-217, REQ-218
 */
export function renderConfigTable(table: ConfigTable): string[] {
  const columnCount = table.headers.length;
  if (columnCount === 0 || table.rows.length === 0) {
    return [];
  }
  const headers = table.headers.map((header) => escapeDetailText(header));
  const rows = table.rows.map((row) => {
    const cells: string[] = [];
    for (let column = 0; column < columnCount; column += 1) {
      cells.push(escapeDetailText(row[column] ?? ""));
    }
    return cells;
  });
  const widths = headers.map((header, column) => {
    let width = displayWidth(header);
    for (const row of rows) {
      width = Math.max(width, displayWidth(row[column]));
    }
    return width;
  });
  const segment = (index: number): string => "─".repeat(widths[index] + TABLE_PADDING * 2);
  const border = (left: string, middle: string, right: string): string =>
    left + widths.map((_width, index) => segment(index)).join(middle) + right;
  const line = (cells: readonly string[]): string =>
    "│" +
    widths
      .map((width, index) => " ".repeat(TABLE_PADDING) + padCell(cells[index] ?? "", width) + " ".repeat(TABLE_PADDING))
      .join("│") +
    "│";
  const lines: string[] = [border("┌", "┬", "┐"), line(headers), border("├", "┼", "┤")];
  for (const row of rows) {
    lines.push(line(row));
  }
  lines.push(border("└", "┴", "┘"));
  return lines;
}

/**
 * @brief Emits one real node and its subtree into a line accumulator.
 * @details Prefix segments come exclusively from `ancestorHasNext`: one
 * `│   ` per ancestor with a later sibling, otherwise four spaces (REQ-209).
 * The marker is `└── ` for the last real sibling and `├── ` otherwise, and every
 * attached detail line receives the same ancestor prefix plus exactly one own
 * continuation segment (REQ-210). Complexity O(nodes + details).
 * @param node {ConfigRenderNode} Real configuration node.
 * @param ancestorHasNext {boolean[]} Later-sibling flags of the real ancestors.
 * @param isLast {boolean} True when this node is the last real sibling.
 * @param out {string[]} Line accumulator.
 * @return {void}
 * @note Complexity O(subtree size). Pure.
 * @satisfies REQ-209, REQ-210
 */
function emitConfigNode(
  node: ConfigRenderNode,
  ancestorHasNext: readonly boolean[],
  isLast: boolean,
  out: string[]
): void {
  const prefix = ancestorHasNext.map((hasNext) => (hasNext ? TREE_CONTINUE : TREE_INDENT)).join("");
  out.push(prefix + (isLast ? TREE_LAST : TREE_BRANCH) + node.heading);
  const detailPrefix = prefix + (isLast ? TREE_INDENT : TREE_CONTINUE);
  for (const detail of node.details) {
    for (const logicalLine of detail.lines) {
      out.push(detailPrefix + escapeDetailText(logicalLine));
    }
  }
  node.children.forEach((child, index) => {
    emitConfigNode(child, [...ancestorHasNext, !isLast], index === node.children.length - 1, out);
  });
}

/**
 * @brief Renders one configuration tree with an unconnected display root.
 * @details The root heading is printed without any tree marker and its own
 * details use a simple four-space indent, so a requested subtree never invents
 * ancestors or emits a dangling continuation column (REQ-212). Real children
 * are emitted through the REQ-209 sibling algorithm (REQ-209, REQ-210).
 * @param root {ConfigRenderNode} Display root node.
 * @return {string[]} Rendered lines without a trailing newline element.
 * @note Complexity O(nodes + details). Pure.
 * @satisfies REQ-209, REQ-210, REQ-212
 */
export function renderConfigTree(root: ConfigRenderNode): string[] {
  const lines: string[] = [escapeDetailText(root.heading)];
  for (const detail of root.details) {
    for (const logicalLine of detail.lines) {
      lines.push(TREE_INDENT + escapeDetailText(logicalLine));
    }
  }
  root.children.forEach((child, index) => {
    emitConfigNode(child, [], index === root.children.length - 1, lines);
  });
  return lines;
}

/**
 * @brief Attaches one table to a node detail list when it carries rows.
 * @details Returns an empty detail list for zero rows so empty collections show
 * only their no-data action hint (REQ-218).
 * @param table {ConfigTable} Candidate table.
 * @return {ConfigDetail[]} Zero or one detail block holding the rendered table.
 * @note Complexity O(rows * columns). Pure.
 * @satisfies REQ-217, REQ-218
 */
export function asConfigTableDetail(table: ConfigTable): ConfigDetail[] {
  const lines = renderConfigTable(table);
  return lines.length === 0 ? [] : [{ lines }];
}
