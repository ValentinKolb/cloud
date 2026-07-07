import { describe, expect, test } from "bun:test";
import type { CloudCliContext, CloudCliFlags } from "@valentinkolb/cloud/cli";
import pulseCli from "./cli";

type FetchCall = {
  path: string;
  init?: RequestInit;
};

const baseId = "810db53e-e756-4db5-9a40-9091f04a0abd";
const sourceId = "11111111-1111-4111-8111-111111111111";
const dashboardId = "22222222-2222-4222-8222-222222222222";

const jsonResponse = (value: unknown, status = 200) => Response.json(value, { status });

const createContext = (
  args: string[],
  flags: CloudCliFlags = {},
  responses: Response[] = [],
  output: "text" | "json" = "text",
) => {
  const calls: FetchCall[] = [];
  const lines: string[] = [];
  const tables: unknown[][] = [];
  const ctx: CloudCliContext = {
    args,
    flags,
    options: { profile: "test", server: "http://cloud.test", token: "token", output },
    getDefault: async () => undefined,
    setDefault: async () => undefined,
    createApiClient: (() => {
      throw new Error("not needed");
    }) as CloudCliContext["createApiClient"],
    fetch: async (path, init) => {
      calls.push({ path, init });
      const response = responses.shift();
      if (!response) throw new Error(`Unexpected fetch: ${path}`);
      return response;
    },
    readJson: async (response) => {
      const value = await response.json();
      if (!response.ok) throw new Error(typeof value?.message === "string" ? value.message : response.statusText);
      return value;
    },
    print: (value = "") => lines.push(value),
    json: (value) => lines.push(JSON.stringify(value, null, 2)),
    table: (rows) => tables.push(rows),
  };
  return { ctx, calls, lines, tables };
};

const base = {
  id: baseId,
  name: "Test",
  description: null,
  retentionDays: 30,
  createdBy: null,
  deletionStartedAt: null,
  deletionFailedAt: null,
  deletionError: null,
  dataClearStartedAt: null,
  dataClearCompletedAt: null,
  dataClearFailedAt: null,
  dataClearError: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const source = {
  id: sourceId,
  baseId,
  kind: "http_ingest",
  name: "docker",
  enabled: true,
  endpointUrl: null,
  bearerTokenConfigured: false,
  scrapeIntervalSeconds: null,
  lastSeenAt: "2026-07-07T00:00:00.000Z",
  lastError: null,
  lastErrorAt: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const inventory = {
  resources: [
    {
      key: "host:macbook",
      id: "macbook",
      label: "MacBook",
      type: "host",
      sourceIds: [sourceId],
      metricSeriesCount: 1,
      metricCount: 1,
      eventCount: 0,
      stateCount: 1,
      lastSeenAt: "2026-07-07T12:00:00.000Z",
      dimensions: { host: "macbook" },
    },
  ],
  metrics: [
    {
      seriesId: "33333333-3333-4333-8333-333333333333",
      resourceKey: "host:macbook",
      resourceId: "macbook",
      resourceType: "host",
      metric: "system.memory.usage",
      type: "gauge",
      unit: "percent",
      sourceId,
      dimensions: { host: "macbook" },
      lastSeenAt: "2026-07-07T12:00:00.000Z",
      latestValue: 61.2,
      latestSampleAt: "2026-07-07T12:00:00.000Z",
    },
  ],
  states: [
    {
      key: "system.host.online",
      value: true,
      sourceId,
      entityId: "host:macbook",
      entityType: "host",
      dimensions: { host: "macbook" },
      updatedAt: "2026-07-07T12:00:00.000Z",
    },
  ],
  events: [],
};

describe("pulse CLI", () => {
  test("lists metrics for a resolved resource", async () => {
    const { ctx, calls, tables } = createContext(
      ["resources", "metrics", baseId, "MacBook"],
      {},
      [jsonResponse(base), jsonResponse(inventory)],
    );

    await pulseCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([`/api/pulse/bases/${baseId}`, `/api/pulse/bases/${baseId}/inventory`]);
    expect(tables[0]).toEqual([
      {
        id: "33333333",
        metric: "system.memory.usage",
        type: "gauge",
        unit: "percent",
        source: "11111111",
        resource: "host:macbook",
        value: "61.2",
        lastSeenAt: "2026-07-07T12:00:00.000Z",
      },
    ]);
  });

  test("filters metric summaries by source name through inventory", async () => {
    const { ctx, calls, tables } = createContext(
      ["metrics", baseId],
      { source: "docker" },
      [jsonResponse(base), jsonResponse([source]), jsonResponse(inventory)],
    );

    await pulseCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/pulse/bases/${baseId}`,
      `/api/pulse/bases/${baseId}/sources`,
      `/api/pulse/bases/${baseId}/inventory`,
    ]);
    expect(tables[0]).toEqual([
      {
        metric: "system.memory.usage",
        type: "gauge",
        unit: "percent",
        series: 1,
        lastSeenAt: "2026-07-07T12:00:00.000Z",
      },
    ]);
  });

  test("keeps resources JSON compact unless raw inventory is requested", async () => {
    const { ctx, lines } = createContext(
      ["resources", baseId],
      {},
      [jsonResponse(base), jsonResponse(inventory)],
      "json",
    );

    await pulseCli.run(ctx);

    const payload = JSON.parse(lines[0]!);
    expect(payload.resources).toEqual([
      {
        key: "host:macbook",
        type: "host",
        label: "MacBook",
        metrics: 1,
        states: 1,
        events: 0,
        sources: 1,
        lastSeenAt: "2026-07-07T12:00:00.000Z",
      },
    ]);
    expect(payload.metrics).toBeUndefined();
    expect(payload.states).toBeUndefined();
    expect(payload.events).toBeUndefined();
  });

  test("does not match resource labels as state identities", async () => {
    const collisionInventory = {
      ...inventory,
      states: [
        ...inventory.states,
        {
          key: "system.host.online",
          value: false,
          sourceId,
          entityId: "MacBook",
          entityType: "host",
          dimensions: { host: "other" },
          updatedAt: "2026-07-07T12:01:00.000Z",
        },
      ],
    };
    const { ctx, tables } = createContext(
      ["resources", "states", baseId, "MacBook"],
      {},
      [jsonResponse(base), jsonResponse(collisionInventory)],
    );

    await pulseCli.run(ctx);

    expect(tables[0]).toEqual([
      {
        key: "system.host.online",
        value: "true",
        source: "11111111",
        entity: "host:macbook",
        entityType: "host",
        updatedAt: "2026-07-07T12:00:00.000Z",
      },
    ]);
  });

  test("prints a stable public display URL", async () => {
    const dashboard = {
      id: dashboardId,
      baseId,
      name: "Ops",
      config: { dsl: "dashboard \"Ops\" {}", layout: null, refreshIntervalSeconds: 5 },
      publicEnabled: true,
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
    };
    const { ctx, calls, lines } = createContext(
      ["dashboards", "public-url", baseId, "Ops"],
      { theme: "dark", height: "full", yes: true },
      [jsonResponse(base), jsonResponse([dashboard]), jsonResponse({ dashboard, token: "public-token" })],
    );

    await pulseCli.run(ctx);

    expect(calls.at(-1)?.path).toBe(`/api/pulse/dashboards/${dashboardId}/public-token`);
    expect(calls.at(-1)?.init?.method).toBe("POST");
    expect(lines).toEqual(["http://cloud.test/app/pulse/display/public-token?theme=dark&height=full"]);
  });

  test("requires confirmation before creating or refreshing a public display URL", async () => {
    const { ctx } = createContext(["dashboards", "public-url", baseId, "Ops"]);

    await expect(pulseCli.run(ctx)).rejects.toThrow("Refusing to enable or refresh a public link without --yes.");
  });

  test("keeps overview JSON compact unless inventory is requested", async () => {
    const { ctx, lines } = createContext(
      ["overview", baseId],
      {},
      [jsonResponse(base), jsonResponse([source]), jsonResponse(inventory), jsonResponse([]), jsonResponse([])],
      "json",
    );

    await pulseCli.run(ctx);

    const payload = JSON.parse(lines[0]!);
    expect(payload.inventory).toBeUndefined();
    expect(payload.summary).toEqual({
      base: "Test",
      sources: 1,
      resources: 1,
      resourceTypes: 1,
      metrics: 0,
      metricSeries: 1,
      events: 0,
      states: 1,
    });
    expect(payload.topResources).toHaveLength(1);
  });
});
