import { describe, expect, test } from "bun:test";
import type { Workflow } from "../../../contracts";
import { workflowEditorDraft } from "./workflow-editor-draft";

const workflow = {
  id: "11111111-1111-4111-8111-111111111111",
  shortId: "wf001",
  baseId: "22222222-2222-4222-8222-222222222222",
  name: "Current workflow",
  description: "Current description",
  source: "triggers:\n  api: {}\nsteps: []",
  compiled: { triggers: { api: {} }, steps: [] },
  enabled: true,
  position: 0,
  revision: 7,
  ownerUserId: null,
  deletedAt: null,
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
} satisfies Workflow;

describe("workflow editor draft", () => {
  test("replaces every editable field and revision from the latest workflow", () => {
    expect(workflowEditorDraft(workflow, "fallback")).toEqual({
      name: workflow.name,
      description: workflow.description,
      enabled: workflow.enabled,
      source: workflow.source,
      revision: workflow.revision,
    });
  });

  test("uses predictable defaults for a new workflow", () => {
    expect(workflowEditorDraft(undefined, "fallback")).toEqual({
      name: "",
      description: "",
      enabled: false,
      source: "fallback",
      revision: 1,
    });
  });
});
