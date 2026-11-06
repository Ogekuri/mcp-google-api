import { resolveEnabledToolNames } from "./utils/configResolver.js";
import { loadCliSettings } from "./utils/cliSettings.js";
import { Logger } from "./index.js";
import { ToolConfig } from "./core/BaseMcpServer.js";

// Import tool definitions
import { SearchNearby, SearchNearbyParams } from "./tools/maps/searchNearby.js";
import { PlaceDetails, PlaceDetailsParams } from "./tools/maps/placeDetails.js";
import { Geocode, GeocodeParams } from "./tools/maps/geocode.js";
import { ReverseGeocode, ReverseGeocodeParams } from "./tools/maps/reverseGeocode.js";
import { DistanceMatrix, DistanceMatrixParams } from "./tools/maps/distanceMatrix.js";
import { Directions, DirectionsParams } from "./tools/maps/directions.js";
import { Elevation, ElevationParams } from "./tools/maps/elevation.js";
import { SearchPlaces, SearchPlacesParams } from "./tools/maps/searchPlaces.js";
import { Timezone, TimezoneParams } from "./tools/maps/timezone.js";
import { Weather, WeatherParams } from "./tools/maps/weather.js";
import { ExploreArea, ExploreAreaParams } from "./tools/maps/exploreArea.js";
import { PlanRoute, PlanRouteParams } from "./tools/maps/planRoute.js";
import { ComparePlaces, ComparePlacesParams } from "./tools/maps/comparePlaces.js";
import { AirQuality, AirQualityParams } from "./tools/maps/airQuality.js";
import { StaticMap, StaticMapParams } from "./tools/maps/staticMap.js";
import { BatchGeocode, BatchGeocodeParams } from "./tools/maps/batchGeocode.js";
import { SearchAlongRoute, SearchAlongRouteParams } from "./tools/maps/searchAlongRoute.js";
import { LocalRankTracker, LocalRankTrackerParams } from "./tools/maps/localRankTracker.js";

// All Google Maps tools are read-only API queries
const MAPS_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

interface ServerInstanceConfig {
  name: string;
  tools: ToolConfig[];
}

const serverConfigs: ServerInstanceConfig[] = [
  {
    name: "MCP-Server",
    tools: [
      {
        name: SearchNearby.NAME,
        description: SearchNearby.DESCRIPTION,
        schema: SearchNearby.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: SearchNearbyParams) => SearchNearby.ACTION(params),
      },
      {
        name: PlaceDetails.NAME,
        description: PlaceDetails.DESCRIPTION,
        schema: PlaceDetails.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: PlaceDetailsParams) => PlaceDetails.ACTION(params),
      },
      {
        name: Geocode.NAME,
        description: Geocode.DESCRIPTION,
        schema: Geocode.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: GeocodeParams) => Geocode.ACTION(params),
      },
      {
        name: ReverseGeocode.NAME,
        description: ReverseGeocode.DESCRIPTION,
        schema: ReverseGeocode.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: ReverseGeocodeParams) => ReverseGeocode.ACTION(params),
      },
      {
        name: DistanceMatrix.NAME,
        description: DistanceMatrix.DESCRIPTION,
        schema: DistanceMatrix.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: DistanceMatrixParams) => DistanceMatrix.ACTION(params),
      },
      {
        name: Directions.NAME,
        description: Directions.DESCRIPTION,
        schema: Directions.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: DirectionsParams) => Directions.ACTION(params),
      },
      {
        name: Elevation.NAME,
        description: Elevation.DESCRIPTION,
        schema: Elevation.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: ElevationParams) => Elevation.ACTION(params),
      },
      {
        name: SearchPlaces.NAME,
        description: SearchPlaces.DESCRIPTION,
        schema: SearchPlaces.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: SearchPlacesParams) => SearchPlaces.ACTION(params),
      },
      {
        name: Timezone.NAME,
        description: Timezone.DESCRIPTION,
        schema: Timezone.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: TimezoneParams) => Timezone.ACTION(params),
      },
      {
        name: Weather.NAME,
        description: Weather.DESCRIPTION,
        schema: Weather.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: WeatherParams) => Weather.ACTION(params),
      },
      {
        name: ExploreArea.NAME,
        description: ExploreArea.DESCRIPTION,
        schema: ExploreArea.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: ExploreAreaParams) => ExploreArea.ACTION(params),
      },
      {
        name: PlanRoute.NAME,
        description: PlanRoute.DESCRIPTION,
        schema: PlanRoute.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: PlanRouteParams) => PlanRoute.ACTION(params),
      },
      {
        name: ComparePlaces.NAME,
        description: ComparePlaces.DESCRIPTION,
        schema: ComparePlaces.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: ComparePlacesParams) => ComparePlaces.ACTION(params),
      },
      {
        name: AirQuality.NAME,
        description: AirQuality.DESCRIPTION,
        schema: AirQuality.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: AirQualityParams) => AirQuality.ACTION(params),
      },
      {
        name: StaticMap.NAME,
        description: StaticMap.DESCRIPTION,
        schema: StaticMap.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: StaticMapParams) => StaticMap.ACTION(params),
      },
      {
        name: BatchGeocode.NAME,
        description: BatchGeocode.DESCRIPTION,
        schema: BatchGeocode.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: BatchGeocodeParams) => BatchGeocode.ACTION(params),
      },
      {
        name: SearchAlongRoute.NAME,
        description: SearchAlongRoute.DESCRIPTION,
        schema: SearchAlongRoute.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: SearchAlongRouteParams) => SearchAlongRoute.ACTION(params),
      },
      {
        name: LocalRankTracker.NAME,
        description: LocalRankTracker.DESCRIPTION,
        schema: LocalRankTracker.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: LocalRankTrackerParams) => LocalRankTracker.ACTION(params),
      },
    ],
  },
];

/**
 * @brief Applies the persisted `enabledTools` allowlist to a tool registry.
 * @details Delegates allowlist semantics to `resolveEnabledToolNames` (unset,
 * empty, or `*` -> full set; >=1 match -> subset; 0 matches -> full set plus
 * stderr error). The raw allowlist defaults to the persisted settings
 * `enabledTools` field (DES-015, REQ-167); callers may pass an explicit
 * value for testing. Logs the active-count line only when a strict subset is
 * selected, preserving legacy output. Complexity O(n + m).
 * @param tools {ToolConfig[]} Full tool registry.
 * @param raw {string | undefined} Raw allowlist string; defaults to the persisted settings value.
 * @return {ToolConfig[]} Effective tool list (never empty for a non-empty input).
 * @see resolveEnabledToolNames
 * @satisfies PRJ-006, REQ-010, REQ-011, REQ-012
 */
export function filterTools(tools: ToolConfig[], raw: string | undefined = loadCliSettings().enabledTools): ToolConfig[] {
  const resolution = resolveEnabledToolNames(
    tools.map((tool) => tool.name),
    raw
  );

  if (resolution.fallback) {
    Logger.error(`enabledTools matched 0 tools. Available: ${tools.map((t) => t.name).join(", ")}`);
    return tools;
  }

  if (resolution.matched !== tools.length) {
    Logger.log(`enabledTools: ${resolution.matched}/${tools.length} tools active`);
  }

  const enabled = new Set(resolution.names);
  return tools.filter((tool) => enabled.has(tool.name));
}

export default serverConfigs;
