import { describe, expect, test } from "bun:test";

describe("published App page routes", () => {
  test("keep SSR anonymous-friendly and IP-rate-limited", async () => {
    const source = await Bun.file(new URL("../index.ts", import.meta.url)).text();
    const routes = source.slice(source.indexOf("export const customAppRoutes"), source.indexOf("/**\n * Default export"));

    expect(routes).toContain('rateLimit({ keyBy: "ip", limitPerSecond: 10, windowSecs: 60 })');
    expect(routes.match(/auth\.requireRole\("\*"\)/g)).toHaveLength(2);
    expect(routes).not.toContain('auth.requireRole("authenticated"');
    expect(routes).not.toContain("auth.redirectToLogin");
  });

  test("keeps App document downloads public-capable and mutations authenticated", async () => {
    const source = await Bun.file(new URL("../../api/custom-apps.ts", import.meta.url)).text();
    const download = source.indexOf('/documents/:runId/download"');
    const authenticated = source.indexOf('.use(deps.requireAuthenticated ?? auth.requireRole("authenticated"))');
    const rowAction = source.indexOf('/row-actions/:actionId"');
    const scanner = source.indexOf('/:blockId/scanner"');

    expect(download).toBeGreaterThan(0);
    expect(download).toBeLessThan(authenticated);
    expect(rowAction).toBeGreaterThan(authenticated);
    expect(scanner).toBeGreaterThan(authenticated);
    expect(source).toContain("executePublishedCustomAppRecords");
    expect(source).toContain("published.response.rows.some((row) => row.recordId === rowId)");
  });
});
