import { describe, expect, test } from "bun:test";
import type { MailRequestContext } from "./auth";
import { createMailWorkflowActionPorts } from "./workflow-runtime-actions";

describe("Mail workflow runtime action ports", () => {
  test("composes Mail domain actions with shared built-ins", () => {
    const ports = createMailWorkflowActionPorts({
      authority: { kind: "actor", context: {} as MailRequestContext },
      mailboxId: "11111111-1111-4111-8111-111111111111",
      workflowVersionId: "22222222-2222-4222-8222-222222222222",
      targetId: "33333333-3333-4333-8333-333333333333",
      preconditions: {},
    });

    for (const action of [
      "addKeyword",
      "removeKeyword",
      "moveMessage",
      "assignConversation",
      "setConversationStatus",
      "setVariable",
      "succeed",
      "fail",
    ]) {
      expect(ports.execute.get(action)).toBeDefined();
      expect(ports.dryRun.get(action)).toBeDefined();
    }
    expect(ports.execute.get("unknown")).toBeUndefined();
    expect(ports.dryRun.get("unknown")).toBeUndefined();
  });
});
