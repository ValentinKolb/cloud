import { describe, expect, test } from "bun:test";
import type { PulseExplorerQuery } from "../../contracts";
import { compileDashboardDsl } from "../../dashboard-dsl";
import { compilePulseQueryText } from "../../query-dsl";
import { compactMetricUnit, dashboardCellSpan, dashboardQueryLine, dashboardWidgetSnippetFromQuery, gaugeMax } from "./helpers";

const compileSnippet = (snippet: string) =>
  compileDashboardDsl(
    `dashboard "Test" {
  section "Main" {
    ${snippet
      .split("\n")
      .map((line) => (line.trim() ? `    ${line}` : line))
      .join("\n")}
  }
}`,
    (query) => {
      const compiled = compilePulseQueryText("base", query);
      return compiled.ok ? { ok: true, data: compiled.data } : { ok: false, message: compiled.error.message };
    },
  );

describe("Pulse workspace dashboard snippets", () => {
  test("auto-splits dashboard rows without explicit spans", () => {
    expect(dashboardCellSpan(undefined, 1)).toBe(12);
    expect(dashboardCellSpan(undefined, 2)).toBe(6);
    expect(dashboardCellSpan(undefined, 3)).toBe(4);
    expect(dashboardCellSpan(undefined, 4)).toBe(3);
    expect(dashboardCellSpan(8, 3)).toBe(8);
  });

  test("formats percent units compactly for charts", () => {
    expect(compactMetricUnit("percent")).toBe("%");
    expect(compactMetricUnit("percentage")).toBe("%");
    expect(compactMetricUnit("bytes")).toBe("bytes");
    expect(gaugeMax("percent", 61)).toBe(100);
  });

  test("normalizes query lines without changing quoted values", () => {
    expect(dashboardQueryLine(' metric app.orders sum\n  every  1h \n where customer="ACME  North" env=\'prod  blue\' ')).toBe(
      'metric app.orders sum every 1h where customer="ACME  North" env=\'prod  blue\'',
    );
  });

  test("copies metric queries as selected visual widgets", () => {
    const query = "metric system.cpu.usage avg every 5m since 24h where host=server";
    const compiled = compilePulseQueryText("base", query);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const snippet = dashboardWidgetSnippetFromQuery(query, compiled.data as PulseExplorerQuery, "gauge");
    expect(snippet).toContain('gauge "system.cpu.usage"');
    expect(compileSnippet(snippet).ok).toBe(true);
  });

  test("copies line visual metric queries as line syntax", () => {
    const query = "metric system.cpu.usage avg every 5m since 24h";
    const compiled = compilePulseQueryText("base", query);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const snippet = dashboardWidgetSnippetFromQuery(query, compiled.data as PulseExplorerQuery, "line");
    expect(snippet).toContain('line "system.cpu.usage"');
    expect(compileSnippet(snippet).ok).toBe(true);
  });

  test("copies event queries as table widgets", () => {
    const query = "events deploy.finished since 24h limit 25";
    const compiled = compilePulseQueryText("base", query);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const snippet = dashboardWidgetSnippetFromQuery(query, compiled.data as PulseExplorerQuery, "line");
    expect(snippet).toContain('table "deploy.finished"');
    expect(compileSnippet(snippet).ok).toBe(true);
  });

  test("copies state queries as table widgets", () => {
    const query = "states service.online since 10m entity_type service limit 50";
    const compiled = compilePulseQueryText("base", query);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const snippet = dashboardWidgetSnippetFromQuery(query, compiled.data as PulseExplorerQuery, "stat");
    expect(snippet).toContain('table "service.online"');
    expect(compileSnippet(snippet).ok).toBe(true);
  });
});
