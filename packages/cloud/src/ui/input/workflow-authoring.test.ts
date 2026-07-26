import { describe, expect, test } from "bun:test";
import { createWorkflowYamlHighlighter } from "./workflow-authoring";

describe("workflow YAML highlighting", () => {
  test("highlights app-specific keys and workflow references without importing an app manifest", () => {
    const html = createWorkflowYamlHighlighter()("moveMessage:\n  message: inputs.message\n");

    expect(html).toContain('<span class="doc-token-keyword">moveMessage</span>');
    expect(html).toContain('<span class="doc-token-keyword">message</span>');
    expect(html).toContain('<span class="doc-token-placeholder">inputs.message</span>');
  });
});
