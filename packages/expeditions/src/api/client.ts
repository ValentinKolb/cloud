import { api } from "@valentinkolb/cloud/browser";
import type { ApiType } from ".";

/**
 * Typed RPC client for the expeditions API.
 *
 * Islands import this and call e.g. `apiClient[":id"].waypoints.$post(...)`
 * — the path / method / body shape are all type-checked from the same Hono
 * `app` definition the server uses, so renames / signature changes break
 * the client at compile time. No hand-written DTO duplication.
 */
export const apiClient = api.create<ApiType>({ baseUrl: "/api/expeditions" });
