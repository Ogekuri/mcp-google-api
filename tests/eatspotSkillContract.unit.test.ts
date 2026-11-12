import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_PATH = join(PROJECT_ROOT, "skills", "eatspot-discovery", "SKILL.md");
const DEBUG_PATH = join(PROJECT_ROOT, "skills", "eatspot-discovery", "DEBUG.md");
const MANIFEST_PATH = join(PROJECT_ROOT, "skills", "manifest.json");

/**
 * @brief Loads the packaged eatspot-discovery skill document as text.
 * @details Reads the tracked SKILL.md asset once per test; the file is an
 * immutable input during the test run. Missing file fails the test.
 * @return {string} Raw Markdown text of the skill document.
 */
function readSkillDoc(): string {
  return readFileSync(SKILL_PATH, "utf-8");
}

/**
 * @brief Loads the packaged debug overlay document as text.
 * @details The overlay is installed only with `--debug-skills`; the file is
 * read directly so the suite verifies its packaged content (REQ-153).
 * @return {string} Raw Markdown text of the debug overlay document.
 */
function readDebugDoc(): string {
  return readFileSync(DEBUG_PATH, "utf-8");
}

/**
 * @brief Loads the packaged skills manifest as a parsed object.
 * @details Parses the tracked manifest.json; malformed JSON fails the test
 * through the JSON.parse exception.
 * @return {{version: number, skills: Array<Record<string, unknown>>}} Parsed manifest.
 */
function readManifest(): { version: number; skills: Array<Record<string, unknown>> } {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

/**
 * @brief Extracts the body of one Markdown heading section.
 * @details Locates the line starting with the given heading prefix and
 * collects lines until the next heading of any level (`##`..`######`).
 * @param text {string} Full document text to scan.
 * @param heading {string} Exact heading-line prefix (e.g. "### D9").
 * @return {string} Section text including the heading line.
 * @throws {AssertionError} When the heading prefix is absent.
 */
function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(heading));
  assert.notEqual(start, -1, `Missing heading: ${heading}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{2,6} /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

test("eatspot skill documents the maps_geocode flat payload contract", () => {
  const realResponseSection = section(readSkillDoc(), "#### 13.1");
  assert.match(realResponseSection, /`maps_geocode`/);
  assert.match(realResponseSection, /"location": \{ "lat": <number>, "lng": <number> \}/);
  assert.match(realResponseSection, /"formatted_address"/);
  assert.match(realResponseSection, /"place_id"/);
});

test("eatspot skill forbids dereferencing the internal success/data envelope", () => {
  const realResponseSection = section(readSkillDoc(), "#### 13.1");
  assert.match(realResponseSection, /never exposed to MCP clients/);
  assert.match(realResponseSection, /Dereferencing `data`/);
  assert.match(realResponseSection, /`success`, or `error`/);
});

test("eatspot skill debug register applies bounded raw-payload capture with declared truncation", () => {
  const d9 = section(readDebugDoc(), "### D9");
  assert.match(d9, /serialized-size limit/i);
  assert.match(d9, /TRUNCATED/);
  assert.match(d9, /`raw_place` of ALL returned results/);
  assert.match(d9, /never a subset of results/);
});

test("eatspot skill re-executes calls when a register entry is missing", () => {
  const d9 = section(readDebugDoc(), "### D9");
  assert.match(d9, /Register-entry integrity/);
  assert.match(d9, /re-execute the tool call/);
  assert.match(d9, /never dereference fields of a missing entry/);
  assert.match(d9, /API_RESPONSE_NOT_ACCESSIBLE/);
});

test("packaged manifest version matches the skill declaration", () => {
  const skillText = readSkillDoc();
  const manifest = readManifest();
  const declared = skillText.match(/Version (\d+\.\d+\.\d+)/);
  assert.notEqual(declared, null, "Skill must declare a Version X.Y.Z line");
  const entry = manifest.skills.find((skill) => skill["id"] === "eatspot-discovery");
  assert.notEqual(entry, undefined, "Manifest must index the eatspot-discovery skill");
  assert.equal(entry && entry["version"], declared && declared[1]);
});

test("eatspot skill keeps every debug instruction out of the packaged core document", () => {
  const skillText = readSkillDoc();
  const debugText = readDebugDoc();

  assert.equal(skillText.includes("## PART II"), false, "core document must not embed the debug part");
  assert.equal(skillText.includes("DEBUG_ENABLED"), false, "core document must not enable DEBUG");
  assert.equal(/^### D\d/m.test(skillText), false, "core document must not carry debug sections");
  assert.match(debugText, /## PART II — DEBUG/);
  assert.match(debugText, /DEBUG_ENABLED = TRUE/);
  assert.equal(/^### D\d+\./m.test(debugText), true, "debug overlay must carry the debug sections");
});

test("packaged manifest declares the debug overlay of the eatspot skill", () => {
  const manifest = readManifest();
  const entry = manifest.skills.find((skill) => skill["id"] === "eatspot-discovery");
  assert.notEqual(entry, undefined, "Manifest must index the eatspot-discovery skill");
  assert.equal(entry && entry["debug"], "DEBUG.md");
});
