import { describe, expect, test } from "bun:test";
import type { MetricQuery, PulseExplorerQuery } from "../contracts";
import { compilePulseQueryText } from "../query-dsl";
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

  test("compiles controls and visual conditions", () => {
    const result = compileDashboardDsl(
      `dashboard "Controlled" {
        controls {
          range "Range" variable range options 1h, 6h
        }

        section "Main" {
          stat "Orders" {
            query metric sales.orders increase every 1h since $range
            warn when value > 100 message "High order volume"
          }
        }
      }`,
      metricQuery,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.layout?.controls?.[0]).toMatchObject({ kind: "range", variable: "range", defaultValue: "1h" });
    const widget = result.data.layout?.sections[0]?.rows[0]?.cells[0];
    expect(widget?.kind).toBe("metric");
    if (widget?.kind !== "metric") return;
    expect(widget.since).toBe("1h");
    expect(widget.conditions?.[0]).toMatchObject({ level: "warn", operator: ">", value: 100 });
  });

  test("supports grid rows and label/text controls", () => {
    const result = compileDashboardDsl(
      `dashboard "Scoped" {
        controls {
          label "Region" variable region default eu options eu, us
          text "Search" variable search default checkout
        }

        section "Main" {
          grid height lg {
            chart "Orders" {
              query metric sales.orders increase every 1h since 24h where region=$region, term=$search
            }
          }
        }
      }`,
      (query) => {
        const compiled = compilePulseQueryText("base", query);
        return compiled.ok ? { ok: true, data: compiled.data } : { ok: false, message: compiled.error.message };
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.layout?.controls?.map((control) => control.kind)).toEqual(["label", "text"]);
    const row = result.data.layout?.sections[0]?.rows[0];
    expect(row?.height).toBe("lg");
    const widget = row?.cells[0];
    expect(widget?.kind).toBe("metric");
    if (widget?.kind !== "metric") return;
    expect(widget.dimensions).toEqual({ region: "eu", term: "checkout" });
  });

  test("does not replace partial dashboard control variable names", () => {
    const result = compileDashboardDsl(
      `dashboard "Scoped" {
        controls {
          label "Env" variable env default prod
        }

        section "Main" {
          chart "Orders" {
            query metric sales.orders avg every 5m since 24h where environment=$environment, env=$env
          }
        }
      }`,
      (query) => {
        expect(query).toContain("environment=$environment");
        expect(query).toContain("env=prod");
        return { ok: false, message: "stop" };
      },
    );
    expect(result.ok).toBe(false);
  });

  test("reports query diagnostics for excessive dashboard lookback", () => {
    const result = compileDashboardDsl(
      `dashboard "Too broad" {
        section "Main" {
          chart "Orders" {
            query metric sales.orders avg every 1h since 365d
          }
        }
      }`,
      (query) => {
        const compiled = compilePulseQueryText("base", query);
        return compiled.ok ? { ok: true, data: compiled.data } : { ok: false, message: compiled.error.message };
      },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain("compact durations");
  });

  test("compiles events and states as table widgets", () => {
    const result = compileDashboardDsl(
      `dashboard "Ops" {
        section "Activity" {
          table "Deploys" {
            query events deploy.finished since 24h entity service:api limit 25
          }

          table "Current states" {
            query states service.online entity_type service limit 50
          }
        }
      }`,
      (query) => {
        const compiled = compilePulseQueryText("base", query);
        return compiled.ok ? { ok: true, data: compiled.data } : { ok: false, message: compiled.error.message };
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [eventsWidget, statesWidget] = result.data.layout?.sections[0]?.rows[0]?.cells ?? [];
    expect(eventsWidget?.kind).toBe("events");
    if (eventsWidget?.kind !== "events") return;
    expect(eventsWidget.query.kind).toBe("events");
    expect(eventsWidget.query.event).toBe("deploy.finished");
    expect(eventsWidget.query.entityId).toBe("service:api");
    expect(eventsWidget.query.limit).toBe(25);
    expect(statesWidget?.kind).toBe("states");
    if (statesWidget?.kind !== "states") return;
    expect(statesWidget.query.kind).toBe("states");
    expect(statesWidget.query.state).toBe("service.online");
    expect(statesWidget.query.entityType).toBe("service");
    expect(statesWidget.query.limit).toBe(50);
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
