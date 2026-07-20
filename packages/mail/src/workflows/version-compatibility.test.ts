import { describe, expect, test } from "bun:test";
import type { WorkflowBoundPlan, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { retiredMailWorkflowConfiguration } from "./version-compatibility";

const plan = (
  action: string,
  config: Record<string, WorkflowJsonValue>,
  bindings: Record<string, WorkflowJsonValue> = {},
): WorkflowBoundPlan => ({
  schemaVersion: 2,
  languageId: "mail",
  languageVersion: 1,
  sourceHash: "source",
  manifestHash: "manifest",
  catalogHash: "catalog",
  actionPolicies: {},
  inputs: [],
  triggers: [],
  bindings,
  steps: [{ kind: "action", action, config, sourcePath: ["steps", 0] }],
});

describe("Mail workflow version compatibility", () => {
  test("rejects retired schedule references and reference-scheme selection", () => {
    expect(retiredMailWorkflowConfiguration(plan("automaticReply", { schedule: "office-hours" }))).toBe("response_schedule_reference");
    expect(retiredMailWorkflowConfiguration(plan("ensureConversationReference", { scheme: "support" }))).toBe("reference_scheme_selection");
  });

  test("accepts canonical inline schedule and mailbox reference configuration", () => {
    expect(retiredMailWorkflowConfiguration(plan("automaticReply", { schedule: { timeZone: "Europe/Berlin" } }))).toBeNull();
    expect(retiredMailWorkflowConfiguration(plan("ensureConversationReference", {}))).toBeNull();
  });
});
