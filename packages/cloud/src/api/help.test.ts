import { describe, expect, test } from "bun:test";
import { compileHelp } from "../_internal/help";
import type { AppRegistryEntry } from "../contracts/registry";
import { defineHelp } from "../server/help";
import { createHelpRoutes } from "./help";

const source = `---
id: getting-started
title: Getting started
description: Create the first item.
order: 10
---

# Getting started

## Create an item {icon="plus"}

Open the catalog and create an adapter.`;

const compiled = compileHelp({
  appId: "inventory",
  appName: "Inventory",
  appIcon: "ti ti-package",
  basePath: "/app/inventory",
  definition: defineHelp({ documents: [source] }),
});

const app: AppRegistryEntry = {
  id: "inventory",
  name: "Inventory",
  icon: "ti ti-package",
  description: "Inventory app",
  baseUrl: "http://app-inventory:3000",
  routes: ["/app/inventory"],
  help: compiled.summary,
};

const authenticate = async (_c: unknown, next: () => Promise<void>) => next();

describe("Help API", () => {
  test("mounts public Help before authenticated capability middleware", async () => {
    const source = await Bun.file(new URL("./index.ts", import.meta.url)).text();
    expect(source.indexOf('.route("/", helpRoutes)')).toBeLessThan(source.indexOf('.route("/", capabilityRoutes)'));
  });

  test("searches and renders one live matching corpus", async () => {
    const routes = createHelpRoutes({
      getApp: async () => app,
      getHelp: async () => compiled.registryEntry,
      authenticate,
    });

    const search = await routes.request("/help/v1/inventory/search?q=adapter");
    expect(search.status).toBe(200);
    expect(await search.json()).toEqual({ ids: ["getting-started"] });

    const document = await routes.request("/help/v1/inventory/documents/getting-started");
    expect(document.status).toBe(200);
    expect(await document.json()).toMatchObject({
      id: "getting-started",
      title: "Getting started",
      markdown: expect.stringContaining("Create an item"),
      html: expect.stringContaining("<h2"),
    });
  });

  test("rejects missing, mismatched, and unknown Help", async () => {
    const missing = createHelpRoutes({ getApp: async () => null, getHelp: async () => null, authenticate });
    expect((await missing.request("/help/v1/missing/search?q=test")).status).toBe(404);

    const stale = createHelpRoutes({
      getApp: async () => ({ ...app, help: { ...compiled.summary, manifestHash: "stale" } }),
      getHelp: async () => compiled.registryEntry,
      authenticate,
    });
    expect((await stale.request("/help/v1/inventory/search?q=test")).status).toBe(503);

    const routes = createHelpRoutes({ getApp: async () => app, getHelp: async () => compiled.registryEntry, authenticate });
    expect((await routes.request("/help/v1/inventory/documents/missing")).status).toBe(404);
  });
});
