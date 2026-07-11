import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import type { SqlClient } from "./audit";
import { dispatchRecordEventOutbox, enqueueRecordEvent } from "./record-event-outbox";
import type { GridsRecordEvent } from "./record-events";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;
const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

type Fixture = { actorId: string; baseId: string; tableId: string; fieldId: string };

const createFixture = (): Fixture => ({ actorId: uuid(), baseId: uuid(), tableId: uuid(), fieldId: uuid() });

const insertFixture = async (fixture: Fixture): Promise<void> => {
  await sql`
    INSERT INTO auth.users (id, uid, provider, profile, display_name, given_name, sn)
    VALUES (${fixture.actorId}::uuid, ${`outbox-${fixture.actorId}`}, 'local', 'user', 'Outbox Test', 'Outbox', 'Test')
  `;
  await sql`
    INSERT INTO grids.bases (id, short_id, name, created_by)
    VALUES (${fixture.baseId}::uuid, ${shortId("B")}, 'Record event outbox', ${fixture.actorId}::uuid)
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES (${fixture.tableId}::uuid, ${shortId("T")}, ${fixture.baseId}::uuid, 'Items', 0)
  `;
  await sql`
    INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
    VALUES (${fixture.fieldId}::uuid, ${shortId("F")}, ${fixture.tableId}::uuid, 'Name', 'text', '{}'::jsonb, 0)
  `;
};

const cleanupFixture = async (fixture: Fixture): Promise<void> => {
  await sql`DELETE FROM grids.audit_log WHERE base_id = ${fixture.baseId}::uuid OR table_id = ${fixture.tableId}::uuid`;
  await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
  await sql`DELETE FROM auth.users WHERE id = ${fixture.actorId}::uuid`;
};

const insertRecordAndEvent = async (client: SqlClient, fixture: Fixture, name: string): Promise<{ recordId: string; outboxId: string }> => {
  const recordId = uuid();
  await client`
    INSERT INTO grids.records (id, table_id, data, version, created_by, updated_by)
    VALUES (
      ${recordId}::uuid,
      ${fixture.tableId}::uuid,
      ${{ [fixture.fieldId]: name }}::jsonb,
      1,
      ${fixture.actorId}::uuid,
      ${fixture.actorId}::uuid
    )
  `;
  const outboxId = await enqueueRecordEvent(client, {
    type: "record.created",
    baseId: fixture.baseId,
    tableId: fixture.tableId,
    recordId,
    version: 1,
    changedFieldIds: [fixture.fieldId],
    actorId: fixture.actorId,
  });
  return { recordId, outboxId };
};

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("record event outbox integration", () => {
  postgresTest("commits records and events atomically, retries publishing, and deduplicates delivery", async () => {
    const fixture = createFixture();
    try {
      await insertFixture(fixture);
      const created = await sql.begin((tx) => insertRecordAndEvent(tx, fixture, "Camera"));

      const [stored] = await sql<Array<{ record_count: number; status: string; attempts: number; payload: GridsRecordEvent }>>`
        SELECT
          (SELECT count(*)::int FROM grids.records WHERE id = ${created.recordId}::uuid) AS record_count,
          status,
          attempts,
          payload
        FROM grids.record_event_outbox
        WHERE id = ${created.outboxId}::uuid
      `;
      expect(stored?.record_count).toBe(1);
      expect(stored?.status).toBe("pending");
      expect(stored?.payload).toMatchObject({
        type: "record.created",
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        recordId: created.recordId,
        version: 1,
        actorId: fixture.actorId,
      });

      const publishFailure = new Error("redis unavailable");
      await expect(dispatchRecordEventOutbox(created.outboxId, async () => Promise.reject(publishFailure))).rejects.toThrow(
        "redis unavailable",
      );
      const [failed] = await sql<Array<{ status: string; attempts: number; last_error: string | null }>>`
        SELECT status, attempts, last_error FROM grids.record_event_outbox WHERE id = ${created.outboxId}::uuid
      `;
      expect(failed).toEqual({ status: "failed", attempts: 1, last_error: "redis unavailable" });

      const published: GridsRecordEvent[] = [];
      let releasePublish!: () => void;
      let markPublishStarted!: () => void;
      const publishBarrier = new Promise<void>((resolve) => {
        releasePublish = resolve;
      });
      const publishStarted = new Promise<void>((resolve) => {
        markPublishStarted = resolve;
      });
      const firstDispatch = dispatchRecordEventOutbox(created.outboxId, async (event) => {
        published.push(event);
        markPublishStarted();
        await publishBarrier;
      });
      await publishStarted;
      const concurrentDispatch = dispatchRecordEventOutbox(created.outboxId, async (event) => {
        published.push(event);
      });
      releasePublish();
      expect(await Promise.all([firstDispatch, concurrentDispatch])).toEqual(["delivered", "already-delivered"]);
      expect(published).toHaveLength(1);
      expect(published[0]).toEqual(stored?.payload);
      expect(
        await dispatchRecordEventOutbox(created.outboxId, async (event) => {
          published.push(event);
        }),
      ).toBe("already-delivered");
      expect(published).toHaveLength(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("rolls back the outbox row when the surrounding record transaction fails", async () => {
    const fixture = createFixture();
    let recordId: string | null = null;
    let outboxId: string | null = null;
    try {
      await insertFixture(fixture);
      await expect(
        sql.begin(async (tx) => {
          const created = await insertRecordAndEvent(tx, fixture, "Rolled back");
          recordId = created.recordId;
          outboxId = created.outboxId;
          throw new Error("force rollback");
        }),
      ).rejects.toThrow("force rollback");
      expect(recordId).not.toBeNull();
      expect(outboxId).not.toBeNull();
      const [counts] = await sql<Array<{ records: number; events: number }>>`
        SELECT
          (SELECT count(*)::int FROM grids.records WHERE id = ${recordId}::uuid) AS records,
          (SELECT count(*)::int FROM grids.record_event_outbox WHERE id = ${outboxId}::uuid) AS events
      `;
      expect(counts).toEqual({ records: 0, events: 0 });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("moves poison events to a terminal dead-letter state", async () => {
    const fixture = createFixture();
    try {
      await insertFixture(fixture);
      const created = await sql.begin((tx) => insertRecordAndEvent(tx, fixture, "Poison"));
      await sql`UPDATE grids.record_event_outbox SET attempts = 19 WHERE id = ${created.outboxId}::uuid`;
      await expect(dispatchRecordEventOutbox(created.outboxId, async () => Promise.reject(new Error("invalid event")))).rejects.toThrow(
        "invalid event",
      );
      const [row] = await sql<Array<{ status: string; attempts: number; last_error: string | null }>>`
        SELECT status, attempts, last_error FROM grids.record_event_outbox WHERE id = ${created.outboxId}::uuid
      `;
      expect(row).toEqual({ status: "dead", attempts: 20, last_error: "invalid event" });
      expect(await dispatchRecordEventOutbox(created.outboxId, async () => undefined)).toBe("dead");
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
