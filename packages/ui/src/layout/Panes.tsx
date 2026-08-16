import { type DndCollisionContext, type DndController, type DndDroppableSnapshot, dnd } from "@k2b/stdlib/solid";
import { children, createMemo, createSignal, createUniqueId, For, Index, type JSX, onCleanup, Show } from "solid-js";
import type { MaybeAccessor } from "../inputs/field-contract";
import {
  activatePanesElement,
  applyPanesIntent,
  findPanesLeaf,
  getPanesDropTargets,
  normalizePanesSizes,
  normalizePanesValue,
  PANES_MAX_ID_LENGTH,
  PANES_MIN_SIZE,
  type PanesDropIntent,
  type PanesDropTarget,
  type PanesLeafNode,
  type PanesLeafPresentation,
  type PanesNode,
  type PanesSplitNode,
  type PanesValue,
  resizePanesSplit,
  resolvePanesDropIntent,
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

type DropMeta = { target: PanesDropTarget; label: string };

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

const nearestDroppable = (entries: DndDroppableSnapshot<DropMeta>[]): DndDroppableSnapshot<DropMeta> | null =>
  entries.reduce<DndDroppableSnapshot<DropMeta> | null>(
    (winner, entry) => (!winner || entry.distance < winner.distance ? entry : winner),
    null,
  );

const pointerHitsSplitTarget = (
  entry: DndDroppableSnapshot<DropMeta>,
  pointer: DndCollisionContext<DragMeta, DropMeta, PanesDropIntent>["pointer"],
) => {
  if (entry.meta.target.kind !== "split" || !entry.meta.target.zone) return entry.containsPointer;
  if (!entry.containsPointer) return false;

  const x = pointer.x - entry.rect.left;
  const y = pointer.y - entry.rect.top;
  if (entry.meta.target.zone === "top") return x >= y && x <= entry.rect.width - y;
  if (entry.meta.target.zone === "bottom") {
    const corner = entry.rect.height - y;
    return x >= corner && x <= entry.rect.width - corner;
  }
  if (entry.meta.target.zone === "left") return y >= x && y <= entry.rect.height - x;

  const corner = entry.rect.width - x;
  return y >= corner && y <= entry.rect.height - corner;
};

const panesCollisionDetector = (context: DndCollisionContext<DragMeta, DropMeta, PanesDropIntent>): string | null => {
  const hits = context.droppables.filter((entry) => pointerHitsSplitTarget(entry, context.pointer));
  return nearestDroppable(hits)?.id ?? null;
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
  const [draggedElementId, setDraggedElementId] = createSignal<string | null>(null);
  const dropTargets = createMemo(() => {
    const dragged = draggedElementId();
    if (!dragged) return [];
    return getPanesDropTargets(value(), dragged, {
      allowMove: canMove(),
      allowReorder: canReorder(),
      allowHorizontalSplit: canHorizontalSplit(),
      allowVerticalSplit: canVerticalSplit(),
    });
  });

  const resolveIntent = (rawIntent: PanesDropIntent): PanesDropIntent | null => {
    if (!canMove()) return null;
    const intent = rawIntent;
    if (intent.kind === "split") {
      const horizontal = intent.zone === "left" || intent.zone === "right";
      if ((horizontal && !canHorizontalSplit()) || (!horizontal && !canVerticalSplit())) return null;
    }
    if (intent.kind === "move" && !canReorder()) return null;
    if (intent.kind === "insert" && intent.direction === "horizontal" && !canHorizontalSplit()) return null;
    if (intent.kind === "insert" && intent.direction === "vertical" && !canVerticalSplit()) return null;
    return resolvePanesDropIntent(value(), intent);
  };

  const paneDnd = dnd.create<DragMeta, DropMeta, PanesDropIntent>({
    collisionDetector: panesCollisionDetector,
    buildIntent: (context) => (context.over && !context.over.meta.target.disabled ? resolveIntent(context.over.meta.target.intent) : null),
    isSameIntent: sameIntent,
    onDragStart: ({ active }) => {
      setDraggedElementId(active.meta.elementId);
    },
    announcements: {
      dragStart: (active) => `Picked up ${active.meta.label}.`,
      dragOver: (active, over) => (over ? `Move ${active.meta.label} to ${over.meta.label}.` : `${active.meta.label} is not over a pane.`),
      drop: (active, over) => (over ? `Moved ${active.meta.label} to ${over.meta.label}.` : `Did not move ${active.meta.label}.`),
      cancel: (active) => `Cancelled moving ${active.meta.label}.`,
    },
    onDrop: ({ intent }) => {
      setDraggedElementId(null);
      if (!intent) return;
      props.onValueChange(applyPanesIntent(value(), intent, presentation()));
    },
    onCancel: () => {
      setDraggedElementId(null);
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
        dropTargets={dropTargets}
        instanceId={instanceId}
        keepMounted={props.keepMounted ?? true}
        canResize={canResize}
        canMove={canMove}
        canReorder={canReorder}
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
  dropTargets: () => PanesDropTarget[];
  instanceId: string;
  keepMounted: boolean;
  canResize: () => boolean;
  canMove: () => boolean;
  canReorder: () => boolean;
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
          dropTargets={props.dropTargets}
          instanceId={props.instanceId}
          keepMounted={props.keepMounted}
          canResize={props.canResize}
          canMove={props.canMove}
          canReorder={props.canReorder}
          onActive={props.onActive}
          onResize={props.onResize}
        />
      </Show>
      <Show when={props.node().type === "leaf"}>
        <PanesLeaf
          node={() => props.node() as PanesLeafNode}
          elementById={props.elementById}
          dnd={props.dnd}
          dropTargets={props.dropTargets}
          instanceId={props.instanceId}
          keepMounted={props.keepMounted}
          canMove={props.canMove}
          canReorder={props.canReorder}
          onActive={props.onActive}
        />
      </Show>
    </>
  );
}

function PanesSplit(props: Omit<RendererProps, "node"> & { node: () => PanesSplitNode }) {
  let container: HTMLDivElement | undefined;
  let stopResize: (() => void) | undefined;
  let finishResize: (() => void) | undefined;
  const direction = () => props.node().direction;
  const sizes = () => normalizePanesSizes(props.node().sizes, props.node().children.length);
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
                dropTargets={props.dropTargets}
                instanceId={props.instanceId}
                keepMounted={props.keepMounted}
                canResize={props.canResize}
                canMove={props.canMove}
                canReorder={props.canReorder}
                onActive={props.onActive}
                onResize={props.onResize}
              />
            </div>
            <Show when={index < props.node().children.length - 1}>
              <button
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
  const leafTargets = createMemo(() => props.dropTargets().filter((target) => target.leafId === props.node().id));
  const tabTargetBefore = (id: string) => leafTargets().find((target) => target.kind === "tab" && target.beforeElementId === id);
  const endTabTarget = () => leafTargets().find((target) => target.kind === "tab" && target.beforeElementId === null);
  const bodyTargets = createMemo(() => leafTargets().filter((target) => target.kind !== "tab"));
  const targetLabel = (target: PanesDropTarget) => {
    if (target.kind === "group") return `Add to ${activeElementTitle()}`;
    if (target.kind === "tab") {
      const before = target.beforeElementId ? props.elementById.get(target.beforeElementId) : null;
      return before ? `Insert before ${elementTitle(before)}` : "Insert at end";
    }
    return `Add ${target.zone}`;
  };
  const showTabs = () => presentation() === "tabs" && elements().length > 1;
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
    <section class="k2b-panes__leaf" data-presentation={presentation()}>
      <Show
        when={showTabs()}
        fallback={
          <Show when={activeElement()}>
            {(element) => (
              <div class="k2b-panes__single-tabs">
                <div
                  class="k2b-panes__single-header"
                  data-movable={props.canMove() ? "true" : undefined}
                  data-dnd-active={props.dnd.activeId() === draggableId(elementId(element())) ? "true" : undefined}
                >
                  <Show when={tabTargetBefore(elementId(element()))}>
                    {(target) => <PanesDropTargetView target={target()} label={targetLabel(target())} dnd={props.dnd} placement="tab" />}
                  </Show>
                  <span
                    ref={(surface) => {
                      props.dnd.draggable(surface, () => ({
                        id: draggableId(elementId(element())),
                        meta: {
                          elementId: elementId(element()),
                          label: elementTitle(element()),
                        },
                        disabled: !props.canMove(),
                        focusable: false,
                        keyboard: false,
                      }));
                    }}
                    class="k2b-ui k2b-panes__tab-button k2b-panes__drag-preview"
                    data-dnd-preview
                  >
                    <i class={`${iconClass(element().props.icon)} k2b-panes__icon`} aria-hidden="true" />
                    <span title={elementTitle(element())}>{elementTitle(element())}</span>
                  </span>
                  <Show when={elementClosable(element())}>
                    <CloseButton element={element()} tabIndex={-1} />
                  </Show>
                </div>
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
                  data-movable={props.canMove() ? "true" : undefined}
                  data-active={active() ? "true" : undefined}
                  data-dnd-active={props.dnd.activeId() === draggableId(elementId(element)) ? "true" : undefined}
                  onClick={(event) => {
                    if ((event.target as Element).closest(".k2b-panes__close")) return;
                    props.onActive(props.node().id, elementId(element));
                  }}
                  onKeyDown={(event) => onTabKeyDown(event, index(), element)}
                >
                  <Show when={tabTargetBefore(elementId(element))}>
                    {(target) => <PanesDropTargetView target={target()} label={targetLabel(target())} dnd={props.dnd} placement="tab" />}
                  </Show>
                  <span
                    ref={(surface) => {
                      props.dnd.draggable(surface, () => ({
                        id: draggableId(elementId(element)),
                        meta: {
                          elementId: elementId(element),
                          label: elementTitle(element),
                        },
                        disabled: !props.canMove(),
                        focusable: false,
                        keyboard: false,
                      }));
                    }}
                    class="k2b-ui k2b-panes__tab-button k2b-panes__drag-preview"
                    data-dnd-preview
                  >
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
          <Show when={endTabTarget()}>
            {(target) => <PanesDropTargetView target={target()} label={targetLabel(target())} dnd={props.dnd} placement="tab-end" />}
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
      <Show when={bodyTargets().length > 0}>
        <div class="k2b-panes__drop-targets" aria-hidden="true">
          <For each={bodyTargets()}>
            {(target) => <PanesDropTargetView target={target} label={targetLabel(target)} dnd={props.dnd} placement="body" />}
          </For>
        </div>
      </Show>
    </section>
  );
}

function PanesDropTargetView(props: { target: PanesDropTarget; label: string; dnd: PaneDnd; placement: "tab" | "tab-end" | "body" }) {
  const icon = () => {
    if (props.target.kind === "group") return "ti ti-plus";
    if (props.target.kind === "tab") return "ti ti-caret-down-filled";
    if (props.target.zone === "top") return "ti ti-row-insert-top";
    if (props.target.zone === "bottom") return "ti ti-row-insert-bottom";
    if (props.target.zone === "left") return "ti ti-column-insert-left";
    return "ti ti-column-insert-right";
  };
  return (
    <div
      ref={(element) => {
        props.dnd.droppable(element, () => ({
          id: `panes-target:${props.target.id}`,
          meta: { target: props.target, label: props.label },
          disabled: props.target.disabled,
        }));
      }}
      class="k2b-panes__drop-target"
      data-kind={props.target.kind}
      data-placement={props.placement}
      data-zone={props.target.zone}
      data-disabled={props.target.disabled ? "true" : undefined}
      data-active={props.dnd.overId() === `panes-target:${props.target.id}` ? "true" : undefined}
      title={props.target.disabled ? `${props.label} — already in this position` : props.label}
      aria-hidden="true"
    >
      <i class={icon()} />
      <Show when={props.target.kind !== "tab"}>
        <span>{props.label}</span>
      </Show>
    </div>
  );
}

const Panes = PanesRoot as PanesComponent;
Panes.Root = PanesRoot;
Panes.Element = PanesElement;

export default Panes;
