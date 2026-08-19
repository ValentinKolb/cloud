import { describe, expect, test } from "bun:test";

describe("Retention policy settings contract", () => {
  test("states activation, consequences, bounds, and non-goals in user language", async () => {
    const source = await Bun.file(new URL("./RetentionPolicySection.tsx", import.meta.url)).text();
    for (const text of [
      "Base retention floor",
      "Preservation only",
      "No minimum retention configured",
      "Minimum retention days",
      "Finalized Records and protected Files remain protected",
      "Reaching the floor does not itself permit or perform destruction",
      "Remove minimum retention?",
      "Nothing is deleted now",
      "Loading retention policy",
      "Retention policy is unavailable",
      "Impact could not be calculated",
      "unreferenced Files retained until later",
      "Files protected by Durable History or Documents are not candidates",
      "No File is deleted by this preview",
      "Example unreferenced Files",
    ])
      expect(source).toContain(text);
  });
});
