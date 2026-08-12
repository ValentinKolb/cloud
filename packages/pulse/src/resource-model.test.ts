import { describe, expect, test } from "bun:test";
import { derivePulseResource, explicitPulseResource, pulseSignalSubject } from "./resource-model";
import { PULSE_RESOURCE_KEY_MAX_LENGTH } from "./telemetry-contract";

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

  test("uses explicit business entities when present", () => {
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

  test("does not expose an internal Source ID as a resource identity", () => {
    const resource = derivePulseResource({
      signalName: "custom.metric",
      sourceId: "11111111-1111-4111-8111-111111111111",
      dimensions: {},
    });

    expect(resource).toBeNull();
  });

  test("keeps observed resource keys within the CloudResourceRef budget", () => {
    const type = "service";
    const allowedId = "a".repeat(PULSE_RESOURCE_KEY_MAX_LENGTH - type.length - 1);

    expect(explicitPulseResource({ type, id: allowedId })?.key).toHaveLength(PULSE_RESOURCE_KEY_MAX_LENGTH);
    expect(explicitPulseResource({ type, id: `${allowedId}a` })).toBeNull();
    expect(
      derivePulseResource({
        signalName: "custom.metric",
        entityType: type,
        entityId: `${allowedId}a`,
        dimensions: {},
      }),
    ).toBeNull();
    expect(
      derivePulseResource({
        signalName: "custom.metric",
        entityType: type,
        entityId: ` ${allowedId}`,
        dimensions: {},
      }),
    ).toBeNull();
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
