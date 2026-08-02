import { describe, expect, test } from "bun:test";
import { ok } from "@k2b/stdlib";
import type { MiddlewareHandler } from "hono";
import { compileCapabilities } from "../_internal/capabilities";
import { defineCapabilities, UniversalSearchDataSchema, UniversalSearchInputSchema } from "../contracts/capabilities";
import type { CapabilityRegistryEntry } from "../contracts/registry";
import type { AuthContext } from "../server";
import { createSearchRoutes } from "./search";

const capabilities = defineCapabilities({
  version: 1,
  types: {
    item: { title: "Item", description: "A searchable test item." },
  },
  queries: {
    search: {
      title: "Search items",
      description: "Find test items by text and facets.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      openWorld: false,
      universalSearch: {
        tags: [{ tag: "item", title: "Items", description: "Show test items.", aliases: ["thing"] }],
      },
      run: async () => ok({ data: [] }),
    },
  },
});

const manifest = compileCapabilities("demo", capabilities).manifest;
const app: CapabilityRegistryEntry = {
  appId: "demo",
  appName: "Demo",
  appIcon: "ti ti-box",
  endpoint: "http://demo:3000/api/_internal/capabilities/v1",
  manifest,
};

const authenticate: MiddlewareHandler<AuthContext> = async (c, next) => {
  const user = { id: "11111111-1111-4111-8111-111111111111", roles: ["user"] } as AuthContext["Variables"]["user"];
  c.set("actor", { kind: "user", user });
  c.set("accessSubject", { type: "user", userId: user.id });
  c.set("user", user);
  await next();
};

describe("global capability search", () => {
  test("discovers and routes multiple providers from one app", async () => {
    const multiManifest = compileCapabilities(
      "demo",
      defineCapabilities({
        version: 1,
        types: { item: { title: "Item", description: "One search result." } },
        queries: {
          first: {
            ...capabilities.queries.search,
            universalSearch: { tags: [{ tag: "first", title: "First", description: "Search first items." }] },
          },
          second: {
            ...capabilities.queries.search,
            universalSearch: { tags: [{ tag: "second", title: "Second", description: "Search second items." }] },
          },
        },
      }),
    ).manifest;
    const calls: string[] = [];
    const routes = createSearchRoutes({
      authenticate,
      listCapabilities: async () => [{ ...app, manifest: multiManifest }],
      fetch: async (url) => {
        calls.push(String(url));
        return Response.json({ data: [] });
      },
    });

    expect((await routes.request("/search?q=test&tag=second")).status).toBe(200);
    expect(calls).toEqual(["http://demo:3000/api/_internal/capabilities/v1/queries/second"]);

    calls.length = 0;
    expect((await routes.request("/search?q=test")).status).toBe(200);
    expect(calls.sort()).toEqual([
      "http://demo:3000/api/_internal/capabilities/v1/queries/first",
      "http://demo:3000/api/_internal/capabilities/v1/queries/second",
    ]);
  });

  test("discovers tags and maps stable resource refs", async () => {
    let input: unknown;
    const routes = createSearchRoutes({
      authenticate,
      listCapabilities: async () => [app],
      fetch: async (_url, init) => {
        input = JSON.parse(String(init?.body));
        return Response.json({
          data: [
            {
              ref: { type: "demo.item", id: "42" },
              title: "Answer",
              preview: "A result",
              links: [{ rel: "open", href: "/app/demo/42" }],
            },
          ],
        });
      },
    });

    const response = await routes.request("/search?q=answer&tag=thing&provider_limit=2", {
      headers: { cookie: "session=test" },
    });
    expect(response.status).toBe(200);
    expect(input).toEqual({ input: { query: "answer", tags: ["thing"], limit: 6 } });
    expect(await response.json()).toEqual({
      query: "answer",
      count: 1,
      items: [
        {
          appId: "demo",
          appName: "Demo",
          appIcon: "ti ti-box",
          id: "demo.item:42",
          title: "Answer",
          href: "/app/demo/42",
          preview: "A result",
        },
      ],
    });
  });

  test("reports unsupported facets without calling providers", async () => {
    let calls = 0;
    const routes = createSearchRoutes({
      authenticate,
      listCapabilities: async () => [app],
      fetch: async () => {
        calls += 1;
        return Response.json({ data: [] });
      },
    });

    const response = await routes.request("/search?tag=missing");
    expect(response.status).toBe(200);
    expect(calls).toBe(0);
    expect(await response.json()).toEqual({ query: "", count: 0, items: [], unsupportedTags: ["missing"] });
  });

  test("rejects unbounded queries and provider limits before fan-out", async () => {
    const routes = createSearchRoutes({ authenticate, listCapabilities: async () => [app] });
    expect((await routes.request(`/search?q=${"x".repeat(501)}`)).status).toBe(400);
    expect((await routes.request("/search?provider_limit=31")).status).toBe(400);
    expect((await routes.request(`/search?${Array.from({ length: 21 }, (_, index) => `tag=t${index}`).join("&")}`)).status).toBe(400);
  });

  test("caps a provider that returns more items than requested", async () => {
    const routes = createSearchRoutes({
      authenticate,
      listCapabilities: async () => [app],
      fetch: async () =>
        Response.json({
          data: Array.from({ length: 100 }, (_, index) => ({
            ref: { type: "demo.item", id: String(index) },
            title: `Item ${index}`,
            links: [{ rel: "open", href: `/app/demo/${index}` }],
          })),
        }),
    });
    const response = await routes.request("/search?provider_limit=2");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { items: unknown[] }).items).toHaveLength(6);
  });
});
