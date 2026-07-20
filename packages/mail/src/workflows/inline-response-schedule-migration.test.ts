import { describe, expect, test } from "bun:test";
import type { WorkflowBoundPlan, WorkflowFieldSchema } from "@valentinkolb/cloud/workflows";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import { bindMailWorkflow } from "./binder";
import { buildMailWorkflowCatalog } from "./catalog";
import { inlineWorkflowResponseSchedules } from "./inline-response-schedule-migration";
import { mailWorkflowManifest } from "./manifest";

const schedule = {
  timeZone: "Europe/Berlin",
  activeRanges: [],
  weeklyWindows: [{ weekday: 1 as const, start: "09:00", end: "17:00" }],
  exceptions: [],
};

describe("inline response schedule migration", () => {
  test("replaces a named schedule in source, IR, and bound plan", async () => {
    const legacyManifest = structuredClone(mailWorkflowManifest);
    const automaticReply = legacyManifest.actions.find((action) => action.kind === "automaticReply");
    if (!automaticReply) throw new Error("automaticReply action is missing");
    automaticReply.config.properties.schedule = {
      kind: "string",
      optional: true,
      minLength: 1,
      maxLength: 500,
    } satisfies WorkflowFieldSchema;
    const source = `inputs:
  message:
    type: mailMessage
  conversation:
    type: mailConversation
triggers:
  messageReceived:
    with:
      message: "\${{ trigger.message }}"
      conversation: "\${{ trigger.conversation }}"
steps:
  - automaticReply:
      message: inputs.message
      conversation: inputs.conversation
      sender: Support
      subject: Receipt
      body: Received
      schedule: Office hours
`;
    const compiled = await compileWorkflow(source, legacyManifest);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const boundPlan: WorkflowBoundPlan = {
      schemaVersion: 2,
      languageId: compiled.ir.languageId,
      languageVersion: compiled.ir.languageVersion,
      sourceHash: compiled.ir.sourceHash,
      manifestHash: compiled.ir.manifestHash,
      catalogHash: "legacy",
      actionPolicies: {},
      inputs: compiled.ir.inputs,
      triggers: compiled.ir.triggers,
      steps: compiled.ir.steps,
      bindings: {
        "steps.0.automaticReply.sender": "10000000-0000-4000-8000-000000000001",
        "steps.0.automaticReply.schedule": {
          id: "20000000-0000-4000-8000-000000000001",
          name: "Office hours",
          revision: 2,
          definition: schedule,
        },
      },
    };

    const migrated = inlineWorkflowResponseSchedules({
      source,
      ir: compiled.ir,
      boundPlan,
      lookup: (reference) => (reference === "Office hours" ? schedule : null),
    });
    expect(migrated.migratedActions).toBe(1);
    expect(migrated.source).toContain("timeZone: Europe/Berlin");
    expect(migrated.boundPlan.bindings).not.toHaveProperty("steps.0.automaticReply.schedule");

    const recompiled = await compileWorkflow(migrated.source, mailWorkflowManifest);
    expect(recompiled.ok).toBe(true);
    if (!recompiled.ok) return;
    const rebound = await bindMailWorkflow(
      recompiled.ir,
      buildMailWorkflowCatalog({
        folders: [],
        assignableUsers: [],
        senderIdentities: [{ id: "10000000-0000-4000-8000-000000000001", name: "Support" }],
      }),
    );
    expect(rebound.ok).toBe(true);
    if (!rebound.ok) return;
    expect(rebound.plan.steps[0]).toMatchObject({ config: { schedule } });
    expect(rebound.plan.bindings).toEqual({
      "steps.0.automaticReply.sender": "10000000-0000-4000-8000-000000000001",
    });
  });
});
