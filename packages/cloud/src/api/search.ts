import { Hono, type MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import { listApps } from "..";
import { CloudResourceViewSchema, ErrorResponseSchema } from "../contracts";
import { type AuthContext, auth, expectUserBackedActor, jsonResponse, requiresAuth, v } from "../server";
import { logger } from "../services";
import { capabilityCredentialHeaders } from "./capabilities";
import { readBoundedJson } from "../_internal/bounded-json";
import type { AppRegistryEntry } from "../contracts";
import { type SearchItem, SearchItemSchema, SearchQuerySchema, SearchResponseSchema } from "./search/schemas";

const log = logger("search");

/**
 * Maximum items returned to the client after merging across providers.
 * The frontend has no further limit — this caps the rendered list.
 */
const GLOBAL_RESULT_LIMIT = 30;
const PROVIDER_CONCURRENCY = 8;
const PROVIDER_TIMEOUT_MS = 8_000;
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;

type HttpSearchProvider = {
  appId: string;
  appName: string;
  appIcon: string;
  endpoint: string;
  tags: string[];
  schemaHash: string;
};

/**
 * Discovers search providers from the app registry.
 * Only live apps with a Query that opts into Universal Search are included.
 */
const getSearchProviders = (entries: AppRegistryEntry[]): HttpSearchProvider[] => {
  return entries.flatMap((entry) => {
    if (!entry.capabilities) return [];
    const query = entry.capabilities.manifest.queries.find((candidate) => candidate.universalSearch);
    if (!query?.universalSearch) return [];
    return [
      {
        appId: entry.id,
        appName: entry.name,
        appIcon: entry.icon,
        endpoint: `${entry.capabilities.endpoint}/queries/${encodeURIComponent(query.localId)}`,
        tags: query.universalSearch.tags.flatMap((tag) => [tag.tag, ...(tag.aliases ?? [])]),
        schemaHash: query.schemaHash,
      },
    ];
  });
};

type SearchRouteDependencies = {
  listApps?: () => Promise<AppRegistryEntry[]>;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  authenticate?: MiddlewareHandler<AuthContext>;
};

const settleBounded = async <T, R>(items: readonly T[], concurrency: number, run: (item: T, index: number) => Promise<R>) => {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const index = next;
        next += 1;
        const item = items[index];
        if (item === undefined) return;
        try {
          results[index] = {
            status: "fulfilled",
            value: await run(item, index),
          };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
};

/**
 * Creates the global search route.
 * Discovers search providers from the registry and fetches results via HTTP,
 * forwarding the session cookie for authentication.
 */
export const createSearchRoutes = (dependencies: SearchRouteDependencies = {}) => {
  const registry = dependencies.listApps ?? listApps;
  const fetchProvider = dependencies.fetch ?? globalThis.fetch;
  return new Hono<AuthContext>().use(dependencies.authenticate ?? auth.requireRole("authenticated")).get(
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
        403: jsonResponse(ErrorResponseSchema, "User-backed actor required"),
      },
    }),
    v("query", SearchQuerySchema),
    async (c) => {
      expectUserBackedActor(c);

      const query = c.req.valid("query");
      const providers = getSearchProviders(await registry());

      // Pre-filter providers by tag overlap. With no tags, every provider
      // runs (text-only search). With tags, only providers that own at least
      // one requested tag participate — saves fanout to apps that can't
      // contribute. Tags the user typed that no provider declares are
      // returned to the client so it can render a helpful empty state.
      const knownTags = new Set(providers.flatMap((p) => p.tags));
      const unsupportedTags = query.tag.filter((t) => !knownTags.has(t));
      const active = query.tag.length === 0 ? providers : providers.filter((p) => p.tags.some((t) => query.tag.includes(t)));

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
      const effectiveProviderLimit = active.length === 1 ? Math.min(GLOBAL_RESULT_LIMIT, query.provider_limit * 3) : query.provider_limit;
      // One request-wide budget keeps latency flat as the number of apps grows.
      // Workers that have not started when the deadline expires fail fast on
      // the already-aborted signal instead of opening a fresh timeout window.
      const providerDeadline = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
      const settled = await settleBounded(active, PROVIDER_CONCURRENCY, async (provider) => {
        // Scope tags to those this provider declared. Apps no longer need
        // their own gate — the framework guarantees they only see tags
        // they understand.
        const scopedTags = query.tag.filter((t) => provider.tags.includes(t));

        const res = await fetchProvider(provider.endpoint, {
          method: "POST",
          headers: (() => {
            const headers = capabilityCredentialHeaders(c.req.raw);
            headers.set("x-cloud-capability-schema-hash", provider.schemaHash);
            return headers;
          })(),
          body: JSON.stringify({
            input: {
              query: query.q,
              tags: scopedTags,
              limit: effectiveProviderLimit,
            },
          }),
          signal: AbortSignal.any([c.req.raw.signal, providerDeadline]),
        });

        if (!res.ok) {
          throw new Error(`Search provider ${provider.appId} returned ${res.status}`);
        }

        const parsedBody = await readBoundedJson(res, MAX_PROVIDER_RESPONSE_BYTES);
        if (!parsedBody.ok) throw new Error(`Search provider ${provider.appId} returned invalid or oversized JSON`);
        const envelope = parsedBody.data as { data?: unknown };
        const results = Array.isArray(envelope.data) ? envelope.data : [];
        const validItems: SearchItem[] = [];

        for (const item of results) {
          const view = CloudResourceViewSchema.safeParse(item);
          if (!view.success) {
            log.warn("Search capability returned invalid resource view", {
              appId: provider.appId,
              issues: view.error.issues.map((issue) => issue.message),
            });
            continue;
          }
          const open = view.data.links.find((link) => link.rel === "open");
          if (!open) {
            log.warn("Search capability returned a resource without an open link", { appId: provider.appId, type: view.data.ref.type });
            continue;
          }
          const preview = view.data.links.find((link) => link.rel === "preview");
          const parsed = SearchItemSchema.safeParse({
            id: `${view.data.ref.type}:${view.data.ref.id}`,
            title: view.data.title,
            href: open.href,
            preview: view.data.preview,
            icon: view.data.icon,
            priority: view.data.priority,
            metadata: view.data.metadata,
            previewUrl: preview?.href,
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
      });

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
};

export type SearchApiType = ReturnType<typeof createSearchRoutes>;
