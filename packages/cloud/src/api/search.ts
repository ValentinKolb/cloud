import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { auth, jsonResponse, requiresAuth, v, type AuthContext } from "../server";
import { ErrorResponseSchema } from "../contracts";
import { logger } from "../services";
import { listApps } from "..";
import { SearchItemSchema, SearchQuerySchema, SearchResponseSchema, type SearchItem } from "./search/schemas";

const log = logger("search");

type HttpSearchProvider = {
  appId: string;
  appName: string;
  appIcon: string;
  endpoint: string;
};

/**
 * Discovers search providers from the app registry.
 * Only apps with a `search` capability (and therefore a search endpoint) are included.
 */
const getSearchProviders = async (): Promise<HttpSearchProvider[]> => {
  const entries = await listApps();
  return entries
    .filter((e) => !!e.search)
    .map((e) => ({
      appId: e.id,
      appName: e.name,
      appIcon: e.icon,
      endpoint: e.search!.endpoint,
    }));
};

/**
 * Creates the global search route.
 * Discovers search providers from the registry and fetches results via HTTP,
 * forwarding the session cookie for authentication.
 */
export const createSearchRoutes = () =>
  new Hono<AuthContext>()
    .use(auth.requireRole("authenticated"))
    .get(
      "/search",
      describeRoute({
        tags: ["Search"],
        summary: "Global search",
        description: "Searches across app providers discovered via the service registry with optional tag filters.",
        ...requiresAuth,
        responses: {
          200: jsonResponse(SearchResponseSchema, "Merged search results"),
          400: jsonResponse(ErrorResponseSchema, "Invalid query"),
          401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        },
      }),
      v("query", SearchQuerySchema),
      async (c) => {
        const query = c.req.valid("query");
        const providers = await getSearchProviders();

        const settled = await Promise.allSettled(
          providers.map(async (provider) => {
            const res = await fetch(provider.endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                // Forward the session cookie for auth on the app's internal search endpoint
                Cookie: c.req.raw.headers.get("Cookie") ?? "",
              },
              body: JSON.stringify({
                query: query.q,
                tags: query.tag,
                limit: query.provider_limit,
              }),
            });

            if (!res.ok) {
              throw new Error(`Search provider ${provider.appId} returned ${res.status}`);
            }

            const results: unknown[] = await res.json();
            const validItems: SearchItem[] = [];

            for (const item of results) {
              const parsed = SearchItemSchema.safeParse({
                ...(item as Record<string, unknown>),
                appId: provider.appId,
                appName: provider.appName,
                appIcon: provider.appIcon,
              });
              if (!parsed.success) {
                log.warn("Search provider returned invalid item", {
                  appId: provider.appId,
                  tags: query.tag,
                  issues: parsed.error.issues.map((issue) => issue.message),
                });
                continue;
              }
              validItems.push(parsed.data);
            }

            return validItems;
          }),
        );

        const items = settled.flatMap((result, index) => {
          if (result.status === "fulfilled") return result.value;

          log.warn("Search provider failed", {
            appId: providers[index]?.appId ?? "unknown",
            tags: query.tag,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
          return [];
        });

        items.sort((a, b) => {
          const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
          if (priorityDiff !== 0) return priorityDiff;
          return a.title.localeCompare(b.title);
        });

        return c.json({
          query: query.q,
          count: items.length,
          items,
        });
      },
    );

export type SearchApiType = ReturnType<typeof createSearchRoutes>;
