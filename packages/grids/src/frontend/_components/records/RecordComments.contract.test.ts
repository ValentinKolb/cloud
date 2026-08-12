import { describe, expect, test } from "bun:test";

describe("App record comments", () => {
  test("uses a bounded bare discussion without a detail-panel card", async () => {
    const source = await Bun.file(new URL("./RecordComments.island.tsx", import.meta.url)).text();

    expect(source).toContain("Discussion");
    expect(source).toContain('as="h2"');
    expect(source).toContain('surface="bare"');
    expect(source).toContain('class="max-h-[24rem] overflow-y-auto overscroll-y-contain pr-1"');
    expect(source).not.toContain('class="detail-section');
    expect(source).not.toContain("detail-section-label");
    expect(source).not.toContain("PanelHeader");
  });
});
