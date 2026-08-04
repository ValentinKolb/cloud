import { isStableUiId } from "./stable-id";

export const PANES_VALUE_VERSION = 1 as const;
export const PANES_MIN_SIZE = 8;

export type PanesLeafPresentation = "single" | "tabs" | "stack";
export type PanesDirection = "horizontal" | "vertical";
export type PanesSplitZone = "left" | "right" | "top" | "bottom";

export type PanesLeafNode = {
  type: "leaf";
  id: string;
  elementIds: string[];
  activeElementId?: string;
  presentation?: PanesLeafPresentation;
};

export type PanesSplitNode = {
  type: "split";
  id: string;
  direction: PanesDirection;
  sizes: number[];
  children: PanesNode[];
};

export type PanesNode = PanesLeafNode | PanesSplitNode;

export type PanesValue = {
  version?: typeof PANES_VALUE_VERSION;
  root: PanesNode;
};

export type PanesDropIntent =
  | { kind: "move"; elementId: string; leafId: string; beforeElementId?: string }
  | { kind: "split"; elementId: string; leafId: string; zone: PanesSplitZone }
  | { kind: "insert"; elementId: string; splitId: string; index: number; direction: PanesDirection };

type ElementLocation = {
  leaf: PanesLeafNode;
  parentSplitId?: string;
  childIndex?: number;
  elementIndex: number;
};

const MAX_DEPTH = 12;
const MAX_NODES = 64;
/** Longest node or element id `normalizePanesValue` will keep. */
export const PANES_MAX_ID_LENGTH = 160;
const MAX_ID_LENGTH = PANES_MAX_ID_LENGTH;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const validId = (value: unknown): value is string => isStableUiId(value, MAX_ID_LENGTH);

const uniqueStrings = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!validId(value) || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

export const normalizePanesSizes = (sizes: readonly number[], length: number): number[] => {
  if (length <= 0) return [];
  const sanitized = Array.from({ length }, (_, index) => {
    const size = sizes[index] ?? 0;
    return Number.isFinite(size) ? Math.max(0, size) : 0;
  });
  const total = sanitized.reduce((sum, size) => sum + size, 0);
  if (total <= 0) return sanitized.map(() => 100 / length);
  return sanitized.map((size) => (size / total) * 100);
};

const normalizedPresentation = (
  value: unknown,
  fallback: PanesLeafPresentation,
  elementCount: number,
): PanesLeafPresentation => {
  const presentation = value === "single" || value === "tabs" || value === "stack" ? value : fallback;
  return presentation === "single" && elementCount > 1 ? "tabs" : presentation;
};

const leafNode = (
  id: string,
  elementIds: readonly string[] = [],
  presentation: PanesLeafPresentation = "tabs",
): PanesLeafNode => {
  const ids = uniqueStrings(elementIds);
  return {
    type: "leaf",
    id,
    elementIds: ids,
    activeElementId: ids[0],
    presentation: normalizedPresentation(presentation, "tabs", ids.length),
  };
};

export const createPanesValue = (
  elementIds: readonly string[],
  presentation: PanesLeafPresentation = "tabs",
): PanesValue => ({
  version: PANES_VALUE_VERSION,
  root: leafNode("root", elementIds, presentation),
});

const normalizeNodeId = (value: unknown, fallback: string, seen: Set<string>): string => {
  const base = validId(value) ? value : fallback;
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }
  let suffix = 2;
  while (seen.has(`${base}-${suffix}`)) suffix += 1;
  const id = `${base}-${suffix}`;
  seen.add(id);
  return id;
};

const normalizeNode = (
  value: unknown,
  allowed: Set<string>,
  usedElements: Set<string>,
  usedNodes: Set<string>,
  fallbackPresentation: PanesLeafPresentation,
  budget: { nodes: number },
  depth = 0,
  fallbackId = "root",
): PanesNode | null => {
  if (!isRecord(value) || depth > MAX_DEPTH || budget.nodes >= MAX_NODES) return null;
  budget.nodes += 1;

  if (value.type === "leaf") {
    const rawIds = Array.isArray(value.elementIds) ? value.elementIds : [];
    const elementIds = rawIds.flatMap((entry) => {
      if (!validId(entry) || !allowed.has(entry) || usedElements.has(entry)) return [];
      usedElements.add(entry);
      return [entry];
    });
    if (elementIds.length === 0) return null;
    const id = normalizeNodeId(value.id, fallbackId, usedNodes);
    const presentation = normalizedPresentation(value.presentation, fallbackPresentation, elementIds.length);
    return {
      type: "leaf",
      id,
      elementIds,
      activeElementId:
        validId(value.activeElementId) && elementIds.includes(value.activeElementId)
          ? value.activeElementId
          : elementIds[0],
      presentation,
    };
  }

  if (value.type !== "split" || (value.direction !== "horizontal" && value.direction !== "vertical")) return null;
  const id = normalizeNodeId(value.id, fallbackId, usedNodes);
  const rawChildren = Array.isArray(value.children) ? value.children.slice(0, MAX_NODES) : [];
  const rawSizes = Array.isArray(value.sizes) ? value.sizes : [];
  const entries = rawChildren.flatMap((child, index) => {
    const normalized = normalizeNode(
      child,
      allowed,
      usedElements,
      usedNodes,
      fallbackPresentation,
      budget,
      depth + 1,
      `${fallbackId}-${index + 1}`,
    );
    if (!normalized) return [];
    const rawSize = rawSizes[index];
    return [{ node: normalized, size: typeof rawSize === "number" && Number.isFinite(rawSize) ? rawSize : 0 }];
  });
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0]!.node;
  return {
    type: "split",
    id,
    direction: value.direction,
    sizes: normalizePanesSizes(
      entries.map((entry) => entry.size),
      entries.length,
    ),
    children: entries.map((entry) => entry.node),
  };
};

export const normalizePanesValue = (
  value: unknown,
  elementIds: readonly string[],
  presentation: PanesLeafPresentation = "tabs",
): PanesValue => {
  const ids = uniqueStrings(elementIds);
  if (ids.length === 0) return createPanesValue([], presentation);
  // Version gate. `PANES_VALUE_VERSION` was stamped on every value this module
  // produces but never checked on the way back in, so a payload written by a
  // future layout schema would have been parsed as if it were this one.
  // `undefined` is accepted: `PanesValue.version` is optional and values
  // predate the field.
  const versioned = isRecord(value) && value.version !== undefined && value.version !== PANES_VALUE_VERSION;
  const candidate = !versioned && isRecord(value) && isRecord(value.root) ? value.root : null;
  const usedElements = new Set<string>();
  const usedNodes = new Set<string>();
  const root = normalizeNode(
    candidate,
    new Set(ids),
    usedElements,
    usedNodes,
    presentation,
    { nodes: 0 },
  );
  const missing = ids.filter((id) => !usedElements.has(id));

  if (!root) return createPanesValue(ids, presentation);
  if (missing.length === 0) return { version: PANES_VALUE_VERSION, root };
  if (root.type === "leaf") {
    const nextIds = [...root.elementIds, ...missing];
    return {
      version: PANES_VALUE_VERSION,
      root: {
        ...root,
        elementIds: nextIds,
        activeElementId: root.activeElementId ?? nextIds[0],
        presentation: normalizedPresentation(root.presentation, presentation, nextIds.length),
      },
    };
  }

  const newLeafId = nextPanesNodeId(root, `leaf-${missing[0]}`);
  return {
    version: PANES_VALUE_VERSION,
    root: {
      ...root,
      sizes: normalizePanesSizes([...root.sizes, PANES_MIN_SIZE], root.children.length + 1),
      children: [...root.children, leafNode(newLeafId, missing, presentation)],
    },
  };
};

const mapPanesNode = (
  node: PanesNode,
  targetId: string,
  update: (node: PanesNode) => PanesNode,
): PanesNode =>
  node.id === targetId
    ? update(node)
    : node.type === "split"
      ? { ...node, children: node.children.map((child) => mapPanesNode(child, targetId, update)) }
      : node;

const pruneEmptyNodes = (node: PanesNode): PanesNode | null => {
  if (node.type === "leaf") return node.elementIds.length > 0 ? node : null;
  const entries = node.children.flatMap((child, index) => {
    const next = pruneEmptyNodes(child);
    return next ? [{ node: next, size: node.sizes[index] ?? 0 }] : [];
  });
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0]!.node;
  return {
    ...node,
    children: entries.map((entry) => entry.node),
    sizes: normalizePanesSizes(
      entries.map((entry) => entry.size),
      entries.length,
    ),
  };
};

const removeElement = (node: PanesNode, elementId: string): PanesNode => {
  if (node.type === "leaf") {
    const elementIds = node.elementIds.filter((id) => id !== elementId);
    return {
      ...node,
      elementIds,
      activeElementId: elementIds.includes(node.activeElementId ?? "") ? node.activeElementId : elementIds[0],
    };
  }
  return { ...node, children: node.children.map((child) => removeElement(child, elementId)) };
};

export const findPanesLeaf = (node: PanesNode, leafId: string): PanesLeafNode | null => {
  if (node.type === "leaf") return node.id === leafId ? node : null;
  for (const child of node.children) {
    const leaf = findPanesLeaf(child, leafId);
    if (leaf) return leaf;
  }
  return null;
};

const findPanesSplit = (node: PanesNode, splitId: string): PanesSplitNode | null => {
  if (node.type === "leaf") return null;
  if (node.id === splitId) return node;
  for (const child of node.children) {
    const split = findPanesSplit(child, splitId);
    if (split) return split;
  }
  return null;
};

const findElementLocation = (
  node: PanesNode,
  elementId: string,
  parentSplitId?: string,
  childIndex?: number,
): ElementLocation | null => {
  if (node.type === "leaf") {
    const elementIndex = node.elementIds.indexOf(elementId);
    return elementIndex >= 0 ? { leaf: node, parentSplitId, childIndex, elementIndex } : null;
  }
  for (let index = 0; index < node.children.length; index += 1) {
    const location = findElementLocation(node.children[index]!, elementId, node.id, index);
    if (location) return location;
  }
  return null;
};

const collectNodeIds = (node: PanesNode, ids: Set<string>) => {
  ids.add(node.id);
  if (node.type === "split") node.children.forEach((child) => collectNodeIds(child, ids));
};

const safeNodeBase = (value: string): string => {
  const safe = value.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (safe || "pane").slice(0, 96);
};

const nextPanesNodeId = (
  root: PanesNode,
  base: string,
  reserved: readonly string[] = [],
): string => {
  const ids = new Set<string>();
  collectNodeIds(root, ids);
  reserved.forEach((id) => ids.add(id));
  const safe = safeNodeBase(base);
  if (!ids.has(safe)) return safe;
  let suffix = 2;
  while (ids.has(`${safe}-${suffix}`)) suffix += 1;
  return `${safe}-${suffix}`;
};

export const activatePanesElement = (value: PanesValue, elementId: string): PanesValue => {
  const location = findElementLocation(value.root, elementId);
  if (!location || location.leaf.activeElementId === elementId) return value;
  return {
    version: PANES_VALUE_VERSION,
    root: mapPanesNode(value.root, location.leaf.id, (node) =>
      node.type === "leaf" ? { ...node, activeElementId: elementId } : node,
    ),
  };
};

const insertElement = (
  node: PanesNode,
  leafId: string,
  elementId: string,
  beforeElementId?: string,
): PanesNode =>
  mapPanesNode(node, leafId, (target) => {
    if (target.type !== "leaf") return target;
    const elementIds = target.elementIds.filter((id) => id !== elementId);
    const beforeIndex = beforeElementId ? elementIds.indexOf(beforeElementId) : -1;
    if (beforeIndex >= 0) elementIds.splice(beforeIndex, 0, elementId);
    else elementIds.push(elementId);
    return {
      ...target,
      elementIds,
      activeElementId: elementId,
      presentation: normalizedPresentation(target.presentation, "tabs", elementIds.length),
    };
  });

const splitLeaf = (
  node: PanesNode,
  leafId: string,
  elementId: string,
  zone: PanesSplitZone,
  presentation: PanesLeafPresentation,
  newLeafId: string,
  newSplitId: string,
): PanesNode =>
  mapPanesNode(node, leafId, (target) => {
    if (target.type !== "leaf") return target;
    const direction = zone === "left" || zone === "right" ? "horizontal" : "vertical";
    const newLeaf = leafNode(newLeafId, [elementId], presentation);
    return {
      type: "split",
      id: newSplitId,
      direction,
      sizes: [50, 50],
      children: zone === "left" || zone === "top" ? [newLeaf, target] : [target, newLeaf],
    };
  });

const insertLeafIntoSplit = (
  node: PanesNode,
  splitId: string,
  index: number,
  elementId: string,
  presentation: PanesLeafPresentation,
  newLeafId: string,
): PanesNode =>
  mapPanesNode(node, splitId, (target) => {
    if (target.type !== "split") return target;
    const insertIndex = Math.min(Math.max(index + 1, 0), target.children.length);
    const children = [...target.children];
    children.splice(insertIndex, 0, leafNode(newLeafId, [elementId], presentation));
    const sizes = normalizePanesSizes(target.sizes, target.children.length);
    const previousSize = sizes[index] ?? 100 / children.length;
    const nextSize = sizes[index + 1] ?? previousSize;
    const insertedSize = Math.max(PANES_MIN_SIZE, Math.min(24, (previousSize + nextSize) / 2));
    return {
      ...target,
      children,
      sizes: normalizePanesSizes(
        [...sizes.slice(0, insertIndex), insertedSize, ...sizes.slice(insertIndex)],
        children.length,
      ),
    };
  });

export const resizePanesSplit = (
  value: PanesValue,
  splitId: string,
  index: number,
  delta: number,
  baseSizes?: readonly number[],
): PanesValue => ({
  version: PANES_VALUE_VERSION,
  root: mapPanesNode(value.root, splitId, (target) => {
    if (target.type !== "split" || index < 0 || index >= target.children.length - 1) return target;
    const sizes = normalizePanesSizes(baseSizes ?? target.sizes, target.children.length);
    const current = sizes[index] ?? 0;
    const next = sizes[index + 1] ?? 0;
    const clampedDelta = Math.min(Math.max(delta, -current + PANES_MIN_SIZE), next - PANES_MIN_SIZE);
    sizes[index] = current + clampedDelta;
    sizes[index + 1] = next - clampedDelta;
    return { ...target, sizes: normalizePanesSizes(sizes, target.children.length) };
  }),
});

export const applyPanesIntent = (
  value: PanesValue,
  intent: PanesDropIntent,
  presentation: PanesLeafPresentation = "tabs",
): PanesValue => {
  const source = findElementLocation(value.root, intent.elementId);
  if (!source) return value;
  if (intent.kind === "move" && !findPanesLeaf(value.root, intent.leafId)) return value;
  if (intent.kind === "insert" && !findPanesSplit(value.root, intent.splitId)) return value;
  if (intent.kind === "move" && intent.beforeElementId === intent.elementId) return value;
  if (intent.kind === "move" && source.leaf.id === intent.leafId) {
    // Releasing over your own pane body — no tab was hit, so there is no
    // `beforeElementId` — is a no-op, not a "send this tab to the end".
    if (!intent.beforeElementId) return value;
    const beforeIndex = source.leaf.elementIds.indexOf(intent.beforeElementId);
    if (beforeIndex === source.elementIndex || beforeIndex === source.elementIndex + 1) return value;
  }
  // Dropping a solo pane into the gap immediately before or after itself asks
  // for the arrangement it already has. Without this the leaf is destroyed and
  // rebuilt under a fresh node id, and the split's sizes are renormalized, so a
  // gesture that should change nothing loses the pane's width.
  if (
    intent.kind === "insert" &&
    source.parentSplitId === intent.splitId &&
    source.leaf.elementIds.length === 1 &&
    source.childIndex !== undefined &&
    (source.childIndex === intent.index || source.childIndex === intent.index + 1)
  ) {
    return value;
  }
  if (intent.kind === "split") {
    const target = findPanesLeaf(value.root, intent.leafId);
    if (!target || (target.elementIds.length === 1 && target.elementIds[0] === intent.elementId)) return value;
  }

  const withoutElement = removeElement(value.root, intent.elementId);
  let root: PanesNode;
  if (intent.kind === "move") {
    root = insertElement(withoutElement, intent.leafId, intent.elementId, intent.beforeElementId);
  } else if (intent.kind === "insert") {
    root = insertLeafIntoSplit(
      withoutElement,
      intent.splitId,
      intent.index,
      intent.elementId,
      presentation,
      nextPanesNodeId(value.root, `leaf-${intent.elementId}`),
    );
  } else {
    const leafId = nextPanesNodeId(value.root, `leaf-${intent.elementId}`);
    const splitId = nextPanesNodeId(value.root, `split-${intent.leafId}`, [leafId]);
    root = splitLeaf(withoutElement, intent.leafId, intent.elementId, intent.zone, presentation, leafId, splitId);
  }
  return {
    version: PANES_VALUE_VERSION,
    root: pruneEmptyNodes(root) ?? leafNode("root", [], presentation),
  };
};
