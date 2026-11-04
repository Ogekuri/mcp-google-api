import { AsyncLocalStorage } from "node:async_hooks";
import { ApiKeyManager } from "./apiKeyManager.js";

/**
 * @brief Per-request context propagated through `AsyncLocalStorage`.
 * @details Carries the resolved request API key and the MCP session id
 * (DES-006).
 */
interface RequestContext {
  apiKey?: string;
  sessionId?: string;
}

// Create AsyncLocalStorage instance to track request context
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * @brief Returns the current request's API key.
 * @details Reads the `AsyncLocalStorage` store first (per-request/per-session
 * key, DES-006); when no context exists (stdio transport) falls back to the
 * startup default key injected into `ApiKeyManager` from the persisted
 * settings (REQ-018, REQ-142). No environment fallback (CTN-002).
 * @return {string | undefined} Effective API key; undefined when unconfigured.
 * @satisfies DES-006, REQ-018, REQ-142
 */
export function getCurrentApiKey(): string | undefined {
  const context = requestContextStorage.getStore();
  return context?.apiKey || ApiKeyManager.getInstance().getApiKey();
}

/**
 * @brief Runs a function inside a specific request context.
 * @details Opens an `AsyncLocalStorage` scope so nested reads via
 * `getCurrentApiKey` observe the given key/session pair (DES-006).
 * @param context {RequestContext} Context to expose to the executed function.
 * @param fn {() => T | Promise<T>} Function executed within the scope.
 * @return {T | Promise<T>} The function's own result.
 * @satisfies DES-006
 */
export function runWithContext<T>(context: RequestContext, fn: () => T | Promise<T>): T | Promise<T> {
  return requestContextStorage.run(context, fn);
}
