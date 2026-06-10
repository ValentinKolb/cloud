import { AppWorkspace, layout, Pagination, prompts } from "@valentinkolb/cloud/ui";
import { type LinkNavigateEvent, type NavigationScrollMode, navigate } from "@valentinkolb/ssr/nav";
import type { DateContext } from "@valentinkolb/stdlib";
import { streaming } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, onCleanup, onMount } from "solid-js";
import { apiClient } from "@/api/client";
import Calendar from "../calendar";
import ItemDetailHost from "../detail/ItemDetailHost";
import SpaceDetailLayoutSync from "../detail/SpaceDetailLayoutSync";
import SpaceEditPanel from "../edit/SpaceEditPanel";
import FilterBar from "../filter/FilterBar";
import { buildFilterUrl, defaultFilter, type FilterState, parseFilterFromUrl } from "../filter/types";
import KanbanBoard from "../kanban/KanbanBoard";
import ItemsList from "../list";
import SpaceSidebar from "../sidebar/SpaceSidebar";
import ItemsTable from "../table/ItemsTable";
import { requestSpacesRouteNavigation, SPACES_ROUTE_NAVIGATION_EVENT, type SpacesRouteNavigationDetail } from "./workspace-events";
import {
  buildSpacesItemLinkBaseUrl,
  buildSpacesPaginationBaseUrl,
  parseSpacesWorkspaceHref,
  type SpacesWorkspaceState,
  spacesDetailPanelWidthClass,
} from "./workspace-types";

type Props = {
  initialState: Extract<SpacesWorkspaceState, { kind: "ok" }>;
  dateConfig?: DateContext;
};

type OkWorkspaceState = Extract<SpacesWorkspaceState, { kind: "ok" }>;

type RouteStateRequest = {
  href: string;
  resolve: (state: OkWorkspaceState | null) => void;
  reject: (error: Error) => void;
};

type RouteStateResult = {
  request: RouteStateRequest;
  state: OkWorkspaceState | null;
};

const KANBAN_PAGE_SIZE = 30;

const currentHref = () => `${window.location.pathname}${window.location.search}`;
const updateLayout = (next: OkWorkspaceState) => layout.update({ breadcrumbs: next.title, title: next.title.at(-1)?.title });

export default function SpacesWorkspace(props: Props) {
  const [state, setState] = createSignal(props.initialState);
  const [settingsDialogOpen, setSettingsDialogOpen] = createSignal(false);
  let activeRouteRequest: RouteStateRequest | null = null;
  const spaceId = () => state().space.id;
  const baseSpaceUrl = () => `/app/spaces/${spaceId()}`;
  const currentUrl = () => new URL(`${baseSpaceUrl()}${state().query ? `?${state().query}` : ""}`, "http://spaces.local");
  const filter = () =>
    state().currentView === "list" || state().currentView === "table" ? parseFilterFromUrl(currentUrl()) : defaultFilter;
  const itemLinkBaseUrl = () =>
    buildSpacesItemLinkBaseUrl({
      baseSpaceUrl: baseSpaceUrl(),
      currentView: state().currentView,
      filter: filter(),
      hasViewOverride: state().hasOverride && new URLSearchParams(state().query).has("view"),
      hasPanelWidthOverride: state().hasOverride && new URLSearchParams(state().query).has("panelWidth"),
      currentPanelWidth: state().currentPanelWidth,
      calendarView: state().calendarView,
      calendarDate: state().calendarDate,
      calendarTagIds: state().calendarTagIds,
      dateConfig: props.dateConfig,
    });
  const paginationBaseUrl = () =>
    buildSpacesPaginationBaseUrl({
      baseSpaceUrl: baseSpaceUrl(),
      filter: filter(),
      hasViewOverride: state().hasOverride && new URLSearchParams(state().query).has("view"),
      currentView: state().currentView,
      hasPanelWidthOverride: state().hasOverride && new URLSearchParams(state().query).has("panelWidth"),
      currentPanelWidth: state().currentPanelWidth,
    });

  const routeStateMutation = mutations.create<RouteStateResult, RouteStateRequest>({
    mutation: async (request, ctx) => {
      const { href } = request;
      const target = parseSpacesWorkspaceHref(href);
      if (!target || target.spaceId !== spaceId()) return { request, state: null };
      const res = await apiClient.workspace.route.$get({ query: { href } }, { init: { signal: ctx.abortSignal } });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Could not load workspace route");
      }
      const next = (await res.json()) as SpacesWorkspaceState;
      return { request, state: next.kind === "ok" ? next : null };
    },
    onSuccess: (result, _ctx) => {
      // The mutation primitive exposes results via callbacks; bridge it back to
      // the route navigation flow that needs to decide before pushing history.
      result.request.resolve(result.state);
    },
    onError: (error, _ctx) => {
      if (error.name === "AbortError") return;
      activeRouteRequest?.reject(error);
      prompts.error(error.message || "Could not open route");
    },
  });

  const fetchRouteState = async (href: string): Promise<OkWorkspaceState | null> => {
    const target = parseSpacesWorkspaceHref(href);
    if (!target || target.spaceId !== spaceId()) return null;
    routeStateMutation.abort();
    return new Promise((resolve, reject) => {
      const request = { href, resolve, reject };
      activeRouteRequest = request;
      void routeStateMutation.mutate(request).finally(() => {
        if (activeRouteRequest === request) activeRouteRequest = null;
      });
    });
  };

  const openSettingsDialog = (settingsState: OkWorkspaceState) => {
    if (settingsDialogOpen()) return;
    setSettingsDialogOpen(true);
    void prompts
      .dialog<void>(
        (close) => (
          <div class="flex h-[86vh] min-h-0 flex-col overflow-hidden">
            <SpaceEditPanel
              space={settingsState.space}
              baseUrl={settingsState.icalBaseUrl}
              initialSettings={settingsState.settings}
              accessEntries={settingsState.accessEntries}
              apiKeys={settingsState.apiKeys}
              isAdmin={settingsState.isAdmin}
              onClose={() => {
                close();
                if (state().isSettingsMode) {
                  requestSpacesRouteNavigation(`/app/spaces/${settingsState.space.id}`, { scroll: "preserve" });
                }
              }}
            />
          </div>
        ),
        { surface: "bare", header: false, size: "large" },
      )
      .finally(() => {
        setSettingsDialogOpen(false);
        if (state().isSettingsMode) {
          requestSpacesRouteNavigation(`/app/spaces/${settingsState.space.id}`, { scroll: "preserve" });
        }
      });
  };

  const openRoute = async (href: string, options: { replace?: boolean; scroll?: NavigationScrollMode } = {}) => {
    const next = await fetchRouteState(href);
    if (!next) {
      prompts.error("Could not open this Spaces route without reloading.");
      return;
    }
    setState(next);
    updateLayout(next);
    navigate(href, { replace: options.replace, scroll: options.scroll ?? "top" });
    if (next.isSettingsMode) openSettingsDialog(next);
  };

  const handleNavigate = async (nav: LinkNavigateEvent) => {
    if (nav.url.origin !== window.location.origin) {
      nav.fallback();
      return;
    }
    const target = `${nav.url.pathname}${nav.url.search}`;
    const next = await fetchRouteState(target);
    if (!next) {
      prompts.error("Could not open this Spaces route without reloading.");
      return;
    }
    setState(next);
    updateLayout(next);
    nav.push(target, { scroll: nav.scroll });
    if (next.isSettingsMode) openSettingsDialog(next);
  };

  const openSettingsRoute = async () => {
    const next = await fetchRouteState(`/app/spaces/${spaceId()}/settings`);
    if (!next?.isSettingsMode) {
      prompts.error("Could not open settings without reloading.");
      return;
    }
    openSettingsDialog(next);
  };

  const commitFilterPatch = (patch: Partial<FilterState>) => {
    const href = buildFilterUrl(itemLinkBaseUrl(), { ...patch, page: 1 }, filter());
    return openRoute(href, { replace: true, scroll: "preserve" });
  };

  const clearFilters = () => {
    void openRoute(buildFilterUrl(itemLinkBaseUrl(), defaultFilter, defaultFilter), { replace: true, scroll: "preserve" });
  };

  onMount(() => {
    const abortController = new AbortController();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let lastEventCursor: string | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void openRoute(currentHref(), { replace: true, scroll: "preserve" });
      }, 120);
    };
    const waitForReconnect = () =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timeout);
          abortController.signal.removeEventListener("abort", done);
          resolve();
        };
        const timeout = setTimeout(done, 2_000);
        abortController.signal.addEventListener("abort", done, { once: true });
      });

    void (async () => {
      while (!abortController.signal.aborted) {
        try {
          const url = new URL(`/api/spaces/${spaceId()}/events`, window.location.origin);
          if (lastEventCursor) url.searchParams.set("after", lastEventCursor);
          const response = await fetch(url, {
            headers: { Accept: "text/event-stream" },
            signal: abortController.signal,
          });
          if (!response.ok || !response.body) return;
          for await (const event of streaming.parseSSE(response.body)) {
            if (abortController.signal.aborted) return;
            if (event.id) lastEventCursor = event.id;
            if (event.event?.startsWith("item.")) scheduleRefresh();
          }
        } catch {
          // Best-effort refresh: normal navigation still works if the stream drops.
        }
        if (!abortController.signal.aborted) await waitForReconnect();
      }
    })();

    const handleRouteNavigation = (event: Event) => {
      const detail = (event as CustomEvent<SpacesRouteNavigationDetail>).detail;
      if (detail?.href) void openRoute(detail.href, { replace: detail.replace, scroll: detail.scroll });
    };

    const handlePopState = () => {
      void fetchRouteState(currentHref())
        .then((next) => {
          if (!next) return;
          setState(next);
          if (next.isSettingsMode) openSettingsDialog(next);
        })
        .catch((error) => {
          prompts.error(error instanceof Error ? error.message : "Could not open route");
        });
    };

    window.addEventListener(SPACES_ROUTE_NAVIGATION_EVENT, handleRouteNavigation);
    window.addEventListener("popstate", handlePopState);
    if (state().isSettingsMode) openSettingsDialog(state());
    onCleanup(() => {
      abortController.abort();
      if (refreshTimer) clearTimeout(refreshTimer);
      routeStateMutation.abort();
      window.removeEventListener(SPACES_ROUTE_NAVIGATION_EVENT, handleRouteNavigation);
      window.removeEventListener("popstate", handlePopState);
    });
  });

  const selectedItemId = () => state().selectedItem?.id ?? new URLSearchParams(state().query).get("item") ?? "";
  const detailScrollPreserveKey = () => `spaces-detail-${spaceId()}-${selectedItemId() || "empty"}`;
  const spaceContext = () => ({
    space: state().space,
    columns: state().space.columns,
    tags: state().space.tags,
    currentView: state().currentView,
    currentPanelWidth: state().currentPanelWidth,
    hasOverride: state().hasOverride,
    settings: state().settings,
    query: state().query,
  });

  return (
    <AppWorkspace class="flex-1 min-h-0">
      <SpaceSidebar ctx={spaceContext()} onNavigate={handleNavigate} onOpenSettings={openSettingsRoute} dateConfig={props.dateConfig} />

      <AppWorkspace.Main>
        {state().space.description && (
          <div class="px-3 py-2 info-block-info mb-2">
            <p class="text-sm">{state().space.description}</p>
          </div>
        )}

        {(state().currentView === "list" || state().currentView === "table") && (
          <>
            <FilterBar
              spaceId={spaceId()}
              columns={state().space.columns}
              tags={state().space.tags}
              filter={filter()}
              total={state().itemsResult.total}
              baseUrl={itemLinkBaseUrl()}
              hideGroupBy={state().currentView === "table"}
              onFilterChange={commitFilterPatch}
              onSearchChange={(search) => commitFilterPatch({ search })}
              onClearFilters={clearFilters}
            />
            <div class="h-2" />
          </>
        )}

        <div
          class={`flex-1 min-h-0 ${state().currentView === "calendar" ? "flex flex-col overflow-hidden" : "overflow-y-auto"}`}
          data-scroll-preserve={`spaces-main-${spaceId()}`}
        >
          {(state().currentView === "list" || state().currentView === "table") && (
            <>
              {state().itemsResult.items.length === 0 ? (
                <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
                  <i class="ti ti-checkbox text-sm" />
                  {state().itemsResult.total === 0 && filter().search === "" && filter().status === "active"
                    ? "No items yet. Create your first item!"
                    : "No items match your filters."}
                </p>
              ) : state().currentView === "table" ? (
                <ItemsTable
                  items={state().itemsResult.items}
                  spaceId={spaceId()}
                  columns={state().space.columns}
                  tags={state().space.tags}
                  selectedItemId={selectedItemId()}
                  baseUrl={itemLinkBaseUrl()}
                  scrollPreserveKey={`spaces-table-${spaceId()}`}
                  dateConfig={props.dateConfig}
                />
              ) : (
                <ItemsList
                  items={state().itemsResult.items}
                  columns={state().space.columns}
                  tags={state().space.tags}
                  spaceId={spaceId()}
                  selectedItemId={selectedItemId()}
                  groupBy={filter().groupBy}
                  showCompleted={filter().status !== "active"}
                  baseUrl={itemLinkBaseUrl()}
                  dateConfig={props.dateConfig}
                />
              )}

              <div class="px-3 py-2">
                <Pagination
                  currentPage={state().itemsResult.page}
                  totalPages={state().itemsResult.totalPages}
                  baseUrl={paginationBaseUrl()}
                  onNavigate={handleNavigate}
                />
              </div>
            </>
          )}

          {state().currentView === "kanban" && (
            <KanbanBoard
              spaceId={spaceId()}
              baseUrl={itemLinkBaseUrl()}
              columns={state().space.columns}
              tags={state().space.tags}
              selectedItemId={selectedItemId()}
              initialBuckets={state().kanbanBuckets}
              pageSize={KANBAN_PAGE_SIZE}
              completedColumnId={state().completedColumnId}
              dateConfig={props.dateConfig}
            />
          )}

          {state().currentView === "calendar" && (
            <Calendar
              spaceId={spaceId()}
              items={state().calendarItems}
              columns={state().space.columns}
              tags={state().space.tags}
              selectedTagIds={state().calendarTagIds}
              selectedItemId={selectedItemId()}
              view={state().calendarView}
              date={new Date(state().calendarDate)}
              baseUrl={itemLinkBaseUrl()}
              weather={state().calendarWeather}
              dateConfig={props.dateConfig}
            />
          )}
        </div>
      </AppWorkspace.Main>

      <AppWorkspace.Detail
        id="space-detail-panel"
        open={Boolean(selectedItemId())}
        widthClass={spacesDetailPanelWidthClass(state().currentPanelWidth)}
        viewTransitionName="space-detail-panel-shell"
      >
        <div class="min-h-0 flex-1 overflow-y-auto" data-scroll-preserve={detailScrollPreserveKey()}>
          <ItemDetailHost
            spaceId={spaceId()}
            baseUrl={itemLinkBaseUrl()}
            currentUserId={state().currentUserId}
            columns={state().space.columns}
            tags={state().space.tags}
            initialItem={state().selectedItem}
            initialComments={state().selectedItemComments}
            dateConfig={props.dateConfig}
          />
        </div>
      </AppWorkspace.Detail>
      <SpaceDetailLayoutSync detailContainerId="space-detail-panel" />
    </AppWorkspace>
  );
}
