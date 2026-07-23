import { describe, expect, test } from "bun:test";
import type { MailFolderView } from "../../service/messages";
import { buildMailFolderTree, buildVisibleMailFolderTree, flattenMailFolderTree } from "./mail-folder-tree";

const folder = (id: string, overrides: Partial<MailFolderView> = {}): MailFolderView => ({
  id,
  parentId: null,
  name: id,
  role: "other",
  providerRole: "other",
  configuredRole: null,
  selectable: true,
  showInSidebar: true,
  namespaceKinds: ["personal"],
  discoveryState: "active",
  missingSince: null,
  syncStatus: "current",
  total: 0,
  unread: 0,
  ...overrides,
});

describe("Mail folder tree", () => {
  test("preserves provider hierarchy and input order", () => {
    const tree = buildMailFolderTree([folder("inbox"), folder("projects"), folder("client", { parentId: "projects" }), folder("archive")]);

    expect(flattenMailFolderTree(tree).map(({ folder: item, depth }) => [item.id, depth])).toEqual([
      ["inbox", 0],
      ["projects", 0],
      ["client", 1],
      ["archive", 0],
    ]);
  });

  test("hides unavailable branches and local hidden subtrees", () => {
    const tree = buildVisibleMailFolderTree([
      folder("visible"),
      folder("hidden", { showInSidebar: false }),
      folder("hidden-child", { parentId: "hidden" }),
      folder("missing", { discoveryState: "missing" }),
      folder("missing-child", { parentId: "missing" }),
    ]);

    expect(flattenMailFolderTree(tree).map(({ folder: item }) => item.id)).toEqual(["visible"]);
  });

  test("keeps namespace containers only when they have visible children", () => {
    const tree = buildVisibleMailFolderTree([
      folder("shared", { selectable: false }),
      folder("team", { parentId: "shared" }),
      folder("empty", { selectable: false }),
    ]);

    expect(flattenMailFolderTree(tree).map(({ folder: item, depth }) => [item.id, depth])).toEqual([
      ["shared", 0],
      ["team", 1],
    ]);
  });

  test("fails safe for orphaned and cyclic provider projections", () => {
    const tree = buildMailFolderTree([
      folder("orphan", { parentId: "gone" }),
      folder("a", { parentId: "b" }),
      folder("b", { parentId: "a" }),
    ]);

    expect(new Set(flattenMailFolderTree(tree).map(({ folder: item }) => item.id))).toEqual(new Set(["orphan", "a", "b"]));
  });
});
