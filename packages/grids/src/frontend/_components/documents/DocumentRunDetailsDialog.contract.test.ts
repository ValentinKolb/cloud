import { describe, expect, test } from "bun:test";

describe("document run details", () => {
  test("explains the stored artifact and offers an explicit new generation", async () => {
    const details = await Bun.file(new URL("./DocumentRunDetailsDialog.tsx", import.meta.url)).text();
    const workspace = await Bun.file(new URL("./DocumentTemplateWorkspace.tsx", import.meta.url)).text();

    expect(details).toContain("Stored exact bytes");
    expect(details).not.toContain("re-rendered");
    expect(details).toContain("Technical details");
    expect(details).toContain("Generate again");
    expect(workspace).toContain('openGenerate(item.recordId, "generate-again")');
  });
});
