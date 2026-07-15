import { describe, expect, mock, test } from "bun:test";
import type { QueueReceived } from "@valentinkolb/sync";
import type { GridsRecordEvent } from "./record-events";
import {
  processFailedWorkflowRecordEventDelivery,
  processInvalidWorkflowRecordEventDelivery,
  workflowRecordEventRetryDelayMs,
} from "./workflow-kernel-record-events";

const BASE_ID = "00000000-0000-4000-8000-000000000001";

const invalidDelivery = (input: { ack?: () => Promise<boolean>; nack?: () => Promise<boolean> } = {}): QueueReceived<GridsRecordEvent> => ({
  data: { invalid: true } as unknown as GridsRecordEvent,
  messageId: "event-1",
  deliveryId: "delivery-1",
  attempt: 1,
  leaseUntil: Date.now() + 60_000,
  meta: { baseId: BASE_ID },
  ack: input.ack ?? (async () => true),
  nack: input.nack ?? (async () => true),
  touch: async () => true,
});

describe("workflow record-event recovery", () => {
  test("backs off failed deliveries without exceeding five minutes", () => {
    expect(workflowRecordEventRetryDelayMs(1)).toBe(1_000);
    expect(workflowRecordEventRetryDelayMs(5)).toBe(16_000);
    expect(workflowRecordEventRetryDelayMs(20)).toBe(300_000);
  });

  test("retries invalid queue work until the failure budget is exhausted", async () => {
    const ack = mock(async () => true);
    const nack = mock(async () => true);
    const retrying = mock(async () => ({ attempts: 1, dead: false }));
    const dead = mock(async () => ({ attempts: 5, dead: true }));

    await processInvalidWorkflowRecordEventDelivery(invalidDelivery({ ack, nack }), retrying);
    expect(ack).not.toHaveBeenCalled();
    expect(nack).toHaveBeenCalledTimes(1);

    await processInvalidWorkflowRecordEventDelivery(invalidDelivery({ ack, nack }), dead);
    expect(ack).toHaveBeenCalledTimes(1);
  });

  test("surfaces a rejected acknowledgement for dead invalid events", async () => {
    const delivery = invalidDelivery({ ack: mock(async () => false) });
    const dead = mock(async () => ({ attempts: 5, dead: true }));

    await expect(processInvalidWorkflowRecordEventDelivery(delivery, dead)).rejects.toThrow(
      "record event acknowledgement was not accepted",
    );
  });

  test("rejects invalid work without trustworthy base metadata", async () => {
    const nack = mock(async () => true);
    const delivery = { ...invalidDelivery({ nack }), meta: undefined };
    const recordFailure = mock(async () => ({ attempts: 1, dead: false }));

    await processInvalidWorkflowRecordEventDelivery(delivery, recordFailure);

    expect(recordFailure).not.toHaveBeenCalled();
    expect(nack).toHaveBeenCalledTimes(1);
  });

  test("keeps invalid work retryable when its failure cannot be persisted", async () => {
    const nack = mock(async () => true);
    const delivery = { ...invalidDelivery({ nack }), attempt: 6 };
    const recordFailure = mock(async () => {
      throw new Error("PostgreSQL unavailable");
    });

    await processInvalidWorkflowRecordEventDelivery(delivery, recordFailure);

    expect(nack).toHaveBeenCalledWith(expect.objectContaining({ delayMs: 32_000, reason: "failure_store_unavailable" }));
  });

  test("persists dispatch failures and retries with backoff", async () => {
    const nack = mock(async () => true);
    const delivery = { ...invalidDelivery({ nack }), data: validEvent() };
    const recordFailure = mock(async () => ({ attempts: 3, dead: false }));

    await processFailedWorkflowRecordEventDelivery(delivery, delivery.data, new Error("database unavailable"), recordFailure);

    expect(recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ maxAttempts: 20, error: "database unavailable", baseId: BASE_ID }),
    );
    expect(nack).toHaveBeenCalledWith(expect.objectContaining({ delayMs: 4_000, reason: "dispatch_failed" }));
  });

  test("keeps retrying when the application failure store is unavailable", async () => {
    const nack = mock(async () => true);
    const delivery = { ...invalidDelivery({ nack }), attempt: 7, data: validEvent() };
    const recordFailure = mock(async () => {
      throw new Error("PostgreSQL unavailable");
    });

    const result = await processFailedWorkflowRecordEventDelivery(delivery, delivery.data, new Error("dispatch failed"), recordFailure);

    expect(result).toEqual({ attempts: 7, dead: false });
    expect(nack).toHaveBeenCalledWith(expect.objectContaining({ delayMs: 64_000, reason: "failure_store_unavailable" }));
  });

  test("acknowledges dispatch failures after the application retry budget", async () => {
    const ack = mock(async () => true);
    const delivery = { ...invalidDelivery({ ack }), data: validEvent() };
    const recordFailure = mock(async () => ({ attempts: 20, dead: true }));

    await processFailedWorkflowRecordEventDelivery(delivery, delivery.data, new Error("permanent failure"), recordFailure);

    expect(ack).toHaveBeenCalledTimes(1);
  });
});

const validEvent = (): GridsRecordEvent => ({
  v: 1,
  type: "record.updated",
  baseId: BASE_ID,
  tableId: "00000000-0000-4000-8000-000000000002",
  recordId: "00000000-0000-4000-8000-000000000003",
  version: 2,
  changedFieldIds: [],
  actorId: null,
  occurredAt: "2026-07-15T12:00:00.000Z",
});
