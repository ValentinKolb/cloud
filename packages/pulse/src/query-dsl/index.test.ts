import { describe, expect, test } from "bun:test";
import { compilePulseQueryText, tokenizeQueryText } from ".";

const baseId = "00000000-0000-4000-8000-000000000000";
const sourceId = "11111111-1111-4111-8111-111111111111";

describe("Pulse query DSL", () => {
  test("tokenizes quoted filters", () => {
    expect(tokenizeQueryText('events deploy.finished where service="web app", env=prod')).toEqual([
      "events",
      "deploy.finished",
      "where",
      "service=web app",
      ",",
      "env=prod",
    ]);
  });

  test("compiles metric queries with source, entity, and dimensions", () => {
    const result = compilePulseQueryText(
      baseId,
      `metric docker.container.cpu.usage avg every 1m since 6h source ${sourceId} entity container:app-core entity_type container where env=prod`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      kind: "metric",
      baseId,
      metric: "docker.container.cpu.usage",
      aggregation: "avg",
      bucket: "1m",
      since: "6h",
      sourceId,
      entityId: "container:app-core",
      entityType: "container",
      dimensions: { env: "prod" },
    });
  });

  test("compiles events and states queries", () => {
    const events = compilePulseQueryText(baseId, "events deploy.finished since 24h entity app-core limit 50");
    const states = compilePulseQueryText(baseId, "states service.online entity app-core entity_type service limit 10");
    expect(events.ok).toBe(true);
    expect(states.ok).toBe(true);
    if (events.ok) expect(events.data).toMatchObject({ kind: "events", event: "deploy.finished", entityId: "app-core", limit: 50 });
    if (states.ok) expect(states.data).toMatchObject({ kind: "states", state: "service.online", entityId: "app-core", entityType: "service", limit: 10 });
  });
});
