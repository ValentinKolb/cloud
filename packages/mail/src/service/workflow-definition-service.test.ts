import { describe, expect, test } from "bun:test";
import type { WorkflowBoundPlan } from "@valentinkolb/cloud/workflows";
import { workflowTriggerRegistrations } from "./workflow-definition-service";

const plan: WorkflowBoundPlan = {
  schemaVersion: 2,
  languageId: "mail",
  languageVersion: 1,
  sourceHash: "a".repeat(64),
  manifestHash: "b".repeat(64),
  catalogHash: "c".repeat(64),
  actionPolicies: {},
  inputs: [],
  triggers: [
    {
      kind: "messageReceived",
      config: {},
      with: { message: "${{ trigger.message }}", conversation: "${{ trigger.conversation }}" },
    },
    { kind: "schedule", config: { cron: "0 8 * * *", timezone: "Europe/Berlin" }, with: {} },
  ],
  steps: [],
  bindings: {},
};

describe("Mail workflow activation registrations", () => {
  test("derives keys and configs exclusively from the bound plan", () => {
    expect(workflowTriggerRegistrations(plan)).toEqual([
      {
        key: "messageReceived",
        kind: "messageReceived",
        config: { with: { message: "${{ trigger.message }}", conversation: "${{ trigger.conversation }}" } },
      },
      {
        key: "schedule",
        kind: "schedule",
        config: { cron: "0 8 * * *", timezone: "Europe/Berlin", with: {} },
      },
    ]);
  });
});
