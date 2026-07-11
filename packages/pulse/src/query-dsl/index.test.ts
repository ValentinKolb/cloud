import { describe, expect, test } from "bun:test";
import { compilePulseQueryText, durationToInterval, tokenizeQueryText } from ".";

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

  test("rejects excessive lookback windows", () => {
    const result = compilePulseQueryText(baseId, "metric docker.container.cpu.usage avg every 1h since 365d");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("compact durations");
  });

  test("keeps duration conversion aligned with parser duration limits", () => {
    expect(durationToInterval("5m")).toBe("5 minutes");
    expect(durationToInterval("0m")).toBeNull();
    expect(durationToInterval("365d")).toBeNull();
  });

  test("reports empty and unterminated query text distinctly", () => {
    const empty = compilePulseQueryText(baseId, "   ");
    const unterminated = compilePulseQueryText(baseId, 'events deploy.finished where service="api');

    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.message).toBe("Query is empty");
    expect(unterminated.ok).toBe(false);
    if (!unterminated.ok) expect(unterminated.error.message).toBe("Query has an unterminated quote");
  });

  test("rejects pre-V1 entity type aliases", () => {
    for (const query of [
      "states service.online entity app-core entity-type service limit 10",
      "states service.online entity app-core entitytype service limit 10",
    ]) {
      const result = compilePulseQueryText(baseId, query);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain("Unexpected token");
    }
  });
});
