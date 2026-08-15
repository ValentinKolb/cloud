import { describe, expect, test } from "bun:test";
import { deriveConversationWorkState, deriveReopenedConversationWorkStatus, isAutomaticSubmission } from "./conversation-work-state";

describe("conversation work-state transitions", () => {
  test("derives reopened state from the latest verified message and defaults ambiguity to needs action", () => {
    expect(deriveReopenedConversationWorkStatus(null)).toBe("needs_action");
    expect(deriveReopenedConversationWorkStatus({ direction: "inbound", intent: "observed_reply", automatic: false })).toBe("needs_action");
    expect(deriveReopenedConversationWorkStatus({ direction: "outbound", intent: "observed_reply", automatic: false })).toBe("waiting");
    expect(deriveReopenedConversationWorkStatus({ direction: "outbound", intent: "observed_reply", automatic: true })).toBe("needs_action");
    expect(deriveReopenedConversationWorkStatus({ direction: "outbound", intent: "observed_message", automatic: false })).toBe(
      "needs_action",
    );
  });
  test("reopens every current state for a new inbound message and clears snooze", () => {
    for (const current of ["needs_action", "waiting", "done"] as const) {
      expect(deriveConversationWorkState(current, { direction: "inbound", intent: "observed_message", automatic: false })).toEqual({
        workStatus: "needs_action",
        clearSnooze: true,
      });
    }
  });

  test("moves confirmed human replies to waiting", () => {
    for (const intent of ["reply", "reply_all", "observed_reply"] as const) {
      expect(deriveConversationWorkState("needs_action", { direction: "outbound", intent, automatic: false })).toEqual({
        workStatus: "waiting",
        clearSnooze: false,
      });
    }
  });

  test("does not infer a next step for forwards, new messages, or automatic replies", () => {
    expect(deriveConversationWorkState("needs_action", { direction: "outbound", intent: "forward", automatic: false })).toEqual({
      workStatus: "needs_action",
      clearSnooze: false,
    });
    expect(deriveConversationWorkState("done", { direction: "outbound", intent: "new", automatic: false })).toEqual({
      workStatus: "done",
      clearSnooze: false,
    });
    expect(deriveConversationWorkState("needs_action", { direction: "outbound", intent: "reply", automatic: true })).toEqual({
      workStatus: "needs_action",
      clearSnooze: false,
    });
  });

  test("recognizes RFC Auto-Submitted values without treating explicit no as automatic", () => {
    expect(isAutomaticSubmission(null)).toBe(false);
    expect(isAutomaticSubmission("no")).toBe(false);
    expect(isAutomaticSubmission(" NO ")).toBe(false);
    expect(isAutomaticSubmission("auto-replied")).toBe(true);
    expect(isAutomaticSubmission("auto-generated")).toBe(true);
  });
});
