/**
 * @brief Identifier of a Google Maps Platform API consumed by a tool.
 * @details Stable machine-readable ids used across tool profiles, `doctor`
 * local reports, and documentation tables.
 */
export type GoogleApiId =
  | "geocoding"
  | "places-new"
  | "routes"
  | "timezone"
  | "elevation"
  | "static-maps"
  | "weather"
  | "air-quality";

/**
 * @brief Human-readable Google Cloud Console names for each `GoogleApiId`.
 * @details Matches the service display names in the Google Cloud Console so
 * diagnostics map one-to-one onto enablement screens. Complexity O(1); pure.
 */
export const GOOGLE_API_LABELS: Readonly<Record<GoogleApiId, string>> = {
  geocoding: "Geocoding API",
  "places-new": "Places API (New)",
  routes: "Routes API",
  timezone: "Time Zone API",
  elevation: "Maps Elevation API",
  "static-maps": "Maps Static API",
  weather: "Weather API",
  "air-quality": "Air Quality API",
};

/**
 * @brief Dependency profile of one MCP tool.
 * @details `apis` lists every Google API the tool can call at runtime
 * (including dependencies reached through composite resolution such as
 * address geocoding or text-search fallback); `dependsOnTools` lists the
 * sibling tools whose operations the composite tool chains internally.
 */
export interface ToolApiProfile {
  readonly tool: string;
  readonly apis: readonly GoogleApiId[];
  readonly dependsOnTools: readonly string[];
}

/**
 * @brief Machine-readable tool -> Google API dependency registry (18 entries).
 * @details Covers every tool of PRJ-001. Composite tools
 * (`maps_explore_area`, `maps_plan_route`, `maps_compare_places`,
 * `maps_search_along_route`, `maps_local_rank_tracker`, `maps_batch_geocode`)
 * list both the union of the Google APIs their chain can reach and the tool
 * names they compose. Complexity O(1); pure constant data.
 * @satisfies PRJ-009
 */
export const TOOL_API_PROFILES: Readonly<Record<string, ToolApiProfile>> = {
  maps_geocode: { tool: "maps_geocode", apis: ["geocoding"], dependsOnTools: [] },
  maps_reverse_geocode: { tool: "maps_reverse_geocode", apis: ["geocoding"], dependsOnTools: [] },
  maps_batch_geocode: { tool: "maps_batch_geocode", apis: ["geocoding"], dependsOnTools: ["maps_geocode"] },
  maps_search_nearby: {
    tool: "maps_search_nearby",
    apis: ["places-new", "geocoding"],
    dependsOnTools: ["maps_geocode"],
  },
  maps_search_places: { tool: "maps_search_places", apis: ["places-new"], dependsOnTools: [] },
  maps_place_details: { tool: "maps_place_details", apis: ["places-new"], dependsOnTools: [] },
  maps_directions: { tool: "maps_directions", apis: ["routes"], dependsOnTools: [] },
  maps_distance_matrix: { tool: "maps_distance_matrix", apis: ["routes"], dependsOnTools: [] },
  maps_elevation: { tool: "maps_elevation", apis: ["elevation"], dependsOnTools: [] },
  maps_timezone: { tool: "maps_timezone", apis: ["timezone"], dependsOnTools: [] },
  maps_weather: { tool: "maps_weather", apis: ["weather"], dependsOnTools: [] },
  maps_air_quality: { tool: "maps_air_quality", apis: ["air-quality"], dependsOnTools: [] },
  maps_static_map: { tool: "maps_static_map", apis: ["static-maps"], dependsOnTools: [] },
  maps_explore_area: {
    tool: "maps_explore_area",
    apis: ["places-new", "geocoding"],
    dependsOnTools: ["maps_geocode", "maps_search_nearby", "maps_place_details"],
  },
  maps_plan_route: {
    tool: "maps_plan_route",
    apis: ["routes", "geocoding", "places-new"],
    dependsOnTools: ["maps_geocode", "maps_search_places", "maps_directions"],
  },
  maps_compare_places: {
    tool: "maps_compare_places",
    apis: ["places-new", "routes"],
    dependsOnTools: ["maps_search_places", "maps_place_details", "maps_distance_matrix"],
  },
  maps_search_along_route: {
    tool: "maps_search_along_route",
    apis: ["routes", "places-new"],
    dependsOnTools: ["maps_directions", "maps_search_places"],
  },
  maps_local_rank_tracker: {
    tool: "maps_local_rank_tracker",
    apis: ["places-new"],
    dependsOnTools: ["maps_place_details", "maps_search_places"],
  },
};

/**
 * @brief Looks up the dependency profile of one tool.
 * @details Direct registry access; unknown names return undefined so callers
 * decide whether to skip or report. Complexity O(1).
 * @param toolName {string} MCP tool name (e.g. `maps_geocode`).
 * @return {ToolApiProfile | undefined} Profile when registered; undefined otherwise.
 * @satisfies PRJ-009
 */
export function getToolProfile(toolName: string): ToolApiProfile | undefined {
  return TOOL_API_PROFILES[toolName];
}

/**
 * @brief Aggregated API-dependency summary for a set of enabled tools.
 * @details `tools` keeps per-tool ordering of the input; `apis` is the deduped,
 * registry-order union of required `GoogleApiId`s across all given tools.
 */
export interface ToolsProfileSummary {
  toolCount: number;
  apis: GoogleApiId[];
  tools: Array<{ tool: string; apis: GoogleApiId[]; dependsOnTools: string[] }>;
}

/**
 * @brief Aggregates tool/API profiles for the enabled tool set.
 * @details Maps each name through `TOOL_API_PROFILES` (unknown names and
 * duplicates are skipped), unions the required APIs in registry order without
 * duplicates, and echoes per-tool dependencies. No network access.
 * Complexity O(n) in tool names plus O(n*a) API union work.
 * @param toolNames {readonly string[]} Effective enabled tool names.
 * @return {ToolsProfileSummary} Per-tool profiles and aggregated API union.
 * @see getToolProfile
 * @satisfies PRJ-009, REQ-090
 */
export function describeToolsProfile(toolNames: readonly string[]): ToolsProfileSummary {
  const tools: ToolsProfileSummary["tools"] = [];
  const apiOrder: GoogleApiId[] = [];
  const seenApis = new Set<GoogleApiId>();
  const seenTools = new Set<string>();

  for (const name of toolNames) {
    if (seenTools.has(name)) {
      continue;
    }
    const profile = TOOL_API_PROFILES[name];
    if (!profile) {
      continue;
    }
    seenTools.add(name);
    tools.push({
      tool: profile.tool,
      apis: [...profile.apis],
      dependsOnTools: [...profile.dependsOnTools],
    });
    for (const api of profile.apis) {
      if (!seenApis.has(api)) {
        seenApis.add(api);
        apiOrder.push(api);
      }
    }
  }

  return { toolCount: tools.length, apis: apiOrder, tools };
}
