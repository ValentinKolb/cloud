import { describe, expect, test } from "bun:test";

describe("document browser rows", () => {
  test("keep hover geometry stable", async () => {
    const source = await Bun.file(new URL("./DocumentBrowser.tsx", import.meta.url)).text();

    expect(source).toContain("hover:bg-[var(--ui-paper-highlighted)]");
    expect(source).not.toContain("hover:paper-highlighted");
    expect(source).not.toContain("hover:border");
    expect(source).not.toContain("transition-all");
  });
});
