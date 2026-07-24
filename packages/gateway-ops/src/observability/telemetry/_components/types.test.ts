import { describe, expect, test } from "bun:test";
import {
  buildTelemetryFilterUrl,
  clearTelemetryFiltersUrl,
  closeRouteUrl,
  defaultTelemetryFilter,
  hasActiveTelemetryFilters,
  parseTelemetryFilterFromUrl,
  selectAppUrl,
  TELEMETRY_PAGE_PATH,
} from "./types";

const parse = (query: string) => parseTelemetryFilterFromUrl(new URL(`http://cloud${TELEMETRY_PAGE_PATH}${query}`));

describe("parseTelemetryFilterFromUrl", () => {
  test("falls back to defaults on an empty query", () => {
    expect(parse("")).toEqual(defaultTelemetryFilter);
  });

  test("reads every supported param", () => {
    expect(parse("?range=7d&app=mail&route=/app/mail/inbox&sort=requests&errors=1&slow=1")).toEqual({
      range: "7d",
      appId: "mail",
      route: "/app/mail/inbox",
      sort: "requests",
      errorsOnly: true,
      slowOnly: true,
    });
  });

  test("rejects unknown range and sort values", () => {
    // Hand-edited URLs must not reach SQL as an unvalidated interval or ORDER BY.
    const filter = parse("?range=all-time&sort=; DROP TABLE");
    expect(filter.range).toBe(defaultTelemetryFilter.range);
    expect(filter.sort).toBe(defaultTelemetryFilter.sort);
  });
});

describe("buildTelemetryFilterUrl", () => {
  test("omits defaults", () => {
    expect(buildTelemetryFilterUrl(defaultTelemetryFilter)).toBe(TELEMETRY_PAGE_PATH);
  });

  test("round-trips through the parser", () => {
    const filter = {
      range: "30d",
      appId: "grids",
      route: "/api/grids/bases/:baseId",
      sort: "slow",
      errorsOnly: true,
      slowOnly: false,
    } as const;
    expect(parseTelemetryFilterFromUrl(new URL(`http://cloud${buildTelemetryFilterUrl(filter)}`))).toEqual(filter);
  });

  test("applies a patch over the current filter", () => {
    const url = buildTelemetryFilterUrl({ ...defaultTelemetryFilter, appId: "mail" }, { range: "1h" });
    expect(url).toContain("range=1h");
    expect(url).toContain("app=mail");
  });
});

describe("navigation helpers", () => {
  test("switching app closes a drilldown from another app", () => {
    const current = { ...defaultTelemetryFilter, appId: "mail", route: "/app/mail/inbox" };
    expect(selectAppUrl(current, "grids")).not.toContain("route=");
  });

  test("closing the drilldown keeps the rest of the filter", () => {
    const current = { ...defaultTelemetryFilter, range: "7d", appId: "mail", route: "/app/mail/inbox", sort: "requests" } as const;
    const url = closeRouteUrl(current);
    expect(url).not.toContain("route=");
    expect(url).toContain("range=7d");
    expect(url).toContain("app=mail");
    expect(url).toContain("sort=requests");
  });
});

describe("hasActiveTelemetryFilters", () => {
  test("a bare range is not an active filter", () => {
    expect(hasActiveTelemetryFilters({ ...defaultTelemetryFilter, range: "30d" })).toBe(false);
  });

  test("app, route, sort and row filters each count", () => {
    expect(hasActiveTelemetryFilters({ ...defaultTelemetryFilter, appId: "mail" })).toBe(true);
    expect(hasActiveTelemetryFilters({ ...defaultTelemetryFilter, route: "/x" })).toBe(true);
    expect(hasActiveTelemetryFilters({ ...defaultTelemetryFilter, sort: "requests" })).toBe(true);
    expect(hasActiveTelemetryFilters({ ...defaultTelemetryFilter, errorsOnly: true })).toBe(true);
    expect(hasActiveTelemetryFilters({ ...defaultTelemetryFilter, slowOnly: true })).toBe(true);
  });

  test("clearing keeps the range and drops everything else", () => {
    const url = clearTelemetryFiltersUrl({ ...defaultTelemetryFilter, range: "7d", appId: "mail", slowOnly: true, sort: "requests" });
    expect(url).toBe(`${TELEMETRY_PAGE_PATH}?range=7d`);
  });
});
