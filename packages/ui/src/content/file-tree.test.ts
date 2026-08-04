import { describe, expect, test } from "bun:test";
import { allFolderPaths, buildTree, type FileTreeEntry, flattenVisible } from "./file-tree";

const entries: FileTreeEntry[] = [
  { path: "/input/report.csv", size: 10 },
  { path: "/files/out/summary.md", size: 5 },
  { path: "/files/a.txt", size: 1 },
  { path: "/files/z.txt", size: 1 },
];

describe("FileTree path-first model", () => {
  test("derives implicit folders and sorts folders first, then files alphabetically", () => {
    const tree = buildTree(entries);
    expect(tree.map((node) => node.entry.path)).toEqual(["/files", "/input"]);

    const filesNode = tree[0]!;
    expect(filesNode.isFolder).toBe(true);
    expect(filesNode.children.map((node) => node.name)).toEqual(["out", "a.txt", "z.txt"]);
    expect(filesNode.children[0]!.children.map((node) => node.entry.path)).toEqual(["/files/out/summary.md"]);
  });

  test("explicit folder entries model empty directories", () => {
    const tree = buildTree([{ path: "/empty", kind: "folder" }, { path: "/a.txt" }]);
    expect(tree.map((node) => `${node.entry.path}${node.isFolder ? "/" : ""}`)).toEqual(["/empty/", "/a.txt"]);
  });

  test("flattenVisible respects collapsed folders", () => {
    const tree = buildTree(entries);
    const expandedAll = new Set(allFolderPaths(tree));
    expect(flattenVisible(tree, expandedAll).map((node) => node.entry.path)).toEqual([
      "/files",
      "/files/out",
      "/files/out/summary.md",
      "/files/a.txt",
      "/files/z.txt",
      "/input",
      "/input/report.csv",
    ]);

    const collapsed = new Set(["/files"]);
    expect(flattenVisible(tree, collapsed).map((node) => node.entry.path)).toEqual([
      "/files",
      "/files/out",
      "/files/a.txt",
      "/files/z.txt",
      "/input",
    ]);
  });

  test("depths follow nesting", () => {
    const tree = buildTree(entries);
    const visible = flattenVisible(tree, new Set(allFolderPaths(tree)));
    const byPath = Object.fromEntries(visible.map((node) => [node.entry.path, node.depth]));
    expect(byPath["/files"]).toBe(0);
    expect(byPath["/files/out"]).toBe(1);
    expect(byPath["/files/out/summary.md"]).toBe(2);
  });

  test("preserves node identity by path while refreshing metadata", () => {
    const initial = buildTree([{ path: "/report.csv", size: 10, updatedAt: "old", badge: "draft" }]);
    const node = initial[0]!;
    const refreshed = buildTree([{ path: "/report.csv", size: 20, updatedAt: "new", badge: "ready" }], initial);

    expect(refreshed[0]).toBe(node);
    expect(refreshed[0]?.entry).toEqual({
      path: "/report.csv",
      size: 20,
      updatedAt: "new",
      badge: "ready",
    });
  });

  test("rejects a file path that is also used as a parent directory", () => {
    expect(() => buildTree([{ path: "/src" }, { path: "/src/app.ts" }])).toThrow(
      'FileTree entry conflict: "/src" is a file and cannot contain "/src/app.ts".',
    );
  });
});
