import type { ContactTree, ContactTreeNode } from "./types";

export type ContactTreeRow = {
  id: string;
  label: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  job_title: string | null;
  parent_contact_id: string | null;
};

const treeNodeName = (node: ContactTreeNode): string =>
  (node.label || [node.firstName, node.lastName].filter(Boolean).join(" ") || node.companyName || node.id).toLowerCase();

const sortTreeNodes = (nodes: ContactTreeNode[]) => {
  nodes.sort((left, right) => treeNodeName(left).localeCompare(treeNodeName(right)));
  for (const node of nodes) sortTreeNodes(node.children);
};

export const buildContactTree = (config: { bookId: string; selectedId: string; rows: ContactTreeRow[] }): ContactTree | null => {
  if (config.rows.length === 0) return null;

  const nodes = new Map<string, ContactTreeNode>();
  for (const row of config.rows) {
    nodes.set(row.id, {
      id: row.id,
      label: row.label,
      firstName: row.first_name,
      lastName: row.last_name,
      companyName: row.company_name,
      jobTitle: row.job_title,
      parentContactId: row.parent_contact_id,
      children: [],
    });
  }

  let root: ContactTreeNode | null = null;
  for (const node of nodes.values()) {
    const parent = node.parentContactId ? nodes.get(node.parentContactId) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      root = node;
    }
  }

  if (!root || !nodes.has(config.selectedId)) return null;
  sortTreeNodes([root]);

  return {
    bookId: config.bookId,
    selectedId: config.selectedId,
    root,
  };
};
