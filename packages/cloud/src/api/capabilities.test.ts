import { describe, expect, test } from "bun:test";
import { ok } from "@k2b/stdlib";
import { z } from "zod";
import { compileCapabilities } from "../_internal/capabilities";
import { defineCapabilities } from "../contracts/capabilities";
import type { AppRegistryEntry, CapabilityRegistryEntry } from "../contracts/registry";
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
    actions: {
      rename: {
        title: "Rename item",
        description: "Rename one demo item.",
        input: z.object({ id: z.string().describe("Stable item id."), name: z.string().describe("New item name.") }).strict(),
        data: z.object({ id: z.string(), name: z.string() }).strict(),
        destructive: true,
        openWorld: false,
        approval: "once",
        idempotency: "none",
        review: async ({ id, name }) => ok({ message: `Rename ${id} to ${name}.` }),
        run: async ({ id, name }) => ok({ data: { id, name } }),
      },
    },
  }),
);

const entry = (id = "demo"): CapabilityRegistryEntry => ({
  appId: id,
  appName: id,
  appIcon: "ti ti-box",
  endpoint: `http://${id}:3000/api/_internal/capabilities/v1`,
  manifest: { ...compiled.manifest, appId: id },
});

const summary = (capability: CapabilityRegistryEntry): AppRegistryEntry => ({
  id: capability.appId,
  name: capability.appName,
  icon: capability.appIcon,
  description: `${capability.appName} app`,
  baseUrl: `http://${capability.appId}:3000`,
  routes: [],
  capabilities: {
    protocolVersion: capability.manifest.protocolVersion,
    manifestHash: capability.manifest.manifestHash,
  },
});

const authenticate = async (_c: unknown, next: () => Promise<void>) => next();

describe("capability API", () => {
  test("paginates the live catalog deterministically", async () => {
    const apps = [entry("zeta"), entry("alpha"), entry("middle")];
    const byId = new Map(apps.map((app) => [app.appId, app]));
    const routes = createCapabilityRoutes({
      listApps: async () => apps.map(summary),
      getCapability: async (appId) => byId.get(appId) ?? null,
      authenticate,
    });

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
    const routes = createCapabilityRoutes({ getCapability: async () => null, authenticate });
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
      getCapability: async () => entry(),
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

  test("preserves structured throttling errors from the owning app", async () => {
    const routes = createCapabilityRoutes({
      getCapability: async () => entry(),
      authenticate,
      fetch: async () => Response.json({ code: "RATE_LIMITED", message: "Retry later" }, { status: 429 }),
    });
    const response = await routes.request("/capabilities/v1/queries/demo/get", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { id: "one" } }),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: "RATE_LIMITED", message: "Retry later" });
  });

  test("dispatches only advertised Action reviews through the read-only review route", async () => {
    let requestedUrl = "";
    const routes = createCapabilityRoutes({
      getCapability: async () => entry(),
      authenticate,
      fetch: async (input) => {
        requestedUrl = String(input);
        return Response.json({ message: "Rename one to Two." });
      },
    });
    const response = await routes.request("/capabilities/v1/actions/demo/rename/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { id: "one", name: "Two" } }),
    });

    expect(response.status).toBe(200);
    expect(requestedUrl).toBe("http://demo:3000/api/_internal/capabilities/v1/actions/rename/review");
    expect(await response.json()).toEqual({ message: "Rename one to Two." });
  });

  test("rejects an Action review that is not advertised", async () => {
    let requested = false;
    const routes = createCapabilityRoutes({
      getCapability: async () => entry(),
      authenticate,
      fetch: async () => {
        requested = true;
        return Response.json({ message: "Unexpected review." });
      },
    });
    const response = await routes.request("/capabilities/v1/actions/demo/missing/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: {} }),
    });

    expect(response.status).toBe(404);
    expect(requested).toBe(false);
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
