import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { auth, jsonResponse, requiresAuth, v, type AuthContext } from "@valentinkolb/cloud-lib/server/middleware";
import type { AppFacade, AppSearchContext, AppSearchInput, AppSearchResult } from "@valentinkolb/cloud-contracts/app";
import { ErrorResponseSchema } from "@valentinkolb/cloud-contracts/shared";
import { logger } from "@valentinkolb/cloud-core/services/logging";
import { SearchItemSchema, SearchQuerySchema, SearchResponseSchema, type SearchItem } from "./search/schemas";

const log = logger("search");

type SearchProvider = {
  appId: string;
  appName: string;
  appIcon: string;
  run: (input: AppSearchInput) => Promise<AppSearchResult[]>;
};

const getSearchContext = (c: { get: (key: "user" | "sessionToken") => unknown }): AppSearchContext => ({
  get: (key) => c.get(key) as never,
});

const getProviders = (apps: readonly AppFacade[]): SearchProvider[] =>
  apps
    .map((app) => ({
      appId: app.meta.id,
      appName: app.meta.name,
      appIcon: app.meta.icon,
      run: app.capabilities?.search?.run,
    }))
    .flatMap((entry) => (entry.run ? [{ ...entry, run: entry.run }] : []));

export const createSearchRoutes = (apps: readonly AppFacade[]) =>
  new Hono<AuthContext>()
    .use(auth.requireRole("authenticated"))
    .get(
      "/search",
      describeRoute({
        tags: ["Search"],
        summary: "Global search",
        description: "Searches across app providers registered via AppFacade capabilities with optional tag filters.",
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
        const searchCtx = getSearchContext(c);
        const providers = getProviders(apps);

        const settled = await Promise.allSettled(
          providers.map(async (provider) => {
            const results = await provider.run({
              query: query.q,
              tags: query.tag,
              limit: query.provider_limit,
              ctx: searchCtx,
            });

            const validItems: SearchItem[] = [];
            for (const item of results) {
              const parsed = SearchItemSchema.safeParse({
                appId: provider.appId,
                appName: provider.appName,
                appIcon: provider.appIcon,
                id: item.id,
                title: item.title,
                href: item.href,
                preview: item.preview,
                icon: item.icon,
                priority: item.priority,
                metadata: item.metadata,
                previewUrl: item.previewUrl,
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
