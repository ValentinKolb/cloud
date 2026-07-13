import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { RECORD_EVENT_MAX_INVALID_ATTEMPTS, recordInvalidRecordEventDelivery } from "./record-event-delivery-failures";
import { recordEventReader } from "./record-events";
import { createWorkflowTriggerReaderRuntime } from "./workflow-trigger-readers";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;
const shortId = () => `B${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

const waitFor = async (condition: () => Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await condition()) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for record event delivery state");
};

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("record event delivery failures", () => {
  postgresTest("moves invalid deliveries to an immutable dead-letter state after bounded attempts", async () => {
    const baseId = Bun.randomUUIDv7();
    const eventId = `${Date.now()}-0`;
    await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${shortId()}, 'Delivery failure test')`;
    try {
      for (let attempt = 1; attempt <= RECORD_EVENT_MAX_INVALID_ATTEMPTS; attempt++) {
        const result = await recordInvalidRecordEventDelivery({
          baseId,
          consumerGroup: "workflow-triggers",
          eventId,
          payload: '{"v":2}',
          error: "v: expected literal 1",
        });
        expect(result).toEqual({ attempts: attempt, dead: attempt === RECORD_EVENT_MAX_INVALID_ATTEMPTS });
      }

      const terminal = await recordInvalidRecordEventDelivery({
        baseId,
        consumerGroup: "workflow-triggers",
        eventId,
        payload: "replacement must not win",
        error: "replacement must not win",
      });
      expect(terminal).toEqual({ attempts: RECORD_EVENT_MAX_INVALID_ATTEMPTS, dead: true });

      const [stored] = await sql<
        Array<{ attempts: number; status: string; payload: string; error: string; dead_at: Date | string | null }>
      >`
        SELECT attempts, status, payload, error, dead_at
        FROM grids.record_event_delivery_failures
        WHERE base_id = ${baseId}::uuid AND consumer_group = 'workflow-triggers' AND event_id = ${eventId}
      `;
      expect(stored).toMatchObject({
        attempts: RECORD_EVENT_MAX_INVALID_ATTEMPTS,
        status: "dead",
        payload: '{"v":2}',
        error: "v: expected literal 1",
      });
      expect(stored?.dead_at).not.toBeNull();
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  postgresTest("serializes concurrent invalid-delivery attempts", async () => {
    const baseId = Bun.randomUUIDv7();
    const eventId = `${Date.now()}-1`;
    await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${shortId()}, 'Concurrent delivery failure test')`;
    try {
      const results = await Promise.all(
        Array.from({ length: RECORD_EVENT_MAX_INVALID_ATTEMPTS }, () =>
          recordInvalidRecordEventDelivery({
            baseId,
            consumerGroup: "workflow-triggers",
            eventId,
            payload: "{broken",
            error: "payload is not valid JSON",
          }),
        ),
      );
      expect(results.map((result) => result.attempts).sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5]);
      expect(results.filter((result) => result.dead)).toHaveLength(1);

      const [stored] = await sql<Array<{ attempts: number; status: string; dead_at: Date | string | null }>>`
        SELECT attempts, status, dead_at
        FROM grids.record_event_delivery_failures
        WHERE base_id = ${baseId}::uuid AND consumer_group = 'workflow-triggers' AND event_id = ${eventId}
      `;
      expect(stored).toMatchObject({ attempts: RECORD_EVENT_MAX_INVALID_ATTEMPTS, status: "dead" });
      expect(stored?.dead_at).not.toBeNull();
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  postgresTest("keeps poison events pending until the terminal failure is durable", async () => {
    const baseId = Bun.randomUUIDv7();
    const streamKey = `cloud:grids:events:${baseId}:records:stream`;
    await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${shortId()}, 'Poison delivery lifecycle test')`;
    await Bun.redis.send("XADD", [streamKey, "*", "payload", "{broken"]);
    const runtime = createWorkflowTriggerReaderRuntime({
      log: { warn: () => undefined },
      workflows: {
        listRecordEventBaseIds: async () => [baseId],
        listRecordEventEnabled: async () => [],
        recordMatchesWorkflowFilter: async () => ({ ok: true, data: true }),
      },
      prepareRecordEvent: async () => {
        throw new Error("No valid record event should be prepared");
      },
      recordEventReader: (group) => {
        const reader = recordEventReader(group);
        return {
          ...reader,
          recv: (config) => reader.recv({ ...config, timeoutMs: config?.wait === false ? config.timeoutMs : 10 }),
          reclaim: (config) => reader.reclaim({ ...config, minIdleMs: 0 }),
        };
      },
      recordInvalidRecordEventDelivery,
      latestMetadataEventCursor: async () => null,
      liveMetadataEvents: async function* ({ signal }) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      queuePreparedRun: async () => {
        throw new Error("No valid record event should be queued");
      },
      recordDispatchFailure: async () => undefined,
      scheduleReconcile: () => undefined,
      retryDelayMs: 1,
    });
    try {
      await runtime.reconcile();
      await waitFor(async () => {
        const [failure] = await sql<Array<{ attempts: number; status: string }>>`
          SELECT attempts, status
          FROM grids.record_event_delivery_failures
          WHERE base_id = ${baseId}::uuid AND consumer_group = 'workflow-triggers'
        `;
        return failure?.attempts === RECORD_EVENT_MAX_INVALID_ATTEMPTS && failure.status === "dead";
      });
      await waitFor(async () => Number(await Bun.redis.send("XPENDING", [streamKey, "workflow-triggers"]).then((value) => value[0])) === 0);

      const [failure] = await sql<Array<{ attempts: number; status: string }>>`
        SELECT attempts, status
        FROM grids.record_event_delivery_failures
        WHERE base_id = ${baseId}::uuid AND consumer_group = 'workflow-triggers'
      `;
      expect(failure).toEqual({ attempts: RECORD_EVENT_MAX_INVALID_ATTEMPTS, status: "dead" });
    } finally {
      await runtime.stopAll();
      await Bun.redis.send("DEL", [streamKey]);
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });
});
