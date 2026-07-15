import { describe, expect, test } from "bun:test";
import type { Workflow } from "../../../service";
import { workflowEditorDraft, workflowEditorDraftDirty, workflowEditorSavePayload } from "./workflow-editor-draft";

const workflow = {
  id: "11111111-1111-4111-8111-111111111111",
  shortId: "wf001",
  baseId: "22222222-2222-4222-8222-222222222222",
  name: "Current workflow",
  description: "Current description",
  source: "steps:\n  - succeed:\n      message: Done",
  plan: {
    schemaVersion: 1,
    languageId: "grids",
    languageVersion: 1,
    sourceHash: "source",
    manifestHash: "manifest",
    catalogHash: "catalog",
    actionPolicies: {},
    inputs: [],
    triggers: [],
    steps: [],
    bindings: {},
  },
  diagnostics: [],
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

  test("detects editable changes but ignores revision-only refreshes", () => {
    const clean = workflowEditorDraft(workflow, "fallback");

    expect(workflowEditorDraftDirty({ ...clean, revision: clean.revision + 1 }, clean)).toBe(false);
    expect(workflowEditorDraftDirty({ ...clean, source: `${clean.source}\n` }, clean)).toBe(true);
  });

  test("builds a field-granular update and ignores normalized no-op edits", () => {
    const clean = workflowEditorDraft(workflow, "fallback");

    expect(workflowEditorSavePayload({ ...clean, name: `  ${clean.name}  ` }, clean, false)).toEqual({});
    expect(workflowEditorSavePayload({ ...clean, description: "Updated description", enabled: false }, clean, false)).toEqual({
      description: "Updated description",
      enabled: false,
    });
  });

  test("includes every editable field when creating a workflow", () => {
    const draft = { ...workflowEditorDraft(undefined, "steps: []"), name: "  New workflow  ", description: "  " };

    expect(workflowEditorSavePayload(draft, workflowEditorDraft(undefined, "steps: []"), true)).toEqual({
      name: "New workflow",
      description: null,
      enabled: false,
      source: "steps: []",
    });
  });
});
