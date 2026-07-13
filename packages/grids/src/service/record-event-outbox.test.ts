import { describe, expect, test } from "bun:test";
import { waitForRecordEventOutboxDrain } from "./record-event-outbox";

const drained = { activeDeliveries: 0, activeReconciles: 0 };

describe("record event outbox shutdown", () => {
  test("reports a fully drained runtime", async () => {
    expect(await waitForRecordEventOutboxDrain(() => drained, 0)).toEqual({ drained: true, state: drained });
  });

  test("reports outstanding work when the deadline expires", async () => {
    const active = { activeDeliveries: 1, activeReconciles: 1 };
    expect(await waitForRecordEventOutboxDrain(() => active, 0)).toEqual({ drained: false, state: active });
  });

  test("waits for in-flight work to settle", async () => {
    let reads = 0;
    const result = await waitForRecordEventOutboxDrain(() => {
      reads += 1;
      return reads === 1 ? { activeDeliveries: 1, activeReconciles: 0 } : drained;
    }, 100);
    expect(result).toEqual({ drained: true, state: drained });
  });
});
