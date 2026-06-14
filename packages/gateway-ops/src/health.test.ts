import { describe, expect, test } from "bun:test";
import { type GatewayHealth, scopeGatewayHealth } from "./health";

const baseHealth = {
  status: "ok",
  checkedAt: "2026-06-14T00:00:00.000Z",
  summary: {
    apps: 0,
    healthy: 0,
    degraded: 0,
    offline: 0,
    routes: 4,
    requests: 42,
    errors: 0,
    unmatchedRequests: 1,
    gatewayInstances: 1,
  },
  apps: [
    {
      id: "app-a",
      name: "App A",
      icon: "ti ti-a",
      status: "ok",
      online: true,
      healthy: true,
      lastSeenAt: "2026-06-14T00:00:00.000Z",
      offlineForMs: 0,
    },
    {
      id: "app-b",
      name: "App B",
      icon: "ti ti-b",
      status: "warn",
      online: true,
      healthy: false,
      lastSeenAt: "2026-06-14T00:00:00.000Z",
      offlineForMs: 0,
    },
  ],
} satisfies GatewayHealth;

describe("scopeGatewayHealth", () => {
  test("recomputes app counters for scoped health without changing gateway-wide route counters", () => {
    const scoped = scopeGatewayHealth(baseHealth, ["app-a"]);

    expect(scoped.status).toBe("ok");
    expect(scoped.summary.apps).toBe(1);
    expect(scoped.summary.healthy).toBe(1);
    expect(scoped.summary.degraded).toBe(0);
    expect(scoped.summary.routes).toBe(4);
    expect(scoped.summary.requests).toBe(42);
    expect(scoped.apps.map((app) => app.id)).toEqual(["app-a"]);
  });

  test("keeps global route errors as warning signal for scoped health", () => {
    const scoped = scopeGatewayHealth(
      {
        ...baseHealth,
        summary: { ...baseHealth.summary, errors: 1 },
      },
      ["app-a"],
    );

    expect(scoped.status).toBe("warn");
  });

  test("keeps empty scope behavior compatible with the existing all-app health view", () => {
    const scoped = scopeGatewayHealth(baseHealth, []);

    expect(scoped.summary.apps).toBe(2);
    expect(scoped.summary.degraded).toBe(1);
  });
});
