import assert from "node:assert/strict";
import test from "node:test";
import { PlacesSearcher } from "../src/services/PlacesSearcher.js";

// cli.ts is also the executable entrypoint and detects direct execution from
// process.argv[1]. Import it with a neutral argv value so the test process
// does not start an HTTP server as a side effect.
const originalArgv1 = process.argv[1];
process.argv[1] = "cli-exec-unit-test";
const { EXEC_TOOLS, execTool, runExecCommand, runDoctor } = await import("../src/cli.js");
process.argv[1] = originalArgv1;

interface CapturedOutput {
  stdout: string;
  stderr: string;
}

function createStreams(): {
  output: CapturedOutput;
  streams: { stdout: { write: (chunk: string) => boolean }; stderr: { write: (chunk: string) => boolean } };
} {
  const output: CapturedOutput = { stdout: "", stderr: "" };
  return {
    output,
    streams: {
      stdout: {
        write: (chunk: string) => {
          output.stdout += chunk;
          return true;
        },
      },
      stderr: {
        write: (chunk: string) => {
          output.stderr += chunk;
          return true;
        },
      },
    },
  };
}

test("runExecCommand writes successful service responses as JSON to stdout", async () => {
  const { output, streams } = createStreams();
  const exitCode = await runExecCommand(
    "maps_geocode",
    { address: "Tokyo Tower" },
    "test-api-key",
    async (toolName, params, apiKey) => {
      assert.equal(toolName, "maps_geocode");
      assert.deepEqual(params, { address: "Tokyo Tower" });
      assert.equal(apiKey, "test-api-key");
      return { success: true, data: { location: { lat: 35.6586, lng: 139.7454 } } };
    },
    streams
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(output.stdout), {
    success: true,
    data: { location: { lat: 35.6586, lng: 139.7454 } },
  });
  assert.equal(output.stderr, "");
});

test("runExecCommand treats a failed service response as a command failure", async () => {
  const { output, streams } = createStreams();
  const exitCode = await runExecCommand(
    "maps_geocode",
    { address: "Not A Real Address" },
    "test-api-key",
    async () => ({ success: false, error: "Geocoding API request failed" }),
    streams
  );

  assert.equal(exitCode, 1);
  assert.equal(output.stdout, "");
  assert.deepEqual(JSON.parse(output.stderr), { error: "Geocoding API request failed" });
});

test("runExecCommand reports thrown errors on stderr", async () => {
  const { output, streams } = createStreams();
  const exitCode = await runExecCommand(
    "maps_geocode",
    {},
    "test-api-key",
    async () => {
      throw new Error("request timed out");
    },
    streams
  );

  assert.equal(exitCode, 1);
  assert.equal(output.stdout, "");
  assert.deepEqual(JSON.parse(output.stderr), { error: "request timed out" });
});

test("exec mode exposes all 18 canonical tool names", () => {
  assert.equal(EXEC_TOOLS.length, 18);
  assert.deepEqual(
    [...EXEC_TOOLS],
    [
      "maps_geocode",
      "maps_reverse_geocode",
      "maps_search_nearby",
      "maps_search_places",
      "maps_place_details",
      "maps_directions",
      "maps_distance_matrix",
      "maps_elevation",
      "maps_timezone",
      "maps_weather",
      "maps_explore_area",
      "maps_plan_route",
      "maps_compare_places",
      "maps_air_quality",
      "maps_static_map",
      "maps_batch_geocode",
      "maps_search_along_route",
      "maps_local_rank_tracker",
    ]
  );
});

test("doctor performs local checks without calling Google APIs", async () => {
  let calls = 0;
  const report = await runDoctor("1.2.3", "configured-key", false, async () => {
    calls++;
    return { success: true };
  });

  assert.equal(report.success, true);
  assert.equal(report.live, false);
  assert.equal(calls, 0);
  assert.equal(report.checks.find((check) => check.name === "api-key")?.status, "pass");
  assert.equal(report.checks.find((check) => check.name === "live-api")?.status, "skip");
});

test("doctor fails safely when the API key is missing", async () => {
  const report = await runDoctor("1.2.3", undefined, false);

  assert.equal(report.success, false);
  assert.equal(report.checks.find((check) => check.name === "api-key")?.status, "fail");
  assert.equal(JSON.stringify(report).includes("configured-key"), false);
});

test("doctor live mode checks geocoding, places, and routes independently", async () => {
  const calledTools: string[] = [];
  const report = await runDoctor("1.2.3", "secret-key", true, async (toolName) => {
    calledTools.push(toolName);
    if (toolName === "maps_search_places") return { success: false, error: "Places API (New) is disabled" };
    return { success: true };
  });

  assert.deepEqual(calledTools, ["maps_geocode", "maps_search_places", "maps_directions"]);
  assert.equal(report.success, false);
  assert.equal(report.checks.find((check) => check.name === "geocoding-api")?.status, "pass");
  assert.equal(report.checks.find((check) => check.name === "places-api-new")?.status, "fail");
  assert.equal(report.checks.find((check) => check.name === "routes-api")?.status, "pass");
  assert.equal(JSON.stringify(report).includes("secret-key"), false);
});

test("execTool resolves the canonical maps_geocode tool name", async () => {
  const originalGeocode = PlacesSearcher.prototype.geocode;
  const addresses: string[] = [];
  PlacesSearcher.prototype.geocode = async (address) => {
    addresses.push(address);
    return {
      success: true,
      data: {
        location: { lat: 35.6586, lng: 139.7454 },
        formatted_address: address,
        place_id: "test-place-id",
      },
    };
  };

  try {
    const result = await execTool("maps_geocode", { address: "Eiffel Tower" }, "test-api-key");

    assert.equal(result.success, true);
    assert.deepEqual(addresses, ["Eiffel Tower"]);
  } finally {
    PlacesSearcher.prototype.geocode = originalGeocode;
  }
});

test("execTool accepts the canonical maps_search_nearby tool name", async () => {
  const originalSearchNearby = PlacesSearcher.prototype.searchNearby;
  let receivedKeyword: string | undefined;
  PlacesSearcher.prototype.searchNearby = async (params) => {
    receivedKeyword = params.keyword;
    return { success: true, data: [] };
  };

  try {
    const result = await execTool(
      "maps_search_nearby",
      { center: { value: "35.68,139.74", isCoordinates: true }, keyword: "restaurant" },
      "test-api-key"
    );

    assert.equal(result.success, true);
    assert.equal(receivedKeyword, "restaurant");
  } finally {
    PlacesSearcher.prototype.searchNearby = originalSearchNearby;
  }
});
