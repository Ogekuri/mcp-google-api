interface SearchResponse {
    success: boolean;
    error?: string;
    data?: any[];
    location?: any;
    nextPageToken?: string;
    fieldMask?: string;
    raw_response?: any;
}
interface PlaceDetailsResponse {
    success: boolean;
    error?: string;
    data?: any;
    fieldMask?: string;
}
interface GeocodeResponse {
    success: boolean;
    error?: string;
    data?: {
        location: {
            lat: number;
            lng: number;
        };
        formatted_address: string;
        place_id: string;
    };
}
interface ReverseGeocodeResponse {
    success: boolean;
    error?: string;
    data?: {
        formatted_address: string;
        place_id: string;
        address_components: any[];
    };
}
interface DistanceMatrixResponse {
    success: boolean;
    error?: string;
    data?: {
        distances: any[][];
        durations: any[][];
        origin_addresses: string[];
        destination_addresses: string[];
    };
}
interface DirectionsResponse {
    success: boolean;
    error?: string;
    data?: {
        routes: any[];
        summary: string;
        total_distance: {
            value: number;
            text: string;
        };
        total_duration: {
            value: number;
            text: string;
        };
    };
}
interface TimezoneResponse {
    success: boolean;
    error?: string;
    data?: {
        timeZoneId: string;
        timeZoneName: string;
        utcOffset: number;
        dstOffset: number;
        localTime: string;
    };
}
interface WeatherResponse {
    success: boolean;
    error?: string;
    data?: any;
}
interface StaticMapResponse {
    success: boolean;
    error?: string;
    data?: {
        base64: string;
        size: number;
        dimensions: string;
    };
}
interface AirQualityResponse {
    success: boolean;
    error?: string;
    data?: any;
}
interface ElevationResponse {
    success: boolean;
    error?: string;
    data?: Array<{
        elevation: number;
        location: {
            lat: number;
            lng: number;
        };
    }>;
}
declare class PlacesSearcher {
    private mapsTools;
    private newPlacesService;
    private routesService;
    constructor(apiKey?: string);
    searchNearby(params: {
        center: {
            value: string;
            isCoordinates: boolean;
        };
        keyword?: string;
        radius?: number;
        openNow?: boolean;
        minRating?: number;
    }): Promise<SearchResponse>;
    searchText(params: {
        query: string;
        locationBias?: {
            latitude: number;
            longitude: number;
            radius?: number;
        };
        openNow?: boolean;
        minRating?: number;
        includedType?: string;
        strictTypeFiltering?: boolean;
        priceLevels?: string[];
        pageSize?: number;
        pageToken?: string;
        languageCode?: string;
        includeRaw?: boolean;
    }): Promise<SearchResponse>;
    getPlaceDetails(placeId: string, maxPhotos?: number, includeRaw?: boolean): Promise<PlaceDetailsResponse>;
    geocode(address: string): Promise<GeocodeResponse>;
    reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodeResponse>;
    calculateDistanceMatrix(origins: string[], destinations: string[], mode?: "driving" | "walking" | "bicycling" | "transit", departure_time?: string, avoid_tolls?: boolean, avoid_highways?: boolean): Promise<DistanceMatrixResponse>;
    getDirections(origin: string, destination: string, mode?: "driving" | "walking" | "bicycling" | "transit", departure_time?: string, arrival_time?: string, avoid_tolls?: boolean, avoid_highways?: boolean): Promise<DirectionsResponse>;
    getTimezone(latitude: number, longitude: number, timestamp?: number): Promise<TimezoneResponse>;
    getWeather(latitude: number, longitude: number, type?: "current" | "forecast_daily" | "forecast_hourly", forecastDays?: number, forecastHours?: number): Promise<WeatherResponse>;
    getAirQuality(latitude: number, longitude: number, includeHealthRecommendations?: boolean, includePollutants?: boolean): Promise<AirQualityResponse>;
    getStaticMap(params: {
        center?: string;
        zoom?: number;
        size?: string;
        maptype?: string;
        markers?: string[];
        path?: string[];
    }): Promise<StaticMapResponse>;
    searchAlongRoute(params: {
        textQuery: string;
        origin: string;
        destination: string;
        mode?: string;
        maxResults?: number;
    }): Promise<{
        success: boolean;
        error?: string;
        data?: any;
    }>;
    private resolveLocation;
    exploreArea(params: {
        location: string;
        types?: string[];
        radius?: number;
        topN?: number;
    }): Promise<any>;
    planRoute(params: {
        stops: string[];
        mode?: "driving" | "walking" | "bicycling" | "transit";
        optimize?: boolean;
        departure_time?: string;
        avoid_tolls?: boolean;
        avoid_highways?: boolean;
    }): Promise<any>;
    comparePlaces(params: {
        query: string;
        userLocation?: {
            latitude: number;
            longitude: number;
        };
        limit?: number;
    }): Promise<any>;
    getElevation(locations: Array<{
        latitude: number;
        longitude: number;
    }>): Promise<ElevationResponse>;
    localRankTracker(params: {
        keywords: string[];
        placeId: string;
        center: {
            latitude: number;
            longitude: number;
        };
        gridSize?: number;
        gridSpacing?: number;
    }): Promise<any>;
    private scanKeywordGrid;
}

declare class NewPlacesService {
    private client;
    private readonly apiKey;
    private readonly defaultLanguage;
    private readonly placeFieldMask;
    private readonly searchNearbyFieldMask;
    private readonly searchTextFieldMask;
    constructor(apiKey?: string);
    searchNearby(params: {
        location: {
            lat: number;
            lng: number;
        };
        keyword?: string;
        radius?: number;
        maxResultCount?: number;
    }): Promise<any[]>;
    searchText(params: {
        textQuery: string;
        locationBias?: {
            lat: number;
            lng: number;
            radius?: number;
        };
        openNow?: boolean;
        minRating?: number;
        includedType?: string;
        strictTypeFiltering?: boolean;
        priceLevels?: string[];
        pageSize?: number;
        pageToken?: string;
        languageCode?: string;
        maxResultCount?: number;
    }): Promise<any[]>;
    searchTextFull(params: {
        textQuery: string;
        locationBias?: {
            lat: number;
            lng: number;
            radius?: number;
        };
        openNow?: boolean;
        minRating?: number;
        includedType?: string;
        strictTypeFiltering?: boolean;
        priceLevels?: string[];
        pageSize?: number;
        pageToken?: string;
        languageCode?: string;
        maxResultCount?: number;
        includeRaw?: boolean;
    }): Promise<{
        places: any[];
        nextPageToken?: string;
        fieldMask: string;
        raw?: any;
    }>;
    getPhotoUri(photoName: string, maxWidthPx?: number): Promise<string>;
    getPlaceDetails(placeId: string, includeRaw?: boolean): Promise<any>;
    private transformSearchResult;
    private transformPlaceResponse;
    private extractLegacyPlaceId;
    private isCurrentlyOpen;
    private getLocalTimeComponents;
    private formatOpeningHours;
    private extractErrorMessage;
}

declare const Logger: {
    log: (...args: any[]) => void;
    error: (...args: any[]) => void;
};

export { Logger, NewPlacesService, PlacesSearcher };
