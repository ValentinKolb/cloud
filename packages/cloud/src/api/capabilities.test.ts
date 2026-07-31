import { describe, expect, test } from "bun:test";
import { ok } from "@k2b/stdlib";
import { z } from "zod";
import { compileCapabilities } from "../_internal/capabilities";
import { defineCapabilities } from "../contracts/capabilities";
import type { AppRegistryEntry } from "../contracts/registry";
import { capabilityCredentialHeaders, createCapabilityRoutes } from "./capabilities";

const compiled = compileCapabilities(
  "demo",
  defineCapabilities({
    version: 1,
    types: { item: { title: "Item", description: "One demo item." } },
    queries: {
      get: {
        title: "Get item",
        description: "Return one demo item.",
        input: z.object({ id: z.string().describe("Stable item id.") }).strict(),
        data: z.object({ id: z.string() }).strict(),
        run: async ({ id }) => ok({ data: { id } }),
      },
    },
  }),
);

const entry = (id = "demo"): AppRegistryEntry => ({
  id,
  name: id,
  icon: "ti ti-box",
  description: "Demo app",
  baseUrl: `http://${id}:3000`,
  routes: [],
  capabilities: {
    endpoint: `http://${id}:3000/api/_internal/capabilities/v1`,
    manifest: { ...compiled.manifest, appId: id },
  },
});

const authenticate = async (_c: unknown, next: () => Promise<void>) => next();

describe("capability API", () => {
  test("paginates the live catalog deterministically", async () => {
    const apps = [entry("zeta"), entry("alpha"), entry("middle")];
    const routes = createCapabilityRoutes({ listApps: async () => apps, authenticate });

    const first = await routes.request("/capabilities/v1/catalog?limit=2");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      apps: [{ appId: "alpha" }, { appId: "middle" }],
      page: { hasMore: true, nextCursor: "middle" },
    });

    const second = await routes.request("/capabilities/v1/catalog?limit=2&cursor=middle");
    expect(await second.json()).toMatchObject({ apps: [{ appId: "zeta" }], page: { hasMore: false } });
  });

  test("returns a structured error for an unavailable app", async () => {
    const routes = createCapabilityRoutes({ getApp: async () => null, authenticate });
    const response = await routes.request("/capabilities/v1/queries/missing/get", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { id: "one" } }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "APP_UNAVAILABLE", message: "App missing is not currently available" });
  });

  test("forwards only caller credentials and protocol headers", async () => {
    let forwarded: Headers | undefined;
    const routes = createCapabilityRoutes({
      getApp: async () => entry(),
      authenticate,
      fetch: async (_input, init) => {
        forwarded = new Headers(init?.headers);
        return Response.json({ data: { id: "one" } });
      },
    });
    const response = await routes.request("/capabilities/v1/queries/demo/get", {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        cookie: "session=ignored",
        "content-type": "application/json",
        "x-cloud-actor": "forged",
      },
      body: JSON.stringify({ input: { id: "one" } }),
    });
    expect(response.status).toBe(200);
    expect(forwarded?.get("authorization")).toBe("Bearer secret");
    expect(forwarded?.get("cookie")).toBeNull();
    expect(forwarded?.get("x-cloud-actor")).toBeNull();
    expect(forwarded?.get("x-cloud-capability-schema-hash")).toBe(compiled.manifest.queries[0]?.schemaHash);
  });
});

test("capabilityCredentialHeaders never forwards internal identity headers", () => {
  const request = new Request("http://cloud.test", {
    headers: { cookie: "session=ok", "x-cloud-actor": "forged", "x-cloud-user": "forged" },
  });
  const headers = capabilityCredentialHeaders(request);
  expect(headers.get("cookie")).toBe("session=ok");
  expect(headers.get("x-cloud-actor")).toBeNull();
  expect(headers.get("x-cloud-user")).toBeNull();
});
