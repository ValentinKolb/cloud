import { describe, expect, test } from "bun:test";
import type { PulseExplorerQuery } from "../../contracts";
import {
  explorerResultViewAfterQuery,
  failedQueryDiagnostics,
  metricControlsFromQuery,
  queryRunApplication,
  shouldRememberQueryRun,
  shouldToastQueryError,
  validQueryDiagnostics,
} from "./query-runner";

const metricQuery: PulseExplorerQuery = {
  kind: "metric",
  baseId: "base-a",
  metric: "system.cpu.usage",
  aggregation: "avg",
  bucket: "5m",
  since: "24h",
  sourceId: "source-a",
};

const eventsQuery: PulseExplorerQuery = {
  kind: "events",
  baseId: "base-a",
  event: "deploy.finished",
  since: "24h",
  limit: 100,
};

describe("Pulse text query runner helpers", () => {
  test("extracts metric query controls for the editor state", () => {
    expect(metricControlsFromQuery(metricQuery)).toEqual({
      aggregation: "avg",
      bucket: "5m",
      metric: "system.cpu.usage",
      since: "24h",
      sourceId: "source-a",
    });
    expect(metricControlsFromQuery(eventsQuery)).toBeNull();
  });

  test("keeps charts for metric queries and switches row queries to table output", () => {
    expect(explorerResultViewAfterQuery("chart", metricQuery)).toBe("chart");
    expect(explorerResultViewAfterQuery("chart", eventsQuery)).toBe("table");
    expect(explorerResultViewAfterQuery("compiled", eventsQuery)).toBe("compiled");
  });

  test("creates successful query diagnostics", () => {
    expect(validQueryDiagnostics(metricQuery)).toEqual({
      ok: true,
      diagnostics: [{ severity: "info", message: "Query is valid." }],
      compiled: metricQuery,
    });
  });

  test("normalizes query run application data", () => {
    expect(
      queryRunApplication("chart", {
        compiled: eventsQuery,
        points: [],
        events: [],
        states: [],
      }),
    ).toMatchObject({
      metricControls: null,
      nextResultView: "table",
      diagnostics: validQueryDiagnostics(eventsQuery),
    });
  });

  test("normalizes query error handling policy", () => {
    expect(failedQueryDiagnostics("Nope")).toEqual({
      ok: false,
      diagnostics: [{ severity: "error", message: "Nope" }],
      compiled: null,
    });
    expect(shouldRememberQueryRun({})).toBe(true);
    expect(shouldRememberQueryRun({ manual: false, remember: false })).toBe(false);
    expect(shouldToastQueryError({})).toBe(true);
    expect(shouldToastQueryError({ manual: false })).toBe(false);
  });
});
