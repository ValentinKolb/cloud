import { describe, expect, test } from "bun:test";

describe("Retention policy settings contract", () => {
  test("states activation, consequences, bounds, and non-goals in user language", async () => {
    const source = await Bun.file(new URL("./RetentionPolicySection.tsx", import.meta.url)).text();
    for (const text of [
      "Record retention floor",
      "Preservation only",
      "No minimum retention configured",
      "Minimum days in trash",
      "Finalized Records remain protected",
      "Reaching the floor does not itself permit or perform destruction",
      "Remove minimum retention?",
      "Nothing is deleted now",
      "Loading retention policy",
      "Retention policy is unavailable",
      "Impact could not be calculated",
    ])
      expect(source).toContain(text);
  });
});
