import { describe, expect, test } from "bun:test";

describe("published Custom App page routes", () => {
  test("keep SSR anonymous-friendly and IP-rate-limited", async () => {
    const source = await Bun.file(new URL("../index.ts", import.meta.url)).text();
    const routes = source.slice(source.indexOf("export const customAppRoutes"), source.indexOf("/**\n * Default export"));

    expect(routes).toContain('rateLimit({ keyBy: "ip", limitPerSecond: 10, windowSecs: 60 })');
    expect(routes.match(/auth\.requireRole\("\*"\)/g)).toHaveLength(2);
    expect(routes).not.toContain('auth.requireRole("authenticated"');
    expect(routes).not.toContain("auth.redirectToLogin");
  });
});
