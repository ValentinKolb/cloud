import { describe, expect, test } from "bun:test";
import { buildWorkflowManifestCompletions, workflowCompletionContext } from "./authoring";
import type { WorkflowLanguageManifest } from "./contracts";
import type { DefinedWorkflowModule } from "./module";

const manifest: WorkflowLanguageManifest = {
  id: "test",
  version: 1,
  inputs: [
    {
      kind: "message",
      label: "Message",
      description: "One message",
      valueType: "test.message",
      config: { kind: "object", properties: {} },
    },
  ],
  triggers: [
    {
      kind: "received",
      label: "Received",
      description: "A message arrived",
      snippet: "received:\n  with: {}",
      config: { kind: "object", properties: {} },
      eventValues: {},
    },
  ],
  actions: [
    {
      kind: "send",
      label: "Send",
      description: "Send a message",
      config: { kind: "object", properties: {} },
      effect: "ambiguous-external",
      dryRun: "validate",
    },
  ],
};

const workflows = {
  actions: {},
  manifest,
} satisfies DefinedWorkflowModule;

describe("workflow authoring completions", () => {
  test("replaces only the current YAML value", () => {
    const source = "steps:\n  - move:\n      folder: Inb";
    expect(workflowCompletionContext(source, source.length).range).toEqual({
      start: source.indexOf("Inb"),
      end: source.length,
    });
  });

  test("derives input, trigger, action, and root suggestions from the manifest", () => {
    expect(buildWorkflowManifestCompletions("inputs:\n  item:\n    type: mes", 29, workflows).map((item) => item.label)).toEqual([
      "message",
    ]);
    expect(buildWorkflowManifestCompletions("triggers:\n  ", 12, workflows).map((item) => item.label)).toEqual(["received"]);
    expect(buildWorkflowManifestCompletions("steps:\n  - se", 13, workflows).map((item) => item.label)).toEqual(["send"]);
    expect(buildWorkflowManifestCompletions("", 0, workflows).map((item) => item.label)).toEqual(["inputs", "triggers", "steps"]);
  });
});
