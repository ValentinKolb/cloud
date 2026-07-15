import { prompts, Tooltip } from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import {
  type DndBuildIntentContext,
  type DndDraggableSnapshot,
  type DndDroppableSnapshot,
  dnd,
  mutation as mutations,
} from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ItemFilter, ItemListResult, SpaceColumn, SpaceItem, SpaceTag, SpaceWormhole, WormholeTransferResult } from "@/contracts";
import { getDetailItemFromUrl, shouldHandleDetailClick, subscribeToDetailSelection } from "../../../lib/detail";
import { readResponseError } from "../../../lib/response";
import AssigneeAvatars from "../shared/AssigneeAvatars";
import CreateItemButton from "../sidebar/CreateItemButton";
import { requestSpacesRouteNavigation } from "../workspace/workspace-events";
import { canTransferThroughWormhole, showWormholeTransferToast, transferThroughWormhole } from "../wormhole-transfer";
import type { KanbanBucketInitial } from "./types";

type Props = {
  spaceId: string;
  baseUrl: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  selectedItemId?: string;
  initialBuckets: KanbanBucketInitial[];
  pageSize: number;
  dateConfig?: DateContext;
  canWrite: boolean;
  wormholes: SpaceWormhole[];
};

type LoadMoreContext = {
  bucketKey: string;
  request: ItemFilter;
};

type DragMeta = {
  itemId: string;
};

type DropMeta =
  | { kind: "item"; bucketKey: string; index: number }
  | { kind: "column"; bucketKey: string }
  | { kind: "wormhole"; wormholeId: string };

type DropIntent =
  | {
      kind: "column";
      bucketKey: string;
      rawInsertIndex: number;
      previewIndex: number;
    }
  | { kind: "wormhole"; wormholeId: string };

type MoveContext = {
  previousBuckets: KanbanBucketInitial[];
  sourceBucketKey: string;
  targetBucketKey: string;
  targetColumnId: string;
  targetRank: string;
  targetIndex: number;
  targetCompleted: boolean;
};

type TransferContext = {
  previousBuckets: KanbanBucketInitial[];
};

const RANK_STEP = 1024n;
const boardScrollMemory = new Map<string, { left: number; top: number }>();

const priorityMeta: Record<string, { icon: string; color: string }> = {
  urgent: { icon: "ti-alert-circle", color: "text-red-500" },
  high: { icon: "ti-arrow-up", color: "text-orange-500" },
  medium: { icon: "ti-minus", color: "text-yellow-500" },
  low: { icon: "ti-arrow-down", color: "text-blue-500" },
};

const buildItemUrl = (baseUrl: string, itemId: string) => {
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}item=${itemId}`;
};

const toRank = (value: string) => {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const betweenRanks = (before: bigint | null, after: bigint | null): bigint | null => {
  if (before === null && after === null) return RANK_STEP;
  if (before === null) {
    if (after! > RANK_STEP) return after! - RANK_STEP;
    return after! - 1n;
  }
  if (after === null) return before + RANK_STEP;
  if (after <= before) return null;
  const gap = after - before;
  if (gap <= 1n) return null;
  return before + gap / 2n;
};

const computeInsertRank = (items: SpaceItem[], insertIndex: number): bigint => {
  const before = insertIndex > 0 ? items[insertIndex - 1] : null;
  const after = insertIndex < items.length ? items[insertIndex] : null;
  const midpoint = betweenRanks(before ? toRank(before.rank) : null, after ? toRank(after.rank) : null);
  if (midpoint !== null) return midpoint;
  if (before) return toRank(before.rank) + 1n;
  if (after) return toRank(after.rank) - 1n;
  return RANK_STEP;
};

const buildRequest = (params: { bucket: KanbanBucketInitial; page: number; pageSize: number }): ItemFilter => {
  const { bucket, page, pageSize } = params;
  return {
    type: "all",
    status: bucket.isDone ? "completed" : "active",
    priority: undefined,
    tagIds: undefined,
    columnIds: bucket.columnId ? [bucket.columnId] : undefined,
    assignedTo: "all",
    deadlineFilter: "all",
    search: undefined,
    sort: "column",
    sortDesc: false,
    groupBy: "column",
    page,
    pageSize,
  };
};

/**
 * Kanban board with SSR-initialized buckets, drag/drop reordering and explicit per-column "load more".
 */
export default function KanbanBoard(props: Props) {
  const [buckets, setBuckets] = createSignal<KanbanBucketInitial[]>(props.initialBuckets);
  const [loadingBucketKey, setLoadingBucketKey] = createSignal<string | null>(null);
  const [movingItemId, setMovingItemId] = createSignal<string | null>(null);
  const [selectedItemId, setSelectedItemId] = createSignal<string | null>(props.selectedItemId ?? null);
  let boardScrollContainer: HTMLDivElement | undefined;
  createEffect(() => {
    setBuckets(props.initialBuckets);
    setSelectedItemId(props.selectedItemId ?? null);
  });

  const getBucketByKey = (bucketKey: string) => buckets().find((bucket) => bucket.key === bucketKey) ?? null;
  const getWormholeById = (wormholeId: string) => props.wormholes.find((wormhole) => wormhole.id === wormholeId) ?? null;
  const withViewTransition = (update: () => void) => {
    if (typeof document === "undefined") {
      update();
      return;
    }
    const doc = document as Document & {
      startViewTransition?: (callback: () => void) => unknown;
    };
    if (!doc.startViewTransition) {
      update();
      return;
    }
    doc.startViewTransition(() => {
      update();
    });
  };
  const boardScrollKey = () => `spaces-kanban-board-${props.spaceId}`;
  const rememberBoardScroll = () => {
    if (!boardScrollContainer) return;
    boardScrollMemory.set(boardScrollKey(), {
      left: boardScrollContainer.scrollLeft,
      top: boardScrollContainer.scrollTop,
    });
  };
  const restoreBoardScroll = (position = boardScrollMemory.get(boardScrollKey())) => {
    if (!boardScrollContainer || !position) return;
    boardScrollContainer.scrollLeft = position.left;
    boardScrollContainer.scrollTop = position.top;
  };
  const withBoardScrollPreserved = (update: () => void) => {
    const position = {
      left: boardScrollContainer?.scrollLeft ?? 0,
      top: boardScrollContainer?.scrollTop ?? 0,
    };
    boardScrollMemory.set(boardScrollKey(), position);
    update();
    requestAnimationFrame(() => {
      restoreBoardScroll(position);
      requestAnimationFrame(() => restoreBoardScroll(position));
    });
  };
  const resolveTargetColumnId = (bucket: KanbanBucketInitial) => {
    return bucket.columnId;
  };

  const findItemLocation = (itemId: string) => {
    for (const bucket of buckets()) {
      const index = bucket.items.findIndex((item) => item.id === itemId);
      if (index >= 0) {
        return {
          bucket,
          index,
          item: bucket.items[index]!,
        };
      }
    }
    return null;
  };

  const resolveMoveTargets = (params: { itemId: string; bucketKey: string }) => {
    const source = findItemLocation(params.itemId);
    const targetBucket = getBucketByKey(params.bucketKey);
    if (!source || !targetBucket) {
      return null;
    }
    return { source, targetBucket };
  };

  const normalizeTargetIndex = (params: {
    sourceBucketKey: string;
    sourceIndex: number;
    targetBucketKey: string;
    targetBucketLength: number;
    rawIndex: number;
  }) => {
    let targetIndex = clamp(params.rawIndex, 0, params.targetBucketLength);
    if (params.sourceBucketKey === params.targetBucketKey && params.sourceIndex < targetIndex) {
      targetIndex -= 1;
    }
    const maxIndex =
      params.sourceBucketKey === params.targetBucketKey ? Math.max(0, params.targetBucketLength - 1) : params.targetBucketLength;
    return clamp(targetIndex, 0, maxIndex);
  };

  const isNoOpMove = (itemId: string, intent: DropIntent) => {
    if (intent.kind !== "column") return false;
    const resolved = resolveMoveTargets({ itemId, bucketKey: intent.bucketKey });
    if (!resolved) return true;
    const targetIndex = normalizeTargetIndex({
      sourceBucketKey: resolved.source.bucket.key,
      sourceIndex: resolved.source.index,
      targetBucketKey: resolved.targetBucket.key,
      targetBucketLength: resolved.targetBucket.items.length,
      rawIndex: intent.rawInsertIndex,
    });
    return resolved.source.bucket.key === resolved.targetBucket.key && resolved.source.index === targetIndex;
  };

  const buildDropIntent = (ctx: DndBuildIntentContext<DragMeta, DropMeta, DropIntent>) => {
    if (!ctx.over) return null;

    if (ctx.over.meta.kind === "wormhole") {
      const source = findItemLocation(ctx.active.meta.itemId);
      if (!source || !canTransferThroughWormhole(source.item)) return null;
      return { kind: "wormhole" as const, wormholeId: ctx.over.meta.wormholeId };
    }

    let rawIndex: number;
    if (ctx.over.meta.kind === "item") {
      rawIndex = ctx.pointer.y <= ctx.over.rect.top + ctx.over.rect.height / 2 ? ctx.over.meta.index : ctx.over.meta.index + 1;
    } else {
      // Pointer is somewhere in the column body; locate insert index from card rects.
      const cards = ctx.over.element.querySelectorAll<HTMLElement>("[data-card-index]");
      rawIndex = cards.length;
      for (let i = 0; i < cards.length; i++) {
        const r = cards[i]!.getBoundingClientRect();
        if (ctx.pointer.y < r.top + r.height / 2) {
          rawIndex = i;
          break;
        }
      }
    }

    const resolved = resolveMoveTargets({
      itemId: ctx.active.meta.itemId,
      bucketKey: ctx.over.meta.bucketKey,
    });
    if (!resolved) return null;

    if (!resolveTargetColumnId(resolved.targetBucket)) {
      return null;
    }

    const previewIndex = normalizeTargetIndex({
      sourceBucketKey: resolved.source.bucket.key,
      sourceIndex: resolved.source.index,
      targetBucketKey: resolved.targetBucket.key,
      targetBucketLength: resolved.targetBucket.items.length,
      rawIndex,
    });

    return {
      kind: "column" as const,
      bucketKey: resolved.targetBucket.key,
      rawInsertIndex: rawIndex,
      previewIndex,
    };
  };

  const describeDroppable = (over: DndDroppableSnapshot<DropMeta> | null) => {
    if (!over) return "No target";
    if (over.meta.kind === "wormhole") {
      const target = getWormholeById(over.meta.wormholeId)?.target;
      return target ? `Wormhole to ${target.spaceName}, ${target.columnName}` : "Unavailable wormhole";
    }
    const bucket = getBucketByKey(over.meta.bucketKey);
    return bucket ? `Column ${bucket.label}` : "Unknown target";
  };

  const describeActiveItem = (active: DndDraggableSnapshot<DragMeta>) => {
    const location = findItemLocation(active.meta.itemId);
    return location?.item.title ?? "item";
  };

  const boardDnd = dnd.create<DragMeta, DropMeta, DropIntent>({
    buildIntent: buildDropIntent,
    announcements: {
      dragStart: (active) => `Picked up ${describeActiveItem(active)}`,
      dragOver: (_active, over) => describeDroppable(over),
      drop: (active, over) => `Dropped ${describeActiveItem(active)} in ${describeDroppable(over)}`,
      cancel: (active) => `Cancelled drag for ${describeActiveItem(active)}`,
    },
    onDrop: ({ active, intent }) => {
      if (!intent || moveMutation.loading() || transferMutation.loading()) return;
      if (intent.kind === "wormhole") {
        transferMutation.mutate({ itemId: active.meta.itemId, wormholeId: intent.wormholeId });
        return;
      }
      if (isNoOpMove(active.meta.itemId, intent)) return;
      moveMutation.mutate({
        itemId: active.meta.itemId,
        intent,
      });
    },
  });

  onCleanup(() => {
    boardDnd.destroy();
  });

  onMount(() => {
    requestAnimationFrame(() => restoreBoardScroll());
    boardScrollContainer?.addEventListener("scroll", rememberBoardScroll, { passive: true });
    setSelectedItemId(getDetailItemFromUrl());
    const unsubscribe = subscribeToDetailSelection(({ itemId }) => {
      setSelectedItemId(itemId);
    });
    onCleanup(() => {
      boardScrollContainer?.removeEventListener("scroll", rememberBoardScroll);
      unsubscribe();
    });
  });

  const loadMoreMutation = mutations.create<ItemListResult, { bucketKey: string }, LoadMoreContext>({
    onBefore: ({ bucketKey }) => {
      const bucket = getBucketByKey(bucketKey);
      if (!bucket) throw new Error("Column not found");

      const request = buildRequest({
        bucket,
        page: bucket.page + 1,
        pageSize: props.pageSize,
      });

      setLoadingBucketKey(bucketKey);
      return { bucketKey, request };
    },
    mutation: async (_vars, ctx) => {
      const res = await apiClient[":id"].items.filter.$post({
        param: { id: props.spaceId },
        json: ctx.request,
      });
      if (!res.ok) {
        throw new Error(await readResponseError(res, "Failed to load items"));
      }
      return (await res.json()) as ItemListResult;
    },
    onSuccess: (result, ctx) => {
      setBuckets((current) =>
        current.map((bucket) =>
          bucket.key === ctx?.bucketKey
            ? {
                ...bucket,
                items: [...bucket.items, ...result.items],
                page: result.page,
                totalPages: result.totalPages,
                total: result.total,
              }
            : bucket,
        ),
      );
    },
    onError: (error) => prompts.error(error.message),
    onFinally: () => setLoadingBucketKey(null),
  });

  const moveMutation = mutations.create<SpaceItem, { itemId: string; intent: DropIntent }, MoveContext>({
    onBefore: ({ itemId, intent }) => {
      if (intent.kind !== "column") throw new Error("Invalid column drop target");
      const previousBuckets = buckets();
      const resolved = resolveMoveTargets({
        itemId,
        bucketKey: intent.bucketKey,
      });
      if (!resolved) throw new Error("Unable to resolve drop target");

      const targetIndex = normalizeTargetIndex({
        sourceBucketKey: resolved.source.bucket.key,
        sourceIndex: resolved.source.index,
        targetBucketKey: resolved.targetBucket.key,
        targetBucketLength: resolved.targetBucket.items.length,
        rawIndex: intent.rawInsertIndex,
      });

      const targetColumnId = resolveTargetColumnId(resolved.targetBucket);
      if (!targetColumnId) {
        throw new Error("Target column is unavailable");
      }

      const targetItemsWithoutSource = resolved.targetBucket.items.filter((item) => item.id !== itemId);
      const targetIndexClamped = clamp(targetIndex, 0, targetItemsWithoutSource.length);
      const targetRank = computeInsertRank(targetItemsWithoutSource, targetIndexClamped);
      const optimisticUpdated: SpaceItem = {
        ...resolved.source.item,
        columnId: targetColumnId,
        rank: targetRank.toString(),
        completedAt: resolved.targetBucket.isDone ? new Date().toISOString() : null,
      };

      withBoardScrollPreserved(() => {
        withViewTransition(() => {
          setBuckets((current) =>
            current.map((bucket) => {
              const hadItem = bucket.items.some((item) => item.id === itemId);
              const nextItems = bucket.items.filter((item) => item.id !== itemId);
              let total = bucket.total - (hadItem ? 1 : 0);

              if (bucket.key === resolved.targetBucket.key) {
                nextItems.splice(targetIndexClamped, 0, optimisticUpdated);
                total += 1;
              }

              return {
                ...bucket,
                items: nextItems,
                total: Math.max(total, 0),
              };
            }),
          );
        });
      });

      setMovingItemId(itemId);
      return {
        previousBuckets,
        sourceBucketKey: resolved.source.bucket.key,
        targetBucketKey: resolved.targetBucket.key,
        targetColumnId,
        targetRank: targetRank.toString(),
        targetIndex: targetIndexClamped,
        targetCompleted: resolved.targetBucket.isDone,
      };
    },
    mutation: async (vars, ctx) => {
      const moveRes = await apiClient[":id"].items[":itemId"].move.$post({
        param: { id: props.spaceId, itemId: vars.itemId },
        json: {
          columnId: ctx.targetColumnId,
          rank: ctx.targetRank,
          completed: ctx.targetCompleted,
        },
      });
      if (!moveRes.ok) {
        throw new Error(await readResponseError(moveRes, "Failed to move item"));
      }
      return (await moveRes.json()) as SpaceItem;
    },
    onSuccess: (updated, ctx) => {
      withBoardScrollPreserved(() => {
        withViewTransition(() => {
          setBuckets((current) =>
            current.map((bucket) => {
              const hadItem = bucket.items.some((item) => item.id === updated.id);
              const nextItems = bucket.items.filter((item) => item.id !== updated.id);
              let total = bucket.total - (hadItem ? 1 : 0);

              if (bucket.key === ctx?.targetBucketKey) {
                const insertIndex = clamp(ctx.targetIndex, 0, nextItems.length);
                nextItems.splice(insertIndex, 0, updated);
                total += 1;
              }

              return {
                ...bucket,
                items: nextItems,
                total: Math.max(total, 0),
              };
            }),
          );
        });
      });
    },
    onError: (error, ctx) => {
      if (ctx?.previousBuckets) {
        withBoardScrollPreserved(() => {
          withViewTransition(() => {
            setBuckets(ctx.previousBuckets);
          });
        });
      }
      prompts.error(error.message);
    },
    onFinally: () => setMovingItemId(null),
  });

  const transferMutation = mutations.create<WormholeTransferResult, { itemId: string; wormholeId: string }, TransferContext>({
    onBefore: ({ itemId }) => {
      const source = findItemLocation(itemId);
      if (!source) throw new Error("Item is no longer available");
      if (!canTransferThroughWormhole(source.item)) throw new Error("Recurring items cannot move through wormholes");
      const previousBuckets = buckets();

      withBoardScrollPreserved(() => {
        withViewTransition(() => {
          setBuckets((current) =>
            current.map((bucket) => {
              const hadItem = bucket.items.some((item) => item.id === itemId);
              return hadItem
                ? { ...bucket, items: bucket.items.filter((item) => item.id !== itemId), total: Math.max(0, bucket.total - 1) }
                : bucket;
            }),
          );
        });
      });
      setMovingItemId(itemId);
      return { previousBuckets };
    },
    mutation: (vars, context) =>
      transferThroughWormhole({
        sourceSpaceId: props.spaceId,
        itemId: vars.itemId,
        wormholeId: vars.wormholeId,
        signal: context.abortSignal,
      }),
    onSuccess: (result) => {
      showWormholeTransferToast(result);
      if (selectedItemId() === result.item.id) {
        requestSpacesRouteNavigation(props.baseUrl, { scroll: "preserve" });
      }
    },
    onError: (error, context) => {
      if (context?.previousBuckets) {
        withBoardScrollPreserved(() => {
          withViewTransition(() => setBuckets(context.previousBuckets));
        });
      }
      if (error.name !== "AbortError") prompts.error(error.message);
    },
    onFinally: () => setMovingItemId(null),
  });

  const isLoadingBucket = (bucketKey: string) => loadMoreMutation.loading() && loadingBucketKey() === bucketKey;
  const hasMore = (bucket: KanbanBucketInitial) => bucket.page < bucket.totalPages;
  const isDropIndicatorVisible = (bucketKey: string, index: number) => {
    const intent = boardDnd.intent();
    return boardDnd.isDragging() && intent?.kind === "column" && intent.bucketKey === bucketKey && intent.previewIndex === index;
  };
  const isColumnTargetActive = (bucketKey: string) => {
    const intent = boardDnd.intent();
    return boardDnd.isDragging() && intent?.kind === "column" && intent.bucketKey === bucketKey;
  };
  const isWormholeTargetActive = (wormholeId: string) => {
    const intent = boardDnd.intent();
    return boardDnd.isDragging() && intent?.kind === "wormhole" && intent.wormholeId === wormholeId;
  };

  return (
    <div class="flex h-full min-h-0 flex-col gap-2">
      <div
        ref={boardScrollContainer}
        class="min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
        data-scroll-preserve={`spaces-kanban-board-${props.spaceId}`}
      >
        <div class="flex h-full min-w-max items-stretch gap-[var(--ui-space-shell)]">
          <For each={buckets()}>
            {(bucket) => {
              const canDropInBucket = props.canWrite && !!resolveTargetColumnId(bucket);

              return (
                <section class="flex h-full w-72 shrink-0 flex-col rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-subtle)] p-1">
                  <header class="flex items-center gap-2 px-1.5 py-1.5">
                    <span
                      class="h-2 w-2 shrink-0 rounded-full"
                      style={`background-color:${bucket.color ?? (bucket.isDone ? "#10b981" : "#6b7280")}`}
                    />
                    <h3 class="flex-1 truncate text-xs font-medium">{bucket.label}</h3>
                    <span class="text-[11px] tabular-nums text-dimmed">{bucket.total}</span>
                  </header>

                  <div
                    ref={(element) => {
                      boardDnd.droppable(element, () => ({
                        id: `drop:column:${bucket.key}`,
                        disabled: !canDropInBucket || moveMutation.loading() || transferMutation.loading(),
                        meta: { kind: "column", bucketKey: bucket.key },
                      }));
                    }}
                    class={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-[var(--ui-radius-control)] p-1.5 transition-[background-color,box-shadow] ${
                      isColumnTargetActive(bucket.key)
                        ? "bg-[var(--ui-selected)] [box-shadow:inset_0_0_0_1px_var(--ui-focus)]"
                        : "bg-transparent"
                    }`}
                    data-scroll-preserve={`spaces-kanban-column-${props.spaceId}-${bucket.key}`}
                  >
                    <Show when={bucket.items.length > 0} fallback={<p class="px-2 py-6 text-center text-[11px] text-dimmed">No items</p>}>
                      <For each={bucket.items}>
                        {(item, itemIndex) => {
                          const priority = item.priority ? priorityMeta[item.priority] : null;
                          const isSelected = () => item.id === selectedItemId();
                          const dragId = `drag:item:${item.id}`;
                          const dropId = `drop:item:${bucket.key}:${item.id}`;
                          const isDraggingThis = () => boardDnd.activeId() === dragId;
                          const isMovingThis = () => (moveMutation.loading() || transferMutation.loading()) && movingItemId() === item.id;

                          return (
                            <>
                              <Show when={isDropIndicatorVisible(bucket.key, itemIndex())}>
                                <div class="relative z-10 h-4">
                                  <div class="absolute inset-x-1 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-[var(--ui-focus)]" />
                                </div>
                              </Show>
                              <article
                                ref={(element) => {
                                  boardDnd.droppable(element, () => ({
                                    id: dropId,
                                    disabled: !canDropInBucket || moveMutation.loading() || transferMutation.loading(),
                                    meta: {
                                      bucketKey: bucket.key,
                                      index: itemIndex(),
                                      kind: "item",
                                    },
                                  }));
                                  boardDnd.draggable(element, () => ({
                                    id: dragId,
                                    disabled: !props.canWrite || moveMutation.loading() || transferMutation.loading(),
                                    focusable: false,
                                    keyboard: false,
                                    handleSelector: "[data-dnd-card-handle]",
                                    meta: { itemId: item.id },
                                  }));
                                }}
                                data-card-index={itemIndex()}
                                class={`group/card relative rounded-[var(--ui-radius-control)] border p-2.5 shadow-none transition-[background-color,border-color] ${
                                  isSelected()
                                    ? "border-[var(--ui-border-strong)] bg-[var(--ui-selected)]"
                                    : "border-[var(--ui-border)] bg-[var(--ui-surface)] hover:bg-[var(--ui-hover)]"
                                } ${isDraggingThis() ? "opacity-40" : ""}`}
                              >
                                <Show when={props.canWrite}>
                                  <Show
                                    when={isMovingThis()}
                                    fallback={
                                      <button
                                        type="button"
                                        data-dnd-card-handle
                                        aria-label={`Drag ${item.title}`}
                                        title="Drag"
                                        class="focus-ui absolute right-1.5 top-1.5 inline-flex h-5 w-5 cursor-grab items-center justify-center rounded-[var(--ui-radius-control)] text-dimmed opacity-0 transition-[color,background-color,opacity] hover:bg-[var(--ui-hover)] hover:text-primary group-hover/card:opacity-100 group-focus-within/card:opacity-100 active:cursor-grabbing"
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                        }}
                                      >
                                        <i class="ti ti-grip-vertical text-[13px]" />
                                      </button>
                                    }
                                  >
                                    <div class="pointer-events-none absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center text-dimmed">
                                      <i class="ti ti-loader-2 animate-spin text-[11px]" />
                                    </div>
                                  </Show>
                                </Show>
                                <a
                                  href={buildItemUrl(props.baseUrl, item.id)}
                                  onClick={(event) => {
                                    if (!shouldHandleDetailClick(event, event.currentTarget)) return;
                                    event.preventDefault();
                                    const href = buildItemUrl(props.baseUrl, item.id);
                                    setSelectedItemId(item.id);
                                    requestSpacesRouteNavigation(href, { scroll: "preserve" });
                                  }}
                                  class={`block ${props.canWrite ? "pr-5" : ""}`}
                                >
                                  <div class="flex items-start gap-2">
                                    <Show when={priority}>
                                      <i class={`ti ${priority!.icon} ${priority!.color} mt-0.5 shrink-0 text-xs`} />
                                    </Show>
                                    <p
                                      class={`break-words text-xs font-medium leading-tight ${item.completedAt ? "line-through text-dimmed" : ""}`}
                                    >
                                      {item.title}
                                    </p>
                                  </div>

                                  <Show when={item.description}>
                                    <p class="mt-1.5 line-clamp-3 break-words text-[11px] text-dimmed">{item.description}</p>
                                  </Show>

                                  <div class="mt-2 flex flex-wrap items-center gap-1.5">
                                    <Show when={item.deadline}>
                                      <span class="inline-flex items-center gap-1 text-[11px] text-dimmed">
                                        <i class="ti ti-clock text-[10px]" />
                                        {dates.formatDateRelative(item.deadline!)}
                                      </span>
                                    </Show>
                                    <Show when={item.assignees && item.assignees.length > 0}>
                                      <AssigneeAvatars assignees={item.assignees!} max={3} />
                                    </Show>
                                  </div>
                                </a>
                              </article>
                            </>
                          );
                        }}
                      </For>
                    </Show>

                    <Show when={isDropIndicatorVisible(bucket.key, bucket.items.length)}>
                      <div class="relative z-10 h-4">
                        <div class="absolute inset-x-1 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-[var(--ui-focus)]" />
                      </div>
                    </Show>

                    <Show when={hasMore(bucket)}>
                      <button
                        type="button"
                        onClick={() => loadMoreMutation.mutate({ bucketKey: bucket.key })}
                        disabled={isLoadingBucket(bucket.key)}
                        class="icon-btn mx-auto mt-1 h-7 w-7"
                        aria-label={`Load more items in ${bucket.label}`}
                        title="Load more"
                      >
                        <i class={`ti ${isLoadingBucket(bucket.key) ? "ti-loader-2 animate-spin" : "ti-arrow-down"} text-sm`} />
                      </button>
                    </Show>

                    <Show when={props.canWrite && bucket.columnId}>
                      <CreateItemButton
                        spaceId={props.spaceId}
                        columns={props.columns}
                        tags={props.tags}
                        dateConfig={props.dateConfig}
                        variant="inline"
                        defaultType="task"
                        defaultColumnId={bucket.columnId!}
                      />
                    </Show>
                  </div>
                </section>
              );
            }}
          </For>

          <Show when={props.canWrite && props.wormholes.length > 0}>
            <section class="flex h-full w-72 shrink-0 flex-col rounded-[var(--ui-radius-surface)] border border-[var(--ui-border-strong)] bg-[var(--ui-surface-subtle)] p-1">
              <header class="flex items-center gap-2 px-1.5 py-1.5">
                <i class="ti ti-arrow-bounce shrink-0 text-sm text-dimmed" />
                <h3 class="flex-1 truncate text-xs font-medium">Wormholes</h3>
                <Tooltip content="Drop an item into a wormhole to move it directly into a status in another Space.">
                  <button type="button" class="icon-btn h-5 w-5" aria-label="About wormholes">
                    <i class="ti ti-info-circle text-xs" />
                  </button>
                </Tooltip>
              </header>

              <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-[var(--ui-radius-control)] p-1.5">
                <For each={props.wormholes}>
                  {(wormhole) => (
                    <Show when={wormhole.target} keyed>
                      {(target) => {
                        const active = () => isWormholeTargetActive(wormhole.id);
                        const dropLabel = `Move item to ${target.spaceName}, ${target.columnName}`;

                        return (
                          <div
                            ref={(element) => {
                              boardDnd.droppable(element, () => ({
                                id: `drop:wormhole:${wormhole.id}`,
                                disabled: !props.canWrite || moveMutation.loading() || transferMutation.loading(),
                                meta: { kind: "wormhole", wormholeId: wormhole.id },
                              }));
                            }}
                            class={`flex h-36 shrink-0 flex-col items-center justify-center rounded-[var(--ui-radius-control)] border bg-[var(--ui-field)] px-5 py-4 text-center transition-[background-color,border-color,box-shadow] ${
                              active() ? "bg-[var(--ui-selected)]" : ""
                            }`}
                            style={
                              active()
                                ? `border-color:${wormhole.color};box-shadow:inset 0 0 0 1px var(--ui-focus),inset 0 2px 5px rgb(0 0 0 / 0.08)`
                                : `border-color:color-mix(in srgb, ${wormhole.color} 30%, var(--ui-border));box-shadow:inset 0 1px 2px rgb(0 0 0 / 0.05)`
                            }
                            title={dropLabel}
                          >
                            <i class="ti ti-arrow-bounce text-2xl" style={`color:${wormhole.color}`} />
                            <p class="mt-2 max-w-full truncate text-xs font-medium text-primary">{target.spaceName}</p>
                            <p class="mt-0.5 max-w-full truncate text-[11px] text-dimmed">{target.columnName}</p>
                            <p class="mt-2 text-[11px] font-medium text-dimmed">{active() ? "Release to move" : "Drop item here"}</p>
                          </div>
                        );
                      }}
                    </Show>
                  )}
                </For>
              </div>
            </section>
          </Show>
        </div>
      </div>
    </div>
  );
}
