import { createSignal, onCleanup, onMount } from "solid-js";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import {
  AppWorkspace,
  documentNavigate,
  navigate,
  prompts,
  type LinkNavigateEvent,
  type NavigationScrollMode,
} from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import SpaceSidebar from "../sidebar/SpaceSidebar";
import FilterBar from "../filter/FilterBar.island";
import {
  buildSpacesItemLinkBaseUrl,
  buildSpacesPaginationBaseUrl,
  parseSpacesWorkspaceHref,
  spacesDetailPanelWidthClass,
  type SpacesWorkspaceState,
} from "./workspace-types";
import { defaultFilter, parseFilterFromUrl } from "../filter/types";
import ItemsList from "../list";
import ItemsTable from "../table/ItemsTable.island";
import KanbanBoard from "../kanban/KanbanBoard.island";
import Calendar from "../calendar";
import ItemDetailHost from "../detail/ItemDetailHost.island";
import SpaceDetailLayoutSync from "../detail/SpaceDetailLayoutSync.island";
import SpaceEditPanel from "../edit/SpaceEditPanel.island";
import { Pagination } from "@valentinkolb/cloud/ui";
import { SPACES_ROUTE_NAVIGATION_EVENT, type SpacesRouteNavigationDetail } from "./workspace-events";

type Props = {
  initialState: Extract<SpacesWorkspaceState, { kind: "ok" }>;
};

const KANBAN_PAGE_SIZE = 30;

const currentHref = () => `${window.location.pathname}${window.location.search}`;

export default function SpacesWorkspace(props: Props) {
  const [state, setState] = createSignal(props.initialState);
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

  const routeStateMutation = mutations.create<Extract<SpacesWorkspaceState, { kind: "ok" }> | null, string>({
    mutation: async (href, ctx) => {
      const target = parseSpacesWorkspaceHref(href);
      if (!target || target.spaceId !== spaceId()) return null;
      const res = await apiClient.workspace.route.$get({ query: { href } }, { init: { signal: ctx.abortSignal } });
      if (!res.ok) return null;
      const next = (await res.json()) as SpacesWorkspaceState;
      return next.kind === "ok" ? next : null;
    },
    onError: (error) => {
      if (error.name === "AbortError") return;
      prompts.error(error.message || "Could not open route");
    },
  });

  const fetchRouteState = async (href: string) => {
    const target = parseSpacesWorkspaceHref(href);
    if (!target || target.spaceId !== spaceId()) return null;
    routeStateMutation.abort();
    return (await routeStateMutation.mutate(href)) ?? null;
  };

  const openRoute = async (href: string, options: { replace?: boolean; scroll?: NavigationScrollMode } = {}) => {
    const next = await fetchRouteState(href);
    if (!next) {
      documentNavigate(href);
      return;
    }
    setState(next);
    navigate(href, { replace: options.replace, scroll: options.scroll ?? "top" });
  };

  const handleNavigate = async (nav: LinkNavigateEvent) => {
    if (nav.url.origin !== window.location.origin) {
      nav.fallback();
      return;
    }
    const target = `${nav.url.pathname}${nav.url.search}`;
    const next = await fetchRouteState(target);
    if (!next) {
      nav.fallback(target);
      return;
    }
    setState(next);
    nav.push(target, { scroll: nav.scroll });
  };

  onMount(() => {
    const handleRouteNavigation = (event: Event) => {
      const detail = (event as CustomEvent<SpacesRouteNavigationDetail>).detail;
      if (detail?.href) void openRoute(detail.href, { replace: detail.replace, scroll: detail.scroll });
    };

    const handlePopState = () => {
      void fetchRouteState(currentHref())
        .then((next) => {
          if (next) setState(next);
        })
        .catch((error) => {
          prompts.error(error instanceof Error ? error.message : "Could not open route");
        });
    };

    window.addEventListener(SPACES_ROUTE_NAVIGATION_EVENT, handleRouteNavigation);
    window.addEventListener("popstate", handlePopState);
    onCleanup(() => {
      routeStateMutation.abort();
      window.removeEventListener(SPACES_ROUTE_NAVIGATION_EVENT, handleRouteNavigation);
      window.removeEventListener("popstate", handlePopState);
    });
  });

  const selectedItemId = () => state().selectedItem?.id ?? new URLSearchParams(state().query).get("item") ?? "";
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
      <SpaceSidebar ctx={spaceContext()} onNavigate={handleNavigate} />

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
            />
            <div class="h-2" />
          </>
        )}

        <div class="flex-1 min-h-0 overflow-y-auto" data-scroll-preserve={`spaces-main-${spaceId()}`}>
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
                  columns={state().space.columns}
                  selectedItemId={selectedItemId()}
                  baseUrl={itemLinkBaseUrl()}
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
              selectedItemId={selectedItemId()}
              initialBuckets={state().kanbanBuckets}
              pageSize={KANBAN_PAGE_SIZE}
              completedColumnId={state().completedColumnId}
            />
          )}

          {state().currentView === "calendar" && (
            <div class="p-3">
              <Calendar
                spaceId={spaceId()}
                items={state().calendarItems}
                columns={state().space.columns}
                tags={state().space.tags}
                view={state().calendarView}
                date={new Date(state().calendarDate)}
                baseUrl={itemLinkBaseUrl()}
                weather={state().calendarWeather}
              />
            </div>
          )}
        </div>
      </AppWorkspace.Main>

      <AppWorkspace.Detail
        id="space-detail-panel"
        open={state().isSettingsMode || Boolean(selectedItemId())}
        widthClass={spacesDetailPanelWidthClass(state().currentPanelWidth)}
        viewTransitionName={state().isSettingsMode ? "space-settings-panel" : "space-detail-panel-shell"}
        class={state().isSettingsMode ? "paper p-4" : ""}
      >
        <div class="min-h-0 flex-1 overflow-y-auto">
          {state().isSettingsMode ? (
            <SpaceEditPanel
              space={state().space}
              baseUrl={state().icalBaseUrl}
              initialSettings={state().settings}
              accessEntries={state().accessEntries}
              isAdmin={state().isAdmin}
            />
          ) : (
            <ItemDetailHost
              spaceId={spaceId()}
              baseUrl={itemLinkBaseUrl()}
              currentUserId={state().currentUserId}
              tags={state().space.tags}
              initialItem={state().selectedItem}
              initialComments={state().selectedItemComments}
            />
          )}
        </div>
      </AppWorkspace.Detail>
      <SpaceDetailLayoutSync detailContainerId="space-detail-panel" forceOpen={state().isSettingsMode} />
    </AppWorkspace>
  );
}
