import { describe, expect, test } from "bun:test";
import type { MailWorkflowTargetSnapshot } from "./workflow-data";
import { mailWorkflowEventContext } from "./workflow-data";

describe("Mail workflow event context", () => {
  test("freezes source data and receipt-time preconditions into the kernel event", () => {
    const snapshot = {
      targetKey: "remote-message",
      source: {
        message: { remoteMessageRefId: "remote-message" },
        conversation: null,
      },
      preconditions: {
        sourceHash: "source-hash",
        remoteState: { modseq: "42", flags: ["seen"], keywords: ["review"] },
        conversation: null,
        triggerKind: "messageReceived",
      },
      internalDate: "2026-07-26T12:00:00.000Z",
    } as unknown as MailWorkflowTargetSnapshot;

    expect(mailWorkflowEventContext("mailbox", snapshot)).toEqual({
      mailboxId: "mailbox",
      source: snapshot.source,
      preconditions: snapshot.preconditions,
    });
  });
});
