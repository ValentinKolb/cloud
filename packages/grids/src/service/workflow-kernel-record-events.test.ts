import { describe, expect, mock, test } from "bun:test";
import type { TopicInvalidDelivery } from "@valentinkolb/sync";
import { processInvalidWorkflowRecordEventDelivery } from "./workflow-kernel-record-events";

const BASE_ID = "00000000-0000-4000-8000-000000000001";

const invalidDelivery = (commit: () => Promise<boolean>): TopicInvalidDelivery => ({
  kind: "invalid",
  eventId: "event-1",
  deliveryId: "delivery-1",
  cursor: "1-0",
  error: "invalid payload",
  rawPayload: "{",
  commit,
});

describe("workflow record-event recovery", () => {
  test("commits reclaimed invalid events only after the retry budget is exhausted", async () => {
    const commit = mock(async () => true);
    const retrying = mock(async () => ({ attempts: 1, dead: false }));
    const dead = mock(async () => ({ attempts: 5, dead: true }));

    await processInvalidWorkflowRecordEventDelivery(BASE_ID, invalidDelivery(commit), retrying);
    expect(commit).not.toHaveBeenCalled();

    await processInvalidWorkflowRecordEventDelivery(BASE_ID, invalidDelivery(commit), dead);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  test("surfaces a rejected acknowledgement for dead invalid events", async () => {
    const delivery = invalidDelivery(mock(async () => false));
    const dead = mock(async () => ({ attempts: 5, dead: true }));

    await expect(processInvalidWorkflowRecordEventDelivery(BASE_ID, delivery, dead)).rejects.toThrow(
      "record event acknowledgement was not accepted",
    );
  });
});
