import { describe, expect, test } from "bun:test";
import { derivePulseResource, pulseSignalSubject } from "./resource-model";

describe("Pulse resource model", () => {
  test("derives Docker container resources from host and container dimensions", () => {
    const resource = derivePulseResource({
      signalName: "docker.container.cpu.usage",
      dimensions: {
        host: "host-a",
        container: "app-core",
        container_id: "abc123",
      },
    });

    expect(resource).toEqual({
      key: "container:host-a/abc123",
      id: "host-a/abc123",
      label: "app-core",
      type: "container",
    });
  });

  test("derives host resources from generic system data without Docker-specific counters", () => {
    const resource = derivePulseResource({
      signalName: "system.memory.usage",
      dimensions: {
        host: "MacBookPro",
      },
    });

    expect(resource).toEqual({
      key: "host:MacBookPro",
      id: "MacBookPro",
      label: "MacBookPro",
      type: "host",
    });
  });

  test("uses explicit business entities before source fallback", () => {
    const resource = derivePulseResource({
      signalName: "sales.orders.created",
      entityId: "shop:kolb-antik",
      entityType: "shop",
      sourceId: "source-a",
      dimensions: {
        channel: "webshop",
      },
    });

    expect(resource).toEqual({
      key: "shop:shop:kolb-antik",
      id: "shop:kolb-antik",
      label: "shop:kolb-antik",
      type: "shop",
    });
  });

  test("falls back to source resources when no entity or dimensions identify a resource", () => {
    const resource = derivePulseResource({
      signalName: "custom.metric",
      sourceId: "source-a",
      dimensions: {},
    });

    expect(resource).toEqual({
      key: "source:source-a",
      id: "source-a",
      label: "source-a",
      type: "source",
    });
  });

  test("formats signal subjects from the derived resource", () => {
    expect(
      pulseSignalSubject({
        signalName: "system.net.rx",
        dimensions: {
          host: "host-a",
          interface: "en0",
        },
      }),
    ).toBe("network:en0");
  });
});
