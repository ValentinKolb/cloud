import { describe, expect, test } from "bun:test";
import { type GridsRecordEvent, publishRecordEvent, reclaimRecordEventDeliveries, recordEventReader } from "./record-events";

const redisTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

describe("record event topic recovery", () => {
  redisTest("reclaims an abandoned consumer-group delivery", async () => {
    const baseId = Bun.randomUUIDv7();
    const group = `reclaim-${Bun.randomUUIDv7()}`;
    const event: GridsRecordEvent = {
      v: 1,
      type: "record.updated",
      baseId,
      tableId: Bun.randomUUIDv7(),
      recordId: Bun.randomUUIDv7(),
      version: 2,
      changedFieldIds: [],
      actorId: null,
      occurredAt: new Date().toISOString(),
    };
    const streamKey = `cloud:grids:events:${baseId}:records:stream`;
    const idempotencyKey = `cloud:grids:events:${baseId}:records:idempotency:${event.type}:${event.recordId}:${event.version}:${event.occurredAt}`;
    try {
      await publishRecordEvent(event);
      const original = await recordEventReader(group).recv({ tenantId: baseId, wait: false });
      expect(original?.data).toEqual(event);

      const reclaimed = await reclaimRecordEventDeliveries(baseId, group, 0);
      expect(reclaimed).toHaveLength(1);
      expect(reclaimed[0]?.data).toEqual(event);
      expect(await reclaimed[0]?.commit()).toBe(true);
    } finally {
      await Bun.redis.send("DEL", [streamKey, idempotencyKey]);
    }
  });
});
