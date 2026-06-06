import { prompts } from "@valentinkolb/cloud/ui";
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
import type { ItemFilter, ItemListResult, SpaceColumn, SpaceItem, SpaceTag } from "@/contracts";
import { getDetailItemFromUrl, shouldHandleDetailClick, subscribeToDetailSelection } from "../../../lib/detail";
import { requestSpacesRouteNavigation } from "../workspace/workspace-events";
import type { KanbanBucketInitial } from "./types";

type Props = {
  spaceId: string;
  baseUrl: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  selectedItemId?: string;
  initialBuckets: KanbanBucketInitial[];
  pageSize: number;
  completedColumnId?: string | null;
  dateConfig?: DateContext;
};

type LoadMoreContext = {
  bucketKey: string;
  request: ItemFilter;
};

type DragMeta = {
  itemId: string;
};

type DropMeta = { kind: "item"; bucketKey: string; index: number } | { kind: "column"; bucketKey: string };

type DropIntent = {
  bucketKey: string;
  rawInsertIndex: number;
  previewIndex: number;
};

type MoveContext = {
  previousBuckets: KanbanBucketInitial[];
  sourceBucketKey: string;
  targetBucketKey: string;
  targetColumnId: string;
  targetRank: string;
  targetIndex: number;
  targetCompleted: boolean;
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
  const isCompletedBucket = bucket.kind === "completed";

  return {
    type: "all",
    status: isCompletedBucket ? "completed" : "active",
    priority: undefined,
    tagIds: undefined,
    columnIds: isCompletedBucket ? undefined : bucket.columnId ? [bucket.columnId] : undefined,
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
    setSelectedItemId(props.selectedItemId ?? null);
  });

  const getBucketByKey = (bucketKey: string) => buckets().find((bucket) => bucket.key === bucketKey) ?? null;
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
    if (bucket.kind === "completed") return props.completedColumnId ?? null;
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
      bucketKey: resolved.targetBucket.key,
      rawInsertIndex: rawIndex,
      previewIndex,
    };
  };

  const describeDroppable = (over: DndDroppableSnapshot<DropMeta> | null) => {
    if (!over) return "No target";
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
      if (!intent || moveMutation.loading() || isNoOpMove(active.meta.itemId, intent)) {
        return;
      }
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
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to load items");
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
        throw new Error("No completed column available for drop target");
      }

      const targetItemsWithoutSource = resolved.targetBucket.items.filter((item) => item.id !== itemId);
      const targetIndexClamped = clamp(targetIndex, 0, targetItemsWithoutSource.length);
      const targetRank = computeInsertRank(targetItemsWithoutSource, targetIndexClamped);
      const optimisticUpdated: SpaceItem = {
        ...resolved.source.item,
        columnId: targetColumnId,
        rank: targetRank.toString(),
        completedAt: resolved.targetBucket.kind === "completed" ? new Date().toISOString() : null,
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
        targetCompleted: resolved.targetBucket.kind === "completed",
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
        const data = await moveRes.json();
        throw new Error("message" in data ? data.message : "Failed to move item");
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

  const isLoadingBucket = (bucketKey: string) => loadMoreMutation.loading() && loadingBucketKey() === bucketKey;
  const hasMore = (bucket: KanbanBucketInitial) => bucket.page < bucket.totalPages;
  const isDropIndicatorVisible = (bucketKey: string, index: number) =>
    boardDnd.isDragging() && boardDnd.intent()?.bucketKey === bucketKey && boardDnd.intent()?.previewIndex === index;

  return (
    <div
      ref={boardScrollContainer}
      class="h-full overflow-x-auto overflow-y-hidden px-3 py-1"
      data-scroll-preserve={`spaces-kanban-board-${props.spaceId}`}
    >
      <div class="flex h-full min-w-max items-stretch gap-3">
        <For each={buckets()}>
          {(bucket) => {
            const isCompletedBucket = bucket.kind === "completed";
            const canDropInBucket = !!resolveTargetColumnId(bucket);

            return (
              <section class="flex h-full w-72 shrink-0 flex-col">
                <header class="flex items-center gap-2 px-1.5 py-1.5">
                  <span
                    class="h-2 w-2 shrink-0 rounded-full"
                    style={`background-color:${bucket.color ?? (isCompletedBucket ? "#10b981" : "#6b7280")}`}
                  />
                  <h3 class="flex-1 truncate text-xs font-medium">{bucket.label}</h3>
                  <span class="text-[11px] text-dimmed">{bucket.total}</span>
                </header>

                <div
                  ref={(element) => {
                    boardDnd.droppable(element, () => ({
                      id: `drop:column:${bucket.key}`,
                      disabled: !canDropInBucket || moveMutation.loading(),
                      meta: { kind: "column", bucketKey: bucket.key },
                    }));
                  }}
                  class={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-lg p-1.5 transition-colors ${
                    boardDnd.isDragging() && boardDnd.intent()?.bucketKey === bucket.key
                      ? "bg-blue-500/10 dark:bg-blue-400/10 [box-shadow:var(--theme-recess),inset_0_0_0_2px_rgb(59_130_246/0.45)] dark:[box-shadow:var(--theme-recess),inset_0_0_0_2px_rgb(96_165_250/0.45)]"
                      : "bg-zinc-100/60 dark:bg-zinc-950/40 [box-shadow:var(--theme-recess)]"
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
                        const isMovingThis = () => moveMutation.loading() && movingItemId() === item.id;

                        return (
                          <>
                            <Show when={isDropIndicatorVisible(bucket.key, itemIndex())}>
                              <div class="relative z-10 h-4">
                                <div class="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-md border border-blue-500/80 bg-blue-500/25 dark:border-blue-400/80 dark:bg-blue-400/25" />
                              </div>
                            </Show>
                            <article
                              ref={(element) => {
                                boardDnd.droppable(element, () => ({
                                  id: dropId,
                                  disabled: !canDropInBucket || moveMutation.loading(),
                                  meta: {
                                    bucketKey: bucket.key,
                                    index: itemIndex(),
                                    kind: "item",
                                  },
                                }));
                                boardDnd.draggable(element, () => ({
                                  id: dragId,
                                  disabled: moveMutation.loading(),
                                  focusable: false,
                                  keyboard: false,
                                  handleSelector: "[data-dnd-card-handle]",
                                  meta: { itemId: item.id },
                                }));
                              }}
                              data-card-index={itemIndex()}
                              class={`group/card relative rounded-md border p-2.5 transition-colors ${
                                isSelected()
                                  ? "border-blue-500 bg-blue-500/[0.08] ring-1 ring-blue-500 dark:border-blue-400 dark:bg-blue-400/10 dark:ring-blue-400"
                                  : "border-zinc-200 bg-white [box-shadow:var(--theme-bevel-top),var(--theme-bevel-bottom)] hover:border-blue-500/45 hover:bg-blue-500/[0.04] dark:border-zinc-700/70 dark:bg-zinc-900 dark:hover:border-blue-400/45 dark:hover:bg-blue-400/[0.06]"
                              } ${isDraggingThis() ? "opacity-40" : ""}`}
                            >
                              <Show
                                when={isMovingThis()}
                                fallback={
                                  <button
                                    type="button"
                                    data-dnd-card-handle
                                    aria-label={`Drag ${item.title}`}
                                    title="Drag"
                                    class="absolute right-1.5 top-1.5 inline-flex h-5 w-5 cursor-grab items-center justify-center rounded-md text-dimmed opacity-0 transition-colors hover:bg-zinc-100 hover:text-primary group-hover/card:opacity-100 active:cursor-grabbing dark:hover:bg-zinc-800"
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
                              <a
                                href={buildItemUrl(props.baseUrl, item.id)}
                                onClick={(event) => {
                                  if (!shouldHandleDetailClick(event, event.currentTarget)) return;
                                  event.preventDefault();
                                  const href = buildItemUrl(props.baseUrl, item.id);
                                  setSelectedItemId(item.id);
                                  requestSpacesRouteNavigation(href, { scroll: "preserve" });
                                }}
                                class="block pr-5"
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
                                    <span class="inline-flex items-center gap-1 text-[11px] text-dimmed">
                                      <i class="ti ti-user text-[10px]" />
                                      {item.assignees!.length}
                                    </span>
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
                      <div class="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-md border border-blue-500/80 bg-blue-500/25 dark:border-blue-400/80 dark:bg-blue-400/25" />
                    </div>
                  </Show>

                  <Show when={hasMore(bucket)}>
                    <button
                      type="button"
                      onClick={() => loadMoreMutation.mutate({ bucketKey: bucket.key })}
                      disabled={isLoadingBucket(bucket.key)}
                      class="mx-auto mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-dimmed transition-colors hover:bg-zinc-200/60 hover:text-primary dark:hover:bg-zinc-800"
                      aria-label={`Load more items in ${bucket.label}`}
                      title="Load more"
                    >
                      <i class={`ti ${isLoadingBucket(bucket.key) ? "ti-loader-2 animate-spin" : "ti-arrow-down"} text-sm`} />
                    </button>
                  </Show>
                </div>
              </section>
            );
          }}
        </For>
      </div>
    </div>
  );
}
