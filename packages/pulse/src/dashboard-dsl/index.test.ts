import { describe, expect, test } from "bun:test";
import type { MetricQuery, PulseExplorerQuery } from "../contracts";
import { compileDashboardDsl, parseDashboardDsl } from ".";

const metricQuery = (query: string): { ok: true; data: PulseExplorerQuery } | { ok: false; message: string } => {
  const parts = query.split(/\s+/);
  if (parts[0] !== "metric") return { ok: false, message: "Only metric queries are supported in this test" };
  const result: MetricQuery = {
    kind: "metric",
    baseId: "base",
    metric: parts[1] ?? "",
    aggregation: (parts[2] as MetricQuery["aggregation"]) ?? "latest",
    bucket: "5m",
    since: "24h",
    sourceId: null,
    dimensions: {},
  };
  const everyIndex = parts.indexOf("every");
  if (everyIndex >= 0) result.bucket = parts[everyIndex + 1] ?? result.bucket;
  const sinceIndex = parts.indexOf("since");
  if (sinceIndex >= 0) result.since = parts[sinceIndex + 1] ?? result.since;
  return { ok: true, data: result };
};

const solarDashboard = `dashboard "Solar overview" {
  description "Live power, battery state, and grid interaction."

  section "Today" {
    description "Operational view for the current day."

    card "Battery" {
      description "Shows current charge and recent charge/discharge trend."

      gauge "Charge" {
        description "Latest state of charge reported by the inverter."
        query metric solar.battery.charge_percent latest since 10m
      }
    }

    markdown "Notes" {
      """
      ## Operating notes

      - Values update every minute.
      - Grid import above 2 kW usually means the battery is empty.
      - Check inverter status if output drops while irradiance is high.
      """
    }
  }
}`;

describe("Pulse dashboard DSL", () => {
  test("parses the solar dashboard block syntax", () => {
    const result = parseDashboardDsl(solarDashboard);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.title).toBe("Solar overview");
    expect(result.data.blocks).toHaveLength(1);
    expect(result.data.blocks[0]?.kind).toBe("section");
  });

  test("compiles card, gauge, and markdown blocks to dashboard layout", () => {
    const result = compileDashboardDsl(solarDashboard, metricQuery);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const section = result.data.layout?.sections[0];
    expect(section?.title).toBe("Today");
    const card = section?.rows[0]?.cells[0];
    expect(card?.kind).toBe("card");
    if (card?.kind !== "card") return;
    expect(card.title).toBe("Battery");
    const gauge = card.rows[0]?.cells[0];
    expect(gauge?.kind).toBe("metric");
    if (gauge?.kind !== "metric") return;
    expect(gauge.metric).toBe("solar.battery.charge_percent");
    expect(gauge.visual).toBe("gauge");
    expect(gauge.since).toBe("10m");
    const markdown = section?.rows[0]?.cells[1];
    expect(markdown?.kind).toBe("markdown");
  });

  test("reports syntax diagnostics for unknown statements", () => {
    const result = parseDashboardDsl('dashboard "Broken" { widget "Nope" {} }');
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain("Unsupported dashboard statement");
  });

  test("forwards embedded query diagnostics", () => {
    const result = compileDashboardDsl(
      'dashboard "Broken" { section "Main" { gauge "Charge" { query events deploy.finished since 1h } } }',
      metricQuery,
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain("Only metric queries");
  });
});
