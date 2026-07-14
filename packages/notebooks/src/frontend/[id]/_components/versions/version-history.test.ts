import { describe, expect, test } from "bun:test";
import { buildDiffRows, orderComparison, summarizeDiff } from "./version-history";

describe("version history helpers", () => {
  test("numbers added, removed, and unchanged diff lines", () => {
    const rows = buildDiffRows([
      { value: "first\n" },
      { removed: true, value: "old\n" },
      { added: true, value: "new\nextra\n" },
      { value: "last\n" },
    ]);

    expect(rows).toEqual([
      { kind: "unchanged", value: "first", oldLine: 1, newLine: 1 },
      { kind: "removed", value: "old", oldLine: 2, newLine: null },
      { kind: "added", value: "new", oldLine: null, newLine: 2 },
      { kind: "added", value: "extra", oldLine: null, newLine: 3 },
      { kind: "unchanged", value: "last", oldLine: 3, newLine: 4 },
    ]);
    expect(summarizeDiff(rows)).toEqual({ added: 2, removed: 1, hasChanges: true });
  });

  test("keeps current as the newer comparison target", () => {
    expect(orderComparison("older", "__current__", [], "__current__")).toEqual({
      fromId: "older",
      toId: "__current__",
    });
  });

  test("orders two historical versions from older to newer", () => {
    const versions = [
      { id: "newer", createdAt: "2026-07-14T12:00:00.000Z" },
      { id: "older", createdAt: "2026-07-14T10:00:00.000Z" },
    ];

    expect(orderComparison("newer", "older", versions, "__current__")).toEqual({
      fromId: "older",
      toId: "newer",
    });
  });
});
