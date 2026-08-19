import { describe, expect, test } from "bun:test";

describe("Evidence exports settings contract", () => {
  test("keeps the admin flow bounded, explicit, and honest about missing history", async () => {
    const [section, panel] = await Promise.all([
      Bun.file(new URL("./EvidenceExportsSection.tsx", import.meta.url)).text(),
      Bun.file(new URL("./BaseSettingsPanel.tsx", import.meta.url)).text(),
    ]);

    expect(panel).toContain('id="evidence"');
    expect(section).toContain("A verifiable package, not a compliance certificate");
    expect(section).toContain("Everything is selected by default");
    expect(section).toContain("Known scope fits the export budgets");
    expect(section).toContain("Scope could not be checked");
    expect(section).toContain("No evidence exports yet");
    expect(section).toContain("Technical details");
    expect(section).toContain("Packages expire after seven days");
    expect(section).toContain('item.status === "failed" || item.status === "canceled"');
    expect(section).toContain('item.status === "queued" || item.status === "running"');
  });
});
