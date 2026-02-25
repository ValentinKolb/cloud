import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";

export type DndId = string;

export type DndPointer = {
  x: number;
  y: number;
};

export type DndDraggableConfig<TDragMeta> = {
  id: DndId;
  meta: TDragMeta;
  disabled?: boolean;
  /**
   * If false, this element is not added to tab order automatically.
   * Useful when a draggable wraps its own interactive focus targets (e.g. links/buttons).
   */
  focusable?: boolean;
  /** Enables keyboard drag controls (Space/Enter/Escape/Arrows). */
  keyboard?: boolean;
  /** Optional CSS selector that must match the pointerdown target (or one of its ancestors) to start drag. */
  handleSelector?: string;
};

export type DndDroppableConfig<TDropMeta> = {
  id: DndId;
  meta: TDropMeta;
  disabled?: boolean;
};

export type DndDraggableSnapshot<TDragMeta> = {
  id: DndId;
  meta: TDragMeta;
  element: HTMLElement;
  rect: DOMRectReadOnly;
};

export type DndDroppableSnapshot<TDropMeta> = {
  id: DndId;
  meta: TDropMeta;
  element: HTMLElement;
  rect: DOMRectReadOnly;
  center: DndPointer;
  containsPointer: boolean;
  distance: number;
};

export type DndCollisionContext<TDragMeta, TDropMeta, TIntent> = {
  active: DndDraggableSnapshot<TDragMeta>;
  pointer: DndPointer;
  droppables: DndDroppableSnapshot<TDropMeta>[];
  previousOverId: DndId | null;
  previousIntent: TIntent | null;
};

export type DndBuildIntentContext<TDragMeta, TDropMeta, TIntent> = {
  active: DndDraggableSnapshot<TDragMeta>;
  over: DndDroppableSnapshot<TDropMeta> | null;
  pointer: DndPointer;
  previousIntent: TIntent | null;
};

export type DndEventContext<TDragMeta, TDropMeta, TIntent> = {
  mode: "pointer" | "keyboard";
  active: DndDraggableSnapshot<TDragMeta>;
  over: DndDroppableSnapshot<TDropMeta> | null;
  intent: TIntent | null;
  pointer: DndPointer;
};

export type DndCreateOptions<TDragMeta, TDropMeta, TIntent> = {
  activationDistance?: number;
  touchActivationDelayMs?: number;
  collisionDetector?: (ctx: DndCollisionContext<TDragMeta, TDropMeta, TIntent>) => DndId | null;
  buildIntent?: (ctx: DndBuildIntentContext<TDragMeta, TDropMeta, TIntent>) => TIntent | null;
  isSameIntent?: (a: TIntent | null, b: TIntent | null) => boolean;
  onDragStart?: (ctx: DndEventContext<TDragMeta, TDropMeta, TIntent>) => void;
  onDragOver?: (ctx: DndEventContext<TDragMeta, TDropMeta, TIntent>) => void;
  onDrop?: (ctx: DndEventContext<TDragMeta, TDropMeta, TIntent>) => void;
  onCancel?: (ctx: DndEventContext<TDragMeta, TDropMeta, TIntent>) => void;
  announcements?: {
    dragStart?: (active: DndDraggableSnapshot<TDragMeta>) => string;
    dragOver?: (active: DndDraggableSnapshot<TDragMeta>, over: DndDroppableSnapshot<TDropMeta> | null) => string;
    drop?: (active: DndDraggableSnapshot<TDragMeta>, over: DndDroppableSnapshot<TDropMeta> | null) => string;
    cancel?: (active: DndDraggableSnapshot<TDragMeta>) => string;
  };
};

export type DndController<TDragMeta, TDropMeta, TIntent> = {
  draggable: (el: HTMLElement, accessor: Accessor<DndDraggableConfig<TDragMeta>>) => void;
  droppable: (el: HTMLElement, accessor: Accessor<DndDroppableConfig<TDropMeta>>) => void;
  activeId: Accessor<DndId | null>;
  overId: Accessor<DndId | null>;
  intent: Accessor<TIntent | null>;
  isDragging: Accessor<boolean>;
  cancel: () => void;
  destroy: () => void;
};

type DraggableRecord<TDragMeta> = {
  id: DndId;
  element: HTMLElement;
  getConfig: () => DndDraggableConfig<TDragMeta>;
};

type DroppableRecord<TDropMeta> = {
  id: DndId;
  element: HTMLElement;
  getConfig: () => DndDroppableConfig<TDropMeta>;
};

type ActiveDrag<TDragMeta> = {
  mode: "pointer" | "keyboard";
  pointerId: number | null;
  pointerType: string | null;
  offsetX: number;
  offsetY: number;
  sourceOpacity: string;
  source: DraggableRecord<TDragMeta>;
  snapshot: DndDraggableSnapshot<TDragMeta>;
};

type PendingPointer<TDragMeta> = {
  record: DraggableRecord<TDragMeta>;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  startedAt: number;
  offsetX: number;
  offsetY: number;
};

const DEFAULT_ACTIVATION_DISTANCE = 6;
const DEFAULT_TOUCH_DELAY = 120;

const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  return !!target.closest("button, a, input, textarea, select, [contenteditable='true'], [data-dnd-ignore]");
};

const defaultIntentComparator = <TIntent,>(a: TIntent | null, b: TIntent | null) => a === b;

const defaultCollisionDetector = <TDragMeta, TDropMeta, TIntent>(
  ctx: DndCollisionContext<TDragMeta, TDropMeta, TIntent>,
): DndId | null => {
  if (ctx.droppables.length === 0) return null;
  const pointerHits = ctx.droppables.filter((entry) => entry.containsPointer);
  const pool = pointerHits.length > 0 ? pointerHits : ctx.droppables;
  let winner = pool[0]!;
  for (const candidate of pool) {
    if (candidate.distance < winner.distance) {
      winner = candidate;
    }
  }
  return winner.id;
};

const sortDroppablesForKeyboard = <TDropMeta,>(entries: DndDroppableSnapshot<TDropMeta>[]) =>
  [...entries].sort((a, b) => {
    const vertical = a.rect.top - b.rect.top;
    if (Math.abs(vertical) > 8) return vertical;
    return a.rect.left - b.rect.left;
  });

const createLiveRegion = () => {
  if (typeof document === "undefined") {
    return { announce: (_message: string) => {}, destroy: () => {} };
  }

  const element = document.createElement("div");
  element.setAttribute("aria-live", "polite");
  element.setAttribute("aria-atomic", "true");
  element.style.position = "fixed";
  element.style.width = "1px";
  element.style.height = "1px";
  element.style.padding = "0";
  element.style.margin = "-1px";
  element.style.overflow = "hidden";
  element.style.clip = "rect(0 0 0 0)";
  element.style.whiteSpace = "nowrap";
  element.style.border = "0";
  document.body.appendChild(element);

  const announce = (message: string) => {
    element.textContent = "";
    queueMicrotask(() => {
      element.textContent = message;
    });
  };

  const destroy = () => {
    element.remove();
  };

  return { announce, destroy };
};

const createGhost = (source: HTMLElement) => {
  if (typeof document === "undefined") return null;
  const rect = source.getBoundingClientRect();
  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.position = "fixed";
  clone.style.top = `${rect.top}px`;
  clone.style.left = `${rect.left}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.pointerEvents = "none";
  clone.style.zIndex = "9999";
  clone.style.margin = "0";
  clone.style.transform = "translate3d(0,0,0)";
  clone.style.opacity = "0.92";
  clone.style.boxShadow = "0 12px 28px rgba(0, 0, 0, 0.28)";
  clone.style.willChange = "transform";
  clone.setAttribute("aria-hidden", "true");
  document.body.appendChild(clone);
  return clone;
};

const getPointerFromEvent = (event: PointerEvent): DndPointer => ({ x: event.clientX, y: event.clientY });

export const createDnd = <TDragMeta, TDropMeta, TIntent>(
  options: DndCreateOptions<TDragMeta, TDropMeta, TIntent> = {},
): DndController<TDragMeta, TDropMeta, TIntent> => {
  const activationDistance = options.activationDistance ?? DEFAULT_ACTIVATION_DISTANCE;
  const touchActivationDelayMs = options.touchActivationDelayMs ?? DEFAULT_TOUCH_DELAY;
  const detectCollision = options.collisionDetector ?? defaultCollisionDetector;
  const compareIntent = options.isSameIntent ?? defaultIntentComparator<TIntent>;

  const draggables = new Map<DndId, DraggableRecord<TDragMeta>>();
  const droppables = new Map<DndId, DroppableRecord<TDropMeta>>();

  const [activeId, setActiveId] = createSignal<DndId | null>(null);
  const [overId, setOverId] = createSignal<DndId | null>(null);
  const [intent, setIntent] = createSignal<TIntent | null>(null);
  const [isDragging, setIsDragging] = createSignal(false);

  let activeDrag: ActiveDrag<TDragMeta> | null = null;
  let pendingPointer: PendingPointer<TDragMeta> | null = null;
  let pointer = { x: 0, y: 0 } satisfies DndPointer;
  let keyboardOverIndex = 0;
  let ghost: HTMLElement | null = null;
  let restoreUserSelect: (() => void) | null = null;
  const liveRegion = createLiveRegion();

  const announce = (message: string | null | undefined) => {
    if (!message) return;
    liveRegion.announce(message);
  };

  const getDroppableSnapshots = (currentPointer: DndPointer): DndDroppableSnapshot<TDropMeta>[] => {
    const entries: DndDroppableSnapshot<TDropMeta>[] = [];
    for (const record of droppables.values()) {
      const config = record.getConfig();
      if (config.disabled) continue;
      const rect = record.element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      const containsPointer =
        currentPointer.x >= rect.left &&
        currentPointer.x <= rect.right &&
        currentPointer.y >= rect.top &&
        currentPointer.y <= rect.bottom;
      const dx = currentPointer.x - center.x;
      const dy = currentPointer.y - center.y;
      entries.push({
        id: config.id,
        meta: config.meta,
        element: record.element,
        rect,
        center,
        containsPointer,
        distance: Math.sqrt(dx * dx + dy * dy),
      });
    }
    return entries;
  };

  const updateGhost = (currentPointer: DndPointer) => {
    if (!ghost || !activeDrag) return;
    const x = currentPointer.x - activeDrag.offsetX;
    const y = currentPointer.y - activeDrag.offsetY;
    ghost.style.transform = `translate3d(${x - activeDrag.snapshot.rect.left}px, ${y - activeDrag.snapshot.rect.top}px, 0)`;
  };

  const emitDragOver = () => {
    if (!activeDrag) return;

    const droppableSnapshots = getDroppableSnapshots(pointer);
    const nextOverId = detectCollision({
      active: activeDrag.snapshot,
      pointer,
      droppables: droppableSnapshots,
      previousOverId: overId(),
      previousIntent: intent(),
    });
    const nextOver = nextOverId ? droppableSnapshots.find((entry) => entry.id === nextOverId) ?? null : null;

    const nextIntent = options.buildIntent
      ? options.buildIntent({
          active: activeDrag.snapshot,
          over: nextOver,
          pointer,
          previousIntent: intent(),
        })
      : null;

    if (nextOverId !== overId()) {
      setOverId(nextOverId);
      announce(options.announcements?.dragOver?.(activeDrag.snapshot, nextOver));
    }

    if (!compareIntent(intent(), nextIntent)) {
      setIntent(() => nextIntent);
    }

    options.onDragOver?.({
      mode: activeDrag.mode,
      active: activeDrag.snapshot,
      over: nextOver,
      intent: nextIntent,
      pointer,
    });
  };

  const clearPointerListeners = () => {
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerCancel);
  };

  const clearGhost = () => {
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
  };

  /**
   * Temporarily disables global text selection while pointer-drag is pending/active.
   * This prevents accidental full-page text highlights during drag gestures.
   */
  const lockSelection = () => {
    if (typeof document === "undefined" || restoreUserSelect) return;
    const root = document.documentElement;
    const prevUserSelect = root.style.userSelect;
    const prevWebkitUserSelect = root.style.webkitUserSelect;
    root.style.userSelect = "none";
    root.style.webkitUserSelect = "none";
    restoreUserSelect = () => {
      root.style.userSelect = prevUserSelect;
      root.style.webkitUserSelect = prevWebkitUserSelect;
      restoreUserSelect = null;
    };
  };

  const unlockSelection = () => {
    restoreUserSelect?.();
  };

  const resetSourceOpacity = () => {
    if (!activeDrag) return;
    activeDrag.source.element.style.opacity = activeDrag.sourceOpacity;
  };

  const clearSession = () => {
    clearGhost();
    resetSourceOpacity();
    activeDrag = null;
    pendingPointer = null;
    unlockSelection();
    setIsDragging(false);
    setActiveId(null);
    setOverId(null);
    setIntent(null);
    pointer = { x: 0, y: 0 };
  };

  const beginDrag = (params: {
    record: DraggableRecord<TDragMeta>;
    mode: "pointer" | "keyboard";
    pointerId: number | null;
    pointerType: string | null;
    offsetX: number;
    offsetY: number;
  }) => {
    const config = params.record.getConfig();
    if (config.disabled) return;

    const rect = params.record.element.getBoundingClientRect();
    activeDrag = {
      mode: params.mode,
      pointerId: params.pointerId,
      pointerType: params.pointerType,
      offsetX: params.offsetX,
      offsetY: params.offsetY,
      sourceOpacity: params.record.element.style.opacity,
      source: params.record,
      snapshot: {
        id: config.id,
        meta: config.meta,
        element: params.record.element,
        rect,
      },
    };

    params.record.element.style.opacity = "0.35";
    setIsDragging(true);
    setActiveId(config.id);

    if (params.mode === "pointer") {
      ghost = createGhost(params.record.element);
      updateGhost(pointer);
    }

    announce(options.announcements?.dragStart?.(activeDrag.snapshot));

    const initialDroppables = getDroppableSnapshots(pointer);
    const sorted = sortDroppablesForKeyboard(initialDroppables);
    keyboardOverIndex = sorted.findIndex((entry) => entry.id === config.id);
    if (keyboardOverIndex < 0) keyboardOverIndex = 0;

    options.onDragStart?.({
      mode: params.mode,
      active: activeDrag.snapshot,
      over: null,
      intent: null,
      pointer,
    });

    emitDragOver();
  };

  const commitDrop = () => {
    if (!activeDrag) return;
    const currentOverId = overId();
    const currentOver = currentOverId
      ? getDroppableSnapshots(pointer).find((entry) => entry.id === currentOverId) ?? null
      : null;

    announce(options.announcements?.drop?.(activeDrag.snapshot, currentOver));
    options.onDrop?.({
      mode: activeDrag.mode,
      active: activeDrag.snapshot,
      over: currentOver,
      intent: intent(),
      pointer,
    });
    clearSession();
  };

  const cancel = () => {
    if (!activeDrag) return;
    const currentOverId = overId();
    const currentOver = currentOverId
      ? getDroppableSnapshots(pointer).find((entry) => entry.id === currentOverId) ?? null
      : null;
    announce(options.announcements?.cancel?.(activeDrag.snapshot));
    options.onCancel?.({
      mode: activeDrag.mode,
      active: activeDrag.snapshot,
      over: currentOver,
      intent: intent(),
      pointer,
    });
    clearSession();
  };

  const maybeStartPendingPointerDrag = (event: PointerEvent) => {
    if (!pendingPointer || activeDrag) return;
    if (event.pointerId !== pendingPointer.pointerId) return;

    const dx = event.clientX - pendingPointer.startX;
    const dy = event.clientY - pendingPointer.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const elapsed = Date.now() - pendingPointer.startedAt;

    const delaySatisfied = pendingPointer.pointerType !== "touch" || elapsed >= touchActivationDelayMs;
    if (distance < activationDistance || !delaySatisfied) {
      return;
    }

    beginDrag({
      record: pendingPointer.record,
      mode: "pointer",
      pointerId: pendingPointer.pointerId,
      pointerType: pendingPointer.pointerType,
      offsetX: pendingPointer.offsetX,
      offsetY: pendingPointer.offsetY,
    });
  };

  const onWindowPointerMove = (event: PointerEvent) => {
    if (pendingPointer && event.pointerId === pendingPointer.pointerId) {
      pointer = getPointerFromEvent(event);
      maybeStartPendingPointerDrag(event);
    }

    if (!activeDrag || activeDrag.mode !== "pointer") return;
    if (activeDrag.pointerId !== event.pointerId) return;

    pointer = getPointerFromEvent(event);
    updateGhost(pointer);
    emitDragOver();
    event.preventDefault();
  };

  const onWindowPointerUp = (event: PointerEvent) => {
    if (pendingPointer && event.pointerId === pendingPointer.pointerId && !activeDrag) {
      pendingPointer = null;
      unlockSelection();
      clearPointerListeners();
      return;
    }

    if (!activeDrag || activeDrag.mode !== "pointer") return;
    if (activeDrag.pointerId !== event.pointerId) return;

    commitDrop();
    clearPointerListeners();
  };

  const onWindowPointerCancel = (event: PointerEvent) => {
    if (pendingPointer && event.pointerId === pendingPointer.pointerId && !activeDrag) {
      pendingPointer = null;
      unlockSelection();
      clearPointerListeners();
      return;
    }

    if (!activeDrag || activeDrag.mode !== "pointer") return;
    if (activeDrag.pointerId !== event.pointerId) return;

    cancel();
    clearPointerListeners();
  };

  const handleKeyboardDrag = (event: KeyboardEvent, record: DraggableRecord<TDragMeta>) => {
    const config = record.getConfig();
    if (config.disabled) return;

    const isTriggerKey = event.key === " " || event.key === "Enter";
    const isArrowKey = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight";

    if (!activeDrag && isTriggerKey) {
      pointer = {
        x: record.element.getBoundingClientRect().left + 4,
        y: record.element.getBoundingClientRect().top + 4,
      };

      beginDrag({
        record,
        mode: "keyboard",
        pointerId: null,
        pointerType: "keyboard",
        offsetX: 0,
        offsetY: 0,
      });
      event.preventDefault();
      return;
    }

    if (!activeDrag || activeDrag.mode !== "keyboard" || activeDrag.snapshot.id !== config.id) return;

    if (event.key === "Escape") {
      cancel();
      event.preventDefault();
      return;
    }

    if (isTriggerKey) {
      commitDrop();
      event.preventDefault();
      return;
    }

    if (!isArrowKey) return;

    const sorted = sortDroppablesForKeyboard(getDroppableSnapshots(pointer));
    if (sorted.length === 0) return;

    const currentOverId = overId();
    const currentIndex = currentOverId ? sorted.findIndex((entry) => entry.id === currentOverId) : -1;
    const startIndex = currentIndex >= 0 ? currentIndex : keyboardOverIndex;
    const delta = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
    const nextIndex = Math.min(sorted.length - 1, Math.max(0, startIndex + delta));
    const next = sorted[nextIndex]!;
    keyboardOverIndex = nextIndex;
    pointer = {
      x: next.center.x,
      y: next.center.y,
    };
    emitDragOver();
    event.preventDefault();
  };

  const draggable = (element: HTMLElement, accessor: Accessor<DndDraggableConfig<TDragMeta>>) => {
    let current = accessor();
    const record: DraggableRecord<TDragMeta> = {
      id: current.id,
      element,
      getConfig: () => current,
    };

    draggables.set(record.id, record);

    const onPointerDown = (event: PointerEvent) => {
      const config = record.getConfig();
      if (config.disabled) return;
      if (event.button !== 0) return;
      if (event.isPrimary === false) return;

      if (config.handleSelector) {
        const target =
          event.target instanceof Element
            ? event.target
            : event.target instanceof Node
              ? event.target.parentElement
              : null;
        if (!target?.closest(config.handleSelector) || !element.contains(target)) {
          return;
        }
      } else if (isInteractiveTarget(event.target)) {
        return;
      }

      const rect = element.getBoundingClientRect();
      pointer = getPointerFromEvent(event);
      pendingPointer = {
        record,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: Date.now(),
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      lockSelection();

      window.addEventListener("pointermove", onWindowPointerMove, { passive: false });
      window.addEventListener("pointerup", onWindowPointerUp);
      window.addEventListener("pointercancel", onWindowPointerCancel);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const config = record.getConfig();
      if (config.keyboard === false) return;
      handleKeyboardDrag(event, record);
    };

    // Disable browser-native drag previews (e.g. links/images) so DnD stays app-controlled.
    const onDragStart = (event: DragEvent) => {
      event.preventDefault();
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("dragstart", onDragStart);
    element.setAttribute("data-dnd-draggable", "true");

    createEffect(() => {
      const next = accessor();
      if (next.id !== record.id) {
        draggables.delete(record.id);
        record.id = next.id;
        draggables.set(record.id, record);
      }
      current = next;
    });

    createEffect(() => {
      const next = accessor();
      if (next.focusable === false) {
        if (element.getAttribute("tabindex") === "0") {
          element.removeAttribute("tabindex");
        }
        return;
      }
      if (element.tabIndex < 0) {
        element.tabIndex = 0;
      }
    });

    createEffect(() => {
      const isActive = activeId() === record.id && isDragging();
      element.setAttribute("aria-grabbed", isActive ? "true" : "false");
    });

    onCleanup(() => {
      draggables.delete(record.id);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("dragstart", onDragStart);
      if (activeDrag?.snapshot.id === record.id) {
        cancel();
      }
    });
  };

  const droppable = (element: HTMLElement, accessor: Accessor<DndDroppableConfig<TDropMeta>>) => {
    let current = accessor();
    const record: DroppableRecord<TDropMeta> = {
      id: current.id,
      element,
      getConfig: () => current,
    };

    droppables.set(record.id, record);
    element.setAttribute("data-dnd-droppable", "true");

    createEffect(() => {
      const next = accessor();
      if (next.id !== record.id) {
        droppables.delete(record.id);
        record.id = next.id;
        droppables.set(record.id, record);
      }
      current = next;
    });

    createEffect(() => {
      const isOver = overId() === record.id && isDragging();
      element.setAttribute("data-dnd-over", isOver ? "true" : "false");
    });

    onCleanup(() => {
      droppables.delete(record.id);
    });
  };

  const destroy = () => {
    if (activeDrag) {
      cancel();
    }
    unlockSelection();
    clearPointerListeners();
    draggables.clear();
    droppables.clear();
    liveRegion.destroy();
  };

  return {
    draggable,
    droppable,
    activeId,
    overId,
    intent,
    isDragging,
    cancel,
    destroy,
  };
};

export const dnd = {
  create: createDnd,
} as const;
