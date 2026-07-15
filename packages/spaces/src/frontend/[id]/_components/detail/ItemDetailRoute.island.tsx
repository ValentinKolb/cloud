import { AppWorkspace, Placeholder, prompts } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceColumn, SpaceTag, SpaceWormhole } from "@/contracts";
import { getDetailItemFromUrl } from "../../../lib/detail";
import { readResponseError } from "../../../lib/response";
import {
  publishSpacesDetailState,
  SPACES_DATA_INVALIDATED_EVENT,
  SPACES_DETAIL_NAVIGATION_EVENT,
  type SpacesDataInvalidation,
  type SpacesDetailNavigation,
} from "../workspace/workspace-events";
import type { SpaceItemDetail } from "../workspace/workspace-types";
import ItemDetailPanel from "./ItemDetailPanel";

type Props = {
  spaceId: string;
  baseUrl: string;
  currentUserId: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  wormholes: SpaceWormhole[];
  initialDetail: SpaceItemDetail | null;
  dateConfig?: DateContext;
  canWrite: boolean;
};

type DetailRequest = {
  itemId: string;
  href: string;
  history: "push" | "replace" | "none";
};

type DetailLoadContext = { request: DetailRequest };

class DetailNotFoundError extends Error {}

const commitHistory = (request: DetailRequest) => {
  if (request.history === "none") return;
  if (request.history === "replace") window.history.replaceState(null, "", request.href);
  else window.history.pushState(null, "", request.href);
};

export default function ItemDetailRoute(props: Props) {
  const [detail, setDetail] = createSignal<SpaceItemDetail | null>(props.initialDetail);
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const clearDetailState = (href: string, replace: boolean) => {
    setDetail(null);
    if (replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
    publishSpacesDetailState(null);
  };
  const loadDetail = mutations.create<{ request: DetailRequest; detail: SpaceItemDetail }, DetailRequest, DetailLoadContext>({
    onBefore: (request) => ({ request }),
    mutation: async (request, context) => {
      const response = await apiClient[":id"].items[":itemId"].detail.$get(
        { param: { id: props.spaceId, itemId: request.itemId } },
        { init: { signal: context.abortSignal } },
      );
      if (response.status === 401 || response.status === 403) {
        window.location.reload();
        throw new DOMException("Workspace access changed", "AbortError");
      }
      if (response.status === 404) throw new DetailNotFoundError(await readResponseError(response, "Item not found"));
      if (!response.ok) throw new Error(await readResponseError(response, "Failed to load item"));
      return { request, detail: await response.json() };
    },
    onSuccess: (result) => {
      setDetail(result.detail);
      commitHistory(result.request);
      publishSpacesDetailState(result.detail.item.id);
    },
    onError: (error, context) => {
      if (error instanceof DetailNotFoundError && context?.request.history === "none") {
        clearDetailState(props.baseUrl, true);
        return;
      }
      if (context?.request.history === "none") {
        window.location.reload();
        return;
      }
      prompts.error(error.message);
    },
  });

  const closeDetail = (href: string, replace = false) => {
    loadDetail.abort();
    clearDetailState(href, replace);
  };

  const requestDetail = (request: DetailRequest) => {
    if (!request.itemId) return;
    loadDetail.abort();
    void loadDetail.mutate(request);
  };

  const refreshCurrentDetail = () => {
    const itemId = detail()?.item.id ?? getDetailItemFromUrl();
    if (!itemId) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => requestDetail({ itemId, href: window.location.href, history: "none" }), 120);
  };

  onMount(() => {
    publishSpacesDetailState(detail()?.item.id ?? null);

    const onNavigate = (event: Event) => {
      const request = (event as CustomEvent<SpacesDetailNavigation>).detail;
      if (!request) return;
      if (!request.itemId) {
        closeDetail(request.href, request.replace);
        return;
      }
      requestDetail({ itemId: request.itemId, href: request.href, history: request.replace ? "replace" : "push" });
    };
    const onPopState = () => {
      const itemId = getDetailItemFromUrl();
      if (!itemId) {
        loadDetail.abort();
        setDetail(null);
        publishSpacesDetailState(null);
        return;
      }
      if (detail()?.item.id === itemId) {
        publishSpacesDetailState(itemId);
        return;
      }
      requestDetail({ itemId, href: window.location.href, history: "none" });
    };
    const onInvalidated = (event: Event) => {
      const invalidation = (event as CustomEvent<SpacesDataInvalidation>).detail;
      if (invalidation?.domains.includes("detail")) refreshCurrentDetail();
    };

    window.addEventListener(SPACES_DETAIL_NAVIGATION_EVENT, onNavigate);
    window.addEventListener(SPACES_DATA_INVALIDATED_EVENT, onInvalidated);
    window.addEventListener("popstate", onPopState);
    onCleanup(() => {
      window.removeEventListener(SPACES_DETAIL_NAVIGATION_EVENT, onNavigate);
      window.removeEventListener(SPACES_DATA_INVALIDATED_EVENT, onInvalidated);
      window.removeEventListener("popstate", onPopState);
      if (refreshTimer) clearTimeout(refreshTimer);
      loadDetail.abort();
    });
  });

  const scrollKey = () => `spaces-detail-${props.spaceId}-${detail()?.item.id ?? "empty"}`;

  return (
    <AppWorkspace.Detail id="space-detail-panel" open={Boolean(detail())} viewTransitionName="space-detail-panel-shell">
      <div class="h-full min-h-0 flex-1" data-scroll-preserve={scrollKey()}>
        <Show
          when={detail()}
          keyed
          fallback={
            loadDetail.loading() ? (
              <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
                <i class="ti ti-loader-2 animate-spin text-sm" /> Loading item details
              </p>
            ) : (
              <Placeholder icon="ti ti-click">Select an item to view details</Placeholder>
            )
          }
        >
          {(current) => (
            <ItemDetailPanel
              item={current.item}
              columns={props.columns}
              tags={props.tags}
              wormholes={props.wormholes}
              spaceId={props.spaceId}
              baseUrl={props.baseUrl}
              currentUserId={props.currentUserId}
              initialCommentsPage={current.comments}
              dateConfig={props.dateConfig}
              canWrite={props.canWrite}
            />
          )}
        </Show>
      </div>
    </AppWorkspace.Detail>
  );
}
