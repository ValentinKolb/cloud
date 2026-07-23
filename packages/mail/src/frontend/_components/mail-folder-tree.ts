import type { MailFolderView } from "../../service/messages";

export type MailFolderTreeNode<T extends MailFolderView = MailFolderView> = {
  folder: T;
  children: MailFolderTreeNode<T>[];
};

const createsCycle = <T extends MailFolderView>(folder: T, parent: T, byId: Map<string, T>): boolean => {
  const visited = new Set([folder.id]);
  let current: T | undefined = parent;
  while (current) {
    if (visited.has(current.id)) return true;
    visited.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
};

export const buildMailFolderTree = <T extends MailFolderView>(folders: readonly T[]): MailFolderTreeNode<T>[] => {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const nodes = new Map<string, MailFolderTreeNode<T>>(folders.map((folder) => [folder.id, { folder, children: [] }]));
  const roots: MailFolderTreeNode<T>[] = [];
  for (const folder of folders) {
    const node = nodes.get(folder.id)!;
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    if (!parent || parent.id === folder.id || createsCycle(folder, parent, byId)) {
      roots.push(node);
      continue;
    }
    nodes.get(parent.id)!.children.push(node);
  }
  return roots;
};

const visibleNode = <T extends MailFolderView>(node: MailFolderTreeNode<T>): MailFolderTreeNode<T> | null => {
  if (!node.folder.showInSidebar || node.folder.discoveryState !== "active" || node.folder.role === "all") return null;
  const children = node.children.flatMap((child) => {
    const visible = visibleNode(child);
    return visible ? [visible] : [];
  });
  if (!node.folder.selectable && children.length === 0) return null;
  return { folder: node.folder, children };
};

export const buildVisibleMailFolderTree = <T extends MailFolderView>(folders: readonly T[]): MailFolderTreeNode<T>[] =>
  buildMailFolderTree(folders).flatMap((node) => {
    const visible = visibleNode(node);
    return visible ? [visible] : [];
  });

export const flattenMailFolderTree = <T extends MailFolderView>(
  nodes: readonly MailFolderTreeNode<T>[],
  depth = 0,
): Array<{ folder: T; depth: number }> =>
  nodes.flatMap((node) => [{ folder: node.folder, depth }, ...flattenMailFolderTree(node.children, depth + 1)]);
