import { describe, expect, test } from "bun:test";

describe("Custom App actions", () => {
  test("uses document navigation for SSR pages", async () => {
    const source = await Bun.file(new URL("./Actions.island.tsx", import.meta.url)).text();

    expect(source).not.toContain('navigation="enhanced"');
    expect(source).toContain("window.location.replace(navigateAction.href)");
  });
});
