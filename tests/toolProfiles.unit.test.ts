import assert from "node:assert/strict";
import test from "node:test";
import serverConfigs from "../src/config.js";
import {
  TOOL_API_PROFILES,
  describeToolsProfile,
  getToolProfile,
} from "../src/utils/toolProfiles.js";

const COMPOSITE_TOOLS = [
  "maps_batch_geocode",
  "maps_explore_area",
  "maps_plan_route",
  "maps_compare_places",
  "maps_search_along_route",
  "maps_local_rank_tracker",
];

const REGISTERED_TOOL_NAMES = serverConfigs[0].tools.map((tool) => tool.name);

test("tool profiles cover all 18 registered tools", () => {
  assert.equal(REGISTERED_TOOL_NAMES.length, 18);
  for (const name of REGISTERED_TOOL_NAMES) {
    const profile = getToolProfile(name);
    assert.notEqual(profile, undefined, `missing profile for ${name}`);
    assert.ok(profile!.apis.length > 0, `profile ${name} must list at least one API`);
  }
  assert.equal(Object.keys(TOOL_API_PROFILES).length, 18);
});

test("composite tools declare their tool dependencies", () => {
  for (const name of COMPOSITE_TOOLS) {
    const profile = getToolProfile(name);
    assert.notEqual(profile, undefined, `missing profile for ${name}`);
    assert.ok(profile!.dependsOnTools.length > 0, `composite ${name} must declare dependsOnTools`);
  }
});

test("tool profile dependencies reference registered profile keys", () => {
  for (const profile of Object.values(TOOL_API_PROFILES)) {
    for (const dependency of profile.dependsOnTools) {
      assert.notEqual(TOOL_API_PROFILES[dependency], undefined, `${profile.tool} depends on unknown ${dependency}`);
    }
  }
});

test("describeToolsProfile aggregates per-tool APIs without duplicates", () => {
  const summary = describeToolsProfile(["maps_geocode", "maps_directions", "maps_geocode"]);
  assert.equal(summary.toolCount, 2);
  assert.deepEqual(summary.apis, ["geocoding", "routes"]);
  assert.deepEqual(summary.tools[0], {
    tool: "maps_geocode",
    apis: ["geocoding"],
    dependsOnTools: [],
  });
});

test("describeToolsProfile skips unknown tool names", () => {
  const summary = describeToolsProfile(["maps_unknown_tool"]);
  assert.equal(summary.toolCount, 0);
  assert.deepEqual(summary.apis, []);
  assert.deepEqual(summary.tools, []);
});
