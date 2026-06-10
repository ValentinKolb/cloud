import { weatherService } from "@valentinkolb/cloud/services";
import { dates as calendar, type DateContext } from "@valentinkolb/stdlib";
import type { CalendarItem, ItemListResult, SpaceComment, SpaceItem } from "@/contracts";
import { spacesService } from "@/service";
import type { CalendarView, DayWeather } from "../calendar/types";
import { defaultFilter, parseFilterFromUrl } from "../filter/types";
import type { KanbanBucketInitial } from "../kanban/types";
import { isValidPanelWidth, isValidView, parseSpaceSettings } from "../settings/SpaceSettingsStore";
import type { SpacesWorkspaceState } from "./workspace-types";

type AuthUser = {
  id: string;
  memberofGroupIds: string[];
};

export const loadSpacesWorkspaceState = async (params: {
  user: AuthUser;
  spaceId: string;
  href: string;
  cookieHeader?: string;
  settings?: boolean;
  dateConfig?: DateContext;
}): Promise<SpacesWorkspaceState> => {
  const url = new URL(params.href, "http://spaces.local");
  const spaceId = params.spaceId;
  const settings = parseSpaceSettings(params.cookieHeader, spaceId);
  const isSettingsMode = params.settings === true || url.pathname.endsWith("/settings") || url.searchParams.get("mode") === "settings";

  const viewParam = url.searchParams.get("view") ?? undefined;
  const panelWidthParam = url.searchParams.get("panelWidth") ?? undefined;
  const selectedItemId = isSettingsMode ? "" : (url.searchParams.get("item") ?? "");
  const calendarViewParam = url.searchParams.get("cv") as CalendarView | null;
  const calendarDateParam = url.searchParams.get("cd") ?? undefined;
  let calendarTagIds = url.searchParams.get("ctags")?.split(",").filter(Boolean) ?? [];

  const hasViewOverride = isValidView(viewParam);
  const hasPanelWidthOverride = isValidPanelWidth(panelWidthParam);
  const hasOverride = hasViewOverride || hasPanelWidthOverride;
  const currentView = hasViewOverride ? viewParam : settings.view;
  const currentPanelWidth = hasPanelWidthOverride ? panelWidthParam : settings.detailPanelWidth;
  const filter = currentView === "list" || currentView === "table" ? parseFilterFromUrl(url) : defaultFilter;

  const space = await spacesService.space.getDetail({ id: spaceId });
  if (!space) return { kind: "notFound", title: "Not found", message: "Space not found" };
  const spaceTagIds = new Set(space.tags.map((tag) => tag.id));
  calendarTagIds = calendarTagIds.filter((tagId) => spaceTagIds.has(tagId));

  const hasAccess = await spacesService.space.permission.canAccess({
    spaceId,
    userId: params.user.id,
    userGroups: params.user.memberofGroupIds,
  });
  if (!hasAccess) return { kind: "accessDenied", title: "Access denied", message: "You don't have access to this space" };

  const userPermission = await spacesService.space.permission.get({
    spaceId,
    userId: params.user.id,
    userGroups: params.user.memberofGroupIds,
  });
  const isAdmin = userPermission === "admin";
  const canWrite = userPermission === "write" || userPermission === "admin";
  if (isSettingsMode && !canWrite) {
    return {
      kind: "accessDenied",
      title: "Access denied",
      message: "You don't have access to space settings",
      redirectTo: `/app/spaces/${spaceId}`,
    };
  }

  const accessEntries = isAdmin && isSettingsMode ? (await spacesService.access.list({ spaceId })).items : [];
  const apiKeys = isAdmin && isSettingsMode ? await spacesService.access.apiKeys.list({ spaceId }) : [];
  const listPageSize = 50;
  let itemsResult: ItemListResult = { items: [], total: 0, page: filter.page, pageSize: listPageSize, totalPages: 0 };
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
      currentUserId: params.user.id,
      dateConfig: params.dateConfig,
    });
  }

  const KANBAN_PAGE_SIZE = 30;
  const completedColumnId = space.columns.find((column) => column.isDone)?.id ?? space.columns[0]?.id ?? null;
  const kanbanBuckets: KanbanBucketInitial[] = [];
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
        currentUserId: params.user.id,
        dateConfig: params.dateConfig,
      });
      return { ...config, items: result.items, page: result.page, totalPages: result.totalPages, total: result.total };
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
    kanbanBuckets.push(await loadBucket({ key: "completed", label: "Completed", color: "#10b981", kind: "completed", columnId: null }));
  }

  const calendarView: CalendarView =
    calendarViewParam && ["day", "week", "month", "year"].includes(calendarViewParam) ? calendarViewParam : "month";
  const dateConfig = params.dateConfig;
  const calendarDate = calendar.parseCalendarDate(calendarDateParam, dateConfig);
  let calendarItems: CalendarItem[] = [];
  const calendarWeather: Record<string, DayWeather> = {};
  if (currentView === "calendar") {
    const calendarYear = Number(calendar.formatDateKey(calendarDate, dateConfig).slice(0, 4));
    const { from, to } =
      calendarView === "day"
        ? { from: calendarDate, to: calendar.addDays(calendarDate, 1, dateConfig) }
        : calendarView === "year"
          ? dateConfig?.timeZone
            ? {
                from: new Date(
                  calendar.zonedDateTimeToInstant(`${calendarYear}-01-01T00:00`, dateConfig.timeZone, { disambiguation: "compatible" }),
                ),
                to: new Date(
                  calendar.zonedDateTimeToInstant(`${calendarYear + 1}-01-01T00:00`, dateConfig.timeZone, { disambiguation: "compatible" }),
                ),
              }
            : { from: new Date(calendarYear, 0, 1), to: new Date(calendarYear + 1, 0, 1) }
          : calendar.getDateRange(calendarView, calendarDate, dateConfig);
    const accessibleItems = (
      await spacesService.item.calendar.list({
        userId: params.user.id,
        groups: params.user.memberofGroupIds,
        from: from.toISOString(),
        to: to.toISOString(),
        dateConfig,
      })
    ).filter((item) => item.spaceId === spaceId);
    calendarItems =
      calendarTagIds.length > 0
        ? accessibleItems.filter((item) => item.tags?.some((tag) => calendarTagIds.includes(tag.id)))
        : accessibleItems;

    const locationCookie = params.cookieHeader
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${weatherService.location.cookie.name}=`))
      ?.slice(weatherService.location.cookie.name.length + 1);
    const location = weatherService.location.cookie.parse(locationCookie);
    const weatherData = await weatherService.forecast.get({ lat: location?.lat, lon: location?.lon });
    if (weatherData?.daily) {
      for (const day of weatherData.daily) {
        calendarWeather[day.date] = {
          tempMin: day.tempMin,
          tempMax: day.tempMax,
          icon: weatherService.ui.getTablerIcon(day.icon),
        };
      }
    }
  }

  let selectedItem: SpaceItem | null = null;
  let selectedItemComments: SpaceComment[] = [];
  if (selectedItemId) {
    selectedItem = itemsResult.items.find((item) => item.id === selectedItemId) ?? null;
    if (!selectedItem) {
      selectedItem = await spacesService.item.get({ id: selectedItemId });
      if (selectedItem?.spaceId !== spaceId) selectedItem = null;
    }
    if (selectedItem) {
      selectedItemComments = (
        await spacesService.comment.list({
          itemId: selectedItemId,
          viewerUserId: params.user.id,
        })
      ).items;
    }
  }

  const title: Array<{ title: string; href?: string }> = [
    { title: "Start", href: "/" },
    { title: "Spaces", href: "/app/spaces" },
    { title: space.name, href: `/app/spaces/${space.id}` },
  ];
  if (isSettingsMode) title.push({ title: "Settings" });

  return {
    kind: "ok",
    title,
    currentUserId: params.user.id,
    space,
    settings,
    currentView,
    currentPanelWidth,
    hasOverride,
    isSettingsMode,
    isAdmin,
    query: url.searchParams.toString(),
    icalBaseUrl: `${url.protocol}//${url.host}`,
    itemsResult,
    kanbanBuckets,
    completedColumnId,
    calendarView,
    calendarDate: calendarDate.toISOString(),
    calendarTagIds,
    calendarItems,
    calendarWeather,
    selectedItem,
    selectedItemComments,
    accessEntries,
    apiKeys,
  };
};
