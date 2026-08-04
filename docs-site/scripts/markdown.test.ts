import { describe, expect, test } from "bun:test";
import { mapMarkdownProse, mapOutsideFences, withoutFencedCode } from "./markdown";

describe("Markdown boundaries", () => {
  test("keeps fenced and inline code unchanged", () => {
    const source = [
      "[prose](/en/docs/build)",
      "`[inline](/en/docs/build)`",
      "````ts",
      "[code](/en/docs/build)",
      "```",
      "[still code](/en/docs/build)",
      "````",
      "[after](/en/docs/build)",
    ].join("\n");

    const result = mapMarkdownProse(source, (text) => text.replaceAll("/en/docs/build", "./architecture.md"));

    expect(result).toContain("[prose](./architecture.md)");
    expect(result).toContain("`[inline](/en/docs/build)`");
    expect(result).toContain("[code](/en/docs/build)");
    expect(result).toContain("[still code](/en/docs/build)");
    expect(result).toContain("[after](./architecture.md)");
  });

  test("does not close a fence with another marker", () => {
    const source = ["```ts", "~~~", "inside", "```", "outside"].join("\n");
    expect(mapOutsideFences(source, (line) => line.toUpperCase())).toBe(["```ts", "~~~", "inside", "```", "OUTSIDE"].join("\n"));
  });

  test("removes complete fenced blocks from prose", () => {
    const source = ["before", "~~~ts", "code", "~~~", "after"].join("\n");
    expect(withoutFencedCode(source)).toBe(["before", "", "", "", "after"].join("\n"));
  });
});
