import {
  type DndBuildIntentContext,
  type DndCollisionContext,
  type DndDroppableSnapshot,
  type DndPointer,
  dnd,
} from "@valentinkolb/stdlib/solid";
import { children, createMemo, For, type JSX, onCleanup, Show } from "solid-js";

const ELEMENT_SLOT = Symbol("Panes.Element");
const MIN_PANE_SIZE = 8;

type MaybeAccessor<T> = T | (() => T);

export type PanesLeafPresentation = "single" | "tabs" | "stack";

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
  direction: "horizontal" | "vertical";
  sizes: number[];
  children: PanesNode[];
};

export type PanesNode = PanesLeafNode | PanesSplitNode;

export type PanesValue = {
  root: PanesNode;
};

type PanesElementSlot = {
  readonly kind: typeof ELEMENT_SLOT;
  id: string;
  title?: string;
  icon?: string;
  closable?: MaybeAccessor<boolean>;
  onClose?: () => void;
  children: JSX.Element;
};

export type PanesRootProps = {
  value: PanesValue;
  onChange: (value: PanesValue) => void;
  children: JSX.Element;
  class?: string;
  keepMounted?: boolean;
  leafPresentation?: PanesLeafPresentation;
  allowResize?: MaybeAccessor<boolean>;
  allowMove?: MaybeAccessor<boolean>;
  allowReorder?: MaybeAccessor<boolean>;
  allowHorizontalSplit?: MaybeAccessor<boolean>;
  allowVerticalSplit?: MaybeAccessor<boolean>;
};

export type PanesElementProps = {
  id: string;
  title?: string;
  icon?: string;
  closable?: MaybeAccessor<boolean>;
  onClose?: () => void;
  children: JSX.Element;
};

type PanesComponent = ((props: PanesRootProps) => JSX.Element) & {
  Root: (props: PanesRootProps) => JSX.Element;
  Element: (props: PanesElementProps) => JSX.Element;
};

type DragMeta = {
  elementId: string;
};

type SplitZone = "left" | "right" | "top" | "bottom";

type DropMeta =
  | { kind: "leaf"; leafId: string }
  | { kind: "tab"; leafId: string; beforeElementId: string }
  | { kind: "split-gap"; splitId: string; index: number; direction: PanesSplitNode["direction"] };

type DropIntent =
  | { kind: "move"; elementId: string; leafId: string; beforeElementId?: string }
  | { kind: "split"; elementId: string; leafId: string; zone: SplitZone }
  | { kind: "insert"; elementId: string; splitId: string; index: number; direction: PanesSplitNode["direction"] };

const isElementSlot = (value: unknown): value is PanesElementSlot => !!value && typeof value === "object" && "kind" in value;

const collectElementSlots = (value: unknown): PanesElementSlot[] => {
  if (Array.isArray(value)) return value.flatMap(collectElementSlots);
  return isElementSlot(value) ? [value] : [];
};

const readMaybe = (value: MaybeAccessor<boolean> | undefined, fallback: boolean) =>
  typeof value === "function" ? value() : (value ?? fallback);

const iconClass = (icon: string | undefined) => {
  const value = icon?.trim() || "ti-layout-sidebar-right";
  return value.startsWith("ti ") ? value : `ti ${value}`;
};

const normalizeSizes = (sizes: number[], length: number) => {
  const sanitized = Array.from({ length }, (_, index) => {
    const size = sizes[index] ?? 0;
    return Number.isFinite(size) ? Math.max(0, size) : 0;
  });
  const total = sanitized.reduce((sum, size) => sum + size, 0);
  if (total <= 0) return sanitized.map(() => 100 / Math.max(1, length));
  return sanitized.map((size) => (size / total) * 100);
};

const leafNode = (id: string, elementIds: string[] = [], presentation?: PanesLeafPresentation): PanesLeafNode => ({
  type: "leaf",
  id,
  elementIds,
  activeElementId: elementIds[0],
  presentation,
});

export const createPanesValue = (elementIds: string[], presentation: PanesLeafPresentation = "tabs"): PanesValue => ({
  root: leafNode("root", elementIds, presentation),
});

const pruneNode = (node: PanesNode, allowed: Set<string>, used: Set<string>, presentation: PanesLeafPresentation): PanesNode | null => {
  if (node.type === "leaf") {
    const elementIds = node.elementIds.filter((id) => allowed.has(id) && !used.has(id));
    for (const id of elementIds) used.add(id);
    if (elementIds.length === 0) return null;
    return {
      ...node,
      presentation: node.presentation ?? presentation,
      elementIds,
      activeElementId: elementIds.includes(node.activeElementId ?? "") ? node.activeElementId : elementIds[0],
    };
  }

  const children = node.children.flatMap((child) => {
    const pruned = pruneNode(child, allowed, used, presentation);
    return pruned ? [pruned] : [];
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;
  return { ...node, children, sizes: normalizeSizes(node.sizes, children.length) };
};

export const normalizePanesValue = (
  value: PanesValue | null | undefined,
  elementIds: string[],
  presentation: PanesLeafPresentation = "tabs",
): PanesValue => {
  const allowed = new Set(elementIds);
  const used = new Set<string>();
  const root = value?.root ? pruneNode(value.root, allowed, used, presentation) : null;
  const missing = elementIds.filter((id) => !used.has(id));
  if (!root) return createPanesValue(missing, presentation);
  if (missing.length === 0) return { root };
  return {
    root:
      root.type === "leaf"
        ? {
            ...root,
            elementIds: [...root.elementIds, ...missing],
            activeElementId: root.activeElementId ?? root.elementIds[0] ?? missing[0],
          }
        : {
            type: "split",
            id: root.id,
            direction: root.direction,
            sizes: normalizeSizes([...root.sizes, MIN_PANE_SIZE], root.children.length + 1),
            children: [...root.children, leafNode(`leaf-${missing[0]}`, missing, presentation)],
          },
  };
};

const mapNode = (node: PanesNode, targetId: string, update: (node: PanesNode) => PanesNode): PanesNode =>
  node.id === targetId
    ? update(node)
    : node.type === "split"
      ? { ...node, children: node.children.map((child) => mapNode(child, targetId, update)) }
      : node;

const removeEmptyLeaves = (node: PanesNode): PanesNode | null => {
  if (node.type === "leaf") return node.elementIds.length > 0 ? node : null;
  const children = node.children.flatMap((child) => {
    const next = removeEmptyLeaves(child);
    return next ? [next] : [];
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;
  return { ...node, children, sizes: normalizeSizes(node.sizes, children.length) };
};

const removeElementFromNode = (node: PanesNode, elementId: string): PanesNode => {
  if (node.type === "leaf") {
    const elementIds = node.elementIds.filter((id) => id !== elementId);
    return {
      ...node,
      elementIds,
      activeElementId: elementIds.includes(node.activeElementId ?? "") ? node.activeElementId : elementIds[0],
    };
  }
  return { ...node, children: node.children.map((child) => removeElementFromNode(child, elementId)) };
};

const findLeaf = (node: PanesNode, leafId: string): PanesLeafNode | null => {
  if (node.type === "leaf") return node.id === leafId ? node : null;
  for (const child of node.children) {
    const leaf = findLeaf(child, leafId);
    if (leaf) return leaf;
  }
  return null;
};

const findElementLocation = (
  node: PanesNode,
  elementId: string,
  parentSplitId?: string,
  childIndex?: number,
): { leaf: PanesLeafNode; parentSplitId?: string; childIndex?: number; elementIndex: number } | null => {
  if (node.type === "leaf") {
    const elementIndex = node.elementIds.indexOf(elementId);
    return elementIndex >= 0 ? { leaf: node, parentSplitId, childIndex, elementIndex } : null;
  }
  for (let index = 0; index < node.children.length; index++) {
    const location = findElementLocation(node.children[index]!, elementId, node.id, index);
    if (location) return location;
  }
  return null;
};

const insertElement = (node: PanesNode, leafId: string, elementId: string, beforeElementId?: string): PanesNode =>
  mapNode(node, leafId, (target) => {
    if (target.type !== "leaf") return target;
    const elementIds = target.elementIds.filter((id) => id !== elementId);
    const beforeIndex = beforeElementId ? elementIds.indexOf(beforeElementId) : -1;
    if (beforeIndex >= 0) elementIds.splice(beforeIndex, 0, elementId);
    else elementIds.push(elementId);
    return {
      ...target,
      elementIds,
      activeElementId: elementId,
      presentation: target.presentation === "single" && elementIds.length > 1 ? "tabs" : target.presentation,
    };
  });

const splitLeaf = (node: PanesNode, leafId: string, elementId: string, zone: SplitZone, presentation: PanesLeafPresentation): PanesNode =>
  mapNode(node, leafId, (target) => {
    if (target.type !== "leaf") return target;
    const direction = zone === "left" || zone === "right" ? "horizontal" : "vertical";
    const newLeaf = leafNode(`leaf-${elementId}-${Date.now()}`, [elementId], presentation);
    const children = zone === "left" || zone === "top" ? [newLeaf, target] : [target, newLeaf];
    return {
      type: "split",
      id: `split-${target.id}-${Date.now()}`,
      direction,
      sizes: [50, 50],
      children,
    };
  });

const insertLeafIntoSplit = (
  node: PanesNode,
  splitId: string,
  index: number,
  elementId: string,
  presentation: PanesLeafPresentation,
): PanesNode =>
  mapNode(node, splitId, (target) => {
    if (target.type !== "split") return target;
    const children = [...target.children];
    const insertIndex = Math.min(Math.max(index + 1, 0), children.length);
    children.splice(insertIndex, 0, leafNode(`leaf-${elementId}-${Date.now()}`, [elementId], presentation));
    const sizes = normalizeSizes(target.sizes, target.children.length);
    const previousSize = sizes[index] ?? 100 / children.length;
    const nextSize = sizes[index + 1] ?? previousSize;
    const insertedSize = Math.max(MIN_PANE_SIZE, Math.min(24, (previousSize + nextSize) / 2));
    return {
      ...target,
      children,
      sizes: normalizeSizes([...sizes.slice(0, insertIndex), insertedSize, ...sizes.slice(insertIndex)], children.length),
    };
  });

const resizeSplit = (node: PanesNode, splitId: string, index: number, delta: number, baseSizes?: number[]): PanesNode =>
  mapNode(node, splitId, (target) => {
    if (target.type !== "split") return target;
    const sizes = normalizeSizes(baseSizes ?? target.sizes, target.children.length);
    const current = sizes[index] ?? 0;
    const next = sizes[index + 1] ?? 0;
    const minDelta = -current + MIN_PANE_SIZE;
    const maxDelta = next - MIN_PANE_SIZE;
    const clampedDelta = Math.min(Math.max(delta, minDelta), maxDelta);
    sizes[index] = current + clampedDelta;
    sizes[index + 1] = next - clampedDelta;
    return { ...target, sizes: normalizeSizes(sizes, target.children.length) };
  });

const applyIntent = (value: PanesValue, intent: DropIntent, presentation: PanesLeafPresentation): PanesValue => {
  const sourceLocation = findElementLocation(value.root, intent.elementId);
  const sourceLeaf = sourceLocation?.leaf;
  if (intent.kind === "move" && intent.beforeElementId === intent.elementId) return value;
  if (intent.kind === "move" && sourceLeaf?.id === intent.leafId && sourceLeaf.elementIds.length === 1) return value;
  if (intent.kind === "move" && sourceLocation && sourceLeaf?.id === intent.leafId) {
    if (!intent.beforeElementId) return value;
    const beforeIndex = sourceLeaf.elementIds.indexOf(intent.beforeElementId);
    if (beforeIndex === sourceLocation.elementIndex || beforeIndex === sourceLocation.elementIndex + 1) return value;
  }
  if (
    intent.kind === "insert" &&
    sourceLocation?.parentSplitId === intent.splitId &&
    sourceLeaf?.elementIds.length === 1 &&
    (sourceLocation.childIndex === intent.index || sourceLocation.childIndex === intent.index + 1)
  ) {
    return value;
  }

  if (intent.kind === "split") {
    const targetLeaf = findLeaf(value.root, intent.leafId);
    if (targetLeaf?.elementIds.length === 1 && targetLeaf.elementIds[0] === intent.elementId) return value;
  }

  const withoutElement = removeEmptyLeaves(removeElementFromNode(value.root, intent.elementId)) ?? leafNode("root", [], presentation);
  if (intent.kind === "move") {
    return {
      root: removeEmptyLeaves(insertElement(withoutElement, intent.leafId, intent.elementId, intent.beforeElementId)) ?? withoutElement,
    };
  }
  if (intent.kind === "insert") {
    const adjustedIndex =
      sourceLocation?.parentSplitId === intent.splitId &&
      sourceLeaf?.elementIds.length === 1 &&
      sourceLocation.childIndex !== undefined &&
      sourceLocation.childIndex < intent.index
        ? intent.index - 1
        : intent.index;
    return {
      root:
        removeEmptyLeaves(insertLeafIntoSplit(withoutElement, intent.splitId, adjustedIndex, intent.elementId, presentation)) ??
        withoutElement,
    };
  }
  return {
    root: removeEmptyLeaves(splitLeaf(withoutElement, intent.leafId, intent.elementId, intent.zone, presentation)) ?? withoutElement,
  };
};

const sameIntent = (a: DropIntent | null, b: DropIntent | null) => JSON.stringify(a) === JSON.stringify(b);

const leafEdgeZone = (pointer: DndPointer, rect: DndDroppableSnapshot<DropMeta>["rect"]): SplitZone | null => {
  const threshold = Math.min(40, Math.max(14, Math.min(rect.width, rect.height) * 0.12));
  const distances = [
    ["left", pointer.x - rect.left],
    ["right", rect.right - pointer.x],
    ["top", pointer.y - rect.top],
    ["bottom", rect.bottom - pointer.y],
  ] as const;
  const edge = distances.filter(([, distance]) => distance >= 0 && distance <= threshold).sort((a, b) => a[1] - b[1])[0];
  return edge?.[0] ?? null;
};

const nearestDroppable = (entries: DndDroppableSnapshot<DropMeta>[]) =>
  entries.reduce<DndDroppableSnapshot<DropMeta> | null>(
    (winner, entry) => (!winner || entry.distance < winner.distance ? entry : winner),
    null,
  );

const panesCollisionDetector = (ctx: DndCollisionContext<DragMeta, DropMeta, DropIntent>) => {
  const hits = ctx.droppables.filter((entry) => entry.containsPointer);
  const pool = hits.length > 0 ? hits : ctx.droppables;
  const splitGap = nearestDroppable(pool.filter((entry) => entry.meta.kind === "split-gap"));
  if (splitGap) return splitGap.id;
  const tab = nearestDroppable(pool.filter((entry) => entry.meta.kind === "tab"));
  if (tab) return tab.id;
  return nearestDroppable(pool)?.id ?? null;
};

const buildIntent = (ctx: DndBuildIntentContext<DragMeta, DropMeta, DropIntent>): DropIntent | null => {
  if (!ctx.over) return null;
  if (ctx.over.meta.kind === "split-gap") {
    return {
      kind: "insert",
      elementId: ctx.active.meta.elementId,
      splitId: ctx.over.meta.splitId,
      index: ctx.over.meta.index,
      direction: ctx.over.meta.direction,
    };
  }
  if (ctx.over.meta.kind === "tab") {
    return {
      kind: "move",
      elementId: ctx.active.meta.elementId,
      leafId: ctx.over.meta.leafId,
      beforeElementId: ctx.over.meta.beforeElementId,
    };
  }
  const zone = leafEdgeZone(ctx.pointer, ctx.over.rect);
  if (zone) return { kind: "split", elementId: ctx.active.meta.elementId, leafId: ctx.over.meta.leafId, zone };
  return { kind: "move", elementId: ctx.active.meta.elementId, leafId: ctx.over.meta.leafId };
};

const elementClosable = (element: PanesElementSlot) => !!element.onClose && readMaybe(element.closable, true);

const closeButtonClass =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded text-dimmed transition hover:text-red-600 dark:hover:text-red-400";

const dragHandleClass =
  "flex shrink-0 cursor-grab items-center justify-center rounded text-dimmed transition-colors hover:text-emerald-600 active:cursor-grabbing dark:hover:text-emerald-400";

const tabButtonBaseClass =
  "flex min-w-32 items-center gap-0.5 rounded-lg border px-2 text-xs transition-[background-color,color,border-color,box-shadow] duration-150";

const tabButtonClass = (active: boolean) =>
  active
    ? `${tabButtonBaseClass} border-blue-200 bg-white font-semibold text-blue-700 hover:border-blue-300 dark:border-blue-800 dark:bg-zinc-900 dark:text-blue-300 dark:hover:border-blue-700`
    : `${tabButtonBaseClass} border-zinc-100 bg-white text-secondary hover:border-zinc-200 hover:text-primary dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700`;

const tabButtonShadow = (active: boolean) =>
  active ? "inset 0 0 0 1px rgb(59 130 246 / 0.22), var(--theme-bevel-top)" : "var(--theme-shadow-elevated)";

const CloseButton = (props: { element: PanesElementSlot }) => (
  <button
    type="button"
    class={closeButtonClass}
    title={`Close ${props.element.title ?? props.element.id}`}
    aria-label={`Close ${props.element.title ?? props.element.id}`}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => {
      event.stopPropagation();
      props.element.onClose?.();
    }}
  >
    <i class="ti ti-x" />
  </button>
);

function PanesElement(props: PanesElementProps): JSX.Element {
  return {
    kind: ELEMENT_SLOT,
    id: props.id,
    title: props.title,
    icon: props.icon,
    closable: props.closable,
    onClose: props.onClose,
    children: props.children,
  } satisfies PanesElementSlot as unknown as JSX.Element;
}

const PanesRoot = (props: PanesRootProps) => {
  const resolved = children(() => props.children);
  const slots = createMemo(() => collectElementSlots(resolved.toArray()));
  const elementById = createMemo(() => new Map(slots().map((slot) => [slot.id, slot])));
  const elementIds = createMemo(() => slots().map((slot) => slot.id));
  const presentation = () => props.leafPresentation ?? "tabs";
  const value = createMemo(() => normalizePanesValue(props.value, elementIds(), presentation()));
  const canResize = () => readMaybe(props.allowResize, true);
  const canMove = () => readMaybe(props.allowMove, true);
  const canReorder = () => readMaybe(props.allowReorder, true);
  const canHorizontalSplit = () => readMaybe(props.allowHorizontalSplit, true);
  const canVerticalSplit = () => readMaybe(props.allowVerticalSplit, true);

  const paneDnd = dnd.create<DragMeta, DropMeta, DropIntent>({
    collisionDetector: panesCollisionDetector,
    buildIntent,
    isSameIntent: sameIntent,
    onDrop: ({ intent }) => {
      if (!intent || !canMove()) return;
      let nextIntent = intent;
      if (nextIntent.kind === "split") {
        const horizontal = nextIntent.zone === "left" || nextIntent.zone === "right";
        if ((horizontal && !canHorizontalSplit()) || (!horizontal && !canVerticalSplit())) {
          if (!canReorder()) return;
          nextIntent = { kind: "move", elementId: nextIntent.elementId, leafId: nextIntent.leafId };
        }
      }
      if (nextIntent.kind === "move" && !canReorder()) return;
      if (nextIntent.kind === "insert" && nextIntent.direction === "horizontal" && !canHorizontalSplit()) return;
      if (nextIntent.kind === "insert" && nextIntent.direction === "vertical" && !canVerticalSplit()) return;
      props.onChange(applyIntent(value(), nextIntent, presentation()));
    },
  });

  onCleanup(() => paneDnd.destroy());

  const setActive = (leafId: string, elementId: string) => {
    props.onChange({
      root: mapNode(value().root, leafId, (node) => (node.type === "leaf" ? { ...node, activeElementId: elementId } : node)),
    });
  };

  const resize = (splitId: string, index: number, delta: number, baseSizes: number[]) =>
    props.onChange({ root: resizeSplit(value().root, splitId, index, delta, baseSizes) });

  return (
    <div class={`flex min-h-0 min-w-0 overflow-hidden ${props.class ?? ""}`}>
      <PanesNodeRenderer
        node={() => value().root}
        elementById={elementById()}
        dnd={paneDnd}
        keepMounted={props.keepMounted ?? true}
        canResize={canResize}
        canMove={canMove}
        canReorder={canReorder}
        canHorizontalSplit={canHorizontalSplit}
        canVerticalSplit={canVerticalSplit}
        onActive={setActive}
        onResize={resize}
      />
    </div>
  );
};

function PanesNodeRenderer(props: {
  node: () => PanesNode;
  elementById: Map<string, PanesElementSlot>;
  dnd: ReturnType<typeof dnd.create<DragMeta, DropMeta, DropIntent>>;
  keepMounted: boolean;
  canResize: () => boolean;
  canMove: () => boolean;
  canReorder: () => boolean;
  canHorizontalSplit: () => boolean;
  canVerticalSplit: () => boolean;
  onActive: (leafId: string, elementId: string) => void;
  onResize: (splitId: string, index: number, delta: number, baseSizes: number[]) => void;
}) {
  return (
    <Show when={props.node().type === "leaf"} fallback={<PanesSplit {...props} node={() => props.node() as PanesSplitNode} />}>
      <PanesLeaf
        node={() => props.node() as PanesLeafNode}
        elementById={props.elementById}
        dnd={props.dnd}
        keepMounted={props.keepMounted}
        canMove={props.canMove}
        canReorder={props.canReorder}
        canHorizontalSplit={props.canHorizontalSplit}
        canVerticalSplit={props.canVerticalSplit}
        onActive={props.onActive}
      />
    </Show>
  );
}

function PanesSplit(props: {
  node: () => PanesSplitNode;
  elementById: Map<string, PanesElementSlot>;
  dnd: ReturnType<typeof dnd.create<DragMeta, DropMeta, DropIntent>>;
  keepMounted: boolean;
  canResize: () => boolean;
  canMove: () => boolean;
  canReorder: () => boolean;
  canHorizontalSplit: () => boolean;
  canVerticalSplit: () => boolean;
  onActive: (leafId: string, elementId: string) => void;
  onResize: (splitId: string, index: number, delta: number, baseSizes: number[]) => void;
}) {
  let container: HTMLDivElement | undefined;
  let stopResize: (() => void) | undefined;
  let resizeActive = false;
  const direction = () => props.node().direction;
  const sizes = () => normalizeSizes(props.node().sizes, props.node().children.length);
  const insertIntent = (index: number) => {
    const intent = props.dnd.intent();
    return intent?.kind === "insert" && intent.splitId === props.node().id && intent.index === index;
  };

  const stopActiveResize = () => {
    stopResize?.();
    stopResize = undefined;
    resizeActive = false;
  };

  onCleanup(() => {
    if (!resizeActive) stopActiveResize();
  });

  const startResize = (event: PointerEvent, index: number) => {
    if (!props.canResize()) return;
    event.preventDefault();
    stopActiveResize();
    resizeActive = true;
    const split = props.node();
    const baseSizes = normalizeSizes(split.sizes, split.children.length);
    const start = split.direction === "horizontal" ? event.clientX : event.clientY;
    const rect = container?.getBoundingClientRect();
    const extent = split.direction === "horizontal" ? (rect?.width ?? 1) : (rect?.height ?? 1);
    const onMove = (move: PointerEvent) => {
      const current = split.direction === "horizontal" ? move.clientX : move.clientY;
      props.onResize(split.id, index, ((current - start) / extent) * 100, baseSizes);
    };
    stopResize = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stopActiveResize);
      window.removeEventListener("pointercancel", stopActiveResize);
      window.removeEventListener("blur", stopActiveResize);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stopActiveResize);
    window.addEventListener("pointercancel", stopActiveResize);
    window.addEventListener("blur", stopActiveResize);
  };

  const keyResizeDelta = (event: KeyboardEvent, index: number) => {
    if (!props.canResize()) return null;
    const split = props.node();
    const baseSizes = normalizeSizes(split.sizes, split.children.length);
    const current = baseSizes[index] ?? 0;
    const next = baseSizes[index + 1] ?? 0;
    const step = event.shiftKey ? 8 : 2;
    if (event.key === "Home") return -current + MIN_PANE_SIZE;
    if (event.key === "End") return next - MIN_PANE_SIZE;
    if (split.direction === "horizontal") {
      if (event.key === "ArrowLeft") return -step;
      if (event.key === "ArrowRight") return step;
    } else {
      if (event.key === "ArrowUp") return -step;
      if (event.key === "ArrowDown") return step;
    }
    return null;
  };

  const onResizeKeyDown = (event: KeyboardEvent, index: number) => {
    const delta = keyResizeDelta(event, index);
    if (delta === null) return;
    event.preventDefault();
    const split = props.node();
    props.onResize(split.id, index, delta, normalizeSizes(split.sizes, split.children.length));
  };

  return (
    <div ref={container} class={`flex min-h-0 min-w-0 flex-1 ${direction() === "horizontal" ? "flex-row" : "flex-col"}`}>
      <For each={props.node().children}>
        {(child, index) => (
          <>
            <div class="flex min-h-0 min-w-0 overflow-hidden" style={{ flex: `${sizes()[index()] ?? 0} 1 0` }}>
              <PanesNodeRenderer {...props} node={() => props.node().children[index()] ?? child} />
            </div>
            <Show when={index() < props.node().children.length - 1}>
              <button
                ref={(button) => {
                  props.dnd.droppable(button, () => ({
                    id: `panes-split-gap:${props.node().id}:${index()}`,
                    meta: { kind: "split-gap", splitId: props.node().id, index: index(), direction: direction() },
                    disabled:
                      !props.canMove() ||
                      (direction() === "horizontal" && !props.canHorizontalSplit()) ||
                      (direction() === "vertical" && !props.canVerticalSplit()),
                  }));
                }}
                type="button"
                role="separator"
                aria-orientation={direction() === "horizontal" ? "vertical" : "horizontal"}
                aria-valuemin={MIN_PANE_SIZE}
                aria-valuemax={100 - MIN_PANE_SIZE}
                aria-valuenow={Math.round(sizes()[index()] ?? 0)}
                aria-disabled={!props.canResize()}
                tabIndex={props.canResize() ? 0 : -1}
                class={`group relative z-10 shrink-0 rounded-full bg-transparent transition ${
                  direction() === "horizontal" ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize"
                } ${props.canResize() ? "" : "cursor-default"}`}
                style={{ cursor: props.canResize() ? (direction() === "horizontal" ? "col-resize" : "row-resize") : "default" }}
                aria-label="Resize pane"
                onPointerDown={(event) => startResize(event, index())}
                onKeyDown={(event) => onResizeKeyDown(event, index())}
              >
                <span
                  class={`pointer-events-none absolute rounded-full transition ${
                    direction() === "horizontal" ? "inset-y-2 left-0 right-0" : "inset-x-2 bottom-0 top-0"
                  } ${
                    insertIntent(index())
                      ? "bg-emerald-500/80 shadow-[0_0_0_4px_rgba(16,185,129,0.16)]"
                      : props.canResize()
                        ? "group-hover:bg-blue-500/70 group-active:bg-blue-600/80"
                        : ""
                  }`}
                />
              </button>
            </Show>
          </>
        )}
      </For>
    </div>
  );
}

function PanesLeaf(props: {
  node: () => PanesLeafNode;
  elementById: Map<string, PanesElementSlot>;
  dnd: ReturnType<typeof dnd.create<DragMeta, DropMeta, DropIntent>>;
  keepMounted: boolean;
  canMove: () => boolean;
  canReorder: () => boolean;
  canHorizontalSplit: () => boolean;
  canVerticalSplit: () => boolean;
  onActive: (leafId: string, elementId: string) => void;
}) {
  const elements = () => props.node().elementIds.flatMap((id) => props.elementById.get(id) ?? []);
  const activeId = () =>
    props.node().elementIds.includes(props.node().activeElementId ?? "") ? props.node().activeElementId : props.node().elementIds[0];
  const presentation = () => props.node().presentation ?? "tabs";
  const activeElement = () => props.elementById.get(activeId() ?? "");
  const mergePreviewElement = () => {
    const intent = props.dnd.intent();
    if (intent?.kind !== "move" || intent.leafId !== props.node().id) return null;
    if (props.node().elementIds.includes(intent.elementId)) return null;
    return props.elementById.get(intent.elementId) ?? null;
  };
  const showTabs = () => (presentation() === "tabs" && elements().length > 1) || !!mergePreviewElement();
  const splitIntent = (zone: "left" | "right" | "top" | "bottom") => {
    const intent = props.dnd.intent();
    return intent?.kind === "split" && intent.leafId === props.node().id && intent.zone === zone;
  };

  return (
    <section
      ref={(element) => {
        props.dnd.droppable(element, () => ({
          id: `panes-leaf:${props.node().id}`,
          meta: { kind: "leaf", leafId: props.node().id },
          disabled: !props.canMove() || (!props.canReorder() && !props.canHorizontalSplit() && !props.canVerticalSplit()),
        }));
      }}
      class="relative flex h-full min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden"
    >
      <Show
        when={showTabs()}
        fallback={
          <Show when={activeElement()}>
            {(element) => (
              <div
                ref={(header) => {
                  props.dnd.draggable(header, () => ({
                    id: `panes-element:${element().id}`,
                    meta: { elementId: element().id },
                    disabled: !props.canMove(),
                    handleSelector: "[data-panes-drag-handle]",
                  }));
                }}
                class={`h-8 shrink-0 gap-2 ${tabButtonClass(true)} ${
                  props.dnd.activeId() === `panes-element:${element().id}` ? "opacity-40" : ""
                }`}
                style={{ "box-shadow": tabButtonShadow(true) }}
              >
                <Show when={props.canMove()}>
                  <button
                    type="button"
                    data-panes-drag-handle
                    class={`${dragHandleClass} h-7 w-7`}
                    title="Move pane"
                    aria-label="Move pane"
                  >
                    <i class="ti ti-grip-vertical" />
                  </button>
                </Show>
                <i class={`${iconClass(element().icon)} shrink-0 text-sm`} />
                <span class="min-w-0 flex-1 truncate">{element().title ?? element().id}</span>
                <Show when={elementClosable(element())}>
                  <CloseButton element={element()} />
                </Show>
              </div>
            )}
          </Show>
        }
      >
        <div
          class="panes-tab-strip flex h-8 shrink-0 items-stretch gap-1 overflow-x-auto overflow-y-hidden"
          style={{ "scrollbar-gutter": "stable" }}
        >
          <For each={elements()}>
            {(element) => (
              <div
                ref={(tab) => {
                  props.dnd.droppable(tab, () => ({
                    id: `panes-tab:${props.node().id}:${element.id}`,
                    meta: { kind: "tab", leafId: props.node().id, beforeElementId: element.id },
                    disabled: !props.canReorder(),
                  }));
                  props.dnd.draggable(tab, () => ({
                    id: `panes-element:${element.id}`,
                    meta: { elementId: element.id },
                    disabled: !props.canMove(),
                    handleSelector: "[data-panes-drag-handle]",
                  }));
                }}
                class={`flex-1 ${tabButtonClass(activeId() === element.id)} ${
                  props.dnd.activeId() === `panes-element:${element.id}` ? "opacity-40" : ""
                }`}
                style={{ "box-shadow": tabButtonShadow(activeId() === element.id) }}
              >
                <Show when={props.canMove()}>
                  <button
                    type="button"
                    data-panes-drag-handle
                    class={`${dragHandleClass} h-6 w-6`}
                    title="Move tab"
                    aria-label={`Move ${element.title ?? element.id}`}
                  >
                    <i class="ti ti-grip-vertical" />
                  </button>
                </Show>
                <button
                  type="button"
                  class="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded text-left"
                  onPointerDown={(event) => {
                    if (event.button === 0) props.onActive(props.node().id, element.id);
                  }}
                  onClick={() => props.onActive(props.node().id, element.id)}
                >
                  <i class={`${iconClass(element.icon)} shrink-0 text-sm`} />
                  <span class="truncate">{element.title ?? element.id}</span>
                </button>
                <Show when={elementClosable(element)}>
                  <CloseButton element={element} />
                </Show>
              </div>
            )}
          </For>
          <Show when={mergePreviewElement()}>
            {(element) => (
              <div class="flex min-w-32 flex-1 items-center gap-1.5 rounded border border-emerald-300 bg-emerald-50 px-2 text-xs font-semibold text-emerald-700 shadow-sm dark:border-emerald-700/70 dark:bg-emerald-950/50 dark:text-emerald-300">
                <i class="ti ti-plus shrink-0 text-sm" />
                <i class={`${iconClass(element().icon)} shrink-0 text-sm`} />
                <span class="truncate">{element().title ?? element().id}</span>
              </div>
            )}
          </Show>
        </div>
      </Show>

      <div class="relative min-h-0 flex-1 overflow-hidden">
        <For each={elements()}>
          {(element) => (
            <div class={`${props.keepMounted ? (activeId() === element.id || presentation() === "stack" ? "contents" : "hidden") : ""}`}>
              <Show when={props.keepMounted || activeId() === element.id || presentation() === "stack"}>{element.children}</Show>
            </div>
          )}
        </For>
      </div>

      <SplitDropZone zone="left" active={splitIntent("left") && props.canMove() && props.canHorizontalSplit()} />
      <SplitDropZone zone="right" active={splitIntent("right") && props.canMove() && props.canHorizontalSplit()} />
      <SplitDropZone zone="top" active={splitIntent("top") && props.canMove() && props.canVerticalSplit()} />
      <SplitDropZone zone="bottom" active={splitIntent("bottom") && props.canMove() && props.canVerticalSplit()} />
    </section>
  );
}

function SplitDropZone(props: { zone: "left" | "right" | "top" | "bottom"; active: boolean }) {
  const vertical = props.zone === "left" || props.zone === "right";
  return (
    <div class="pointer-events-none absolute inset-0">
      <Show when={props.active}>
        <div
          class={`pointer-events-none absolute rounded bg-emerald-500/70 shadow-[0_0_0_4px_rgba(16,185,129,0.16)] ${
            vertical ? "inset-y-2 w-2" : "inset-x-2 h-2"
          } ${props.zone === "left" ? "left-2" : ""} ${props.zone === "right" ? "right-2" : ""} ${props.zone === "top" ? "top-2" : ""} ${
            props.zone === "bottom" ? "bottom-2" : ""
          }`}
        />
      </Show>
    </div>
  );
}

const Panes = PanesRoot as PanesComponent;
Panes.Root = PanesRoot;
Panes.Element = PanesElement;

export default Panes;
