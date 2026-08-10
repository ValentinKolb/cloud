import {
  type DndBuildIntentContext,
  type DndCollisionContext,
  type DndController,
  type DndDroppableSnapshot,
  type DndPointer,
  dnd,
} from "@k2b/stdlib/solid";
import { children, createMemo, createUniqueId, For, Index, type JSX, onCleanup, Show } from "solid-js";
import type { MaybeAccessor } from "../inputs/field-contract";
import {
  activatePanesElement,
  applyPanesIntent,
  findPanesLeaf,
  normalizePanesSizes,
  normalizePanesValue,
  PANES_MAX_ID_LENGTH,
  PANES_MIN_SIZE,
  type PanesDirection,
  type PanesDropIntent,
  type PanesLeafNode,
  type PanesLeafPresentation,
  type PanesNode,
  type PanesSplitNode,
  type PanesSplitZone,
  type PanesValue,
  resizePanesSplit,
} from "./panes-state";
import { assertStableUiId, assertUniqueStableUiIds } from "./stable-id";

export type {
  PanesLeafNode,
  PanesLeafPresentation,
  PanesNode,
  PanesSplitNode,
  PanesValue,
} from "./panes-state";
export { createPanesValue, normalizePanesValue } from "./panes-state";

const ELEMENT_SLOT = Symbol("Panes.Element");

type PanesElementSlot = {
  readonly kind: typeof ELEMENT_SLOT;
  readonly props: PanesElementProps;
};

export type PanesRootProps = {
  value: PanesValue;
  onValueChange: (value: PanesValue) => void;
  children: JSX.Element;
  class?: string;
  label?: string;
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
  title: string;
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
  label: string;
};

type DropMeta =
  | { kind: "leaf"; leafId: string; label: string }
  | { kind: "tab"; leafId: string; beforeElementId: string; label: string }
  | { kind: "split-gap"; splitId: string; index: number; direction: PanesDirection; label: string };

type PaneDnd = DndController<DragMeta, DropMeta, PanesDropIntent>;

const isElementSlot = (value: unknown): value is PanesElementSlot =>
  !!value && typeof value === "object" && "kind" in value && value.kind === ELEMENT_SLOT;

const collectElementSlots = (value: unknown): PanesElementSlot[] => {
  if (Array.isArray(value)) return value.flatMap(collectElementSlots);
  return isElementSlot(value) ? [value] : [];
};

const readMaybe = (value: MaybeAccessor<boolean> | undefined, fallback: boolean): boolean =>
  typeof value === "function" ? value() : (value ?? fallback);

const elementId = (element: PanesElementSlot): string => element.props.id;
const elementTitle = (element: PanesElementSlot): string => element.props.title;

const iconClass = (icon: string | undefined): string => {
  const value = icon?.trim() || "ti-layout-sidebar-right";
  return value.startsWith("ti ") ? value : `ti ${value}`;
};

/**
 * `normalizePanesValue` accepts node and element ids up to
 * `PANES_MAX_ID_LENGTH`, so truncating here at a shorter length let two ids
 * that agree on their first N characters produce the same `tabId`/`panelId` —
 * duplicate DOM ids, `aria-controls` pointing at the wrong panel, and
 * `focusTab` focusing the wrong tab.
 */
const safeDomId = (value: string): string => assertStableUiId(value, "Panes id", PANES_MAX_ID_LENGTH);

const elementClosable = (element: PanesElementSlot): boolean => !!element.props.onClose && readMaybe(element.props.closable, true);

const leafEdgeZone = (pointer: DndPointer, rect: DndDroppableSnapshot<DropMeta>["rect"]): PanesSplitZone | null => {
  const threshold = Math.min(40, Math.max(14, Math.min(rect.width, rect.height) * 0.12));
  const distances = [
    ["left", pointer.x - rect.left],
    ["right", rect.right - pointer.x],
    ["top", pointer.y - rect.top],
    ["bottom", rect.bottom - pointer.y],
  ] as const;
  return distances.filter(([, distance]) => distance >= 0 && distance <= threshold).sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
};

const nearestDroppable = (entries: DndDroppableSnapshot<DropMeta>[]): DndDroppableSnapshot<DropMeta> | null =>
  entries.reduce<DndDroppableSnapshot<DropMeta> | null>(
    (winner, entry) => (!winner || entry.distance < winner.distance ? entry : winner),
    null,
  );

const panesCollisionDetector = (context: DndCollisionContext<DragMeta, DropMeta, PanesDropIntent>): string | null => {
  const hits = context.droppables.filter((entry) => entry.containsPointer);
  const pool = hits.length > 0 ? hits : context.droppables;
  const splitGap = nearestDroppable(pool.filter((entry) => entry.meta.kind === "split-gap"));
  if (splitGap) return splitGap.id;
  const tab = nearestDroppable(pool.filter((entry) => entry.meta.kind === "tab"));
  if (tab) return tab.id;
  return nearestDroppable(pool)?.id ?? null;
};

const buildIntent = (context: DndBuildIntentContext<DragMeta, DropMeta, PanesDropIntent>): PanesDropIntent | null => {
  if (!context.over) return null;
  if (context.over.meta.kind === "split-gap") {
    return {
      kind: "insert",
      elementId: context.active.meta.elementId,
      splitId: context.over.meta.splitId,
      index: context.over.meta.index,
      direction: context.over.meta.direction,
    };
  }
  if (context.over.meta.kind === "tab") {
    return {
      kind: "move",
      elementId: context.active.meta.elementId,
      leafId: context.over.meta.leafId,
      beforeElementId: context.over.meta.beforeElementId,
    };
  }
  const zone = leafEdgeZone(context.pointer, context.over.rect);
  if (zone) {
    return {
      kind: "split",
      elementId: context.active.meta.elementId,
      leafId: context.over.meta.leafId,
      zone,
    };
  }
  return {
    kind: "move",
    elementId: context.active.meta.elementId,
    leafId: context.over.meta.leafId,
  };
};

const sameIntent = (a: PanesDropIntent | null, b: PanesDropIntent | null): boolean => JSON.stringify(a) === JSON.stringify(b);

const CloseButton = (props: { element: PanesElementSlot; tabIndex?: number }) => (
  <button
    type="button"
    class="k2b-panes__close"
    tabIndex={props.tabIndex}
    title={`Close ${elementTitle(props.element)}`}
    aria-label={`Close ${elementTitle(props.element)}`}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => {
      event.stopPropagation();
      props.element.props.onClose?.();
    }}
  >
    <i class="ti ti-x" aria-hidden="true" />
  </button>
);

function PanesElement(props: PanesElementProps): JSX.Element {
  return {
    kind: ELEMENT_SLOT,
    props,
  } satisfies PanesElementSlot as unknown as JSX.Element;
}

const PanesRoot = (props: PanesRootProps) => {
  const instanceId = `k2b-panes-${createUniqueId()}`;
  const resolved = children(() => props.children);
  const slots = createMemo(() => {
    const collected = collectElementSlots(resolved.toArray());
    assertUniqueStableUiIds(collected.map(elementId), "Panes.Element id", PANES_MAX_ID_LENGTH);
    return collected;
  });
  const elementById = createMemo(() => new Map(slots().map((slot) => [elementId(slot), slot])));
  const elementIds = createMemo(() => slots().map(elementId));
  const presentation = () => props.leafPresentation ?? "tabs";
  const value = createMemo(() => normalizePanesValue(props.value, elementIds(), presentation()));
  const canResize = () => readMaybe(props.allowResize, true);
  const canMove = () => readMaybe(props.allowMove, true);
  const canReorder = () => readMaybe(props.allowReorder, true);
  const canHorizontalSplit = () => readMaybe(props.allowHorizontalSplit, true);
  const canVerticalSplit = () => readMaybe(props.allowVerticalSplit, true);

  const paneDnd = dnd.create<DragMeta, DropMeta, PanesDropIntent>({
    collisionDetector: panesCollisionDetector,
    buildIntent,
    isSameIntent: sameIntent,
    announcements: {
      dragStart: (active) => `Picked up ${active.meta.label}.`,
      dragOver: (active, over) => (over ? `Move ${active.meta.label} to ${over.meta.label}.` : `${active.meta.label} is not over a pane.`),
      drop: (active, over) => (over ? `Moved ${active.meta.label} to ${over.meta.label}.` : `Did not move ${active.meta.label}.`),
      cancel: (active) => `Cancelled moving ${active.meta.label}.`,
    },
    onDrop: ({ intent }) => {
      if (!intent || !canMove()) return;
      let nextIntent = intent;
      if (nextIntent.kind === "split") {
        const horizontal = nextIntent.zone === "left" || nextIntent.zone === "right";
        if ((horizontal && !canHorizontalSplit()) || (!horizontal && !canVerticalSplit())) {
          if (!canReorder()) return;
          nextIntent = {
            kind: "move",
            elementId: nextIntent.elementId,
            leafId: nextIntent.leafId,
          };
        }
      }
      if (nextIntent.kind === "move" && !canReorder()) return;
      if (nextIntent.kind === "insert" && nextIntent.direction === "horizontal" && !canHorizontalSplit()) return;
      if (nextIntent.kind === "insert" && nextIntent.direction === "vertical" && !canVerticalSplit()) return;
      props.onValueChange(applyPanesIntent(value(), nextIntent, presentation()));
    },
  });

  const setActive = (leafId: string, elementId: string) => {
    const leaf = findPanesLeaf(value().root, leafId);
    if (!leaf?.elementIds.includes(elementId)) return;
    const next = activatePanesElement(value(), elementId);
    if (next !== value()) props.onValueChange(next);
  };

  const resize = (splitId: string, index: number, delta: number, baseSizes: number[]) =>
    props.onValueChange(resizePanesSplit(value(), splitId, index, delta, baseSizes));

  return (
    <div class={`k2b-panes ${props.class ?? ""}`} data-k2b-panes role="group" aria-label={props.label ?? "Pane workspace"}>
      <PanesNodeRenderer
        node={() => value().root}
        elementById={elementById()}
        dnd={paneDnd}
        instanceId={instanceId}
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

type RendererProps = {
  node: () => PanesNode;
  elementById: Map<string, PanesElementSlot>;
  dnd: PaneDnd;
  instanceId: string;
  keepMounted: boolean;
  canResize: () => boolean;
  canMove: () => boolean;
  canReorder: () => boolean;
  canHorizontalSplit: () => boolean;
  canVerticalSplit: () => boolean;
  onActive: (leafId: string, elementId: string) => void;
  onResize: (splitId: string, index: number, delta: number, baseSizes: number[]) => void;
};

function PanesNodeRenderer(props: RendererProps) {
  return (
    <>
      <Show when={props.node().type === "split"}>
        <PanesSplit
          node={() => props.node() as PanesSplitNode}
          elementById={props.elementById}
          dnd={props.dnd}
          instanceId={props.instanceId}
          keepMounted={props.keepMounted}
          canResize={props.canResize}
          canMove={props.canMove}
          canReorder={props.canReorder}
          canHorizontalSplit={props.canHorizontalSplit}
          canVerticalSplit={props.canVerticalSplit}
          onActive={props.onActive}
          onResize={props.onResize}
        />
      </Show>
      <Show when={props.node().type === "leaf"}>
        <PanesLeaf
          node={() => props.node() as PanesLeafNode}
          elementById={props.elementById}
          dnd={props.dnd}
          instanceId={props.instanceId}
          keepMounted={props.keepMounted}
          canMove={props.canMove}
          canReorder={props.canReorder}
          canHorizontalSplit={props.canHorizontalSplit}
          canVerticalSplit={props.canVerticalSplit}
          onActive={props.onActive}
        />
      </Show>
    </>
  );
}

function PanesSplit(props: Omit<RendererProps, "node"> & { node: () => PanesSplitNode }) {
  const dndInstanceId = createUniqueId();
  let container: HTMLDivElement | undefined;
  let stopResize: (() => void) | undefined;
  let finishResize: (() => void) | undefined;
  const direction = () => props.node().direction;
  const sizes = () => normalizePanesSizes(props.node().sizes, props.node().children.length);
  const insertIntent = (index: number) => {
    const intent = props.dnd.intent();
    return intent?.kind === "insert" && intent.splitId === props.node().id && intent.index === index;
  };

  const stopActiveResize = () => {
    stopResize?.();
    stopResize = undefined;
    finishResize = undefined;
  };

  const finishActiveResize = () => {
    finishResize?.();
    stopResize = undefined;
    finishResize = undefined;
  };

  onCleanup(stopActiveResize);

  const startResize = (event: PointerEvent, index: number) => {
    if (!props.canResize()) return;
    event.preventDefault();
    stopActiveResize();
    const split = props.node();
    const pointerId = event.pointerId;
    const captureTarget = event.currentTarget as HTMLElement;
    captureTarget.setPointerCapture?.(pointerId);
    const baseSizes = normalizePanesSizes(split.sizes, split.children.length);
    const start = split.direction === "horizontal" ? event.clientX : event.clientY;
    const rect = container?.getBoundingClientRect();
    const extent = Math.max(1, split.direction === "horizontal" ? (rect?.width ?? 1) : (rect?.height ?? 1));
    let resizeFrame: number | undefined;
    let pendingDelta: number | undefined;
    const flushResize = () => {
      if (resizeFrame !== undefined) {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = undefined;
      }
      if (pendingDelta === undefined) return;
      const delta = pendingDelta;
      pendingDelta = undefined;
      props.onResize(split.id, index, delta, baseSizes);
    };
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      const current = split.direction === "horizontal" ? move.clientX : move.clientY;
      pendingDelta = ((current - start) / extent) * 100;
      if (resizeFrame !== undefined) return;
      resizeFrame = requestAnimationFrame(flushResize);
    };
    const onEnd = (end: PointerEvent) => {
      if (end.pointerId !== pointerId) return;
      finishActiveResize();
    };
    stopResize = () => {
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeFrame = undefined;
      pendingDelta = undefined;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("blur", finishActiveResize);
      if (captureTarget.hasPointerCapture?.(pointerId)) captureTarget.releasePointerCapture(pointerId);
    };
    finishResize = () => {
      flushResize();
      stopResize?.();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("blur", finishActiveResize);
  };

  const resizeDelta = (event: KeyboardEvent, index: number): number | null => {
    if (!props.canResize()) return null;
    const split = props.node();
    const baseSizes = normalizePanesSizes(split.sizes, split.children.length);
    const current = baseSizes[index] ?? 0;
    const next = baseSizes[index + 1] ?? 0;
    const step = event.shiftKey ? 8 : 2;
    if (event.key === "Home") return -current + PANES_MIN_SIZE;
    if (event.key === "End") return next - PANES_MIN_SIZE;
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
    const delta = resizeDelta(event, index);
    if (delta === null) return;
    event.preventDefault();
    const split = props.node();
    props.onResize(split.id, index, delta, normalizePanesSizes(split.sizes, split.children.length));
  };

  return (
    <div ref={container} class="k2b-panes__split" data-direction={direction()}>
      <Index each={props.node().children}>
        {(child, index) => (
          <>
            <div class="k2b-panes__split-child" style={{ flex: `${sizes()[index] ?? 0} 1 0` }}>
              <PanesNodeRenderer
                node={child}
                elementById={props.elementById}
                dnd={props.dnd}
                instanceId={props.instanceId}
                keepMounted={props.keepMounted}
                canResize={props.canResize}
                canMove={props.canMove}
                canReorder={props.canReorder}
                canHorizontalSplit={props.canHorizontalSplit}
                canVerticalSplit={props.canVerticalSplit}
                onActive={props.onActive}
                onResize={props.onResize}
              />
            </div>
            <Show when={index < props.node().children.length - 1}>
              <button
                ref={(button) => {
                  props.dnd.droppable(button, () => ({
                    id: `panes-split-gap:${dndInstanceId}:${props.node().id}:${index}`,
                    meta: {
                      kind: "split-gap",
                      splitId: props.node().id,
                      index,
                      direction: direction(),
                      label: `the ${direction()} split boundary`,
                    },
                    disabled:
                      !props.canMove() ||
                      (direction() === "horizontal" && !props.canHorizontalSplit()) ||
                      (direction() === "vertical" && !props.canVerticalSplit()),
                  }));
                }}
                type="button"
                role="separator"
                aria-orientation={direction() === "horizontal" ? "vertical" : "horizontal"}
                aria-valuemin={PANES_MIN_SIZE}
                aria-valuemax={100 - PANES_MIN_SIZE}
                aria-valuenow={Math.round(sizes()[index] ?? 0)}
                aria-disabled={!props.canResize()}
                tabIndex={props.canResize() ? 0 : -1}
                class="k2b-panes__separator"
                data-direction={direction()}
                data-insert-active={insertIntent(index) ? "true" : undefined}
                aria-label="Resize panes"
                onPointerDown={(event) => startResize(event, index)}
                onKeyDown={(event) => onResizeKeyDown(event, index)}
              >
                <span aria-hidden="true" />
              </button>
            </Show>
          </>
        )}
      </Index>
    </div>
  );
}

function PanesLeaf(
  props: Omit<RendererProps, "node" | "canResize" | "onResize"> & {
    node: () => PanesLeafNode;
  },
) {
  const dndInstanceId = createUniqueId();
  const draggableId = (id: string) => `panes-element:${dndInstanceId}:${id}`;
  const tabDropId = (id: string) => `panes-tab:${dndInstanceId}:${props.node().id}:${id}`;
  const elements = createMemo(() => props.node().elementIds.flatMap((id) => props.elementById.get(id) ?? []));
  const activeId = createMemo(() =>
    props.node().elementIds.includes(props.node().activeElementId ?? "") ? props.node().activeElementId : props.node().elementIds[0],
  );
  const presentation = () => props.node().presentation ?? "tabs";
  const activeElement = () => props.elementById.get(activeId() ?? "");
  const activeElementTitle = () => {
    const element = activeElement();
    return element ? elementTitle(element) : props.node().id;
  };
  const mergePreviewElement = () => {
    const intent = props.dnd.intent();
    if (intent?.kind !== "move" || intent.leafId !== props.node().id) return null;
    if (props.node().elementIds.includes(intent.elementId)) return null;
    return props.elementById.get(intent.elementId) ?? null;
  };
  const showTabs = () => (presentation() === "tabs" && elements().length > 1) || !!mergePreviewElement();
  const splitIntent = (zone: PanesSplitZone) => {
    const intent = props.dnd.intent();
    return intent?.kind === "split" && intent.leafId === props.node().id && intent.zone === zone;
  };
  const tabId = (elementId: string) => `${props.instanceId}-${safeDomId(props.node().id)}-${safeDomId(elementId)}-tab`;
  const panelId = (elementId: string) => `${props.instanceId}-${safeDomId(props.node().id)}-${safeDomId(elementId)}-panel`;

  const focusTab = (index: number) => {
    const element = elements()[index];
    if (!element) return;
    props.onActive(props.node().id, elementId(element));
    queueMicrotask(() => document.getElementById(tabId(elementId(element)))?.focus());
  };

  const onTabKeyDown = (event: KeyboardEvent, index: number, element: PanesElementSlot) => {
    if ((event.key === "Delete" || event.key === "Backspace") && elementClosable(element)) {
      event.preventDefault();
      element.props.onClose?.();
      return;
    }
    const count = elements().length;
    if (count < 2) return;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = (index - 1 + count) % count;
    if (event.key === "ArrowRight") next = (index + 1) % count;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    focusTab(next);
  };

  return (
    <section
      ref={(element) => {
        props.dnd.droppable(element, () => ({
          id: `panes-leaf:${dndInstanceId}:${props.node().id}`,
          meta: {
            kind: "leaf",
            leafId: props.node().id,
            label: `pane ${activeElementTitle()}`,
          },
          disabled: !props.canMove() || (!props.canReorder() && !props.canHorizontalSplit() && !props.canVerticalSplit()),
        }));
      }}
      class="k2b-panes__leaf"
      data-presentation={presentation()}
    >
      <Show
        when={showTabs()}
        fallback={
          <Show when={activeElement()}>
            {(element) => (
              <div
                ref={(header) => {
                  props.dnd.droppable(header, () => ({
                    id: tabDropId(elementId(element())),
                    meta: {
                      kind: "tab",
                      leafId: props.node().id,
                      beforeElementId: elementId(element()),
                      label: `before ${elementTitle(element())}`,
                    },
                    disabled: !props.canReorder(),
                  }));
                  props.dnd.draggable(header, () => ({
                    id: draggableId(elementId(element())),
                    meta: {
                      elementId: elementId(element()),
                      label: elementTitle(element()),
                    },
                    disabled: !props.canMove(),
                    focusable: false,
                    keyboard: true,
                    handleSelector: "[data-panes-drag-handle]",
                  }));
                }}
                class="k2b-panes__single-header"
                data-dnd-active={props.dnd.activeId() === draggableId(elementId(element())) ? "true" : undefined}
              >
                <Show when={props.canMove()}>
                  <button
                    type="button"
                    data-panes-drag-handle
                    class="k2b-panes__drag"
                    tabIndex={-1}
                    title="Move pane"
                    aria-label={`Move ${elementTitle(element())}`}
                  >
                    <i class="ti ti-grip-vertical" aria-hidden="true" />
                  </button>
                </Show>
                <span class="k2b-ui k2b-panes__tab-button k2b-panes__drag-preview" data-dnd-preview>
                  <i class={`${iconClass(element().props.icon)} k2b-panes__icon`} aria-hidden="true" />
                  <span title={elementTitle(element())}>{elementTitle(element())}</span>
                </span>
                <Show when={elementClosable(element())}>
                  <CloseButton element={element()} tabIndex={-1} />
                </Show>
              </div>
            )}
          </Show>
        }
      >
        <div class="k2b-panes__tabs" role="tablist" aria-label="Pane tabs" aria-orientation="horizontal">
          <For each={elements()}>
            {(element, index) => {
              const active = () => activeId() === elementId(element);
              return (
                <div
                  ref={(tab) => {
                    props.dnd.droppable(tab, () => ({
                      id: tabDropId(elementId(element)),
                      meta: {
                        kind: "tab",
                        leafId: props.node().id,
                        beforeElementId: elementId(element),
                        label: `before ${elementTitle(element)}`,
                      },
                      disabled: !props.canReorder(),
                    }));
                    props.dnd.draggable(tab, () => ({
                      id: draggableId(elementId(element)),
                      meta: {
                        elementId: elementId(element),
                        label: elementTitle(element),
                      },
                      disabled: !props.canMove(),
                      focusable: active(),
                      keyboard: true,
                      handleSelector: "[data-panes-drag-handle]",
                    }));
                  }}
                  id={tabId(elementId(element))}
                  class="k2b-panes__tab"
                  role="tab"
                  aria-label={elementTitle(element)}
                  aria-selected={active()}
                  aria-controls={panelId(elementId(element))}
                  aria-posinset={index() + 1}
                  aria-setsize={elements().length}
                  aria-keyshortcuts={elementClosable(element) ? "Delete Backspace" : undefined}
                  tabIndex={active() ? 0 : -1}
                  title={elementTitle(element)}
                  data-active={active() ? "true" : undefined}
                  data-dnd-active={props.dnd.activeId() === draggableId(elementId(element)) ? "true" : undefined}
                  onClick={(event) => {
                    if ((event.target as Element).closest(".k2b-panes__close")) return;
                    props.onActive(props.node().id, elementId(element));
                  }}
                  onKeyDown={(event) => onTabKeyDown(event, index(), element)}
                >
                  <Show when={props.canMove()}>
                    <span data-panes-drag-handle class="k2b-panes__drag" title="Move tab" aria-hidden="true">
                      <i class="ti ti-grip-vertical" aria-hidden="true" />
                    </span>
                  </Show>
                  <span class="k2b-ui k2b-panes__tab-button k2b-panes__drag-preview" data-dnd-preview>
                    <i class={`${iconClass(element.props.icon)} k2b-panes__icon`} aria-hidden="true" />
                    <span>{elementTitle(element)}</span>
                  </span>
                  <Show when={elementClosable(element)}>
                    <span
                      class="k2b-panes__close"
                      title={`Close ${elementTitle(element)}`}
                      aria-hidden="true"
                      onPointerDown={(event) => event.stopPropagation()}
                      onPointerUp={(event) => {
                        event.stopPropagation();
                        element.props.onClose?.();
                      }}
                    >
                      <i class="ti ti-x" aria-hidden="true" />
                    </span>
                  </Show>
                </div>
              );
            }}
          </For>
          <Show when={mergePreviewElement()}>
            {(element) => (
              <div class="k2b-panes__merge-preview" aria-hidden="true">
                <i class="ti ti-plus" />
                <i class={iconClass(element().props.icon)} />
                <span>{elementTitle(element())}</span>
              </div>
            )}
          </Show>
        </div>
      </Show>

      <div class="k2b-panes__body" data-presentation={presentation()}>
        <For each={elements()}>
          {(element) => {
            const visible = () => activeId() === elementId(element) || presentation() === "stack";
            return (
              // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the runtime role is always tabpanel or region.
              <div
                id={panelId(elementId(element))}
                class="k2b-panes__panel"
                role={showTabs() ? "tabpanel" : "region"}
                aria-labelledby={showTabs() ? tabId(elementId(element)) : undefined}
                aria-label={!showTabs() ? elementTitle(element) : undefined}
                hidden={!visible()}
                data-active={visible() ? "true" : undefined}
              >
                <Show when={props.keepMounted || visible()}>{element.props.children}</Show>
              </div>
            );
          }}
        </For>
      </div>

      <SplitDropZone zone="left" active={splitIntent("left") && props.canMove() && props.canHorizontalSplit()} />
      <SplitDropZone zone="right" active={splitIntent("right") && props.canMove() && props.canHorizontalSplit()} />
      <SplitDropZone zone="top" active={splitIntent("top") && props.canMove() && props.canVerticalSplit()} />
      <SplitDropZone zone="bottom" active={splitIntent("bottom") && props.canMove() && props.canVerticalSplit()} />
    </section>
  );
}

function SplitDropZone(props: { zone: PanesSplitZone; active: boolean }) {
  return (
    <Show when={props.active}>
      <div class="k2b-panes__drop-zone" data-zone={props.zone} aria-hidden="true" />
    </Show>
  );
}

const Panes = PanesRoot as PanesComponent;
Panes.Root = PanesRoot;
Panes.Element = PanesElement;

export default Panes;
