import { describe, expect, test } from "bun:test";
import { workflowEmailTemplateDraft, workflowEmailTemplateDraftDirty } from "./workflow-email-template-draft";

describe("workflow email template draft", () => {
  test("uses editor defaults and detects persisted field changes", () => {
    const clean = workflowEmailTemplateDraft(undefined, "Default subject", "<p>Default</p>", { customer: { name: "Ada" } });

    expect(clean).toEqual({
      name: "",
      description: "",
      subject: "Default subject",
      html: "<p>Default</p>",
      sampleData: { customer: { name: "Ada" } },
      enabled: true,
    });
    expect(workflowEmailTemplateDraftDirty(clean, clean)).toBe(false);
    expect(workflowEmailTemplateDraftDirty({ ...clean, subject: "Changed" }, clean)).toBe(true);
    expect(workflowEmailTemplateDraftDirty({ ...clean, sampleData: { customer: { name: "Grace" } } }, clean)).toBe(true);
  });
});
