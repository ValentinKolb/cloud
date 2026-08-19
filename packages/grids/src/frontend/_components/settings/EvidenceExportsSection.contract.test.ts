import { describe, expect, test } from "bun:test";

describe("Evidence exports settings contract", () => {
  test("keeps the admin flow bounded, explicit, and honest about missing history", async () => {
    const [section, panel] = await Promise.all([
      Bun.file(new URL("./EvidenceExportsSection.tsx", import.meta.url)).text(),
      Bun.file(new URL("./BaseSettingsPanel.tsx", import.meta.url)).text(),
    ]);

    expect(panel).toContain('id="evidence"');
    expect(section).toContain("A verifiable package, not a compliance certificate");
    expect(section).toContain("Available evidence");
    expect(section).toContain("This check changes nothing and is not a compliance assessment");
    expect(section).toContain("Coverage by stored table");
    expect(section).toContain("Earlier states unavailable");
    expect(section).toContain("Building history baseline");
    expect(section).toContain("Finalization not enabled");
    expect(section).toContain("Evidence coverage is unavailable");
    expect(section).toContain("No stored tables in this Base");
    expect(section).toContain("Open table");
    expect(section).toContain("Everything is selected by default");
    expect(section).toContain("Known scope fits the export budgets");
    expect(section).toContain("Scope could not be checked");
    expect(section).toContain("No evidence exports yet");
    expect(section).toContain("Technical details");
    expect(section).toContain("Copy verification command");
    expect(section).toContain("cld grids evidence verify");
    expect(section).toContain("--manifest-sha256");
    const packagesStart = section.indexOf('title="Recent packages"');
    const actionsStart = section.indexOf("<SettingsCollection.Item.Actions>", packagesStart);
    const actionsEnd = section.indexOf("</SettingsCollection.Item.Actions>", actionsStart);
    const technicalDetails = section.indexOf("Technical details", actionsStart);
    expect(actionsStart).toBeGreaterThanOrEqual(0);
    expect(technicalDetails).toBeGreaterThan(actionsStart);
    expect(technicalDetails).toBeLessThan(actionsEnd);
    expect(section).toContain("Packages expire after seven days");
    expect(section).toContain('item.status === "failed" || item.status === "canceled"');
    expect(section).toContain('item.status === "queued" || item.status === "running"');
  });
});
