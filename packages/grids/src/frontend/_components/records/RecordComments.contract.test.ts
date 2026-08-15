import { describe, expect, test } from "bun:test";

describe("App record comments", () => {
  test("uses a bare discussion without creating a nested scroll owner", async () => {
    const source = await Bun.file(new URL("./RecordComments.island.tsx", import.meta.url)).text();

    expect(source).toContain("Discussion");
    expect(source).toContain('as="h2"');
    expect(source).toContain('surface="bare"');
    expect(source).toContain("<Discussion.List");
    expect(source).not.toContain("overflow-y-auto");
    expect(source).not.toContain('class="detail-section');
    expect(source).not.toContain("detail-section-label");
    expect(source).not.toContain("PanelHeader");
  });
});
