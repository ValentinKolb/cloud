import { describe, expect, test } from "bun:test";
import { mailWorkflowMessagePrecondition } from "./workflow-message-preconditions";

describe("Mail workflow message preconditions", () => {
  const context = {
    source: { message: { remoteMessageRefId: "remote", id: "message", folderId: "folder" } },
    preconditions: {
      message: { remoteMessageRefId: "remote", id: "message", folderId: "folder" },
      remoteState: { modseq: "42", flags: ["seen"], keywords: ["review"] },
    },
  };
  const target = { messageId: "message", remoteMessageRefId: "remote", folderId: "folder" };

  test("returns the receipt-time provider state for the frozen message", () => {
    expect(mailWorkflowMessagePrecondition(context, target)).toEqual({
      modseq: "42",
      flags: ["seen"],
      keywords: ["review"],
    });
  });

  test("fails closed for another message or missing state", () => {
    expect(() => mailWorkflowMessagePrecondition(context, { ...target, messageId: "other" })).toThrow(
      "Frozen remote message preconditions are unavailable",
    );
    expect(() => mailWorkflowMessagePrecondition({ source: context.source }, target)).toThrow(
      "Frozen remote message preconditions are unavailable",
    );
  });
});
