import { describe, expect, test } from "bun:test";
import { assistantHelp } from ".";

describe("assistantHelp", () => {
  test("serves the existing Assistant help topics as Markdown", async () => {
    expect(assistantHelp.manifest.map((document) => document.id)).toEqual(["assistant-overview", "assistant-workflow"]);

    const overviewResponse = await assistantHelp.router.request("/assistant-overview");
    const overviewPayload = await overviewResponse.json();
    expect(overviewResponse.status).toBe(200);
    expect(overviewPayload.markdown).toContain("Assistant is a personal AI chat app");

    const workflowResponse = await assistantHelp.router.request("/assistant-workflow");
    const workflowPayload = await workflowResponse.json();
    expect(workflowPayload.markdown).toContain("Assistant keeps recent chats in the sidebar");
  });
});
