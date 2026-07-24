import { describe, expect, test } from "bun:test";
import { diagnoseRange, errorRate, rangeHours, routeRows, TELEMETRY_RANGES, TELEMETRY_SORTS } from "./telemetry";

describe("diagnoseRange", () => {
  test("maps a free-form lookback onto a supported range", () => {
    expect(diagnoseRange(1)).toBe("1h");
    expect(diagnoseRange(3)).toBe("6h");
    expect(diagnoseRange(24)).toBe("24h");
    expect(diagnoseRange(48)).toBe("7d");
    expect(diagnoseRange(24 * 90)).toBe("30d");
  });

  test("only ever returns a range the API accepts", () => {
    // `diagnose --since` is free-form, so an unmapped value would reach the
    // API as an invalid enum and fail the whole bundle.
    for (const hours of [0, 1, 5, 6, 7, 23, 24, 25, 167, 168, 169, 1000]) {
      expect(TELEMETRY_RANGES).toContain(diagnoseRange(hours) as (typeof TELEMETRY_RANGES)[number]);
    }
  });
});

describe("rangeHours", () => {
  test("round-trips every supported range", () => {
    expect(TELEMETRY_RANGES.map(rangeHours)).toEqual([1, 6, 24, 168, 720]);
  });

  test("falls back to a day for anything unexpected", () => {
    expect(rangeHours("nonsense")).toBe(24);
  });
});

describe("errorRate", () => {
  test("formats a percentage", () => {
    expect(errorRate(976, 976)).toBe("100.0%");
    expect(errorRate(1, 1000)).toBe("0.1%");
  });

  test("does not divide by zero", () => {
    expect(errorRate(0, 0)).toBe("-");
  });
});

describe("routeRows", () => {
  test("keeps the route identifiable and formats durations", () => {
    const [row] = routeRows([
      {
        appId: "mail",
        route: "/api/mail/mailboxes/:id",
        requests: 200,
        errors: 20,
        slowRequests: 3,
        avgDurationMs: 12.4,
        maxDurationMs: 2500,
      },
    ]);
    expect(row).toEqual({
      route: "/api/mail/mailboxes/:id",
      app: "mail",
      requests: 200,
      errors: 20,
      errorRate: "10.0%",
      slow: 3,
      avgMs: "12ms",
      maxMs: "2.50s",
    });
  });

  test("renders missing durations rather than crashing", () => {
    const [row] = routeRows([
      { appId: "core", route: "/", requests: 0, errors: 0, slowRequests: 0, avgDurationMs: null, maxDurationMs: null },
    ]);
    expect(row?.avgMs).toBe("-");
    expect(row?.errorRate).toBe("-");
  });
});

describe("sort options", () => {
  test("expose both rate-based and absolute error ordering", () => {
    // They answer different questions: worst rate vs most failures overall.
    expect(TELEMETRY_SORTS).toContain("errorRate");
    expect(TELEMETRY_SORTS).toContain("errors");
  });
});
