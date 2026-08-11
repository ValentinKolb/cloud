import { describe, expect, test } from "bun:test";

describe("App record details", () => {
  test("uses shared detail semantics and typed field rendering", async () => {
    const source = await Bun.file(new URL("./RecordDetails.island.tsx", import.meta.url)).text();

    expect(source).toContain("DescriptionList");
    expect(source).toContain("<FieldValue");
    expect(source).toContain('mode="detail"');
    expect(source).not.toContain("formatFieldValueText");
    expect(source).not.toContain('class="divide-y rounded-xl border"');
    expect(source).toContain("fetch(run.downloadUrl");
    expect(source).not.toContain("requestDocumentRunDownload");
  });
});
