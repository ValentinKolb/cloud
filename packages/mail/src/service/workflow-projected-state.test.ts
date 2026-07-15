import { describe, expect, test } from "bun:test";
import type { WorkflowBoundPlan } from "@valentinkolb/cloud/workflows";
import type { FrozenMailWorkflowSource } from "./workflow-data";
import { applyMailConversationTransition, applyMailMessageTransition, createMailWorkflowProjectedState } from "./workflow-projected-state";

const plan = {
  inputs: [
    { name: "message", type: "mailMessage", config: {} },
    { name: "conversation", type: "mailConversation", config: {} },
  ],
} as WorkflowBoundPlan;

const source = {
  message: { id: "message", folderId: "inbox", keywords: ["finance"] },
  conversation: { id: "conversation", workStatus: "open", revision: 2 },
} as FrozenMailWorkflowSource;

describe("Mail workflow projected state", () => {
  test("shares projected objects between context and declared inputs without mutating the snapshot", () => {
    const projected = createMailWorkflowProjectedState(plan, source, { caller: "kept" });

    expect(projected.inputs.message).toBe(projected.source.message);
    expect(projected.inputs.conversation).toBe(projected.source.conversation);
    expect(projected.inputs.caller).toBe("kept");

    applyMailMessageTransition(projected.source.message, "moveMessage", "archive");
    expect((projected.inputs.message as Record<string, unknown>).folderId).toBe("archive");
    expect(source.message.folderId).toBe("inbox");
  });

  test("applies message transitions idempotently with stable keyword comparison", () => {
    const message = structuredClone(source.message);

    expect(applyMailMessageTransition(message, "addKeyword", "FINANCE")).toBe(false);
    expect(applyMailMessageTransition(message, "addKeyword", "Review")).toBe(true);
    expect(applyMailMessageTransition(message, "removeKeyword", "review")).toBe(true);
    expect(applyMailMessageTransition(message, "removeKeyword", "review")).toBe(false);
    expect(message.keywords).toEqual(["finance"]);
  });

  test("projects conversation revisions only when state changes", () => {
    if (!source.conversation) throw new Error("Expected workflow conversation fixture");
    const conversation = structuredClone(source.conversation);

    expect(applyMailConversationTransition(conversation, "setConversationStatus", "open")).toBe(false);
    expect(applyMailConversationTransition(conversation, "setConversationStatus", "done")).toBe(true);
    expect(conversation).toMatchObject({ status: "done", workStatus: "done", responseNeeded: false, revision: 3 });
  });
});
