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
      "does not permit or perform destruction",
      "Remove minimum retention?",
      "Nothing is deleted now",
      "Loading retention policy",
      "Retention policy is unavailable",
      "Impact could not be calculated",
      "Lifecycle ledger",
      "Review Files",
      "Protected references are excluded",
    ])
      expect(source).toContain(text);
  });

  test("loads the File ledger through query.create and keeps filtering on the API", async () => {
    const source = await Bun.file(new URL("./RetentionFilesDialog.tsx", import.meta.url)).text();
    for (const text of ["query.create", "DataTable", "minimumDays", "search", "status", "per_page", "Download File", "View File"])
      expect(source).toContain(text);
    expect(source).not.toContain(".filter(");
  });
});
