import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { spacesService } from "@/spaces/service";
import type { ItemListResult } from "@/spaces/contracts";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { calendar } from "@valentinkolb/cloud/lib/shared";

// Sidebar components
import SpaceSidebar from "./_components/sidebar/SpaceSidebar";
import type { SpaceContext } from "./_components/sidebar/types";

// Settings store
import { parseSpaceSettings, isValidView, isValidPanelWidth } from "./_components/settings/SpaceSettingsStore";

// Filter components
import FilterBar from "./_components/filter/FilterBar.island";
import { parseFilterFromUrl, buildFilterUrl, defaultFilter } from "./_components/filter/types";

// Detail components
import ItemDetailHost from "./_components/detail/ItemDetailHost.island";
import SpaceDetailLayoutSync from "./_components/detail/SpaceDetailLayoutSync.island";

// List components
import ItemsList from "./_components/list";
import ItemsTable from "./_components/table/ItemsTable.island";
import KanbanBoard from "./_components/kanban/KanbanBoard.island";
import type { KanbanBucketInitial } from "./_components/kanban/types";

// Calendar components
import Calendar from "./_components/calendar";
import type { CalendarView, DayWeather } from "./_components/calendar/types";

// Weather
import weatherApp from "@/weather";
import { getCookie } from "hono/cookie";

// Edit panel
import SpaceEditPanel from "./_components/edit/SpaceEditPanel.island";

const withViewOverrides = (params: {
  baseUrl: string;
  hasViewOverride: boolean;
  currentView: string;
  hasPanelWidthOverride: boolean;
  currentPanelWidth: string;
}) => {
  const url = new URL(params.baseUrl, "http://localhost");
  if (params.hasViewOverride) {
    url.searchParams.set("view", params.currentView);
  }
  if (params.hasPanelWidthOverride) {
    url.searchParams.set("panelWidth", params.currentPanelWidth);
  }
  const query = url.searchParams.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
};

/**
 * Space detail page - shows items in various views with filtering
 */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const spaceId = c.req.param("id");

  // Parse user's default settings from cookie
  const cookieHeader = c.req.header("Cookie");
  const settings = parseSpaceSettings(cookieHeader, spaceId);

  // Read query params for view overrides
  const viewParam = c.req.query("view");
  const panelWidthParam = c.req.query("panelWidth");
  const selectedItemId = c.req.query("item");
  const isSettingsMode = c.req.query("mode") === "settings";

  // Calendar-specific params
  const calendarViewParam = c.req.query("cv") as CalendarView | undefined;
  const calendarDateParam = c.req.query("cd");

  // Determine effective values: query param overrides cookie default
  const hasViewOverride = isValidView(viewParam);
  const hasPanelWidthOverride = isValidPanelWidth(panelWidthParam);
  const hasOverride = hasViewOverride || hasPanelWidthOverride;

  const currentView = hasViewOverride ? viewParam : settings.view;
  const currentPanelWidth = hasPanelWidthOverride ? panelWidthParam : settings.detailPanelWidth;

  // Parse filter from URL
  const url = new URL(c.req.url);
  const filter = currentView === "list" || currentView === "table" ? parseFilterFromUrl(url) : defaultFilter;

  // Get space details
  const space = await spacesService.space.getDetail({ id: spaceId });

  if (!space) {
    return (
      <Layout c={c} title="Not Found">
        <div class="max-w-4xl mx-auto flex flex-col items-center gap-4 py-12">
          <p class="flex items-center gap-1.5 text-xs text-dimmed">
            <i class="ti ti-alert-circle text-sm" />
            Space not found
          </p>
          <a href="/app/spaces" class="btn-primary btn-sm">
            Back to Spaces
          </a>
        </div>
      </Layout>
    );
  }

  // Check access
  const hasAccess = await spacesService.space.permission.canAccess({
    spaceId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });
  if (!hasAccess) {
    return (
      <Layout c={c} title="Access Denied">
        <div class="max-w-4xl mx-auto flex flex-col items-center gap-4 py-12">
          <p class="flex items-center gap-1.5 text-xs text-dimmed">
            <i class="ti ti-lock text-sm" />
            You don't have access to this space
          </p>
          <a href="/app/spaces" class="btn-primary btn-sm">
            Back to Spaces
          </a>
        </div>
      </Layout>
    );
  }

  // Get user's permission level and access entries (for admin)
  const userPermission = await spacesService.space.permission.get({
    spaceId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });
  const isAdmin = userPermission === "admin";

  // Load access entries only for admins (in settings mode)
  const accessEntries = isAdmin && isSettingsMode ? (await spacesService.access.list({ spaceId })).items : [];

  const KANBAN_PAGE_SIZE = 30;
  const listPageSize = 50;

  // List view uses a single paginated query.
  let itemsResult: ItemListResult = {
    items: [],
    total: 0,
    page: filter.page,
    pageSize: listPageSize,
    totalPages: 0,
  };
  if (currentView === "list" || currentView === "table") {
    itemsResult = await spacesService.item.listFiltered({
      spaceId,
      filter: {
        type: filter.type,
        status: filter.status,
        priority: filter.priority.length > 0 ? filter.priority : undefined,
        tagIds: filter.tagIds.length > 0 ? filter.tagIds : undefined,
        columnIds: filter.columnIds.length > 0 ? filter.columnIds : undefined,
        assignedTo: filter.assignedTo,
        deadlineFilter: filter.deadlineFilter,
        search: filter.search || undefined,
        sort: filter.sort,
        sortDesc: filter.sortDesc,
        groupBy: filter.groupBy,
        page: filter.page,
        pageSize: listPageSize,
      },
      currentUserId: user.id,
    });
  }

  let kanbanBuckets: KanbanBucketInitial[] = [];
  const completedColumnId = space.columns.find((column) => column.isDone)?.id ?? space.columns[0]?.id ?? null;

  if (currentView === "kanban") {
    const loadBucket = async (config: {
      key: string;
      label: string;
      color: string | null;
      kind: "column" | "completed";
      columnId: string | null;
      columnIds?: string[];
    }): Promise<KanbanBucketInitial> => {
      const result = await spacesService.item.listFiltered({
        spaceId,
        filter: {
          type: "all",
          status: config.kind === "completed" ? "completed" : "active",
          priority: undefined,
          tagIds: undefined,
          columnIds: config.columnIds && config.columnIds.length > 0 ? config.columnIds : undefined,
          assignedTo: "all",
          deadlineFilter: "all",
          search: undefined,
          sort: "column",
          sortDesc: false,
          groupBy: "column",
          page: 1,
          pageSize: KANBAN_PAGE_SIZE,
        },
        currentUserId: user.id,
      });

      return {
        key: config.key,
        label: config.label,
        color: config.color,
        kind: config.kind,
        columnId: config.columnId,
        items: result.items,
        page: result.page,
        totalPages: result.totalPages,
        total: result.total,
      };
    };

    for (const column of space.columns) {
      kanbanBuckets.push(
        await loadBucket({
          key: `column:${column.id}`,
          label: column.name,
          color: column.color,
          kind: "column",
          columnId: column.id,
          columnIds: [column.id],
        }),
      );
    }

    kanbanBuckets.push(
      await loadBucket({
        key: "completed",
        label: "Completed",
        color: "#10b981",
        kind: "completed",
        columnId: null,
      }),
    );
  }

  // Calendar data (only fetch when calendar view is active)
  const calendarView: CalendarView =
    calendarViewParam && ["month", "week"].includes(calendarViewParam) ? (calendarViewParam as CalendarView) : "month";
  const calendarDate = calendar.parseCalendarDate(calendarDateParam);
  let calendarItems: Awaited<ReturnType<typeof spacesService.item.calendar.list>> = [];

  // Weather data for calendar (indexed by date string)
  let calendarWeather: Record<string, DayWeather> = {};

  if (currentView === "calendar") {
    const { from, to } = calendar.getDateRange(calendarView, calendarDate);
    const allCalendarItems = await spacesService.item.calendar.list({
      userId: user.id,
      groups: user.memberofGroupIds,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    // Filter to current space only
    calendarItems = allCalendarItems.filter((item) => item.spaceId === spaceId);

    // Fetch weather data (use location from cookie if set)
    const locationCookie = getCookie(c, weatherApp.service.location.cookie.name);
    const location = weatherApp.service.location.cookie.parse(locationCookie);
    const lat = location?.lat;
    const lon = location?.lon;

    const weatherData = await weatherApp.service.forecast.get({ lat, lon });
    if (weatherData?.daily) {
      for (const day of weatherData.daily) {
        calendarWeather[day.date] = {
          tempMin: day.tempMin,
          tempMax: day.tempMax,
          icon: weatherApp.service.ui.getTablerIcon(day.icon),
        };
      }
    }
  }

  // Find selected item if any (only when not in settings mode)
  // Need to fetch it separately if not in current result set
  let selectedItem = null;
  let selectedItemComments: Awaited<ReturnType<typeof spacesService.comment.list>>["items"] = [];
  if (!isSettingsMode && selectedItemId) {
    selectedItem = itemsResult.items.find((i) => i.id === selectedItemId) ?? null;
    if (!selectedItem) {
      // Item might be filtered out, fetch it directly
      selectedItem = await spacesService.item.get({ id: selectedItemId });
      // Verify it belongs to this space
      if (selectedItem && selectedItem.spaceId !== spaceId) {
        selectedItem = null;
      }
    }
    // Fetch comments for selected item
    if (selectedItem) {
      selectedItemComments = (await spacesService.comment.list({ itemId: selectedItemId, viewerUserId: user.id })).items;
    }
  }

  // Build shared context
  const ctx: SpaceContext = {
    space,
    columns: space.columns,
    tags: space.tags,
    currentView,
    currentPanelWidth,
    hasOverride,
    settings,
    query: url.searchParams.toString(),
  };

  const detailPanelResponsiveWidthClass =
    currentPanelWidth === "narrow"
      ? "w-full lg:w-80"
      : currentPanelWidth === "medium"
        ? "w-full lg:w-[28rem]"
        : currentPanelWidth === "wide"
          ? "w-full lg:w-[36rem]"
          : "w-full lg:w-[44rem]";

  // Get base URL for iCal links
  const icalBaseUrl = `${url.protocol}//${url.host}`;

  const baseSpaceUrl = `/app/spaces/${spaceId}`;

  // Build pagination base URL (preserves current list filters + view overrides)
  let paginationBaseUrl = withViewOverrides({
    baseUrl: buildFilterUrl(baseSpaceUrl, { page: 0 }, filter),
    hasViewOverride,
    currentView,
    hasPanelWidthOverride,
    currentPanelWidth,
  });
  paginationBaseUrl = paginationBaseUrl.replace("page=0", "page=");

  // Build item link base URL (preserves list filters only in list mode)
  const itemLinkBaseUrl = withViewOverrides({
    baseUrl: currentView === "list" || currentView === "table" ? buildFilterUrl(baseSpaceUrl, {}, filter) : baseSpaceUrl,
    hasViewOverride,
    currentView,
    hasPanelWidthOverride,
    currentPanelWidth,
  });

  const settingsPanel = (
    <SpaceEditPanel space={space} baseUrl={icalBaseUrl} initialSettings={settings} accessEntries={accessEntries} isAdmin={isAdmin} />
  );

  const itemDetailPanel = (
    <ItemDetailHost
      spaceId={ctx.space.id}
      baseUrl={itemLinkBaseUrl}
      currentUserId={user.id}
      tags={ctx.tags}
      initialItem={selectedItem}
      initialComments={selectedItemComments}
    />
  );

  return (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Spaces", href: "/app/spaces" }, { title: space.name }]}>
      <div class="app-cols flex-1 min-h-0">
        {/* Sidebar */}
        <SpaceSidebar ctx={ctx} />

        {/* Main Content */}
        <div class="order-3 lg:order-2 flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {/* Description */}
          {space.description && (
            <>
              <div class="px-3 py-2 info-block-info">
                <p class="text-sm">{space.description}</p>
              </div>
              <div class="divider" />
            </>
          )}

          {/* Filter Bar (list view only) */}
          {(currentView === "list" || currentView === "table") && (
            <>
              <FilterBar
                spaceId={spaceId}
                columns={ctx.columns}
                tags={ctx.tags}
                filter={filter}
                total={itemsResult.total}
                baseUrl={itemLinkBaseUrl}
                hideGroupBy={currentView === "table"}
              />
              <div class="h-2" />
            </>
          )}

          {/* Scrollable content area */}
          <div class="flex-1 min-h-0 overflow-y-auto">
            {(currentView === "list" || currentView === "table") && (
              <>
                {itemsResult.items.length === 0 ? (
                  <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
                    <i class="ti ti-checkbox text-sm" />
                    {itemsResult.total === 0 && filter.search === "" && filter.status === "active"
                      ? "No items yet. Create your first item!"
                      : "No items match your filters."}
                  </p>
                ) : currentView === "table" ? (
                  <ItemsTable
                    items={itemsResult.items}
                    columns={ctx.columns}
                    selectedItemId={selectedItemId}
                    baseUrl={itemLinkBaseUrl}
                  />
                ) : (
                  <ItemsList
                    items={itemsResult.items}
                    columns={ctx.columns}
                    tags={ctx.tags}
                    spaceId={ctx.space.id}
                    selectedItemId={selectedItemId}
                    groupBy={filter.groupBy}
                    showCompleted={filter.status !== "active"}
                    baseUrl={itemLinkBaseUrl}
                  />
                )}

                {/* Pagination */}
                <div class="px-3 py-2">
                  <Pagination currentPage={itemsResult.page} totalPages={itemsResult.totalPages} baseUrl={paginationBaseUrl} />
                </div>
              </>
            )}

            {currentView === "kanban" && (
              <KanbanBoard
                spaceId={spaceId}
                baseUrl={itemLinkBaseUrl}
                selectedItemId={selectedItemId}
                initialBuckets={kanbanBuckets}
                pageSize={KANBAN_PAGE_SIZE}
                completedColumnId={completedColumnId}
              />
            )}

            {currentView === "calendar" && (
              <div class="p-3">
                <Calendar
                  spaceId={spaceId}
                  items={calendarItems}
                  columns={ctx.columns}
                  tags={ctx.tags}
                  view={calendarView}
                  date={calendarDate}
                  baseUrl={itemLinkBaseUrl}
                  weather={calendarWeather}
                />
              </div>
            )}
          </div>
        </div>

        <div
          id="space-detail-panel"
          class={`${isSettingsMode || selectedItemId ? "flex" : "hidden"} order-2 lg:order-3 flex-col ${detailPanelResponsiveWidthClass} shrink-0 overflow-y-auto`}
          style={`view-transition-name: ${isSettingsMode ? "space-settings-panel" : "space-detail-panel-shell"}`}
        >
          {isSettingsMode ? (
            settingsPanel
          ) : (
            <ItemDetailHost
              spaceId={ctx.space.id}
              baseUrl={itemLinkBaseUrl}
              currentUserId={user.id}
              tags={ctx.tags}
              initialItem={selectedItem}
              initialComments={selectedItemComments}
            />
          )}
        </div>
        <SpaceDetailLayoutSync detailContainerId="space-detail-panel" forceOpen={isSettingsMode} />
      </div>
    </Layout>
  );
});
