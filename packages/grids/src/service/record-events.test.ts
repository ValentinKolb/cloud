import { describe, expect, test } from "bun:test";
import { RECORD_EVENT_WORK_PARTITIONS, recordEventWorkPartition, recordEventWorkReader } from "./record-events";

describe("record event workflow partitioning", () => {
  test("routes every event for a record to one stable work partition", () => {
    const recordId = "00000000-0000-4000-8000-000000000001";
    const first = recordEventWorkPartition(recordId);

    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(RECORD_EVENT_WORK_PARTITIONS);
    expect(recordEventWorkPartition(recordId)).toBe(first);
  });

  test("rejects readers outside the configured partition range", () => {
    expect(() => recordEventWorkReader(-1)).toThrow("record event work partition -1 is unavailable");
    expect(() => recordEventWorkReader(RECORD_EVENT_WORK_PARTITIONS)).toThrow(
      `record event work partition ${RECORD_EVENT_WORK_PARTITIONS} is unavailable`,
    );
  });
});
