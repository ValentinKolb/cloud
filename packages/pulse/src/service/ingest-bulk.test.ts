import { describe, expect, test } from "bun:test";
import { prepareIngestBatch } from "./ingest-bulk";

describe("Pulse bulk ingest preparation", () => {
  test("binds every signal to the authenticated source instead of payload source ids", () => {
    const sourceId = "11111111-1111-4111-8111-111111111111";
    const prepared = prepareIngestBatch(
      {
        metrics: [
          {
            name: "system.cpu.usage",
            value: 42,
            sourceId: "22222222-2222-4222-8222-222222222222",
            entityId: "host:alpha",
            entityType: "host",
            dimensions: { host: "alpha" },
          },
        ],
        events: [
          {
            kind: "deploy.finished",
            sourceId: null,
            entityId: "host:alpha",
            entityType: "host",
            resource: { type: "host", id: "host:alpha", label: "alpha" },
            attributes: { request_id: "request-1", location: { city: "Berlin" } },
          },
        ],
        states: [
          {
            key: "system.online",
            value: true,
            sourceId: "33333333-3333-4333-8333-333333333333",
            entityId: "host:alpha",
            entityType: "host",
          },
        ],
      },
      sourceId,
    );

    expect(prepared.metrics[0]?.seriesKey.startsWith(`${sourceId}\u001f`)).toBe(true);
    expect(prepared.resources).toHaveLength(1);
    expect(prepared.resources[0]?.key).toBe("host:host:alpha");
    expect(prepared.events[0]?.attributes).toEqual({ request_id: "request-1", location: { city: "Berlin" } });
  });

  test("does not materialize event identities as resources without an explicit resource", () => {
    const prepared = prepareIngestBatch(
      {
        events: [
          {
            kind: "page.viewed",
            actorId: "visitor:high-cardinality",
            sessionId: "session:high-cardinality",
            entityId: "page:/pricing",
            entityType: "page",
            attributes: { url: "https://example.com/pricing?request=unique" },
          },
        ],
      },
      "11111111-1111-4111-8111-111111111111",
    );

    expect(prepared.resources).toEqual([]);
    expect(prepared.events[0]?.resourceKey).toBeNull();
  });

  test("deduplicates resource and dimension metadata for large set-based writes", () => {
    const prepared = prepareIngestBatch(
      {
        metrics: Array.from({ length: 1_000 }, (_, index) => ({
          name: `system.metric.${index % 10}`,
          value: index,
          entityId: "host:alpha",
          entityType: "host",
          dimensions: { host: "alpha", region: "eu" },
        })),
      },
      "11111111-1111-4111-8111-111111111111",
    );

    expect(prepared.metrics).toHaveLength(1_000);
    expect(prepared.resources).toHaveLength(1);
    expect(prepared.dimensionKeys).toEqual([
      { scope: "metric", key: "host" },
      { scope: "metric", key: "region" },
    ]);
  });
});
