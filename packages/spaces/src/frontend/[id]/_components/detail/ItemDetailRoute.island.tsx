import type { DateContext } from "@k2b/stdlib";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { AppWorkspace, Placeholder, prompts } from "@k2b/ui";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceColumn, SpaceTag, SpaceWormhole } from "@/contracts";
import { getDetailItemFromUrl, getDetailOccurrenceFromUrl } from "../../../lib/detail";
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
  mailIntegrationAvailable: boolean;
};

type DetailRequest = {
  itemId: string;
  occurrenceId: string | null;
  href: string;
  history: "push" | "replace" | "none";
};

type DetailLoadContext = { request: DetailRequest };

class DetailNotFoundError extends Error {}

const canonicalDetailHref = (request: DetailRequest, detail: SpaceItemDetail) => {
  if (!detail.recurringContext?.isOverride || detail.item.id === request.itemId) return request.href;
  const url = new URL(request.href, "http://spaces.local");
  url.searchParams.set("item", detail.item.id);
  return `${url.pathname}${url.search}${url.hash}`;
};

const commitHistory = (request: DetailRequest, detail: SpaceItemDetail) => {
  const href = canonicalDetailHref(request, detail);
  if (request.history === "none") {
    if (href !== request.href) window.history.replaceState(null, "", href);
    return;
  }
  if (request.history === "replace") window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
};

const detailState = (detail: SpaceItemDetail | null) => {
  if (!detail) return { itemId: null, occurrenceId: null, selectionId: null };
  const recurring = detail.recurringContext;
  return {
    itemId: detail.item.id,
    occurrenceId: recurring?.recurrenceId ?? null,
    selectionId: recurring
      ? recurring.isOverride
        ? detail.item.id
        : `${recurring.seriesItemId}:${recurring.recurrenceId}`
      : detail.item.id,
  };
};

export default function ItemDetailRoute(props: Props) {
  const [detail, setDetail] = createSignal<SpaceItemDetail | null>(props.initialDetail);
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const clearDetailState = (href: string, history: DetailRequest["history"]) => {
    setDetail(null);
    if (history === "replace") window.history.replaceState(null, "", href);
    else if (history === "push") window.history.pushState(null, "", href);
    publishSpacesDetailState(detailState(null));
  };
  const loadDetail = mutations.create<{ request: DetailRequest; detail: SpaceItemDetail }, DetailRequest, DetailLoadContext>({
    onBefore: (request) => ({ request }),
    mutation: async (request, context) => {
      const response = await apiClient[":id"].items[":itemId"].detail.$get(
        {
          param: { id: props.spaceId, itemId: request.itemId },
          query: request.occurrenceId ? { recurrence_id: request.occurrenceId } : {},
        },
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
      commitHistory(result.request, result.detail);
      publishSpacesDetailState(detailState(result.detail));
    },
    onError: (error, context) => {
      if (error instanceof DetailNotFoundError && context?.request.history === "none") {
        clearDetailState(props.baseUrl, "replace");
        return;
      }
      if (context?.request.history === "none") {
        window.location.reload();
        return;
      }
      prompts.error(error.message);
    },
  });

  const closeDetail = (href: string, history: DetailRequest["history"]) => {
    loadDetail.abort();
    clearDetailState(href, history);
  };

  const requestDetail = (request: DetailRequest) => {
    if (!request.itemId) return;
    loadDetail.abort();
    void loadDetail.mutate(request);
  };

  const refreshCurrentDetail = () => {
    const itemId = detail()?.item.id ?? getDetailItemFromUrl();
    if (!itemId) return;
    const occurrenceId = detail()?.recurringContext?.recurrenceId ?? getDetailOccurrenceFromUrl();
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => requestDetail({ itemId, occurrenceId, href: window.location.href, history: "none" }), 120);
  };

  onMount(() => {
    const initialItemId = getDetailItemFromUrl();
    const initialDetail = detail();
    if (initialItemId && initialDetail) {
      commitHistory(
        {
          itemId: initialItemId,
          occurrenceId: getDetailOccurrenceFromUrl(),
          href: window.location.href,
          history: "none",
        },
        initialDetail,
      );
    }
    publishSpacesDetailState(detailState(initialDetail));
    if (!detail() && initialItemId) {
      requestDetail({
        itemId: initialItemId,
        occurrenceId: getDetailOccurrenceFromUrl(),
        href: window.location.href,
        history: "none",
      });
    }

    const onNavigate = (event: Event) => {
      const request = (event as CustomEvent<SpacesDetailNavigation>).detail;
      if (!request) return;
      const history = request.history ?? (request.replace ? "replace" : "push");
      if (!request.itemId) {
        closeDetail(request.href, history);
        return;
      }
      requestDetail({
        itemId: request.itemId,
        occurrenceId: request.occurrenceId,
        href: request.href,
        history,
      });
    };
    const onPopState = () => {
      const itemId = getDetailItemFromUrl();
      const occurrenceId = getDetailOccurrenceFromUrl();
      if (!itemId) {
        loadDetail.abort();
        setDetail(null);
        publishSpacesDetailState(detailState(null));
        return;
      }
      if (detail()?.item.id === itemId && (detail()?.recurringContext?.recurrenceId ?? null) === occurrenceId) {
        publishSpacesDetailState(detailState(detail()));
        return;
      }
      requestDetail({ itemId, occurrenceId, href: window.location.href, history: "none" });
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

  const scrollKey = () =>
    `spaces-detail-${props.spaceId}-${detail()?.item.id ?? "empty"}-${detail()?.recurringContext?.recurrenceId ?? "series"}`;

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
              <Placeholder icon="ti ti-click" description={<>Select an item to view details</>} />
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
              commentTarget={current.commentTarget}
              recurringContext={current.recurringContext}
              dateConfig={props.dateConfig}
              canWrite={props.canWrite}
              mailIntegrationAvailable={props.mailIntegrationAvailable}
            />
          )}
        </Show>
      </div>
    </AppWorkspace.Detail>
  );
}
