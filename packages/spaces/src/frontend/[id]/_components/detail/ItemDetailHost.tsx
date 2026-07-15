import { Placeholder, prompts } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceColumn, SpaceComment, SpaceItem, SpaceTag, SpaceWormhole } from "@/contracts";
import { subscribeToDetailSelection } from "../../../lib/detail";
import { readResponseError } from "../../../lib/response";
import ItemDetailPanel from "./ItemDetailPanel";

type Props = {
  spaceId: string;
  baseUrl: string;
  currentUserId: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  wormholes: SpaceWormhole[];
  initialItem: SpaceItem | null;
  initialComments: SpaceComment[];
  showEmpty?: boolean;
  emptyText?: string;
  dateConfig?: DateContext;
  canWrite: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isNullableString = (value: unknown): value is string | null => typeof value === "string" || value === null;
const isSpaceComment = (value: unknown): value is SpaceComment =>
  isObject(value) &&
  typeof value["id"] === "string" &&
  typeof value["itemId"] === "string" &&
  typeof value["content"] === "string" &&
  isNullableString(value["userId"]) &&
  isNullableString(value["userName"]) &&
  isNullableString(value["userAvatarHash"]) &&
  typeof value["createdAt"] === "string" &&
  typeof value["updatedAt"] === "string" &&
  typeof value["canDelete"] === "boolean";
const isSpaceCommentArray = (value: unknown): value is SpaceComment[] => Array.isArray(value) && value.every(isSpaceComment);

type DetailLoadInput = {
  itemId: string;
  prefetchedItem: SpaceItem | null;
};

type DetailLoadResult = {
  item: SpaceItem | null;
  comments: SpaceComment[];
};

/**
 * Client-side detail host for hybrid SSR/detail routing.
 * Keeps URL as source of truth and fetches details without full-page reload.
 */
export default function ItemDetailHost(props: Props) {
  const [item, setItem] = createSignal<SpaceItem | null>(props.initialItem);
  const [comments, setComments] = createSignal<SpaceComment[]>(props.initialComments ?? []);

  const loadComments = async (itemId: string, signal: AbortSignal) => {
    const commentsRes = await apiClient[":id"].items[":itemId"].comments.$get(
      {
        param: { id: props.spaceId, itemId },
      },
      { init: { signal } },
    );
    if (!commentsRes.ok) {
      throw new Error(await readResponseError(commentsRes, "Failed to load comments"));
    }
    const data = await commentsRes.json();
    if (!isSpaceCommentArray(data)) return [];
    return data;
  };

  const loadItem = async (itemId: string, signal: AbortSignal) => {
    const itemRes = await apiClient[":id"].items[":itemId"].$get(
      {
        param: { id: props.spaceId, itemId },
      },
      { init: { signal } },
    );
    if (!itemRes.ok) {
      throw new Error(await readResponseError(itemRes, "Failed to load item"));
    }
    return (await itemRes.json()) as SpaceItem;
  };

  const detailMutation = mutations.create<DetailLoadResult, DetailLoadInput>({
    mutation: async ({ itemId, prefetchedItem }, ctx) => {
      const nextItem =
        prefetchedItem && prefetchedItem.id === itemId
          ? prefetchedItem
          : item()?.id === itemId
            ? item()
            : await loadItem(itemId, ctx.abortSignal);
      const nextComments = await loadComments(itemId, ctx.abortSignal);
      return { item: nextItem ?? null, comments: nextComments };
    },
    onSuccess: (result) => {
      setItem(result.item);
      setComments(result.comments);
    },
    onError: (error) => {
      if (error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "Failed to load item";
      clearSelection();
      prompts.error(message);
    },
  });

  createEffect(() => {
    detailMutation.abort();
    setItem(props.initialItem);
    setComments(props.initialComments ?? []);
  });

  const clearSelection = () => {
    detailMutation.abort();
    setItem(null);
    setComments([]);
  };

  const hydrateDetail = (nextItemId: string, prefetchedItem: SpaceItem | null = null) => {
    detailMutation.abort();
    if (prefetchedItem?.id === nextItemId) setItem(prefetchedItem);
    if (item()?.id !== nextItemId) setComments([]);
    void detailMutation.mutate({ itemId: nextItemId, prefetchedItem });
  };

  onMount(() => {
    const unsubscribe = subscribeToDetailSelection(({ itemId, item: prefetchedItem }) => {
      if (!itemId) {
        clearSelection();
        return;
      }
      void hydrateDetail(itemId, prefetchedItem);
    });
    onCleanup(() => {
      detailMutation.abort();
      unsubscribe();
    });
  });

  return (
    <div class="h-full min-h-0">
      <Show
        when={item()}
        keyed
        fallback={
          detailMutation.loading() ? (
            <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
              <i class="ti ti-loader-2 animate-spin text-sm" />
              Loading item details
            </p>
          ) : props.showEmpty ? (
            <Placeholder icon="ti ti-click">{props.emptyText ?? "Select an item to view details"}</Placeholder>
          ) : null
        }
      >
        {(current) => (
          <ItemDetailPanel
            item={current}
            columns={props.columns}
            tags={props.tags}
            wormholes={props.wormholes}
            spaceId={props.spaceId}
            baseUrl={props.baseUrl}
            currentUserId={props.currentUserId}
            initialComments={comments()}
            dateConfig={props.dateConfig}
            canWrite={props.canWrite}
          />
        )}
      </Show>
    </div>
  );
}
