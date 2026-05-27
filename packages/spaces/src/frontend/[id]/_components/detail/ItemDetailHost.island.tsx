import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import type { SpaceComment, SpaceItem, SpaceTag } from "@/contracts";
import ItemDetailPanel from "./ItemDetailPanel.island";
import { subscribeToDetailSelection } from "../../../lib/detail";

type Props = {
  spaceId: string;
  baseUrl: string;
  currentUserId: string;
  tags: SpaceTag[];
  initialItem: SpaceItem | null;
  initialComments: SpaceComment[];
  showEmpty?: boolean;
  emptyText?: string;
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
  typeof value["createdAt"] === "string" &&
  typeof value["updatedAt"] === "string" &&
  typeof value["canDelete"] === "boolean";
const isSpaceCommentArray = (value: unknown): value is SpaceComment[] => Array.isArray(value) && value.every(isSpaceComment);

/**
 * Client-side detail host for hybrid SSR/detail routing.
 * Keeps URL as source of truth and fetches details without full-page reload.
 */
export default function ItemDetailHost(props: Props) {
  const [item, setItem] = createSignal<SpaceItem | null>(props.initialItem);
  const [comments, setComments] = createSignal<SpaceComment[]>(props.initialComments ?? []);
  const [loading, setLoading] = createSignal(false);
  let requestId = 0;

  createEffect(() => {
    setItem(props.initialItem);
    setComments(props.initialComments ?? []);
    setLoading(false);
  });

  const clearSelection = () => {
    requestId += 1;
    setLoading(false);
    setItem(null);
    setComments([]);
  };

  const loadComments = async (itemId: string) => {
    const commentsRes = await apiClient[":id"].items[":itemId"].comments.$get({
      param: { id: props.spaceId, itemId },
    });
    if (!commentsRes.ok) {
      const data = await commentsRes.json();
      throw new Error("message" in data ? data.message : "Failed to load comments");
    }
    const data = await commentsRes.json();
    if (!isSpaceCommentArray(data)) return [];
    return data;
  };

  const loadItem = async (itemId: string) => {
    const itemRes = await apiClient[":id"].items[":itemId"].$get({
      param: { id: props.spaceId, itemId },
    });
    if (!itemRes.ok) {
      const data = await itemRes.json();
      throw new Error("message" in data ? data.message : "Failed to load item");
    }
    return (await itemRes.json()) as SpaceItem;
  };

  const hydrateDetail = async (nextItemId: string, prefetchedItem: SpaceItem | null = null) => {
    const current = ++requestId;
    setLoading(true);
    try {
      const nextItem =
        prefetchedItem && prefetchedItem.id === nextItemId
          ? prefetchedItem
          : item()?.id === nextItemId
            ? item()
            : await loadItem(nextItemId);

      if (current !== requestId) return;
      setItem(nextItem ?? null);

      const nextComments = await loadComments(nextItemId);
      if (current !== requestId) return;
      setComments(nextComments);
    } catch (error) {
      if (current !== requestId) return;
      const message = error instanceof Error ? error.message : "Failed to load item";
      clearSelection();
      prompts.error(message);
    } finally {
      if (current === requestId) setLoading(false);
    }
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
      unsubscribe();
    });
  });

  return (
    <div>
      <Show
        when={item()}
        keyed
        fallback={
          loading() ? (
            <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
              <i class="ti ti-loader-2 animate-spin text-sm" />
              Loading item details
            </p>
          ) : props.showEmpty ? (
            <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
              <i class="ti ti-click text-sm" />
              {props.emptyText ?? "Select an item to view details"}
            </p>
          ) : null
        }
      >
        {(current) => (
          <ItemDetailPanel
            item={current}
            tags={props.tags}
            spaceId={props.spaceId}
            baseUrl={props.baseUrl}
            currentUserId={props.currentUserId}
            initialComments={comments()}
          />
        )}
      </Show>
    </div>
  );
}
