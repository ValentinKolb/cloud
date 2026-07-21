import { beforeAll, describe, expect } from "bun:test";
import { sql } from "bun";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import {
  getDeadRecordEventDeliveryFailure,
  listDeadRecordEventDeliveryFailures,
  recordRecordEventDeliveryFailure,
} from "./record-event-delivery-failures";

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

const createBase = async (name: string): Promise<string> => {
  const id = testUuid();
  await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${id}::uuid, ${testShortId("B")}, ${name})`;
  return id;
};

describe("record event delivery failures integration", () => {
  postgresTest("transitions exactly at the attempt limit and keeps terminal data immutable", async () => {
    const baseId = await createBase("Delivery failure lifecycle");
    try {
      const input = {
        baseId,
        consumerGroup: "inventory-index",
        eventId: "event-1",
        payload: "original payload",
        error: "first error",
        maxAttempts: 3,
      };

      expect(await recordRecordEventDeliveryFailure(input)).toEqual({ attempts: 1, dead: false });
      expect(await recordRecordEventDeliveryFailure({ ...input, error: "second error" })).toEqual({ attempts: 2, dead: false });
      expect(await recordRecordEventDeliveryFailure({ ...input, error: "terminal error" })).toEqual({ attempts: 3, dead: true });
      expect(await recordRecordEventDeliveryFailure({ ...input, payload: "must not replace", error: "must not replace" })).toEqual({
        attempts: 3,
        dead: true,
      });

      const dead = await listDeadRecordEventDeliveryFailures(baseId, 0);
      expect(dead).toHaveLength(1);
      expect(dead[0]).toMatchObject({ attempts: 3, error: "terminal error", payload: "original payload" });
      expect(await getDeadRecordEventDeliveryFailure(baseId, dead[0]!.id)).toEqual(dead[0]!);
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  postgresTest("marks the first attempt dead when the configured limit is one", async () => {
    const baseId = await createBase("Immediate dead letter");
    try {
      const failure = await recordRecordEventDeliveryFailure({
        baseId,
        consumerGroup: "scanner",
        eventId: "event-1",
        payload: null,
        error: "invalid payload",
        maxAttempts: 1,
      });
      expect(failure).toEqual({ attempts: 1, dead: true });
      expect(await listDeadRecordEventDeliveryFailures(baseId)).toHaveLength(1);
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  postgresTest("serializes concurrent attempts without losing increments", async () => {
    const baseId = await createBase("Concurrent delivery failures");
    try {
      const input = {
        baseId,
        consumerGroup: "workflow",
        eventId: "event-1",
        payload: "payload",
        error: "retry",
        maxAttempts: 4,
      };
      const attempts = await Promise.all(Array.from({ length: 4 }, () => recordRecordEventDeliveryFailure(input)));
      expect(attempts.some((entry) => entry.dead)).toBe(true);

      const dead = await listDeadRecordEventDeliveryFailures(baseId, 1_000);
      expect(dead).toHaveLength(1);
      expect(dead[0]?.attempts).toBe(4);
      expect(await getDeadRecordEventDeliveryFailure(baseId, testUuid())).toBeNull();

      const otherBaseId = await createBase("Isolated delivery failures");
      try {
        expect(await getDeadRecordEventDeliveryFailure(otherBaseId, dead[0]!.id)).toBeNull();
      } finally {
        await sql`DELETE FROM grids.bases WHERE id = ${otherBaseId}::uuid`;
      }
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });
});
