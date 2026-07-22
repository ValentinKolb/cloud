import { describe, expect, test } from "bun:test";
import { type AppSloWindow, gridsSloStatus } from "./grids-operational-health";

const window = (name: AppSloWindow["window"], requestCount: number, availabilityRatio: number): AppSloWindow => ({
  window: name,
  requestCount,
  availabilityRatio,
  errorCount: Math.round(requestCount * (1 - availabilityRatio)),
  slowCount: 0,
  fastRequestRatio: 1,
  observedSeconds: name === "1h" ? 3600 : name === "6h" ? 21_600 : 2_592_000,
});

describe("gridsSloStatus", () => {
  test("does not alert on low-volume samples", () => {
    expect(gridsSloStatus([window("1h", 10, 0.5), window("6h", 20, 0.5)])).toBe("ok");
  });

  test("detects fast and slow availability burn", () => {
    expect(gridsSloStatus([window("1h", 100, 0.98)])).toBe("error");
    expect(gridsSloStatus([window("6h", 500, 0.99)])).toBe("warn");
  });

  test("keeps healthy traffic quiet", () => {
    expect(gridsSloStatus([window("1h", 1000, 0.9999), window("6h", 5000, 0.9995)])).toBe("ok");
  });
});
