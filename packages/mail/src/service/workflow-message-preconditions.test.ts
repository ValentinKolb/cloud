import { describe, expect, test } from "bun:test";
import { mailWorkflowMessagePrecondition } from "./workflow-message-preconditions";

describe("Mail workflow message preconditions", () => {
  const context = {
    source: { message: { remoteMessageRefId: "message" } },
    preconditions: { remoteState: { modseq: "42", flags: ["seen"], keywords: ["review"] } },
  };

  test("returns the receipt-time provider state for the frozen message", () => {
    expect(mailWorkflowMessagePrecondition(context, "message")).toEqual({
      modseq: "42",
      flags: ["seen"],
      keywords: ["review"],
    });
  });

  test("fails closed for another message or missing state", () => {
    expect(() => mailWorkflowMessagePrecondition(context, "other")).toThrow("Frozen remote message preconditions are unavailable");
    expect(() => mailWorkflowMessagePrecondition({ source: context.source }, "message")).toThrow(
      "Frozen remote message preconditions are unavailable",
    );
  });
});
