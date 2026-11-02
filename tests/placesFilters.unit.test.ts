import assert from "node:assert/strict";
import test from "node:test";
import { NewPlacesService } from "../src/services/NewPlacesService.js";
import { PlacesSearcher } from "../src/services/PlacesSearcher.js";

const SEARCH_TEXT_PLACE = {
  id: "ChIJtest123",
  name: "places/ChIJtest123",
  displayName: { text: "Trattoria Test", languageCode: "it" },
  formattedAddress: "Via Test 1, Torino, TO, Italia",
  location: { latitude: 45.07, longitude: 7.68 },
  primaryType: "italian_restaurant",
  types: ["italian_restaurant", "restaurant"],
  businessStatus: "OPERATIONAL",
  googleMapsUri: "https://maps.google.com/?cid=123",
  priceLevel: "PRICE_LEVEL_MODERATE",
  priceRange: {
    startPrice: { currencyCode: "EUR", units: "20" },
    endPrice: { currencyCode: "EUR", units: "35" },
  },
  rating: 4.6,
  userRatingCount: 910,
  regularOpeningHours: {
    periods: [{ open: { day: "MONDAY", hour: 12, minute: 0 }, close: { day: "MONDAY", hour: 15, minute: 0 } }],
    weekdayDescriptions: ["lunedì: 12:00–15:00"],
  },
  currentOpeningHours: {
    openNow: true,
    periods: [{ open: { day: "MONDAY", hour: 12, minute: 0 }, close: { day: "MONDAY", hour: 15, minute: 0 } }],
    weekdayDescriptions: ["lunedì: 12:00–15:00"],
  },
};

const DETAILS_PLACE = {
  ...SEARCH_TEXT_PLACE,
  nationalPhoneNumber: "+39 011 0000000",
  websiteUri: "https://example.com",
  reviews: [],
  photos: [],
};

type SearchCall = { request: any; fieldMask?: string };

function mockSearchClient(response: any): { calls: SearchCall[] } {
  const calls: SearchCall[] = [];
  const client = {
    searchText: async (request: any, options: any) => {
      calls.push({ request, fieldMask: options?.otherArgs?.headers?.["X-Goog-FieldMask"] });
      return [response];
    },
    getPlace: async (_request: any, _options: any) => [DETAILS_PLACE],
  };
  return { calls, client };
}

test("searchTextFull forwards GeoScout filters (priceLevels, strictTypeFiltering, minRating, includedType) to the API", async () => {
  const { calls, client } = mockSearchClient({ places: [SEARCH_TEXT_PLACE] });
  const service = new NewPlacesService("test-key");
  (service as unknown as { client: any }).client = client;

  await service.searchTextFull({
    textQuery: "trattoria Torino",
    includedType: "restaurant",
    strictTypeFiltering: true,
    minRating: 4.5,
    priceLevels: ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE"],
    pageSize: 10,
  });

  assert.equal(calls.length, 1);
  const request = calls[0].request;
  assert.equal(request.textQuery, "trattoria Torino");
  assert.equal(request.includedType, "restaurant");
  assert.equal(request.strictTypeFiltering, true);
  assert.equal(request.minRating, 4.5);
  assert.deepEqual(request.priceLevels, ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE"]);
  assert.equal(request.maxResultCount, 10);
  assert.equal(request.includedTypes, undefined, "Text Search must use singular includedType");
});

// See the NOTE ON PAGINATION in NewPlacesService.searchTextFull: page_size is
// not part of the SearchTextRequest proto shipped with @googlemaps/places, so
// pageSize must be translated to maxResultCount to take effect.
test("pageSize is translated to maxResultCount (SDK proto lacks page_size)", async () => {
  const { calls, client } = mockSearchClient({ places: [SEARCH_TEXT_PLACE] });
  const service = new NewPlacesService("test-key");
  (service as unknown as { client: any }).client = client;

  await service.searchTextFull({ textQuery: "trattoria Torino", pageSize: 8 });
  const request = calls[0].request;
  assert.equal(request.maxResultCount, 8);
  assert.equal(request.pageSize, undefined, "page_size is dropped by the SDK proto");
});

test("searchTextFull sends a field mask covering all GeoScout validation fields and pagination", async () => {
  const { calls, client } = mockSearchClient({ places: [SEARCH_TEXT_PLACE] });
  const service = new NewPlacesService("test-key");
  (service as unknown as { client: any }).client = client;

  await service.searchTextFull({ textQuery: "trattoria Torino" });

  const mask = calls[0].fieldMask || "";
  for (const required of [
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
    "places.currentOpeningHours.periods",
    "nextPageToken",
  ]) {
    assert.ok(mask.includes(required), `field mask missing ${required}`);
  }
});

test("searchTextFull preserves raw Money priceRange, types, businessStatus and hours, and returns nextPageToken", async () => {
  const { client } = mockSearchClient({ places: [SEARCH_TEXT_PLACE], nextPageToken: "token-2" });
  const service = new NewPlacesService("test-key");
  (service as unknown as { client: any }).client = client;

  const result = await service.searchTextFull({ textQuery: "trattoria Torino", includeRaw: true });

  assert.equal(result.nextPageToken, "token-2");
  assert.equal(result.places.length, 1);
  const place = result.places[0];
  assert.equal(place.place_id, "ChIJtest123");
  assert.equal(place.primary_type, "italian_restaurant");
  assert.deepEqual(place.types, ["italian_restaurant", "restaurant"]);
  assert.equal(place.business_status, "OPERATIONAL");
  assert.equal(place.price_level, "PRICE_LEVEL_MODERATE");
  // Raw Money structure must be preserved verbatim, not flattened to numbers
  assert.deepEqual(place.price_range, {
    startPrice: { currencyCode: "EUR", units: "20" },
    endPrice: { currencyCode: "EUR", units: "35" },
  });
  assert.ok(place.regular_opening_hours.periods.length === 1);
  assert.equal(place.current_opening_hours.openNow, true);
  // Raw payload attached for API-verified validation
  assert.deepEqual(place.raw_place, SEARCH_TEXT_PLACE);
  assert.deepEqual(result.raw.places[0], SEARCH_TEXT_PLACE);
});

test("searchTextFull forwards pageToken for pagination", async () => {
  const { calls, client } = mockSearchClient({ places: [SEARCH_TEXT_PLACE] });
  const service = new NewPlacesService("test-key");
  (service as unknown as { client: any }).client = client;

  await service.searchTextFull({ textQuery: "trattoria Torino", pageToken: "token-1" });

  assert.equal(calls[0].request.pageToken, "token-1");
});

test("PlacesSearcher.searchText surfaces GeoScout fields, nextPageToken, field mask and raw payload", async () => {
  const { client } = mockSearchClient({ places: [SEARCH_TEXT_PLACE], nextPageToken: "token-2" });
  const service = new NewPlacesService("test-key");
  (service as unknown as { client: any }).client = client;
  const searcher = new PlacesSearcher("test-key");
  (searcher as unknown as { newPlacesService: NewPlacesService }).newPlacesService = service;

  const result = await searcher.searchText({
    query: "trattoria Torino",
    priceLevels: ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE"],
    strictTypeFiltering: true,
    includeRaw: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.nextPageToken, "token-2");
  assert.ok(result.fieldMask?.includes("places.priceRange"));
  assert.ok(result.raw_response);
  const item = result.data![0];
  assert.equal(item.primary_type, "italian_restaurant");
  assert.deepEqual(item.price_range.endPrice, { currencyCode: "EUR", units: "35" });
  assert.equal(item.total_ratings, 910);
  assert.ok(item.raw_place);
});

test("getPlaceDetails (includeRaw) returns priceRange, businessStatus, hours, raw_place and the field mask", async () => {
  const captured: string[] = [];
  const client = {
    getPlace: async (_request: any, options: any) => {
      captured.push(options.otherArgs.headers["X-Goog-FieldMask"]);
      return [DETAILS_PLACE];
    },
  };
  const service = new NewPlacesService("test-key");
  (service as unknown as { client: any }).client = client;

  const details = await service.getPlaceDetails("ChIJtest123", true);

  assert.ok(captured[0].includes("priceRange"));
  assert.ok(captured[0].includes("businessStatus"));
  assert.ok(captured[0].includes("currentOpeningHours.periods"));
  assert.equal(details.business_status, "OPERATIONAL");
  assert.deepEqual(details.price_range.endPrice, { currencyCode: "EUR", units: "35" });
  assert.ok(details.current_opening_hours.periods.length === 1);
  assert.deepEqual(details.raw_place, DETAILS_PLACE);
  assert.ok(details.field_mask.includes("priceRange"));
});

test("searchText (legacy array contract) still returns a plain array for existing callers", async () => {
  const { client } = mockSearchClient({ places: [SEARCH_TEXT_PLACE] });
  const service = new NewPlacesService("test-key");
  (service as unknown as { client: any }).client = client;

  const places = await service.searchText({ textQuery: "trattoria Torino" });

  assert.ok(Array.isArray(places));
  assert.equal(places[0].place_id, "ChIJtest123");
});
