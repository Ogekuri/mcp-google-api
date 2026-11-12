// src/services/toolclass.ts
import { Client, Language } from "@googlemaps/google-maps-services-js";

// src/services/RoutesService.ts
var ROUTES_API_BASE = "https://routes.googleapis.com";
var TRAVEL_MODE_MAP = {
  driving: "DRIVE",
  walking: "WALK",
  bicycling: "BICYCLE",
  transit: "TRANSIT"
};
var COMPUTE_ROUTES_FIELD_MASK = [
  "routes.distanceMeters",
  "routes.duration",
  "routes.description",
  "routes.polyline.encodedPolyline",
  "routes.legs.distanceMeters",
  "routes.legs.duration",
  "routes.legs.startLocation",
  "routes.legs.endLocation",
  "routes.legs.steps.navigationInstruction",
  "routes.legs.steps.distanceMeters",
  "routes.legs.steps.staticDuration",
  "routes.legs.steps.startLocation",
  "routes.legs.steps.endLocation",
  "routes.legs.steps.transitDetails",
  "routes.legs.polyline",
  "routes.optimizedIntermediateWaypointIndex"
].join(",");
var COMPUTE_ROUTE_MATRIX_FIELD_MASK = "originIndex,destinationIndex,distanceMeters,duration,status,condition";
function parseDuration(duration) {
  if (!duration) return 0;
  const match = duration.match(/^(\d+)s$/);
  return match ? parseInt(match[1], 10) : 0;
}
function formatDistance(meters) {
  if (meters >= 1e3) {
    return `${(meters / 1e3).toFixed(1)} km`;
  }
  return `${meters} m`;
}
function formatDuration(seconds) {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const mins2 = Math.round(seconds % 3600 / 60);
    return mins2 > 0 ? `${hours} hour${hours > 1 ? "s" : ""} ${mins2} min${mins2 > 1 ? "s" : ""}` : `${hours} hour${hours > 1 ? "s" : ""}`;
  }
  const mins = Math.round(seconds / 60);
  return `${mins} min${mins !== 1 ? "s" : ""}`;
}
var COORDINATE_STRING_PATTERN = /^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/;
function describeWaypoint(waypoint) {
  if (typeof waypoint === "string") {
    return waypoint;
  }
  if ("placeId" in waypoint) {
    return `placeId:${waypoint.placeId}`;
  }
  return `${waypoint.latLng.latitude},${waypoint.latLng.longitude}`;
}
function toWaypoint(location) {
  if (typeof location !== "string") {
    return "placeId" in location ? { placeId: location.placeId } : { location: { latLng: location.latLng } };
  }
  const coordMatch = location.match(COORDINATE_STRING_PATTERN);
  if (coordMatch) {
    return {
      location: {
        latLng: {
          latitude: parseFloat(coordMatch[1]),
          longitude: parseFloat(coordMatch[2])
        }
      }
    };
  }
  return { address: location };
}
function buildRouteModifiers(params, travelMode) {
  const routeModifiers = {};
  if (params.avoidTolls) {
    routeModifiers.avoidTolls = true;
  }
  if (params.avoidHighways) {
    routeModifiers.avoidHighways = true;
  }
  if (Object.keys(routeModifiers).length === 0) {
    return void 0;
  }
  if (travelMode !== "DRIVE") {
    throw new Error('Route modifiers "avoid_tolls" and "avoid_highways" are only supported with mode "driving".');
  }
  return routeModifiers;
}
var RoutesService = class {
  constructor(apiKey) {
    this.apiKey = apiKey || "";
    if (!this.apiKey) {
      throw new Error("Google Maps API Key is required");
    }
  }
  /**
   * Compute routes using Routes API.
   * Returns response compatible with existing DirectionsResponse.data interface.
   */
  async computeRoutes(params) {
    const travelMode = TRAVEL_MODE_MAP[params.mode || "driving"] || "DRIVE";
    const requestBody = {
      origin: toWaypoint(params.origin),
      destination: toWaypoint(params.destination),
      travelMode,
      computeAlternativeRoutes: false
    };
    if (travelMode === "DRIVE") {
      requestBody.routingPreference = "TRAFFIC_AWARE";
    }
    const routeModifiers = buildRouteModifiers(params, travelMode);
    if (routeModifiers) {
      requestBody.routeModifiers = routeModifiers;
    }
    if (params.arrivalTime) {
      requestBody.arrivalTime = params.arrivalTime.toISOString();
    } else if (params.departureTime) {
      requestBody.departureTime = params.departureTime.toISOString();
    }
    if (params.intermediates && params.intermediates.length > 0) {
      requestBody.intermediates = params.intermediates.map(toWaypoint);
    }
    if (params.optimizeWaypointOrder && params.intermediates && params.intermediates.length > 1 && travelMode !== "TRANSIT") {
      requestBody.optimizeWaypointOrder = true;
    }
    const response = await fetch(`${ROUTES_API_BASE}/directions/v2:computeRoutes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": COMPUTE_ROUTES_FIELD_MASK
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = errorData?.error?.message || `HTTP ${response.status}`;
      throw new Error(msg);
    }
    const data = await response.json();
    if (!data.routes || data.routes.length === 0) {
      const mode = params.mode || "driving";
      if (mode === "transit") {
        throw new Error(
          `No transit route found from "${params.originLabel ?? describeWaypoint(params.origin)}" to "${params.destinationLabel ?? describeWaypoint(params.destination)}". The Google Routes API does not support transit directions in some regions (notably Japan and India). Try using mode "driving" or "walking" instead, or use a regional transit service for public transportation details.`
        );
      }
      throw new Error(
        `No route found from "${params.originLabel ?? describeWaypoint(params.origin)}" to "${params.destinationLabel ?? describeWaypoint(params.destination)}" with mode: ${mode}`
      );
    }
    const route = data.routes[0];
    const totalDistanceMeters = route.distanceMeters || 0;
    const totalDurationSeconds = parseDuration(route.duration);
    return {
      routes: data.routes,
      summary: route.description || "",
      total_distance: {
        value: totalDistanceMeters,
        text: formatDistance(totalDistanceMeters)
      },
      total_duration: {
        value: totalDurationSeconds,
        text: formatDuration(totalDurationSeconds)
      },
      arrival_time: "",
      departure_time: "",
      ...route.optimizedIntermediateWaypointIndex ? { optimizedIntermediateWaypointIndex: route.optimizedIntermediateWaypointIndex } : {}
    };
  }
  /**
   * Compute route matrix using Routes API.
   * Returns response compatible with existing DistanceMatrixResponse.data interface.
   */
  async computeRouteMatrix(params) {
    const travelMode = TRAVEL_MODE_MAP[params.mode || "driving"] || "DRIVE";
    const requestBody = {
      origins: params.origins.map((o) => ({ waypoint: toWaypoint(o) })),
      destinations: params.destinations.map((d) => ({ waypoint: toWaypoint(d) })),
      travelMode
    };
    if (travelMode === "DRIVE") {
      requestBody.routingPreference = "TRAFFIC_AWARE";
    }
    const routeModifiers = buildRouteModifiers(params, travelMode);
    if (routeModifiers) {
      requestBody.routeModifiers = routeModifiers;
    }
    if (params.departureTime) {
      requestBody.departureTime = params.departureTime.toISOString();
    }
    const response = await fetch(`${ROUTES_API_BASE}/distanceMatrix/v2:computeRouteMatrix`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": COMPUTE_ROUTE_MATRIX_FIELD_MASK
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = errorData?.error?.message || `HTTP ${response.status}`;
      throw new Error(msg);
    }
    const elements = await response.json();
    const rowCount = params.origins.length;
    const colCount = params.destinations.length;
    const distances = Array.from({ length: rowCount }, () => Array(colCount).fill(null));
    const durations = Array.from({ length: rowCount }, () => Array(colCount).fill(null));
    let routeNotFoundCount = 0;
    for (const element of elements) {
      const i = element.originIndex;
      const j = element.destinationIndex;
      if (i === void 0 || j === void 0) continue;
      if (element.condition === "ROUTE_NOT_FOUND") {
        routeNotFoundCount++;
        continue;
      }
      const distMeters = element.distanceMeters || 0;
      const durSeconds = parseDuration(element.duration);
      distances[i][j] = {
        value: distMeters,
        text: formatDistance(distMeters)
      };
      durations[i][j] = {
        value: durSeconds,
        text: formatDuration(durSeconds)
      };
    }
    const totalPairs = rowCount * colCount;
    if (routeNotFoundCount === totalPairs && travelMode === "TRANSIT") {
      throw new Error(
        `No transit routes found for any origin/destination pair. The Google Routes API does not support transit directions in some regions (notably Japan and India). Try using mode "driving" or "walking" instead, or use a regional transit service for public transportation details.`
      );
    }
    return {
      distances,
      durations,
      origin_addresses: params.origins,
      destination_addresses: params.destinations,
      ...routeNotFoundCount > 0 && travelMode === "TRANSIT" ? {
        warning: `${routeNotFoundCount} of ${totalPairs} origin/destination pairs returned no transit route. The Google Routes API has limited transit coverage in some regions.`
      } : {}
    };
  }
};

// src/services/toolclass.ts
function extractErrorMessage(error) {
  const statusCode = error?.response?.status;
  const apiError = error?.response?.data?.error_message;
  const apiStatus = error?.response?.data?.status;
  if (statusCode === 403) {
    return "API key invalid or required API not enabled. Check: console.cloud.google.com \u2192 APIs & Services \u2192 Enable the relevant API (Places, Geocoding, etc.)";
  }
  if (statusCode === 429) {
    return "API quota exceeded. Wait and retry, or check quota at console.cloud.google.com \u2192 Quotas";
  }
  if (apiStatus === "ZERO_RESULTS") {
    return "No results found. Try broader search terms or a larger radius.";
  }
  if (apiStatus === "OVER_QUERY_LIMIT") {
    return "API quota exceeded. Wait and retry, or upgrade your billing plan.";
  }
  if (apiStatus === "REQUEST_DENIED") {
    return `Request denied by Google Maps API. ${apiError || "Check your API key and enabled APIs."}`;
  }
  if (apiStatus === "INVALID_REQUEST") {
    return `Invalid request parameters. ${apiError || "Check your input values."}`;
  }
  if (apiError) {
    return `${apiError} (HTTP ${statusCode})`;
  }
  return error instanceof Error ? error.message : String(error);
}
var GoogleMapsTools = class {
  constructor(apiKey) {
    this.defaultLanguage = Language.en;
    this.client = new Client({});
    this.apiKey = apiKey || "";
    if (!this.apiKey) {
      throw new Error("Google Maps API Key is required");
    }
  }
  async geocodeAddress(address) {
    try {
      const response = await this.client.geocode({
        params: {
          address,
          key: this.apiKey,
          language: this.defaultLanguage
        }
      });
      if (response.data.results.length === 0) {
        throw new Error(`No location found for address: "${address}"`);
      }
      const result = response.data.results[0];
      const location = result.geometry.location;
      return {
        lat: location.lat,
        lng: location.lng,
        formatted_address: result.formatted_address,
        place_id: result.place_id
      };
    } catch (error) {
      Logger.error("Error in geocodeAddress:", error);
      throw new Error(`Failed to geocode address "${address}": ${extractErrorMessage(error)}`);
    }
  }
  parseCoordinates(coordString) {
    const coords = coordString.split(",").map((c) => parseFloat(c.trim()));
    if (coords.length !== 2 || isNaN(coords[0]) || isNaN(coords[1])) {
      throw new Error(
        `Invalid coordinate format: "${coordString}". Please use "latitude,longitude" format (e.g., "25.033,121.564"`
      );
    }
    return { lat: coords[0], lng: coords[1] };
  }
  async getLocation(center) {
    if (center.isCoordinates) {
      return this.parseCoordinates(center.value);
    }
    return this.geocodeAddress(center.value);
  }
  async geocode(address) {
    try {
      const result = await this.geocodeAddress(address);
      return {
        location: { lat: result.lat, lng: result.lng },
        formatted_address: result.formatted_address || "",
        place_id: result.place_id || ""
      };
    } catch (error) {
      Logger.error("Error in geocode:", error);
      throw new Error(`Failed to geocode address "${address}": ${extractErrorMessage(error)}`);
    }
  }
  async reverseGeocode(latitude, longitude) {
    try {
      const response = await this.client.reverseGeocode({
        params: {
          latlng: { lat: latitude, lng: longitude },
          language: this.defaultLanguage,
          key: this.apiKey
        }
      });
      if (response.data.results.length === 0) {
        throw new Error(`No address found for coordinates: (${latitude}, ${longitude})`);
      }
      const result = response.data.results[0];
      return {
        formatted_address: result.formatted_address,
        place_id: result.place_id,
        address_components: result.address_components
      };
    } catch (error) {
      Logger.error("Error in reverseGeocode:", error);
      throw new Error(
        `Failed to reverse geocode coordinates (${latitude}, ${longitude}): ${extractErrorMessage(error)}`
      );
    }
  }
  async searchAlongRoute(params) {
    try {
      const routesService = new RoutesService(this.apiKey);
      const directions = await routesService.computeRoutes({
        origin: params.origin,
        destination: params.destination,
        mode: params.mode || "walking"
      });
      const polyline = directions.routes[0]?.polyline?.encodedPolyline;
      if (!polyline) {
        throw new Error("Could not get route polyline");
      }
      const maxResults = Math.min(params.maxResults || 5, 20);
      const fieldMask = "places.displayName,places.id,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.currentOpeningHours.openNow";
      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": fieldMask
        },
        body: JSON.stringify({
          textQuery: params.textQuery,
          searchAlongRouteParameters: {
            polyline: {
              encodedPolyline: polyline
            }
          },
          maxResultCount: maxResults
        })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || `HTTP ${response.status}`);
      }
      const data = await response.json();
      const places = (data.places || []).map((place) => ({
        name: place.displayName?.text || "",
        place_id: place.id || "",
        formatted_address: place.formattedAddress || "",
        location: {
          lat: place.location?.latitude || 0,
          lng: place.location?.longitude || 0
        },
        rating: place.rating || 0,
        user_ratings_total: place.userRatingCount || 0,
        open_now: place.currentOpeningHours?.openNow ?? null
      }));
      return {
        places,
        route: {
          distance: directions.total_distance.text,
          duration: directions.total_duration.text,
          polyline
        }
      };
    } catch (error) {
      Logger.error("Error in searchAlongRoute:", error);
      throw new Error(error.message || "Failed to search along route");
    }
  }
  async getWeather(latitude, longitude, type = "current", forecastDays, forecastHours) {
    try {
      const baseParams = `key=${this.apiKey}&location.latitude=${latitude}&location.longitude=${longitude}`;
      let url;
      switch (type) {
        case "forecast_daily": {
          const days = Math.min(Math.max(forecastDays || 5, 1), 10);
          url = `https://weather.googleapis.com/v1/forecast/days:lookup?${baseParams}&days=${days}`;
          break;
        }
        case "forecast_hourly": {
          const hours = Math.min(Math.max(forecastHours || 24, 1), 240);
          url = `https://weather.googleapis.com/v1/forecast/hours:lookup?${baseParams}&hours=${hours}`;
          break;
        }
        default:
          url = `https://weather.googleapis.com/v1/currentConditions:lookup?${baseParams}`;
      }
      const response = await fetch(url);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const msg = errorData?.error?.message || `HTTP ${response.status}`;
        if (msg.includes("not supported for this location")) {
          throw new Error(
            `Weather data is not available for this location (${latitude}, ${longitude}). The Google Weather API has limited coverage \u2014 China, Japan, South Korea, Cuba, Iran, North Korea, and Syria are unsupported. Try a location in North America, Europe, or Oceania.`
          );
        }
        throw new Error(msg);
      }
      const data = await response.json();
      if (type === "current") {
        return {
          temperature: data.temperature,
          feelsLike: data.feelsLikeTemperature,
          humidity: data.relativeHumidity,
          wind: data.wind,
          conditions: data.weatherCondition?.description?.text || data.weatherCondition?.type,
          uvIndex: data.uvIndex,
          precipitation: data.precipitation,
          visibility: data.visibility,
          pressure: data.airPressure,
          cloudCover: data.cloudCover,
          isDayTime: data.isDaytime
        };
      }
      return data;
    } catch (error) {
      Logger.error("Error in getWeather:", error);
      throw new Error(error.message || `Failed to get weather for (${latitude}, ${longitude})`);
    }
  }
  async getAirQuality(latitude, longitude, includeHealthRecommendations = true, includePollutants = false) {
    try {
      const url = `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${this.apiKey}`;
      const extraComputations = [];
      if (includeHealthRecommendations) {
        extraComputations.push("HEALTH_RECOMMENDATIONS");
      }
      if (includePollutants) {
        extraComputations.push("POLLUTANT_CONCENTRATION");
      }
      const body = {
        location: { latitude, longitude }
      };
      if (extraComputations.length > 0) {
        body.extraComputations = extraComputations;
      }
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const msg = errorData?.error?.message || `HTTP ${response.status}`;
        throw new Error(msg);
      }
      const data = await response.json();
      const indexes = data.indexes || [];
      const primaryIndex = indexes[0];
      const result = {
        dateTime: data.dateTime,
        regionCode: data.regionCode,
        aqi: primaryIndex?.aqi,
        category: primaryIndex?.category,
        dominantPollutant: primaryIndex?.dominantPollutant,
        color: primaryIndex?.color
      };
      if (indexes.length > 1) {
        result.indexes = indexes.map((idx) => ({
          code: idx.code,
          displayName: idx.displayName,
          aqi: idx.aqi,
          category: idx.category,
          dominantPollutant: idx.dominantPollutant
        }));
      }
      if (data.healthRecommendations) {
        result.healthRecommendations = data.healthRecommendations;
      }
      if (data.pollutants) {
        result.pollutants = data.pollutants.map((p) => ({
          code: p.code,
          displayName: p.displayName,
          concentration: p.concentration,
          additionalInfo: p.additionalInfo
        }));
      }
      return result;
    } catch (error) {
      Logger.error("Error in getAirQuality:", error);
      throw new Error(error.message || `Failed to get air quality for (${latitude}, ${longitude})`);
    }
  }
  async getStaticMap(params) {
    try {
      const dimensions = params.size || "600x400";
      const queryParts = [
        `key=${this.apiKey}`,
        `size=${dimensions}`,
        `maptype=${params.maptype || "roadmap"}`
      ];
      if (params.center) {
        queryParts.push(`center=${encodeURIComponent(params.center)}`);
      }
      if (params.zoom !== void 0) {
        queryParts.push(`zoom=${params.zoom}`);
      }
      if (params.markers) {
        for (const marker of params.markers) {
          queryParts.push(`markers=${encodeURIComponent(marker)}`);
        }
      }
      if (params.path) {
        for (const p of params.path) {
          queryParts.push(`path=${encodeURIComponent(p)}`);
        }
      }
      const url = `https://maps.googleapis.com/maps/api/staticmap?${queryParts.join("&")}`;
      if (url.length > 16384) {
        throw new Error(`URL exceeds 16,384 character limit (${url.length}). Reduce markers or path points.`);
      }
      const response = await fetch(url);
      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json") || contentType.includes("text/")) {
          const errorText = await response.text();
          throw new Error(`Static Maps API error: ${errorText}`);
        }
        throw new Error(`Static Maps API returned HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString("base64");
      return {
        base64,
        size: buffer.length,
        dimensions
      };
    } catch (error) {
      Logger.error("Error in getStaticMap:", error);
      throw new Error(error.message || "Failed to generate static map");
    }
  }
  async getTimezone(latitude, longitude, timestamp) {
    try {
      const ts = timestamp ? Math.floor(timestamp / 1e3) : Math.floor(Date.now() / 1e3);
      const response = await this.client.timezone({
        params: {
          location: { lat: latitude, lng: longitude },
          timestamp: ts,
          key: this.apiKey
        }
      });
      const result = response.data;
      if (result.status !== "OK") {
        throw new Error(`Timezone API returned status: ${result.status}`);
      }
      const totalOffset = (result.rawOffset + result.dstOffset) * 1e3;
      const localTime = new Date(ts * 1e3 + totalOffset).toISOString().replace("Z", "");
      return {
        timeZoneId: result.timeZoneId,
        timeZoneName: result.timeZoneName,
        utcOffset: result.rawOffset,
        dstOffset: result.dstOffset,
        localTime
      };
    } catch (error) {
      Logger.error("Error in getTimezone:", error);
      throw new Error(`Failed to get timezone for (${latitude}, ${longitude}): ${extractErrorMessage(error)}`);
    }
  }
  async getElevation(locations) {
    try {
      const formattedLocations = locations.map((loc) => ({
        lat: loc.latitude,
        lng: loc.longitude
      }));
      const response = await this.client.elevation({
        params: {
          locations: formattedLocations,
          key: this.apiKey
        }
      });
      const result = response.data;
      if (result.status !== "OK") {
        throw new Error(`Failed to get elevation data with status: ${result.status}`);
      }
      return result.results.map((item, index) => ({
        elevation: item.elevation,
        location: formattedLocations[index]
      }));
    } catch (error) {
      Logger.error("Error in getElevation:", error);
      throw new Error(
        `Failed to get elevation data for ${locations.length} location(s): ${extractErrorMessage(error)}`
      );
    }
  }
};

// src/services/NewPlacesService.ts
import { PlacesClient } from "@googlemaps/places";
var NewPlacesService = class {
  constructor(apiKey) {
    this.defaultLanguage = "en";
    this.placeFieldMask = [
      "displayName",
      "name",
      "id",
      "formattedAddress",
      "location",
      "utcOffsetMinutes",
      "primaryType",
      "types",
      "regularOpeningHours.periods",
      "regularOpeningHours.weekdayDescriptions",
      "currentOpeningHours.openNow",
      "currentOpeningHours.periods",
      "currentOpeningHours.weekdayDescriptions",
      "nationalPhoneNumber",
      "websiteUri",
      "priceLevel",
      "rating",
      "userRatingCount",
      "editorialSummary",
      "reviews.rating",
      "reviews.text",
      "reviews.publishTime",
      "reviews.authorAttribution.displayName",
      "reviews.authorAttribution.uri",
      "reviews.authorAttribution.photoUri",
      "reviews.googleMapsUri",
      "reviews.flagContentUri",
      "reviews.relativePublishTimeDescription",
      "photos.heightPx",
      "photos.widthPx",
      "photos.name",
      "photos.authorAttributions",
      "photos.googleMapsUri",
      "photos.flagContentUri",
      "googleMapsUri",
      // Parking & Accessibility
      "parkingOptions",
      "accessibilityOptions",
      // Food & Drink
      "servesVegetarianFood",
      "servesBeer",
      "servesWine",
      "servesCocktails",
      "servesBreakfast",
      "servesLunch",
      "servesDinner",
      "servesBrunch",
      "servesCoffee",
      "servesDessert",
      // Dining options
      "dineIn",
      "delivery",
      "takeout",
      "curbsidePickup",
      "reservable",
      // Pricing (Money structure preserved as returned by the API)
      "priceRange",
      "businessStatus",
      // Atmosphere
      "goodForGroups",
      "goodForChildren",
      "goodForWatchingSports",
      "liveMusic",
      "outdoorSeating",
      "allowsDogs",
      "menuForChildren",
      "restroom",
      // Payment
      "paymentOptions",
      // AI Summaries (region-limited)
      "reviewSummary",
      "generativeSummary"
    ].join(",");
    this.searchNearbyFieldMask = [
      "places.displayName",
      "places.name",
      "places.id",
      "places.formattedAddress",
      "places.location",
      "places.rating",
      "places.userRatingCount",
      "places.currentOpeningHours.openNow",
      "places.primaryType",
      "places.priceLevel",
      "places.types",
      "places.businessStatus",
      "places.googleMapsUri",
      "places.priceRange"
    ].join(",");
    /**
     * FieldMask for Text Search (New). Includes every field required for
     * budget/quality/category/opening-hours validation (price levels, price range
     * with the original Money structure, types, business status, regular and
     * current opening hours) plus nextPageToken for pagination.
     */
    this.searchTextFieldMask = [
      "places.id",
      "places.displayName",
      "places.formattedAddress",
      "places.location",
      "places.primaryType",
      "places.types",
      "places.businessStatus",
      "places.googleMapsUri",
      "places.priceLevel",
      "places.priceRange",
      "places.rating",
      "places.userRatingCount",
      "places.regularOpeningHours.periods",
      "places.regularOpeningHours.weekdayDescriptions",
      "places.currentOpeningHours.openNow",
      "places.currentOpeningHours.periods",
      "places.currentOpeningHours.weekdayDescriptions",
      "nextPageToken"
    ].join(",");
    this.apiKey = apiKey || "";
    this.client = new PlacesClient({ apiKey: this.apiKey });
    if (!this.apiKey) {
      throw new Error("Google Maps API Key is required");
    }
  }
  async searchNearby(params) {
    try {
      const request = {
        locationRestriction: {
          circle: {
            center: {
              latitude: params.location.lat,
              longitude: params.location.lng
            },
            radius: params.radius || 1e3
          }
        },
        maxResultCount: Math.min(params.maxResultCount || 20, 20),
        languageCode: this.defaultLanguage
      };
      if (params.keyword) {
        request.includedTypes = [params.keyword];
      }
      const [response] = await this.client.searchNearby(request, {
        otherArgs: {
          headers: {
            "X-Goog-FieldMask": this.searchNearbyFieldMask
          }
        }
      });
      return (response.places || []).map((place) => this.transformSearchResult(place));
    } catch (error) {
      Logger.error("Error in searchNearby (New API):", error);
      throw new Error(`Failed to search nearby places: ${this.extractErrorMessage(error)}`);
    }
  }
  /**
   * Backward-compatible Text Search (New) returning only the transformed
   * places array.
   */
  async searchText(params) {
    const result = await this.searchTextFull(params);
    return result.places;
  }
  /**
   * Text Search (New) with the full eatspot-discovery filter surface (REQ-027, REQ-109):
   * - priceLevels: cumulative server-side economic filter (enum strings)
   * - strictTypeFiltering: strict place-type filtering
   * - minRating, includedType, openNow: server-side filters
   * - locationBias, pageSize/pageToken: geographic bias and pagination
   * - includeRaw: attaches the original API payload (raw_place per result and
   *   the full raw_response) so callers can validate against real data.
   */
  async searchTextFull(params) {
    try {
      const request = {
        textQuery: params.textQuery,
        languageCode: params.languageCode || this.defaultLanguage
      };
      const requestedCount = params.pageSize ?? params.maxResultCount ?? 10;
      request.maxResultCount = Math.min(Math.max(1, Math.round(requestedCount)), 20);
      if (params.pageToken) {
        request.pageToken = params.pageToken;
      }
      if (params.locationBias) {
        request.locationBias = {
          circle: {
            center: {
              latitude: params.locationBias.lat,
              longitude: params.locationBias.lng
            },
            radius: params.locationBias.radius || 5e3
          }
        };
      }
      if (params.openNow) {
        request.openNow = true;
      }
      if (params.minRating != null) {
        request.minRating = params.minRating;
      }
      if (params.includedType) {
        request.includedType = params.includedType;
      }
      if (params.strictTypeFiltering != null) {
        request.strictTypeFiltering = params.strictTypeFiltering;
      }
      if (params.priceLevels?.length) {
        request.priceLevels = params.priceLevels;
      }
      if (params.pageToken) {
        request.pageToken = params.pageToken;
      }
      const [response] = await this.client.searchText(request, {
        otherArgs: {
          headers: {
            "X-Goog-FieldMask": this.searchTextFieldMask
          }
        }
      });
      const places = (response.places || []).map((place) => {
        const transformed = this.transformSearchResult(place);
        return params.includeRaw ? { ...transformed, raw_place: place } : transformed;
      });
      const paginated = response;
      return {
        places,
        ...paginated.nextPageToken ? { nextPageToken: paginated.nextPageToken } : {},
        fieldMask: this.searchTextFieldMask,
        ...params.includeRaw ? { raw: response } : {}
      };
    } catch (error) {
      Logger.error("Error in searchText (New API):", error);
      throw new Error(`Failed to search places: ${this.extractErrorMessage(error)}`);
    }
  }
  async getPhotoUri(photoName, maxWidthPx = 800) {
    try {
      const [response] = await this.client.getPhotoMedia({
        name: `${photoName}/media`,
        maxWidthPx,
        skipHttpRedirect: true
      });
      return response.photoUri || "";
    } catch (error) {
      Logger.error("Error in getPhotoUri:", error);
      throw new Error(`Failed to get photo URI: ${this.extractErrorMessage(error)}`);
    }
  }
  async getPlaceDetails(placeId, includeRaw = false) {
    try {
      const placeName = `places/${placeId}`;
      const [place] = await this.client.getPlace(
        {
          name: placeName,
          languageCode: this.defaultLanguage
        },
        {
          otherArgs: {
            headers: {
              "X-Goog-FieldMask": this.placeFieldMask
            }
          }
        }
      );
      const transformed = this.transformPlaceResponse(place);
      return includeRaw ? { ...transformed, raw_place: place, field_mask: this.placeFieldMask } : transformed;
    } catch (error) {
      Logger.error("Error in getPlaceDetails (New API):", error);
      throw new Error(`Failed to get place details for ${placeId}: ${this.extractErrorMessage(error)}`);
    }
  }
  transformSearchResult(place) {
    return {
      name: place.displayName?.text || "",
      place_id: this.extractLegacyPlaceId(place),
      formatted_address: place.formattedAddress || "",
      geometry: {
        location: {
          lat: place.location?.latitude || 0,
          lng: place.location?.longitude || 0
        }
      },
      primary_type: place.primaryType || null,
      types: place.types || [],
      business_status: place.businessStatus || null,
      google_maps_uri: place.googleMapsUri || null,
      price_level: place.priceLevel || null,
      // Raw Money object preserved exactly as returned by the API
      // ({ startPrice/endPrice: { currencyCode, units, nanos } })
      price_range: place.priceRange || null,
      rating: place.rating || 0,
      user_ratings_total: place.userRatingCount || 0,
      opening_hours: {
        open_now: place.currentOpeningHours?.openNow ?? null
      },
      regular_opening_hours: place.regularOpeningHours || null,
      current_opening_hours: place.currentOpeningHours || null
    };
  }
  transformPlaceResponse(place) {
    const parking = place.parkingOptions ? Object.fromEntries(Object.entries(place.parkingOptions).filter(([, v]) => v === true)) : void 0;
    const accessibility = place.accessibilityOptions ? Object.fromEntries(Object.entries(place.accessibilityOptions).filter(([, v]) => v === true)) : void 0;
    const diningOptions = {};
    if (place.dineIn) diningOptions.dine_in = true;
    if (place.delivery) diningOptions.delivery = true;
    if (place.takeout) diningOptions.takeout = true;
    if (place.curbsidePickup) diningOptions.curbside_pickup = true;
    if (place.reservable) diningOptions.reservable = true;
    const serves = {};
    if (place.servesVegetarianFood) serves.vegetarian_food = true;
    if (place.servesBeer) serves.beer = true;
    if (place.servesWine) serves.wine = true;
    if (place.servesCocktails) serves.cocktails = true;
    if (place.servesBreakfast) serves.breakfast = true;
    if (place.servesLunch) serves.lunch = true;
    if (place.servesDinner) serves.dinner = true;
    if (place.servesBrunch) serves.brunch = true;
    if (place.servesCoffee) serves.coffee = true;
    if (place.servesDessert) serves.dessert = true;
    const atmosphere = {};
    if (place.goodForGroups) atmosphere.good_for_groups = true;
    if (place.goodForChildren) atmosphere.good_for_children = true;
    if (place.goodForWatchingSports) atmosphere.good_for_watching_sports = true;
    if (place.liveMusic) atmosphere.live_music = true;
    if (place.outdoorSeating) atmosphere.outdoor_seating = true;
    if (place.allowsDogs) atmosphere.allows_dogs = true;
    if (place.menuForChildren) atmosphere.menu_for_children = true;
    if (place.restroom) atmosphere.restroom = true;
    return {
      name: place.displayName?.text || place.name || "",
      place_id: this.extractLegacyPlaceId(place),
      formatted_address: place.formattedAddress || "",
      google_maps_uri: place.googleMapsUri || "",
      geometry: {
        location: {
          lat: place.location?.latitude || 0,
          lng: place.location?.longitude || 0
        }
      },
      primary_type: place.primaryType || null,
      types: place.types || [],
      business_status: place.businessStatus || null,
      rating: place.rating || 0,
      user_ratings_total: place.userRatingCount || 0,
      // Raw Money object preserved exactly as returned by the API
      // ({ startPrice/endPrice: { currencyCode, units, nanos } })
      price_range: place.priceRange || null,
      opening_hours: place.regularOpeningHours ? {
        open_now: this.isCurrentlyOpen(
          place.regularOpeningHours,
          place.utcOffsetMinutes,
          place.currentOpeningHours
        ),
        weekday_text: this.formatOpeningHours(place.regularOpeningHours)
      } : void 0,
      current_opening_hours: place.currentOpeningHours || null,
      formatted_phone_number: place.nationalPhoneNumber || "",
      website: place.websiteUri || "",
      price_level: place.priceLevel || 0,
      editorial_summary: place.editorialSummary?.text || null,
      ...Object.keys(parking || {}).length > 0 ? { parking } : {},
      ...Object.keys(accessibility || {}).length > 0 ? { accessibility } : {},
      ...Object.keys(diningOptions).length > 0 ? { dining_options: diningOptions } : {},
      ...Object.keys(serves).length > 0 ? { serves } : {},
      ...Object.keys(atmosphere).length > 0 ? { atmosphere } : {},
      ...place.paymentOptions ? {
        payment_options: Object.fromEntries(
          Object.entries(place.paymentOptions).filter(([k]) => !k.startsWith("_"))
        )
      } : {},
      ...place.reviewSummary?.text?.text ? {
        review_summary: place.reviewSummary.text.text,
        review_summary_attribution: {
          disclosure_text: place.reviewSummary.disclosureText?.text || "",
          flag_content_uri: place.reviewSummary.flagContentUri || "",
          reviews_uri: place.reviewSummary.reviewsUri || ""
        }
      } : {},
      ...place.generativeSummary?.overview?.text ? {
        generative_summary: place.generativeSummary.overview.text,
        generative_summary_attribution: {
          disclosure_text: place.generativeSummary.disclosureText?.text || "",
          flag_content_uri: place.generativeSummary.flagContentUri || ""
        }
      } : {},
      reviews: place.reviews?.map((review) => ({
        rating: review.rating || 0,
        text: review.text?.text || "",
        language: review.text?.languageCode || null,
        time: review.publishTime?.seconds || 0,
        author_name: review.authorAttribution?.displayName || "",
        author_uri: review.authorAttribution?.uri || "",
        author_photo_uri: review.authorAttribution?.photoUri || "",
        google_maps_uri: review.googleMapsUri || "",
        flag_content_uri: review.flagContentUri || "",
        relative_publish_time_description: review.relativePublishTimeDescription || ""
      })) || [],
      photos: place.photos?.map((photo) => ({
        photo_reference: photo.name || "",
        height: photo.heightPx || 0,
        width: photo.widthPx || 0,
        google_maps_uri: photo.googleMapsUri || "",
        flag_content_uri: photo.flagContentUri || "",
        author_attributions: photo.authorAttributions?.map((author) => ({
          display_name: author.displayName || "",
          uri: author.uri || "",
          photo_uri: author.photoUri || ""
        })) || []
      })) || []
    };
  }
  extractLegacyPlaceId(place) {
    const resourceName = place?.name;
    if (typeof resourceName === "string" && resourceName.startsWith("places/")) {
      const legacyId = resourceName.substring("places/".length);
      if (legacyId) {
        return legacyId;
      }
    }
    return place?.id || "";
  }
  isCurrentlyOpen(openingHours, utcOffsetMinutes, currentOpeningHours) {
    if (typeof currentOpeningHours?.openNow === "boolean") {
      return currentOpeningHours.openNow;
    }
    if (typeof openingHours?.openNow === "boolean") {
      return openingHours.openNow;
    }
    const periods = openingHours?.periods;
    if (!Array.isArray(periods) || periods.length === 0) {
      return false;
    }
    const minutesInDay = 24 * 60;
    const minutesInWeek = minutesInDay * 7;
    const { day: localDay, minutes: localMinutes } = this.getLocalTimeComponents(utcOffsetMinutes);
    const localTimeValue = localDay * minutesInDay + localMinutes;
    const dayMapping = {
      SUNDAY: 0,
      MONDAY: 1,
      TUESDAY: 2,
      WEDNESDAY: 3,
      THURSDAY: 4,
      FRIDAY: 5,
      SATURDAY: 6
    };
    const toDayNumber = (value) => {
      if (typeof value === "number" && value >= 0 && value <= 6) {
        return value;
      }
      if (typeof value === "string") {
        const normalized = value.toUpperCase();
        if (normalized in dayMapping) {
          return dayMapping[normalized];
        }
      }
      return void 0;
    };
    const toMinutes = (time) => {
      if (!time) {
        return void 0;
      }
      const hours = typeof time.hours === "number" ? time.hours : Number(time.hours ?? NaN);
      const minutes = typeof time.minutes === "number" ? time.minutes : Number(time.minutes ?? NaN);
      if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
        return void 0;
      }
      return hours * 60 + minutes;
    };
    for (const period of periods) {
      const openDay = toDayNumber(period?.openDay);
      const closeDay = toDayNumber(period?.closeDay ?? period?.openDay);
      const openMinutes = toMinutes(period?.openTime);
      const closeMinutes = toMinutes(period?.closeTime);
      if (openDay === void 0 || openMinutes === void 0) {
        continue;
      }
      const start = openDay * minutesInDay + openMinutes;
      let end;
      if (closeDay === void 0 || closeMinutes === void 0) {
        end = start + minutesInDay;
      } else {
        end = closeDay * minutesInDay + closeMinutes;
      }
      if (end <= start) {
        end += minutesInWeek;
      }
      let comparableLocalTime = localTimeValue;
      while (comparableLocalTime < start) {
        comparableLocalTime += minutesInWeek;
      }
      if (comparableLocalTime >= start && comparableLocalTime < end) {
        return true;
      }
    }
    return false;
  }
  getLocalTimeComponents(utcOffsetMinutes) {
    const now = /* @__PURE__ */ new Date();
    if (typeof utcOffsetMinutes === "number" && Number.isFinite(utcOffsetMinutes)) {
      const localTime = new Date(now.getTime() + utcOffsetMinutes * 6e4);
      return {
        day: localTime.getUTCDay(),
        minutes: localTime.getUTCHours() * 60 + localTime.getUTCMinutes()
      };
    }
    return {
      day: now.getDay(),
      minutes: now.getHours() * 60 + now.getMinutes()
    };
  }
  formatOpeningHours(openingHours) {
    return openingHours?.weekdayDescriptions || [];
  }
  extractErrorMessage(error) {
    const statusCode = error?.code;
    const message = error?.message || error?.details;
    if (statusCode === 7 || statusCode === 403) {
      return "API key invalid or Places API (New) not enabled. Check: console.cloud.google.com \u2192 APIs & Services \u2192 Enable 'Places API (New)'";
    }
    if (statusCode === 8 || statusCode === 429) {
      return "API quota exceeded. Wait and retry, or check quota at console.cloud.google.com \u2192 Quotas";
    }
    return message || (error instanceof Error ? error.message : String(error));
  }
};

// src/services/PlacesSearcher.ts
function parseCoordinateInput(input) {
  const match = input.match(COORDINATE_STRING_PATTERN);
  if (!match) {
    return null;
  }
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}
function toRouteWaypoint(loc) {
  if (loc.placeId) {
    return { placeId: loc.placeId };
  }
  return { latLng: { latitude: loc.lat, longitude: loc.lng } };
}
var PlacesSearcher = class {
  constructor(apiKey) {
    this.mapsTools = new GoogleMapsTools(apiKey);
    this.newPlacesService = new NewPlacesService(apiKey);
    this.routesService = new RoutesService(apiKey);
  }
  async searchNearby(params) {
    try {
      const location = await this.mapsTools.getLocation(params.center);
      const places = await this.newPlacesService.searchNearby({
        location,
        keyword: params.keyword,
        radius: params.radius
      });
      let filteredPlaces = places;
      if (params.openNow) {
        filteredPlaces = filteredPlaces.filter((p) => p.opening_hours?.open_now === true);
      }
      if (params.minRating) {
        filteredPlaces = filteredPlaces.filter((p) => (p.rating || 0) >= (params.minRating || 0));
      }
      return {
        location,
        success: true,
        data: filteredPlaces.map((place) => ({
          name: place.name,
          place_id: place.place_id,
          address: place.formatted_address,
          location: place.geometry.location,
          primary_type: place.primary_type || null,
          price_level: place.price_level || null,
          rating: place.rating,
          total_ratings: place.user_ratings_total,
          open_now: place.opening_hours?.open_now
        }))
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred during search"
      };
    }
  }
  async searchText(params) {
    try {
      const result = await this.newPlacesService.searchTextFull({
        textQuery: params.query,
        locationBias: params.locationBias ? {
          lat: params.locationBias.latitude,
          lng: params.locationBias.longitude,
          radius: params.locationBias.radius
        } : void 0,
        openNow: params.openNow,
        minRating: params.minRating,
        includedType: params.includedType,
        strictTypeFiltering: params.strictTypeFiltering,
        priceLevels: params.priceLevels,
        pageSize: params.pageSize,
        pageToken: params.pageToken,
        languageCode: params.languageCode,
        includeRaw: params.includeRaw
      });
      return {
        success: true,
        data: result.places.map((place) => ({
          name: place.name,
          place_id: place.place_id,
          address: place.formatted_address,
          location: place.geometry.location,
          primary_type: place.primary_type || null,
          types: place.types || [],
          business_status: place.business_status || null,
          google_maps_uri: place.google_maps_uri || null,
          price_level: place.price_level || null,
          price_range: place.price_range || null,
          rating: place.rating,
          total_ratings: place.user_ratings_total,
          open_now: place.opening_hours?.open_now,
          regular_opening_hours: place.regular_opening_hours || null,
          current_opening_hours: place.current_opening_hours || null,
          ...place.raw_place ? { raw_place: place.raw_place } : {}
        })),
        ...result.nextPageToken ? { nextPageToken: result.nextPageToken } : {},
        fieldMask: result.fieldMask,
        ...params.includeRaw && result.raw ? { raw_response: result.raw } : {}
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred during text search"
      };
    }
  }
  async getPlaceDetails(placeId, maxPhotos = 0, includeRaw = false) {
    try {
      const details = await this.newPlacesService.getPlaceDetails(placeId, includeRaw);
      let photos;
      if (maxPhotos > 0 && details.photos?.length > 0) {
        const photosToFetch = details.photos.slice(0, maxPhotos);
        photos = [];
        for (const photo of photosToFetch) {
          try {
            const url = await this.newPlacesService.getPhotoUri(photo.photo_reference);
            photos.push({
              url,
              width: photo.width,
              height: photo.height,
              google_maps_uri: photo.google_maps_uri,
              flag_content_uri: photo.flag_content_uri,
              author_attributions: photo.author_attributions
            });
          } catch {
          }
        }
      }
      return {
        success: true,
        ...details.field_mask ? { fieldMask: details.field_mask } : {},
        data: {
          name: details.name,
          address: details.formatted_address,
          google_maps_uri: details.google_maps_uri,
          location: details.geometry?.location,
          primary_type: details.primary_type || null,
          types: details.types || [],
          business_status: details.business_status || null,
          rating: details.rating,
          total_ratings: details.user_ratings_total,
          // Raw Money object (startPrice/endPrice: currencyCode/units/nanos)
          price_range: details.price_range || null,
          current_opening_hours: details.current_opening_hours || null,
          opening_hours: details.opening_hours,
          phone: details.formatted_phone_number,
          website: details.website,
          price_level: details.price_level,
          editorial_summary: details.editorial_summary || null,
          ...details.parking ? { parking: details.parking } : {},
          ...details.accessibility ? { accessibility: details.accessibility } : {},
          ...details.dining_options ? { dining_options: details.dining_options } : {},
          ...details.serves ? { serves: details.serves } : {},
          ...details.atmosphere ? { atmosphere: details.atmosphere } : {},
          ...details.payment_options ? { payment_options: details.payment_options } : {},
          ...details.review_summary ? { review_summary: details.review_summary } : {},
          ...details.review_summary_attribution ? { review_summary_attribution: details.review_summary_attribution } : {},
          ...details.generative_summary ? { generative_summary: details.generative_summary } : {},
          ...details.generative_summary_attribution ? { generative_summary_attribution: details.generative_summary_attribution } : {},
          photo_count: details.photos?.length || 0,
          ...photos && photos.length > 0 ? { photos } : {},
          ...details.raw_place ? { raw_place: details.raw_place } : {},
          reviews: details.reviews?.map((review) => ({
            rating: review.rating,
            text: review.text,
            language: review.language || null,
            time: review.time,
            author_name: review.author_name,
            author_uri: review.author_uri,
            author_photo_uri: review.author_photo_uri,
            google_maps_uri: review.google_maps_uri,
            flag_content_uri: review.flag_content_uri,
            relative_publish_time_description: review.relative_publish_time_description
          }))
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while getting place details"
      };
    }
  }
  async geocode(address) {
    try {
      const result = await this.mapsTools.geocode(address);
      return {
        success: true,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while geocoding address"
      };
    }
  }
  async reverseGeocode(latitude, longitude) {
    try {
      const result = await this.mapsTools.reverseGeocode(latitude, longitude);
      return {
        success: true,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred during reverse geocoding"
      };
    }
  }
  async calculateDistanceMatrix(origins, destinations, mode = "driving", departure_time, avoid_tolls, avoid_highways) {
    try {
      const result = await this.routesService.computeRouteMatrix({
        origins,
        destinations,
        mode,
        ...departure_time ? { departureTime: new Date(departure_time) } : {},
        ...avoid_tolls !== void 0 ? { avoidTolls: avoid_tolls } : {},
        ...avoid_highways !== void 0 ? { avoidHighways: avoid_highways } : {}
      });
      return {
        success: true,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while calculating distance matrix"
      };
    }
  }
  async getDirections(origin, destination, mode = "driving", departure_time, arrival_time, avoid_tolls, avoid_highways) {
    try {
      const departureTime = departure_time ? new Date(departure_time) : void 0;
      const arrivalTime = arrival_time ? new Date(arrival_time) : void 0;
      const result = await this.routesService.computeRoutes({
        origin,
        destination,
        mode,
        ...departureTime ? { departureTime } : {},
        ...arrivalTime ? { arrivalTime } : {},
        ...avoid_tolls !== void 0 ? { avoidTolls: avoid_tolls } : {},
        ...avoid_highways !== void 0 ? { avoidHighways: avoid_highways } : {}
      });
      return {
        success: true,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while getting directions"
      };
    }
  }
  async getTimezone(latitude, longitude, timestamp) {
    try {
      const result = await this.mapsTools.getTimezone(latitude, longitude, timestamp);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while getting timezone"
      };
    }
  }
  async getWeather(latitude, longitude, type = "current", forecastDays, forecastHours) {
    try {
      const result = await this.mapsTools.getWeather(latitude, longitude, type, forecastDays, forecastHours);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while getting weather"
      };
    }
  }
  async getAirQuality(latitude, longitude, includeHealthRecommendations, includePollutants) {
    try {
      const result = await this.mapsTools.getAirQuality(
        latitude,
        longitude,
        includeHealthRecommendations,
        includePollutants
      );
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while getting air quality"
      };
    }
  }
  async getStaticMap(params) {
    try {
      const result = await this.mapsTools.getStaticMap(params);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while generating static map"
      };
    }
  }
  async searchAlongRoute(params) {
    try {
      const result = await this.mapsTools.searchAlongRoute(params);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while searching along route"
      };
    }
  }
  // --------------- Composite Tools ---------------
  /**
   * Resolve a location string to one concrete place, exactly once: geocoding
   * first, then Places Text Search for informal names it does not index.
   *
   * Throws rather than returning { success: false } — the plan_route and
   * explore_area actions JSON.stringify(result.data) without checking the flag,
   * so a failure object would surface as an empty success.
   */
  async resolveLocation(input) {
    if (COORDINATE_STRING_PATTERN.test(input)) {
      const coordinates = parseCoordinateInput(input);
      if (!coordinates) {
        throw new Error(`Failed to resolve location: ${input} (not a valid "latitude,longitude" pair)`);
      }
      const displayGeocode = await this.geocode(input);
      return {
        originalName: input,
        address: displayGeocode.success && displayGeocode.data ? displayGeocode.data.formatted_address : input,
        lat: coordinates.lat,
        lng: coordinates.lng,
        placeId: ""
      };
    }
    const geo = await this.geocode(input);
    if (geo.success && geo.data) {
      return {
        originalName: input,
        address: geo.data.formatted_address,
        lat: geo.data.location.lat,
        lng: geo.data.location.lng,
        placeId: geo.data.place_id
      };
    }
    const textSearch = await this.searchText({ query: input });
    if (textSearch.success && textSearch.data && textSearch.data.length > 0) {
      const topMatch = textSearch.data[0];
      return {
        originalName: input,
        address: topMatch.address || topMatch.name,
        lat: topMatch.location.lat,
        lng: topMatch.location.lng,
        placeId: topMatch.place_id || ""
      };
    }
    throw new Error(
      `Failed to resolve location: ${input} (geocoding: ${geo.error || "no result"}; places text search: ${textSearch.error || "no result"})`
    );
  }
  async exploreArea(params) {
    const types = params.types || ["restaurant", "cafe", "tourist_attraction"];
    const radius = params.radius || 1e3;
    const topN = params.topN || 3;
    const resolved = await this.resolveLocation(params.location);
    const { lat, lng } = resolved;
    const categories = [];
    for (const type of types) {
      const search = await this.searchNearby({
        center: { value: `${lat},${lng}`, isCoordinates: true },
        keyword: type,
        radius
      });
      if (!search.success || !search.data) continue;
      const topPlaces = search.data.slice(0, topN);
      const detailed = [];
      for (const place of topPlaces) {
        if (!place.place_id) continue;
        const details = await this.getPlaceDetails(place.place_id);
        detailed.push({
          name: place.name,
          address: place.address,
          rating: place.rating,
          total_ratings: place.total_ratings,
          open_now: place.open_now,
          phone: details.data?.phone,
          website: details.data?.website
        });
      }
      categories.push({ type, count: search.data.length, top: detailed });
    }
    return {
      success: true,
      data: {
        location: { address: resolved.address, lat, lng },
        radius,
        categories
      }
    };
  }
  async planRoute(params) {
    const mode = params.mode || "driving";
    const stops = params.stops;
    if (stops.length < 2) throw new Error("Need at least 2 stops");
    const resolvedStops = [];
    for (const stop of stops) {
      resolvedStops.push(await this.resolveLocation(stop));
    }
    const origin = toRouteWaypoint(resolvedStops[0]);
    const destination = toRouteWaypoint(resolvedStops[resolvedStops.length - 1]);
    const intermediates = stops.length > 2 ? resolvedStops.slice(1, -1).map((s) => toRouteWaypoint(s)) : void 0;
    const shouldOptimize = params.optimize !== false && stops.length > 3 && mode !== "transit";
    const routeResult = await this.routesService.computeRoutes({
      origin,
      destination,
      mode,
      intermediates,
      optimizeWaypointOrder: shouldOptimize,
      originLabel: stops[0],
      destinationLabel: stops[stops.length - 1],
      ...params.departure_time ? { departureTime: new Date(params.departure_time) } : {},
      ...params.avoid_tolls !== void 0 ? { avoidTolls: params.avoid_tolls } : {},
      ...params.avoid_highways !== void 0 ? { avoidHighways: params.avoid_highways } : {}
    });
    const route = routeResult.routes[0];
    const routeLegs = route?.legs || [];
    let orderedStops;
    if (shouldOptimize && routeResult.optimizedIntermediateWaypointIndex) {
      const optimizedOrder = routeResult.optimizedIntermediateWaypointIndex;
      const intermediateResolved = resolvedStops.slice(1, -1);
      orderedStops = [
        resolvedStops[0],
        ...optimizedOrder.map((i) => intermediateResolved[i]),
        resolvedStops[resolvedStops.length - 1]
      ];
    } else {
      orderedStops = resolvedStops;
    }
    const legs = [];
    let totalDistance = 0;
    let totalDuration = 0;
    for (let i = 0; i < orderedStops.length - 1; i++) {
      const leg = routeLegs[i];
      if (leg) {
        const distMeters = leg.distanceMeters || 0;
        const durSeconds = parseDuration(leg.duration);
        totalDistance += distMeters;
        totalDuration += durSeconds;
        legs.push({
          from: orderedStops[i].originalName,
          to: orderedStops[i + 1].originalName,
          distance: formatDistance(distMeters),
          duration: formatDuration(durSeconds)
        });
      } else {
        legs.push({
          from: orderedStops[i].originalName,
          to: orderedStops[i + 1].originalName,
          distance: "unknown",
          duration: "unknown",
          note: "Directions unavailable for this segment"
        });
      }
    }
    return {
      success: true,
      data: {
        mode,
        optimized: shouldOptimize,
        stops: orderedStops.map((s) => `${s.originalName} (${s.address})`),
        legs,
        total_distance: `${(totalDistance / 1e3).toFixed(1)} km`,
        total_duration: `${Math.round(totalDuration / 60)} min`
      }
    };
  }
  async comparePlaces(params) {
    const limit = params.limit || 5;
    const search = await this.searchText({ query: params.query });
    if (!search.success || !search.data) throw new Error(search.error || "Search failed");
    const places = search.data.slice(0, limit);
    const compared = [];
    for (const place of places) {
      const details = await this.getPlaceDetails(place.place_id);
      compared.push({
        name: place.name,
        address: place.address,
        primary_type: details.data?.primary_type || place.primary_type || null,
        rating: place.rating,
        total_ratings: place.total_ratings,
        opening_hours: details.data?.opening_hours,
        phone: details.data?.phone,
        website: details.data?.website,
        price_level: details.data?.price_level,
        ...details.data?.parking ? { parking: details.data.parking } : {},
        ...details.data?.serves ? { serves: details.data.serves } : {},
        ...details.data?.atmosphere ? { atmosphere: details.data.atmosphere } : {},
        ...details.data?.dining_options ? { dining_options: details.data.dining_options } : {}
      });
    }
    if (params.userLocation && compared.length > 0) {
      const origin = `${params.userLocation.latitude},${params.userLocation.longitude}`;
      const destinations = places.map((p) => `${p.location.lat},${p.location.lng}`);
      const matrix = await this.calculateDistanceMatrix([origin], destinations, "driving");
      if (matrix.success && matrix.data) {
        for (let i = 0; i < compared.length; i++) {
          compared[i].distance = matrix.data.distances[0]?.[i]?.text;
          compared[i].drive_time = matrix.data.durations[0]?.[i]?.text;
        }
      }
    }
    return { success: true, data: compared };
  }
  async getElevation(locations) {
    try {
      const result = await this.mapsTools.getElevation(locations);
      return {
        success: true,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while getting elevation data"
      };
    }
  }
  async localRankTracker(params) {
    try {
      const gridSize = params.gridSize || 3;
      const spacingMeters = params.gridSpacing || 1e3;
      const { latitude: centerLat, longitude: centerLng } = params.center;
      const half = Math.floor(gridSize / 2);
      const metersPerDegreeLat = 111320;
      const metersPerDegreeLng = 111320 * Math.cos(centerLat * Math.PI / 180);
      const gridPoints = [];
      for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
          const rowOffset = (row - half) * spacingMeters;
          const colOffset = (col - half) * spacingMeters;
          gridPoints.push({
            row,
            col,
            lat: centerLat + rowOffset / metersPerDegreeLat,
            lng: centerLng + colOffset / metersPerDegreeLng
          });
        }
      }
      let targetName = "";
      try {
        const details = await this.getPlaceDetails(params.placeId);
        if (details.success && details.data) {
          targetName = details.data.name;
        }
      } catch {
      }
      const keywordResults = [];
      for (const keyword of params.keywords) {
        const gridResults = await this.scanKeywordGrid(keyword, params.placeId, gridPoints, spacingMeters);
        keywordResults.push({ keyword, ...gridResults });
      }
      if (keywordResults.length === 1) {
        const kr = keywordResults[0];
        return {
          success: true,
          data: {
            target: { name: targetName, place_id: params.placeId },
            grid_size: `${gridSize}x${gridSize}`,
            grid_spacing_m: spacingMeters,
            keyword: kr.keyword,
            metrics: kr.metrics,
            grid: kr.grid
          }
        };
      }
      return {
        success: true,
        data: {
          target: { name: targetName, place_id: params.placeId },
          grid_size: `${gridSize}x${gridSize}`,
          grid_spacing_m: spacingMeters,
          keywords: keywordResults.map((kr) => ({
            keyword: kr.keyword,
            metrics: kr.metrics,
            grid: kr.grid
          }))
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred during local rank tracking"
      };
    }
  }
  async scanKeywordGrid(keyword, placeId, gridPoints, spacingMeters) {
    const concurrency = 5;
    const gridResults = [];
    const searchOne = async (point) => {
      try {
        const places = await this.newPlacesService.searchText({
          textQuery: keyword,
          locationBias: { lat: point.lat, lng: point.lng, radius: spacingMeters / 2 },
          maxResultCount: 20
        });
        const rank = places.findIndex((p) => p.place_id === placeId);
        const top3 = places.slice(0, 3).map((p) => p.name || "");
        return {
          row: point.row,
          col: point.col,
          lat: Math.round(point.lat * 1e6) / 1e6,
          lng: Math.round(point.lng * 1e6) / 1e6,
          rank: rank >= 0 ? rank + 1 : null,
          top3
        };
      } catch {
        return {
          row: point.row,
          col: point.col,
          lat: Math.round(point.lat * 1e6) / 1e6,
          lng: Math.round(point.lng * 1e6) / 1e6,
          rank: null,
          top3: []
        };
      }
    };
    for (let i = 0; i < gridPoints.length; i += concurrency) {
      const batch = gridPoints.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(searchOne));
      gridResults.push(...results);
    }
    const rankedPoints = gridResults.filter((r) => r.rank !== null);
    const totalPoints = gridResults.length;
    const inTop3 = rankedPoints.filter((r) => r.rank <= 3).length;
    const arp = rankedPoints.length > 0 ? Math.round(rankedPoints.reduce((sum, r) => sum + r.rank, 0) / rankedPoints.length * 10) / 10 : null;
    const atrp = Math.round(gridResults.reduce((sum, r) => sum + (r.rank ?? 21), 0) / totalPoints * 10) / 10;
    const solv = Math.round(inTop3 / totalPoints * 1e3) / 10;
    return {
      metrics: {
        arp,
        atrp,
        solv,
        found_in: `${rankedPoints.length}/${totalPoints}`
      },
      grid: gridResults
    };
  }
};

// src/index.ts
var Logger = {
  log: (...args) => {
    console.error("[INFO]", ...args);
  },
  error: (...args) => {
    console.error("[ERROR]", ...args);
  }
};

export {
  NewPlacesService,
  PlacesSearcher,
  Logger
};
