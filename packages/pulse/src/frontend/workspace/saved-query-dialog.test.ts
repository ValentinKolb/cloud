import { describe, expect, test } from "bun:test";
import type { PulseExplorerQuery } from "../../contracts";
import { defaultSavedQueryName, normalizeSavedQueryDialogResult } from "./saved-query-dialog-model";

const metricQuery: PulseExplorerQuery = {
  kind: "metric",
  baseId: "base-a",
  metric: "system.cpu.usage",
  aggregation: "avg",
  bucket: "5m",
  since: "24h",
};

describe("Pulse saved query dialog helpers", () => {
  test("derives default names from compiled queries", () => {
    expect(defaultSavedQueryName(metricQuery)).toBe("system.cpu.usage");
    expect(
      defaultSavedQueryName({ kind: "events", baseId: "base-a", event: "deploy.finished", since: "24h", limit: 100 }),
    ).toBe("deploy.finished");
    expect(defaultSavedQueryName({ kind: "events", baseId: "base-a", event: null, since: "24h", limit: 100 })).toBe(
      "All events",
    );
    expect(
      defaultSavedQueryName({ kind: "states", baseId: "base-a", state: "service.online", since: "24h", limit: 100 }),
    ).toBe("service.online");
    expect(defaultSavedQueryName({ kind: "states", baseId: "base-a", state: null, since: "24h", limit: 100 })).toBe(
      "All states",
    );
    expect(defaultSavedQueryName(null)).toBe("Pulse query");
  });

  test("normalizes dialog results", () => {
    expect(normalizeSavedQueryDialogResult(null)).toBeNull();
    expect(normalizeSavedQueryDialogResult({ name: "   ", description: "ignored" })).toBeNull();
    expect(normalizeSavedQueryDialogResult({ name: "  CPU trend  ", description: "  Useful for dashboards  " })).toEqual({
      name: "CPU trend",
      description: "Useful for dashboards",
    });
    expect(normalizeSavedQueryDialogResult({ name: "Errors", description: "   " })).toEqual({
      name: "Errors",
      description: null,
    });
  });
});
