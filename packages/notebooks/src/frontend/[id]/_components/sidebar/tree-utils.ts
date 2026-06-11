import type { NoteTreeNode } from "./types";

export function flattenTree(nodes: NoteTreeNode[], excludeId?: string): NoteTreeNode[] {
  const result: NoteTreeNode[] = [];
  const walk = (list: NoteTreeNode[]) => {
    for (const node of list) {
      if (node.id === excludeId) continue;
      result.push(node);
      if (node.children.length > 0) walk(node.children);
    }
  };
  walk(nodes);
  return result;
}

export function getNodeDepthLabel(node: NoteTreeNode, allNodes: NoteTreeNode[]): string {
  let depth = 0;
  let current = node;
  while (current.parentId) {
    const parent = allNodes.find((n) => n.id === current.parentId);
    if (!parent) break;
    depth++;
    current = parent;
  }
  return "\u00A0\u00A0".repeat(depth) + node.title;
}
