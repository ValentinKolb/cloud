import { describe, expect, test } from "bun:test";
import type { WorkflowBoundPlan, WorkflowFieldSchema } from "@valentinkolb/cloud/workflows";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import { mailWorkflows } from "./module";
import { removeWorkflowReferenceSchemeSelection } from "./single-reference-configuration-migration";

describe("single reference configuration migration", () => {
  test("removes legacy scheme selection from source, IR, plan, and bindings", async () => {
    const legacyManifest = structuredClone(mailWorkflows.manifest);
    const action = legacyManifest.actions.find((candidate) => candidate.kind === "ensureConversationReference");
    if (!action) throw new Error("ensureConversationReference action is missing");
    action.config.properties.scheme = {
      kind: "string",
      optional: true,
      minLength: 1,
      maxLength: 500,
    } satisfies WorkflowFieldSchema;
    const source = `inputs:
  conversation:
    type: mailConversation
steps:
  - ensureConversationReference:
      conversation: inputs.conversation
      scheme: Support
`;
    const compiled = await compileWorkflow(source, legacyManifest);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const plan: WorkflowBoundPlan = {
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
        "steps.0.ensureConversationReference.scheme": "10000000-0000-4000-8000-000000000001",
      },
    };

    const migrated = removeWorkflowReferenceSchemeSelection({ source, ir: compiled.ir, boundPlan: plan });

    expect(migrated.migratedActions).toBe(1);
    expect(migrated.source).not.toContain("scheme:");
    expect(migrated.ir.steps[0]).not.toHaveProperty("config.scheme");
    expect(migrated.boundPlan.bindings).toEqual({});
    expect((await compileWorkflow(migrated.source, mailWorkflows)).ok).toBe(true);
  });
});
