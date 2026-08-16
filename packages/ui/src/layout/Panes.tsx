import { type DndCollisionContext, type DndController, type DndDroppableSnapshot, dnd } from "@k2b/stdlib/solid";
import { createMemo, createSignal, createUniqueId, For, type JSX, onCleanup, Show } from "solid-js";
import {
  activatePanesItem,
  applyPanesIntent,
  getPanesDropTargets,
  PANES_MAX_ID_LENGTH,
  PANES_MIN_RATIO,
  type PanesDropTarget,
  type PanesGroup,
  type PanesIntent,
  type PanesLayout,
  type PanesNode,
  type PanesPath,
  type PanesSplit,
  parsePanesLayout,
  resizePanesSplit,
  samePanesIntent,
} from "./panes-layout";
import { assertUniqueStableUiIds } from "./stable-id";

export type PanesItem = {
  id: string;
  title: string;
  icon?: string;
  render: () => JSX.Element;
  onClose?: () => void;
};

export type PanesProps = {
  layout: PanesLayout;
  onLayoutChange: (layout: PanesLayout) => void;
  items: readonly PanesItem[];
  movable?: boolean;
  resizable?: boolean;
  split?: false | "horizontal" | "vertical" | "both";
  onAddItem?: (targetItemId: string | null) => void;
  ariaLabel?: string;
  class?: string;
};

type DragMeta = { itemId: string; label: string };
type DropMeta = { target: PanesDropTarget; label: string };
type PaneDnd = DndController<DragMeta, DropMeta, PanesIntent>;

const iconClass = (icon: string | undefined): string => {
  const value = icon?.trim() || "ti-layout-sidebar-right";
  return value.startsWith("ti ") ? value : `ti ${value}`;
};

const collectLayoutItemIds = (node: PanesNode | null, ids: string[] = []): string[] => {
  if (!node) return ids;
  if (node.type === "group") ids.push(...node.items);
  else {
    collectLayoutItemIds(node.first, ids);
    collectLayoutItemIds(node.second, ids);
  }
  return ids;
};

const nearestDroppable = (entries: DndDroppableSnapshot<DropMeta>[]): DndDroppableSnapshot<DropMeta> | null =>
  entries.reduce<DndDroppableSnapshot<DropMeta> | null>(
    (winner, entry) => (!winner || entry.distance < winner.distance ? entry : winner),
    null,
  );

export const pointerHitsPanesDropTarget = (
  entry: Pick<DndDroppableSnapshot<DropMeta>, "containsPointer" | "meta" | "rect">,
  pointer: { x: number; y: number },
): boolean => {
  const side = entry.meta.target.side;
  if (entry.meta.target.kind !== "split" || !side) return entry.containsPointer;
  if (!entry.containsPointer) return false;
  const x = pointer.x - entry.rect.left;
  const y = pointer.y - entry.rect.top;
  if (side === "top") return x >= y && x <= entry.rect.width - y;
  if (side === "bottom") {
    const corner = entry.rect.height - y;
    return x >= corner && x <= entry.rect.width - corner;
  }
  if (side === "left") return y >= x && y <= entry.rect.height - x;
  const corner = entry.rect.width - x;
  return y >= corner && y <= entry.rect.height - corner;
};

const panesCollisionDetector = (context: DndCollisionContext<DragMeta, DropMeta, PanesIntent>): string | null =>
  nearestDroppable(context.droppables.filter((entry) => pointerHitsPanesDropTarget(entry, context.pointer)))?.id ?? null;

const createItemMap = (items: readonly PanesItem[]): Map<string, PanesItem> => {
  assertUniqueStableUiIds(
    items.map((item) => item.id),
    "Panes item id",
    PANES_MAX_ID_LENGTH,
  );
  return new Map(items.map((item) => [item.id, item]));
};

const requireItem = (items: Map<string, PanesItem>, id: string): PanesItem => {
  const item = items.get(id);
  if (!item) throw new Error(`Panes layout references missing item "${id}".`);
  return item;
};

export default function Panes(props: PanesProps): JSX.Element {
  const instanceId = `k2b-panes-${createUniqueId()}`;
  const items = createMemo(() => createItemMap(props.items));
  const layout = createMemo(() => {
    if (!parsePanesLayout(props.layout)) throw new Error("Panes layout must be a valid version 2 layout.");
    for (const id of collectLayoutItemIds(props.layout.root)) requireItem(items(), id);
    return props.layout;
  });
  const canMove = () => props.movable ?? true;
  const canResize = () => props.resizable ?? true;
  const split = () => props.split ?? "both";
  const [draggedItemId, setDraggedItemId] = createSignal<string | null>(null);
  const dropTargets = createMemo(() => {
    const itemId = draggedItemId();
    return itemId ? getPanesDropTargets(layout(), itemId, { movable: canMove(), split: split() }) : [];
  });
  const paneDnd = dnd.create<DragMeta, DropMeta, PanesIntent>({
    collisionDetector: panesCollisionDetector,
    buildIntent: ({ over }) => over?.meta.target.intent ?? null,
    isSameIntent: samePanesIntent,
    onDragStart: ({ active }) => setDraggedItemId(active.meta.itemId),
    announcements: {
      dragStart: (active) => `Picked up ${active.meta.label}.`,
      dragOver: (active, over) => (over ? `Move ${active.meta.label} to ${over.meta.label}.` : `${active.meta.label} is not over a pane.`),
      drop: (active, over) => (over ? `Moved ${active.meta.label} to ${over.meta.label}.` : `Did not move ${active.meta.label}.`),
      cancel: (active) => `Cancelled moving ${active.meta.label}.`,
    },
    onDrop: ({ intent, mode }) => {
      setDraggedItemId(null);
      if (!intent) return;
      const current = layout();
      const next = applyPanesIntent(current, intent);
      if (next === current) return;
      props.onLayoutChange(next);
      if (mode === "keyboard") queueMicrotask(() => document.getElementById(`${instanceId}-${intent.itemId}-tab`)?.focus());
    },
    onCancel: () => setDraggedItemId(null),
  });
  const activate = (itemId: string) => {
    const current = layout();
    const next = activatePanesItem(current, itemId);
    if (next !== current) props.onLayoutChange(next);
  };
  const requestAdd = (targetItemId: string | null) => props.onAddItem?.(targetItemId);

  return (
    <div class={`k2b-panes ${props.class ?? ""}`} data-k2b-panes role="group" aria-label={props.ariaLabel ?? "Pane workspace"}>
      <Show
        when={layout().root}
        fallback={
          <div class="k2b-panes__empty">
            <Show when={props.onAddItem !== undefined}>
              <button type="button" class="k2b-panes__add" onClick={() => requestAdd(null)} aria-label="Add pane">
                <i class="ti ti-plus" aria-hidden="true" />
                <span>Add pane</span>
              </button>
            </Show>
          </div>
        }
      >
        {(root) => (
          <PanesNodeRenderer
            node={root}
            path={[]}
            layout={layout}
            itemById={items}
            dnd={paneDnd}
            dropTargets={dropTargets}
            instanceId={instanceId}
            canMove={canMove}
            canResize={canResize}
            addItem={requestAdd}
            canAdd={() => props.onAddItem !== undefined}
            onActivate={activate}
            onLayoutChange={props.onLayoutChange}
          />
        )}
      </Show>
    </div>
  );
}

type RendererProps = {
  node: () => PanesNode;
  path: PanesPath;
  layout: () => PanesLayout;
  itemById: () => Map<string, PanesItem>;
  dnd: PaneDnd;
  dropTargets: () => PanesDropTarget[];
  instanceId: string;
  canMove: () => boolean;
  canResize: () => boolean;
  addItem: (targetItemId: string | null) => void;
  canAdd: () => boolean;
  onActivate: (itemId: string) => void;
  onLayoutChange: (layout: PanesLayout) => void;
};

function PanesNodeRenderer(props: RendererProps): JSX.Element {
  const split = createMemo(() => {
    const node = props.node();
    return node.type === "split" ? node : null;
  });
  const group = createMemo(() => {
    const node = props.node();
    return node.type === "group" ? node : null;
  });
  return (
    <>
      <Show when={split()}>{(node) => <PanesSplitRenderer {...props} node={node} />}</Show>
      <Show when={group()}>{(node) => <PanesGroupRenderer {...props} node={node} />}</Show>
    </>
  );
}

function PanesSplitRenderer(props: Omit<RendererProps, "node"> & { node: () => PanesSplit }): JSX.Element {
  let container: HTMLDivElement | undefined;
  let stopResize: (() => void) | undefined;
  let finishResize: (() => void) | undefined;
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
  const commitRatio = (ratio: number) => {
    const current = props.layout();
    const next = resizePanesSplit(current, props.path, ratio);
    if (next !== current) props.onLayoutChange(next);
  };
  const startResize = (event: PointerEvent) => {
    if (!props.canResize()) return;
    event.preventDefault();
    stopActiveResize();
    const pointerId = event.pointerId;
    const captureTarget = event.currentTarget as HTMLElement;
    const startRatio = props.node().ratio;
    const start = props.node().direction === "horizontal" ? event.clientX : event.clientY;
    const rect = container?.getBoundingClientRect();
    const extent = Math.max(1, props.node().direction === "horizontal" ? (rect?.width ?? 1) : (rect?.height ?? 1));
    let frame: number | undefined;
    let pendingRatio: number | undefined;
    const flush = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      if (pendingRatio === undefined) return;
      const ratio = pendingRatio;
      pendingRatio = undefined;
      commitRatio(ratio);
    };
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      const current = props.node().direction === "horizontal" ? move.clientX : move.clientY;
      pendingRatio = startRatio + (current - start) / extent;
      if (frame === undefined) frame = requestAnimationFrame(flush);
    };
    const onEnd = (end: PointerEvent) => {
      if (end.pointerId === pointerId) finishActiveResize();
    };
    stopResize = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      pendingRatio = undefined;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("blur", finishActiveResize);
      if (captureTarget.hasPointerCapture?.(pointerId)) captureTarget.releasePointerCapture(pointerId);
    };
    finishResize = () => {
      flush();
      stopResize?.();
    };
    captureTarget.setPointerCapture?.(pointerId);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("blur", finishActiveResize);
  };
  const onResizeKeyDown = (event: KeyboardEvent) => {
    if (!props.canResize()) return;
    const step = event.shiftKey ? 0.08 : 0.02;
    let ratio: number | null = null;
    if (event.key === "Home") ratio = PANES_MIN_RATIO;
    if (event.key === "End") ratio = 1 - PANES_MIN_RATIO;
    if (props.node().direction === "horizontal" && event.key === "ArrowLeft") ratio = props.node().ratio - step;
    if (props.node().direction === "horizontal" && event.key === "ArrowRight") ratio = props.node().ratio + step;
    if (props.node().direction === "vertical" && event.key === "ArrowUp") ratio = props.node().ratio - step;
    if (props.node().direction === "vertical" && event.key === "ArrowDown") ratio = props.node().ratio + step;
    if (ratio === null) return;
    event.preventDefault();
    commitRatio(ratio);
  };
  return (
    <div ref={container} class="k2b-panes__split" data-direction={props.node().direction}>
      <div class="k2b-panes__split-child" style={{ flex: `${props.node().ratio} 1 0` }}>
        <PanesNodeRenderer {...props} node={() => props.node().first} path={[...props.path, "first"]} />
      </div>
      <button
        type="button"
        role="separator"
        aria-orientation={props.node().direction === "horizontal" ? "vertical" : "horizontal"}
        aria-valuemin={Math.round(PANES_MIN_RATIO * 100)}
        aria-valuemax={Math.round((1 - PANES_MIN_RATIO) * 100)}
        aria-valuenow={Math.round(props.node().ratio * 100)}
        aria-disabled={!props.canResize()}
        tabIndex={props.canResize() ? 0 : -1}
        class="k2b-panes__separator"
        data-direction={props.node().direction}
        aria-label="Resize panes"
        onPointerDown={startResize}
        onKeyDown={onResizeKeyDown}
      >
        <span aria-hidden="true" />
      </button>
      <div class="k2b-panes__split-child" style={{ flex: `${1 - props.node().ratio} 1 0` }}>
        <PanesNodeRenderer {...props} node={() => props.node().second} path={[...props.path, "second"]} />
      </div>
    </div>
  );
}

function ActivePane(props: { itemId: string; itemById: () => Map<string, PanesItem> }): JSX.Element {
  return requireItem(props.itemById(), props.itemId).render();
}

function PanesGroupRenderer(props: Omit<RendererProps, "node"> & { node: () => PanesGroup }): JSX.Element {
  const dndInstanceId = createUniqueId();
  const draggableId = (id: string) => `panes-item:${dndInstanceId}:${id}`;
  const itemIds = createMemo(() => props.node().items);
  const groupTargets = createMemo(() => props.dropTargets().filter((target) => props.node().items.includes(target.targetItemId)));
  const targetBefore = (itemId: string) => groupTargets().find((target) => target.kind === "tab" && target.beforeItemId === itemId);
  const targetAtEnd = () => groupTargets().find((target) => target.kind === "tab" && target.beforeItemId === null);
  const bodyTargets = createMemo(() => groupTargets().filter((target) => target.kind !== "tab"));
  const tabId = (itemId: string) => `${props.instanceId}-${itemId}-tab`;
  const panelId = (itemId: string) => `${props.instanceId}-${itemId}-panel`;
  const focusTab = (index: number) => {
    const itemId = itemIds()[index];
    if (!itemId) return;
    props.onActivate(itemId);
    queueMicrotask(() => document.getElementById(tabId(itemId))?.focus());
  };
  const onTabKeyDown = (event: KeyboardEvent, index: number, itemId: string) => {
    if (props.dnd.activeId() === draggableId(itemId)) return;
    const item = requireItem(props.itemById(), itemId);
    if ((event.key === "Delete" || event.key === "Backspace") && item.onClose) {
      event.preventDefault();
      item.onClose();
      return;
    }
    const count = itemIds().length;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = (index - 1 + count) % count;
    if (event.key === "ArrowRight") next = (index + 1) % count;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    focusTab(next);
  };
  const targetLabel = (target: PanesDropTarget): string => {
    const targetItem = requireItem(props.itemById(), target.targetItemId);
    if (target.kind === "group") return `Add to ${targetItem.title}`;
    if (target.kind === "tab") {
      const before = target.beforeItemId ? requireItem(props.itemById(), target.beforeItemId) : null;
      return before ? `Insert before ${before.title}` : "Insert at end";
    }
    return `Add ${target.side} of ${targetItem.title}`;
  };
  return (
    <section class="k2b-panes__group">
      <div class="k2b-panes__tabs" role="tablist" aria-label="Pane tabs" aria-orientation="horizontal">
        <For each={itemIds()}>
          {(itemId, index) => {
            const item = () => requireItem(props.itemById(), itemId);
            const active = () => props.node().active === itemId;
            return (
              <div
                ref={(surface) =>
                  props.dnd.draggable(surface, () => ({
                    id: draggableId(itemId),
                    meta: { itemId, label: item().title },
                    disabled: !props.canMove(),
                    focusable: false,
                    keyboard: true,
                    handleSelector: ".k2b-panes__tab-button",
                  }))
                }
                class="k2b-panes__tab"
                data-active={active() ? "true" : undefined}
                data-movable={props.canMove() ? "true" : undefined}
                data-dnd-active={props.dnd.activeId() === draggableId(itemId) ? "true" : undefined}
              >
                <Show when={targetBefore(itemId)}>
                  {(target) => <PanesDropTargetView target={target()} label={targetLabel(target())} dnd={props.dnd} placement="tab" />}
                </Show>
                <button
                  id={tabId(itemId)}
                  type="button"
                  class="k2b-panes__tab-button"
                  role="tab"
                  aria-label={item().title}
                  aria-selected={active()}
                  aria-controls={active() ? panelId(itemId) : undefined}
                  aria-posinset={index() + 1}
                  aria-setsize={itemIds().length}
                  aria-keyshortcuts={item().onClose ? "Delete Backspace" : undefined}
                  tabIndex={active() ? 0 : -1}
                  title={item().title}
                  onClick={() => props.onActivate(itemId)}
                  onKeyDown={(event) => onTabKeyDown(event, index(), itemId)}
                >
                  <span class="k2b-ui k2b-panes__drag-surface k2b-panes__drag-preview" data-dnd-preview>
                    <i class={`${iconClass(item().icon)} k2b-panes__icon`} aria-hidden="true" />
                    <span>{item().title}</span>
                  </span>
                </button>
                <Show when={item().onClose !== undefined}>
                  <button
                    type="button"
                    class="k2b-panes__close"
                    title={`Close ${item().title}`}
                    aria-label={`Close ${item().title}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      item().onClose?.();
                    }}
                  >
                    <i class="ti ti-x" aria-hidden="true" />
                  </button>
                </Show>
              </div>
            );
          }}
        </For>
        <Show when={targetAtEnd()}>
          {(target) => <PanesDropTargetView target={target()} label={targetLabel(target())} dnd={props.dnd} placement="tab-end" />}
        </Show>
        <Show when={props.canAdd()}>
          <button
            type="button"
            class="k2b-panes__add k2b-panes__add--tab"
            aria-label="Add pane"
            title="Add pane"
            onClick={() => props.addItem(props.node().active)}
          >
            <i class="ti ti-plus" aria-hidden="true" />
          </button>
        </Show>
      </div>
      <div class="k2b-panes__body">
        <div id={panelId(props.node().active)} class="k2b-panes__panel" role="tabpanel" aria-labelledby={tabId(props.node().active)}>
          <Show when={props.node().active} keyed>
            {(itemId) => <ActivePane itemId={itemId} itemById={props.itemById} />}
          </Show>
        </div>
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

function PanesDropTargetView(props: {
  target: PanesDropTarget;
  label: string;
  dnd: PaneDnd;
  placement: "tab" | "tab-end" | "body";
}): JSX.Element {
  const icon = () => {
    if (props.target.kind === "group") return "ti ti-plus";
    if (props.target.kind === "tab") return "ti ti-caret-down-filled";
    if (props.target.side === "top") return "ti ti-row-insert-top";
    if (props.target.side === "bottom") return "ti ti-row-insert-bottom";
    if (props.target.side === "left") return "ti ti-column-insert-left";
    return "ti ti-column-insert-right";
  };
  return (
    <div
      ref={(element) =>
        props.dnd.droppable(element, () => ({
          id: `panes-target:${props.target.id}`,
          meta: { target: props.target, label: props.label },
        }))
      }
      class="k2b-panes__drop-target"
      data-kind={props.target.kind}
      data-placement={props.placement}
      data-zone={props.target.side}
      data-active={props.dnd.overId() === `panes-target:${props.target.id}` ? "true" : undefined}
      title={props.label}
      aria-hidden="true"
    >
      <i class={icon()} aria-hidden="true" />
      <Show when={props.target.kind !== "tab"}>
        <span>{props.label}</span>
      </Show>
    </div>
  );
}
