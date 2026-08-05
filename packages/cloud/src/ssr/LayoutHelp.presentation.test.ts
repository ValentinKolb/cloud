import { describe, expect, test } from "bun:test";

const source = await Bun.file(new URL("./LayoutHelp.tsx", import.meta.url)).text();

describe("Layout Help presentation", () => {
  test("centers document loading feedback in the available article body", () => {
    expect(source).toContain('class="mx-auto flex min-h-full w-full max-w-7xl flex-col"');
    expect(source).toContain(
      'class="flex flex-1 items-center justify-center gap-2 py-8 text-sm text-dimmed" role="status"',
    );
  });
});
