import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import type { PulseSource } from "../../contracts";
import { createSourceController } from "./source-controller";

const source: PulseSource = {
  id: "source-1",
  baseId: "base-1",
  kind: "http_ingest",
  name: "Ingest",
  enabled: true,
  endpointUrl: null,
  bearerTokenConfigured: false,
  scrapeIntervalSeconds: null,
  lastSeenAt: null,
  lastError: null,
  lastErrorAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("Pulse write controllers do not repeat a write while canonical data is stale", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return Response.json({});
  }) as unknown as typeof fetch;
  let dispose = () => {};
  const controller = createRoot((nextDispose) => {
    dispose = nextDispose;
    return createSourceController({
      selectedBaseId: () => "base-1",
      loading: () => false,
      setLoading: () => false,
      setSelectedSourceId: () => "",
      navigate: () => undefined,
      refreshBaseData: () => Promise.resolve(),
      refreshSourceDetail: () => Promise.resolve(),
      refreshDashboard: () => Promise.resolve(),
      writeBlocked: () => true,
    });
  });

  try {
    await expect(controller.createApiKey(source, { name: "Blocked", expiresAt: null, permission: "write" })).rejects.toThrow(
      "Refresh Pulse data before making more changes.",
    );
    expect(requests).toBe(0);
  } finally {
    dispose();
    globalThis.fetch = originalFetch;
  }
});
