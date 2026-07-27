import { describe, expect, test } from "bun:test";
import { resolveMailAutomationSection } from "./mail-automation-sections";

describe("Mail automation sections", () => {
  test("uses the same canonical sections for every permission level", () => {
    expect(resolveMailAutomationSection("automatic-replies", false)).toBe("automatic-replies");
    expect(resolveMailAutomationSection("workflows", true)).toBe("workflows");
    expect(resolveMailAutomationSection("workflows", false)).toBe("overview");
  });

  test("rejects removed and unknown sections", () => {
    expect(resolveMailAutomationSection("runs", true)).toBe("overview");
    expect(resolveMailAutomationSection("schedules", true)).toBe("overview");
    expect(resolveMailAutomationSection(null, true)).toBe("overview");
  });
});
