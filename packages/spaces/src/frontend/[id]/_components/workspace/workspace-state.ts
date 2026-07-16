import { logger, weatherService } from "@valentinkolb/cloud/services";
import { dates as calendar, type DateContext } from "@valentinkolb/stdlib";
import type { CalendarItem, ItemListResult, SpaceDetail, SpaceItem, SpaceWormhole, User } from "@/contracts";
import { spacesService } from "@/service";
import { latestSpaceEventCursor } from "@/service/events";
import type { CalendarView, DayWeather } from "../calendar/types";
import { defaultFilter, type FilterState, parseFilterFromUrl } from "../filter/types";
import type { KanbanBucketInitial } from "../kanban/types";
import { isValidView, parseSpaceSettings, type SpaceUserSettings, type ViewType } from "../settings/SpaceSettingsStore";
import type { SpaceItemDetail, SpacesViewSnapshot, SpacesWorkspaceState } from "./workspace-types";

type AuthUser = Pick<User, "id" | "roles">;

const log = logger("spaces:workspace-state");

type WorkspaceRequest = {
  user: AuthUser;
  spaceId: string;
  href: string;
  cookieHeader?: string;
  dateConfig?: DateContext;
};

type RouteState = {
  url: URL;
  settings: SpaceUserSettings;
  currentView: ViewType;
  hasOverride: boolean;
  filter: FilterState;
  selectedItemId: string;
  calendarViewParam: CalendarView | null;
  calendarDateParam?: string;
  calendarTagIds: string[];
};

const LIST_PAGE_SIZE = 50;
const KANBAN_PAGE_SIZE = 30;
const CALENDAR_VIEWS: CalendarView[] = ["day", "week", "month", "year"];
const COMMENT_PAGE_SIZE = 50;
const emptyCommentPage = () => ({ items: [], page: 1, perPage: COMMENT_PAGE_SIZE, total: 0, hasNext: false });

const resolveView = (url: URL, settings: SpaceUserSettings) => {
  const viewParam = url.searchParams.get("view") ?? undefined;
  const hasViewOverride = isValidView(viewParam);
  return { currentView: hasViewOverride ? viewParam : settings.view, hasViewOverride };
};

const parseCalendarTags = (url: URL) => url.searchParams.get("ctags")?.split(",").filter(Boolean) ?? [];

const resolveRouteState = (params: WorkspaceRequest): RouteState => {
  const url = new URL(params.href, "http://spaces.local");
  const settings = parseSpaceSettings(params.cookieHeader, params.spaceId);
  const { currentView, hasViewOverride } = resolveView(url, settings);

  return {
    url,
    settings,
    currentView,
    hasOverride: hasViewOverride,
    filter: currentView === "list" || currentView === "table" ? parseFilterFromUrl(url) : defaultFilter,
    selectedItemId: url.searchParams.get("item") ?? "",
    calendarViewParam: url.searchParams.get("cv") as CalendarView | null,
    calendarDateParam: url.searchParams.get("cd") ?? undefined,
    calendarTagIds: parseCalendarTags(url),
  };
};

const resolvePermissions = async (params: { spaceId: string; user: AuthUser }) => {
  const userPermission = await spacesService.space.permission.get({
    spaceId: params.spaceId,
    subject: { type: "user", userId: params.user.id },
  });
  if (userPermission === "none") return null;

  return {
    isAdmin: userPermission === "admin",
    canWrite: userPermission === "write" || userPermission === "admin",
  };
};

const nonEmpty = <T>(values: T[]) => (values.length > 0 ? values : undefined);

const toListFilter = (filter: FilterState) => ({
  type: filter.type,
  status: filter.status,
  priority: nonEmpty(filter.priority),
  tagIds: nonEmpty(filter.tagIds),
  columnIds: nonEmpty(filter.columnIds),
  assignedTo: filter.assignedTo,
  deadlineFilter: filter.deadlineFilter,
  search: filter.search || undefined,
  sort: filter.sort,
  sortDesc: filter.sortDesc,
  groupBy: filter.groupBy,
  page: filter.page,
  pageSize: LIST_PAGE_SIZE,
});

const loadListItems = async (params: {
  currentView: ViewType;
  spaceId: string;
  filter: FilterState;
  userId: string;
  dateConfig?: DateContext;
}): Promise<ItemListResult> => {
  if (params.currentView !== "list" && params.currentView !== "table") {
    return { items: [], total: 0, page: params.filter.page, pageSize: LIST_PAGE_SIZE, totalPages: 0 };
  }

  return spacesService.item.listFiltered({
    spaceId: params.spaceId,
    filter: toListFilter(params.filter),
    currentUserId: params.userId,
    dateConfig: params.dateConfig,
  });
};

const loadKanbanBuckets = async (params: {
  currentView: ViewType;
  space: SpaceDetail;
  spaceId: string;
  userId: string;
  dateConfig?: DateContext;
}): Promise<KanbanBucketInitial[]> => {
  if (params.currentView !== "kanban") return [];

  const loadBucket = async (config: {
    key: string;
    label: string;
    color: string | null;
    kind: "column";
    columnId: string | null;
    isDone: boolean;
    columnIds?: string[];
  }): Promise<KanbanBucketInitial> => {
    const result = await spacesService.item.listFiltered({
      spaceId: params.spaceId,
      filter: {
        type: "all",
        status: config.isDone ? "completed" : "active",
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
      currentUserId: params.userId,
      dateConfig: params.dateConfig,
    });
    return { ...config, items: result.items, page: result.page, totalPages: result.totalPages, total: result.total };
  };

  return Promise.all(
    params.space.columns.map((column) =>
      loadBucket({
        key: `column:${column.id}`,
        label: column.name,
        color: column.color,
        kind: "column",
        columnId: column.id,
        isDone: column.isDone,
        columnIds: [column.id],
      }),
    ),
  );
};

const resolveCalendarRange = (params: { calendarView: CalendarView; calendarDate: Date; dateConfig?: DateContext }) => {
  const calendarYear = Number(calendar.formatDateKey(params.calendarDate, params.dateConfig).slice(0, 4));
  if (params.calendarView === "day") return { from: params.calendarDate, to: calendar.addDays(params.calendarDate, 1, params.dateConfig) };
  if (params.calendarView !== "year") return calendar.getDateRange(params.calendarView, params.calendarDate, params.dateConfig);

  if (!params.dateConfig?.timeZone) return { from: new Date(calendarYear, 0, 1), to: new Date(calendarYear + 1, 0, 1) };
  return {
    from: new Date(
      calendar.zonedDateTimeToInstant(`${calendarYear}-01-01T00:00`, params.dateConfig.timeZone, { disambiguation: "compatible" }),
    ),
    to: new Date(
      calendar.zonedDateTimeToInstant(`${calendarYear + 1}-01-01T00:00`, params.dateConfig.timeZone, { disambiguation: "compatible" }),
    ),
  };
};

const readWeatherLocationCookie = (cookieHeader?: string) => {
  const locationCookie = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${weatherService.location.cookie.name}=`))
    ?.slice(weatherService.location.cookie.name.length + 1);
  return weatherService.location.cookie.parse(locationCookie);
};

const resolveCalendarView = (view: CalendarView | null): CalendarView => (view && CALENDAR_VIEWS.includes(view) ? view : "month");

const loadCalendarWeather = async (cookieHeader?: string): Promise<Record<string, DayWeather>> => {
  const location = readWeatherLocationCookie(cookieHeader);
  const weatherData = await weatherService.forecast.get({ lat: location?.lat, lon: location?.lon });
  const weather: Record<string, DayWeather> = {};
  if (!weatherData?.daily) return weather;

  for (const day of weatherData.daily) {
    weather[day.date] = {
      tempMin: day.tempMin,
      tempMax: day.tempMax,
      icon: weatherService.ui.getTablerIcon(day.icon),
    };
  }
  return weather;
};

const loadCalendarState = async (params: {
  currentView: ViewType;
  calendarViewParam: CalendarView | null;
  calendarDateParam?: string;
  calendarTagIds: string[];
  spaceId: string;
  user: AuthUser;
  dateConfig?: DateContext;
  cookieHeader?: string;
}): Promise<{
  calendarView: CalendarView;
  calendarDate: Date;
  calendarItems: CalendarItem[];
  calendarWeather: Record<string, DayWeather>;
}> => {
  const calendarView = resolveCalendarView(params.calendarViewParam);
  const calendarDate = calendar.parseCalendarDate(params.calendarDateParam, params.dateConfig);
  if (params.currentView !== "calendar") return { calendarView, calendarDate, calendarItems: [], calendarWeather: {} };

  const { from, to } = resolveCalendarRange({ calendarView, calendarDate, dateConfig: params.dateConfig });
  const [accessibleItems, calendarWeather] = await Promise.all([
    spacesService.item.calendar.list({
      subject: { type: "user", userId: params.user.id },
      spaceId: params.spaceId,
      tagIds: params.calendarTagIds,
      from: from.toISOString(),
      to: to.toISOString(),
      dateConfig: params.dateConfig,
    }),
    loadCalendarWeather(params.cookieHeader),
  ]);

  return {
    calendarView,
    calendarDate,
    calendarItems: accessibleItems,
    calendarWeather,
  };
};

const loadSelectedItemState = async (params: {
  selectedItemId: string;
  itemsResult: ItemListResult;
  spaceId: string;
  userId: string;
}): Promise<{ selectedItem: SpaceItem | null; selectedItemComments: SpaceItemDetail["comments"] }> => {
  if (!params.selectedItemId) return { selectedItem: null, selectedItemComments: emptyCommentPage() };

  let selectedItem = params.itemsResult.items.find((item) => item.id === params.selectedItemId) ?? null;
  if (!selectedItem) {
    selectedItem = await spacesService.item.get({ id: params.selectedItemId });
    if (selectedItem?.spaceId !== params.spaceId) selectedItem = null;
  }
  if (!selectedItem) return { selectedItem: null, selectedItemComments: emptyCommentPage() };

  const selectedItemComments = await spacesService.comment.list({
    itemId: params.selectedItemId,
    viewerUserId: params.userId,
    pagination: { page: 1, perPage: COMMENT_PAGE_SIZE },
  });

  return { selectedItem, selectedItemComments };
};

const loadWormholes = async (params: { canWrite: boolean; spaceId: string; user: AuthUser }): Promise<SpaceWormhole[]> => {
  if (!params.canWrite) return [];
  const actor = spacesService.wormhole.actorForUser(params.user);
  return spacesService.wormhole.listUsable({ sourceSpaceId: params.spaceId, actor });
};

const loadWorkspaceData = async (params: {
  route: RouteState;
  space: SpaceDetail;
  permissions: { isAdmin: boolean; canWrite: boolean };
  request: WorkspaceRequest;
  calendarTagIds: string[];
}) => {
  const [wormholes, itemsResult, kanbanBuckets, calendarState] = await Promise.all([
    loadWormholes({
      canWrite: params.permissions.canWrite,
      spaceId: params.request.spaceId,
      user: params.request.user,
    }),
    loadListItems({
      currentView: params.route.currentView,
      spaceId: params.request.spaceId,
      filter: params.route.filter,
      userId: params.request.user.id,
      dateConfig: params.request.dateConfig,
    }),
    loadKanbanBuckets({
      currentView: params.route.currentView,
      space: params.space,
      spaceId: params.request.spaceId,
      userId: params.request.user.id,
      dateConfig: params.request.dateConfig,
    }),
    loadCalendarState({
      currentView: params.route.currentView,
      calendarViewParam: params.route.calendarViewParam,
      calendarDateParam: params.route.calendarDateParam,
      calendarTagIds: params.calendarTagIds,
      spaceId: params.request.spaceId,
      user: params.request.user,
      dateConfig: params.request.dateConfig,
      cookieHeader: params.request.cookieHeader,
    }),
  ]);

  return { wormholes, itemsResult, kanbanBuckets, calendarState };
};

const buildWorkspaceTitle = (space: SpaceDetail): Array<{ title: string; href?: string }> => [
  { title: "Start", href: "/" },
  { title: "Spaces", href: "/app/spaces" },
  { title: space.name, href: `/app/spaces/${space.id}` },
];

const loadEventCursor = async (spaceId: string): Promise<string | null> => {
  try {
    return await latestSpaceEventCursor(spaceId);
  } catch (error) {
    log.warn("Could not capture workspace event cursor", {
      spaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

type WorkspaceError = Extract<SpacesWorkspaceState, { kind: "notFound" | "accessDenied" }>;
type AuthorizedWorkspaceContext = {
  route: RouteState;
  permissions: { isAdmin: boolean; canWrite: boolean };
};
type WorkspaceContext = {
  route: RouteState;
  space: SpaceDetail;
  permissions: { isAdmin: boolean; canWrite: boolean };
  calendarTagIds: string[];
};

const authorizeWorkspace = async (
  params: WorkspaceRequest,
): Promise<{ ok: true; value: AuthorizedWorkspaceContext } | { ok: false; error: WorkspaceError }> => {
  const route = resolveRouteState(params);
  const [existingSpace, permissions] = await Promise.all([
    spacesService.space.get({ id: params.spaceId }),
    resolvePermissions({ spaceId: params.spaceId, user: params.user }),
  ]);
  if (!existingSpace) return { ok: false, error: { kind: "notFound", title: "Not found", message: "Space not found" } };
  if (!permissions) {
    return { ok: false, error: { kind: "accessDenied", title: "Access denied", message: "You don't have access to this space" } };
  }
  return { ok: true, value: { route, permissions } };
};

const loadWorkspaceContext = async (
  params: WorkspaceRequest,
  authorized?: AuthorizedWorkspaceContext,
): Promise<{ ok: true; value: WorkspaceContext } | { ok: false; error: WorkspaceError }> => {
  const access = authorized ? { ok: true as const, value: authorized } : await authorizeWorkspace(params);
  if (!access.ok) return access;

  const space = await spacesService.space.getDetail({ id: params.spaceId });
  if (!space) return { ok: false, error: { kind: "notFound", title: "Not found", message: "Space not found" } };

  const spaceTagIds = new Set(space.tags.map((tag) => tag.id));
  const calendarTagIds = access.value.route.calendarTagIds.filter((tagId) => spaceTagIds.has(tagId));
  return { ok: true, value: { ...access.value, space, calendarTagIds } };
};

const toViewSnapshot = (params: {
  route: RouteState;
  itemsResult: ItemListResult;
  kanbanBuckets: KanbanBucketInitial[];
  wormholes: SpaceWormhole[];
  calendarState: Awaited<ReturnType<typeof loadCalendarState>>;
  calendarTagIds: string[];
}): SpacesViewSnapshot => {
  if (params.route.currentView === "list" || params.route.currentView === "table") {
    return { kind: "list", currentView: params.route.currentView, itemsResult: params.itemsResult };
  }
  if (params.route.currentView === "kanban") {
    return { kind: "kanban", buckets: params.kanbanBuckets, wormholes: params.wormholes };
  }
  return {
    kind: "calendar",
    view: params.calendarState.calendarView,
    date: params.calendarState.calendarDate.toISOString(),
    tagIds: params.calendarTagIds,
    items: params.calendarState.calendarItems,
    weather: params.calendarState.calendarWeather,
  };
};

export const loadSpacesViewSnapshot = async (
  params: WorkspaceRequest,
): Promise<SpacesViewSnapshot | Extract<SpacesWorkspaceState, { kind: "notFound" | "accessDenied" }>> => {
  const context = await loadWorkspaceContext(params);
  if (!context.ok) return context.error;
  const { route, space, permissions, calendarTagIds } = context.value;

  const [itemsResult, kanbanBuckets, calendarState, wormholes] = await Promise.all([
    loadListItems({
      currentView: route.currentView,
      spaceId: params.spaceId,
      filter: route.filter,
      userId: params.user.id,
      dateConfig: params.dateConfig,
    }),
    loadKanbanBuckets({
      currentView: route.currentView,
      space,
      spaceId: params.spaceId,
      userId: params.user.id,
      dateConfig: params.dateConfig,
    }),
    loadCalendarState({
      currentView: route.currentView,
      calendarViewParam: route.calendarViewParam,
      calendarDateParam: route.calendarDateParam,
      calendarTagIds,
      spaceId: params.spaceId,
      user: params.user,
      dateConfig: params.dateConfig,
      cookieHeader: params.cookieHeader,
    }),
    loadWormholes({
      canWrite: permissions.canWrite,
      spaceId: params.spaceId,
      user: params.user,
    }),
  ]);
  return toViewSnapshot({
    route,
    itemsResult,
    kanbanBuckets,
    wormholes,
    calendarState,
    calendarTagIds,
  });
};

export const loadSpaceItemDetail = async (params: {
  user: AuthUser;
  spaceId: string;
  itemId: string;
}): Promise<{ kind: "ok"; detail: SpaceItemDetail } | Extract<SpacesWorkspaceState, { kind: "notFound" | "accessDenied" }>> => {
  const [space, permissions] = await Promise.all([
    spacesService.space.get({ id: params.spaceId }),
    resolvePermissions({ spaceId: params.spaceId, user: params.user }),
  ]);
  if (!space) return { kind: "notFound", title: "Not found", message: "Space not found" };
  if (!permissions) return { kind: "accessDenied", title: "Access denied", message: "You don't have access to this space" };

  const item = await spacesService.item.get({ id: params.itemId });
  if (!item || item.spaceId !== params.spaceId) return { kind: "notFound", title: "Not found", message: "Item not found" };
  const comments = await spacesService.comment.list({
    itemId: item.id,
    viewerUserId: params.user.id,
    pagination: { page: 1, perPage: COMMENT_PAGE_SIZE },
  });
  return { kind: "ok", detail: { item, comments } };
};

export const loadSpacesWorkspaceState = async (params: WorkspaceRequest): Promise<SpacesWorkspaceState> => {
  const authorized = await authorizeWorkspace(params);
  if (!authorized.ok) return authorized.error;

  // Capture after authorization but before any snapshot reads. Replaying an
  // event already reflected below is harmless; starting after it can miss one.
  const eventCursor = await loadEventCursor(params.spaceId);
  const context = await loadWorkspaceContext(params, authorized.value);
  if (!context.ok) return context.error;
  const { route, space, permissions, calendarTagIds } = context.value;

  const { wormholes, itemsResult, kanbanBuckets, calendarState } = await loadWorkspaceData({
    route,
    space,
    permissions,
    request: params,
    calendarTagIds,
  });

  const selectedItemState = await loadSelectedItemState({
    selectedItemId: route.selectedItemId,
    itemsResult,
    spaceId: params.spaceId,
    userId: params.user.id,
  });

  return {
    kind: "ok",
    title: buildWorkspaceTitle(space),
    currentUserId: params.user.id,
    space,
    settings: route.settings,
    currentView: route.currentView,
    hasOverride: route.hasOverride,
    isAdmin: permissions.isAdmin,
    canWrite: permissions.canWrite,
    query: route.url.searchParams.toString(),
    icalBaseUrl: `${route.url.protocol}//${route.url.host}`,
    eventCursor,
    itemsResult,
    kanbanBuckets,
    calendarView: calendarState.calendarView,
    calendarDate: calendarState.calendarDate.toISOString(),
    calendarTagIds,
    calendarItems: calendarState.calendarItems,
    calendarWeather: calendarState.calendarWeather,
    selectedItem: selectedItemState.selectedItem,
    selectedItemComments: selectedItemState.selectedItemComments,
    wormholes,
  };
};
