import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { auth, jsonResponse, requiresAuth, v, type AuthContext } from "../server";
import { ErrorResponseSchema } from "../contracts";
import { logger } from "../services";
import { listApps } from "..";
import { SearchItemSchema, SearchQuerySchema, SearchResponseSchema, type SearchItem } from "./search/schemas";

const log = logger("search");

/**
 * Maximum items returned to the client after merging across providers.
 * The frontend has no further limit — this caps the rendered list.
 */
const GLOBAL_RESULT_LIMIT = 30;

type HttpSearchProvider = {
  appId: string;
  appName: string;
  appIcon: string;
  endpoint: string;
  tags: string[];
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
      tags: [...e.search!.tags],
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

        // Pre-filter providers by tag overlap. With no tags, every provider
        // runs (text-only search). With tags, only providers that own at least
        // one requested tag participate — saves fanout to apps that can't
        // contribute. Tags the user typed that no provider declares are
        // returned to the client so it can render a helpful empty state.
        const knownTags = new Set(providers.flatMap((p) => p.tags));
        const unsupportedTags = query.tag.filter((t) => !knownTags.has(t));
        const active =
          query.tag.length === 0
            ? providers
            : providers.filter((p) => p.tags.some((t) => query.tag.includes(t)));

        if (query.tag.length > 0 && active.length === 0) {
          return c.json({
            query: query.q,
            count: 0,
            items: [],
            unsupportedTags,
          });
        }

        // Single-provider queries get a larger sample for better local
        // ranking — the global slice below still caps the response. Capped
        // at GLOBAL_RESULT_LIMIT so a single app can saturate the response
        // but no more.
        const effectiveProviderLimit =
          active.length === 1
            ? Math.min(GLOBAL_RESULT_LIMIT, query.provider_limit * 3)
            : query.provider_limit;

        const settled = await Promise.allSettled(
          active.map(async (provider) => {
            // Scope tags to those this provider declared. Apps no longer need
            // their own gate — the framework guarantees they only see tags
            // they understand.
            const scopedTags = query.tag.filter((t) => provider.tags.includes(t));

            const res = await fetch(provider.endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                // Forward the session cookie for auth on the app's internal search endpoint
                Cookie: c.req.raw.headers.get("Cookie") ?? "",
              },
              body: JSON.stringify({
                query: query.q,
                tags: scopedTags,
                limit: effectiveProviderLimit,
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
            appId: active[index]?.appId ?? "unknown",
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

        const sliced = items.slice(0, GLOBAL_RESULT_LIMIT);

        return c.json({
          query: query.q,
          count: sliced.length,
          items: sliced,
          ...(unsupportedTags.length > 0 ? { unsupportedTags } : {}),
        });
      },
    );

export type SearchApiType = ReturnType<typeof createSearchRoutes>;
