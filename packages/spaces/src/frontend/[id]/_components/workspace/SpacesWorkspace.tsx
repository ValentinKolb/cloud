import { AppWorkspace } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import ItemDetailRoute from "../detail/ItemDetailRoute.island";
import { defaultFilter, parseFilterFromUrl } from "../filter/types";
import SpaceSidebar from "../sidebar/SpaceSidebar";
import type { SpaceContext } from "../sidebar/types";
import RememberSpace from "./RememberSpace.island";
import SpaceLiveEvents from "./SpaceLiveEvents.island";
import SpacesCalendarRoute from "./SpacesCalendarRoute.island";
import SpacesKanbanRoute from "./SpacesKanbanRoute.island";
import SpacesListRoute from "./SpacesListRoute.island";
import {
  buildSpacesItemLinkBaseUrl,
  buildSpacesPaginationBaseUrl,
  type SpaceItemDetail,
  type SpacesWorkspaceState,
} from "./workspace-types";

type OkWorkspaceState = Extract<SpacesWorkspaceState, { kind: "ok" }>;

const routeContext = (state: OkWorkspaceState, dateConfig?: DateContext) => {
  const baseSpaceUrl = `/app/spaces/${state.space.id}`;
  const url = new URL(`${baseSpaceUrl}${state.query ? `?${state.query}` : ""}`, "http://spaces.local");
  const filter = state.currentView === "list" || state.currentView === "table" ? parseFilterFromUrl(url) : defaultFilter;
  const itemLinkBaseUrl = buildSpacesItemLinkBaseUrl({
    baseSpaceUrl,
    currentView: state.currentView,
    filter,
    hasViewOverride: state.hasOverride && url.searchParams.has("view"),
    calendarView: state.calendarView,
    calendarDate: state.calendarDate,
    calendarTagIds: state.calendarTagIds,
    dateConfig,
  });
  return {
    baseSpaceUrl,
    filter,
    itemLinkBaseUrl,
    paginationBaseUrl: buildSpacesPaginationBaseUrl({
      baseSpaceUrl,
      filter,
      hasViewOverride: state.hasOverride && url.searchParams.has("view"),
      currentView: state.currentView,
    }),
  };
};

export default function SpacesWorkspace(props: { state: OkWorkspaceState; dateConfig?: DateContext }) {
  const state = props.state;
  const route = routeContext(state, props.dateConfig);
  const sidebarContext: SpaceContext = {
    space: state.space,
    columns: state.space.columns,
    tags: state.space.tags,
    currentView: state.currentView,
    hasOverride: state.hasOverride,
    settings: state.settings,
    query: state.query,
    canWrite: state.canWrite,
  };
  const initialDetail: SpaceItemDetail | null = state.selectedItem
    ? { item: state.selectedItem, comments: state.selectedItemComments }
    : null;

  return (
    <>
      <RememberSpace spaceId={state.space.id} />
      <SpaceLiveEvents spaceId={state.space.id} initialCursor={state.eventCursor} />
      <AppWorkspace class="flex-1 min-h-0">
        <SpaceSidebar ctx={sidebarContext} baseUrl={state.icalBaseUrl} dateConfig={props.dateConfig} />

        <AppWorkspace.Content>
          <AppWorkspace.Main class="p-[var(--ui-space-shell)]">
            {state.space.description && <p class="mb-2 text-xs leading-relaxed text-dimmed">{state.space.description}</p>}
            {(state.currentView === "list" || state.currentView === "table") && (
              <SpacesListRoute
                spaceId={state.space.id}
                currentView={state.currentView}
                columns={state.space.columns}
                tags={state.space.tags}
                filter={route.filter}
                initialItemsResult={state.itemsResult}
                initialSelectedItemId={state.selectedItem?.id ?? ""}
                itemLinkBaseUrl={route.itemLinkBaseUrl}
                paginationBaseUrl={route.paginationBaseUrl}
                dateConfig={props.dateConfig}
                canWrite={state.canWrite}
              />
            )}
            {state.currentView === "kanban" && (
              <SpacesKanbanRoute
                spaceId={state.space.id}
                baseUrl={route.itemLinkBaseUrl}
                columns={state.space.columns}
                tags={state.space.tags}
                wormholes={state.wormholes}
                initialBuckets={state.kanbanBuckets}
                selectedItemId={state.selectedItem?.id ?? ""}
                dateConfig={props.dateConfig}
                canWrite={state.canWrite}
              />
            )}
            {state.currentView === "calendar" && (
              <SpacesCalendarRoute
                spaceId={state.space.id}
                baseUrl={route.itemLinkBaseUrl}
                columns={state.space.columns}
                tags={state.space.tags}
                initialState={{
                  view: state.calendarView,
                  date: state.calendarDate,
                  tagIds: state.calendarTagIds,
                  items: state.calendarItems,
                  weather: state.calendarWeather,
                }}
                selectedItemId={state.selectedItem?.id ?? ""}
                dateConfig={props.dateConfig}
                canWrite={state.canWrite}
              />
            )}
          </AppWorkspace.Main>

          <ItemDetailRoute
            spaceId={state.space.id}
            baseUrl={route.itemLinkBaseUrl}
            currentUserId={state.currentUserId}
            columns={state.space.columns}
            tags={state.space.tags}
            wormholes={state.wormholes}
            initialDetail={initialDetail}
            dateConfig={props.dateConfig}
            canWrite={state.canWrite}
          />
        </AppWorkspace.Content>
      </AppWorkspace>
    </>
  );
}
