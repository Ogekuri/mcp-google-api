import { Request } from "express";

/**
 * @brief Singleton resolver of the effective API key for each request.
 * @details Resolution priority (`getApiKey`): `X-Google-Maps-API-Key` header,
 * then `Authorization: Bearer` token, then session key, then the startup
 * default key injected via `setDefaultApiKey` (DES-005). The default key is
 * configured exclusively from the persisted settings by the server-start path
 * (REQ-142); no environment variable is consulted or written (CTN-002,
 * DES-006).
 * @satisfies DES-005, DES-006, REQ-016, REQ-017, REQ-018, REQ-019, REQ-020
 */
export class ApiKeyManager {
  private static instance: ApiKeyManager;
  private defaultApiKey: string | undefined;

  private constructor() {
    // The default key is injected at startup from the persisted settings (REQ-142).
    this.defaultApiKey = undefined;
  }

  /**
   * @brief Returns the process-wide singleton instance.
   * @details Lazily constructs the manager; the default key starts unset and
   * MUST be injected by the server-start path before serving requests.
   * Complexity O(1).
   * @return {ApiKeyManager} The singleton instance.
   */
  public static getInstance(): ApiKeyManager {
    if (!ApiKeyManager.instance) {
      ApiKeyManager.instance = new ApiKeyManager();
    }
    return ApiKeyManager.instance;
  }

  /**
   * @brief Injects the startup default API key.
   * @details Called by the server-start command with the key resolved from
   * the persisted settings (REQ-142); undefined clears the default so
   * requests without header/session keys resolve no key (REQ-018, DES-006).
   * Pure in-memory mutation; no environment writes.
   * @param key {string | undefined} Default key from the persisted settings; undefined clears it.
   * @return {void}
   * @satisfies DES-006, REQ-142
   */
  public setDefaultApiKey(key: string | undefined): void {
    this.defaultApiKey = key;
  }

  /**
   * @brief Resolves the effective API key for one request.
   * @details Priority: `X-Google-Maps-API-Key` header, then `Authorization:
   * Bearer` token, then the session key, then the injected default key
   * (DES-005, REQ-016, REQ-017, REQ-018). Complexity O(1).
   * @param req {Request | undefined} Incoming HTTP request; undefined skips header resolution.
   * @param sessionApiKey {string | undefined} Session-scoped key; consulted before the default.
   * @return {string | undefined} Effective key; undefined when nothing resolves.
   * @satisfies DES-005, REQ-016, REQ-017, REQ-018
   */
  public getApiKey(req?: Request, sessionApiKey?: string): string | undefined {
    if (req) {
      // Check for API key in headers
      const headerApiKey = req.headers["x-google-maps-api-key"] as string;
      if (headerApiKey) {
        return headerApiKey;
      }

      // Check for Bearer token in Authorization header
      const authHeader = req.headers["authorization"] as string;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.substring(7);
      }
    }

    // Use session-specific API key if available
    if (sessionApiKey) {
      return sessionApiKey;
    }

    // Fall back to default API key
    return this.defaultApiKey;
  }

  /**
   * @brief Reports whether any API key is resolvable for a request.
   * @details Delegates to `getApiKey` truthiness. Complexity O(1).
   * @param req {Request | undefined} Incoming HTTP request.
   * @param sessionApiKey {string | undefined} Session-scoped key.
   * @return {boolean} True when a key resolves.
   */
  public hasApiKey(req?: Request, sessionApiKey?: string): boolean {
    return !!this.getApiKey(req, sessionApiKey);
  }

  /**
   * @brief Validates the API key format.
   * @details Accepts 20-50 characters of `[A-Za-z0-9_-]` (REQ-020). Pure;
   * complexity O(n) in key length.
   * @param key {string} Candidate key.
   * @return {boolean} True when the format is valid.
   * @satisfies REQ-020
   */
  public isValidApiKeyFormat(key: string): boolean {
    // Google Maps API keys are typically 39 characters long
    // and contain alphanumeric characters, hyphens, and underscores
    return /^[A-Za-z0-9_-]{20,50}$/.test(key);
  }
}
