import { describe, expect, test } from "bun:test";
import { TopicPayloadError } from "@valentinkolb/sync";
import { type GridsRecordEvent, publishRecordEvent, recordEventReader } from "./record-events";

const redisTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

describe("record event topic recovery", () => {
  redisTest("distributes one event to only one replica reader in the consumer group", async () => {
    const baseId = Bun.randomUUIDv7();
    const group = `replicas-${Bun.randomUUIDv7()}`;
    const event: GridsRecordEvent = {
      v: 1,
      type: "record.updated",
      baseId,
      tableId: Bun.randomUUIDv7(),
      recordId: Bun.randomUUIDv7(),
      version: 1,
      changedFieldIds: [],
      actorId: null,
      occurredAt: new Date().toISOString(),
    };
    const streamKey = `cloud:grids:events:${baseId}:records:stream`;
    const idempotencyKey = `cloud:grids:events:${baseId}:records:idempotency:${event.type}:${event.recordId}:${event.version}:${event.occurredAt}`;
    try {
      await publishRecordEvent(event);
      const [first, second] = await Promise.all([
        recordEventReader(group).recv({ tenantId: baseId, wait: false }),
        recordEventReader(group).recv({ tenantId: baseId, wait: false }),
      ]);
      const deliveries = [first, second].filter((delivery) => delivery !== null);

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]?.data).toEqual(event);
      expect(await deliveries[0]?.commit()).toBe(true);
    } finally {
      await Bun.redis.send("DEL", [streamKey, idempotencyKey]);
    }
  });

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
      const reader = recordEventReader(group);
      const original = await reader.recv({ tenantId: baseId, wait: false });
      expect(original?.data).toEqual(event);

      const reclaimed = await reader.reclaim?.({ tenantId: baseId, minIdleMs: 0 });
      if (!reclaimed) throw new Error("Expected topic reclaim support");
      expect(reclaimed.entries).toHaveLength(1);
      const recovered = reclaimed.entries[0];
      if (recovered?.kind !== "delivery") throw new Error("Expected a recovered record event");
      expect(recovered.delivery.data).toEqual(event);
      expect(await recovered.delivery.commit()).toBe(true);
    } finally {
      await Bun.redis.send("DEL", [streamKey, idempotencyKey]);
    }
  });

  redisTest("surfaces and reclaims malformed transport envelopes", async () => {
    const baseId = Bun.randomUUIDv7();
    const group = `invalid-${Bun.randomUUIDv7()}`;
    const streamKey = `cloud:grids:events:${baseId}:records:stream`;
    try {
      await Bun.redis.send("XADD", [streamKey, "*", "payload", "{broken"]);
      const reader = recordEventReader(group);

      await expect(reader.recv({ tenantId: baseId, wait: false, invalidPayload: "throw" })).rejects.toBeInstanceOf(TopicPayloadError);
      const reclaimed = await reader.reclaim({ tenantId: baseId, minIdleMs: 0 });
      expect(reclaimed.entries).toHaveLength(1);
      const recovered = reclaimed.entries[0];
      if (recovered?.kind !== "invalid") throw new Error("Expected an invalid recovered record event");
      expect(recovered.rawPayload).toBe("{broken");
      expect(await recovered.commit()).toBe(true);
    } finally {
      await Bun.redis.send("DEL", [streamKey]);
    }
  });
});
