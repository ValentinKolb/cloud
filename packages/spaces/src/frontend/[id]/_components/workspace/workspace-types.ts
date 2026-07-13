import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import type { ResourceApiKey } from "@valentinkolb/cloud/ui";
import { dates as calendar, type DateContext } from "@valentinkolb/stdlib";
import type { CalendarItem, ItemListResult, SpaceComment, SpaceDetail, SpaceItem } from "@/contracts";
import type { CalendarView, DayWeather } from "../calendar/types";
import { buildFilterUrl, type parseFilterFromUrl, QueryParams } from "../filter/types";
import type { KanbanBucketInitial } from "../kanban/types";
import type { SpaceUserSettings, ViewType } from "../settings/SpaceSettingsStore";

type FilterState = ReturnType<typeof parseFilterFromUrl>;

export type SpacesWorkspaceState =
  | { kind: "notFound"; title: string; message: string }
  | { kind: "accessDenied"; title: string; message: string; redirectTo?: string }
  | {
      kind: "ok";
      title: Array<{ title: string; href?: string }>;
      currentUserId: string;
      space: SpaceDetail;
      settings: SpaceUserSettings;
      currentView: ViewType;
      hasOverride: boolean;
      isSettingsMode: boolean;
      isAdmin: boolean;
      canWrite: boolean;
      query: string;
      icalBaseUrl: string;
      itemsResult: ItemListResult;
      kanbanBuckets: KanbanBucketInitial[];
      calendarView: CalendarView;
      calendarDate: string;
      calendarTagIds: string[];
      calendarItems: CalendarItem[];
      calendarWeather: Record<string, DayWeather>;
      selectedItem: SpaceItem | null;
      selectedItemComments: SpaceComment[];
      accessEntries: AccessEntry[];
      apiKeys: ResourceApiKey[];
    };

export const parseSpacesWorkspaceHref = (href: string) => {
  const url = new URL(href, "http://spaces.local");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "app" || parts[1] !== "spaces" || !parts[2]) return null;
  if (parts.length === 3) return { spaceId: parts[2], settings: false };
  if (parts.length === 4 && parts[3] === "settings") return { spaceId: parts[2], settings: true };
  return null;
};

const withViewOverrides = (params: { baseUrl: string; hasViewOverride: boolean; currentView: string }) => {
  const url = new URL(params.baseUrl, "http://localhost");
  if (params.hasViewOverride) url.searchParams.set("view", params.currentView);
  const query = url.searchParams.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
};

const withoutSelectedItem = (href: string) => {
  const url = new URL(href, "http://localhost");
  url.searchParams.delete(QueryParams.ITEM);
  const query = url.searchParams.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
};

export const buildSpacesPaginationBaseUrl = (params: {
  baseSpaceUrl: string;
  filter: FilterState;
  hasViewOverride: boolean;
  currentView: string;
}) =>
  withViewOverrides({
    baseUrl: buildFilterUrl(params.baseSpaceUrl, { page: 0 }, params.filter),
    hasViewOverride: params.hasViewOverride,
    currentView: params.currentView,
  }).replace("page=0", "page=");

export const buildSpacesItemLinkBaseUrl = (params: {
  baseSpaceUrl: string;
  currentView: string;
  filter: FilterState;
  hasViewOverride: boolean;
  calendarView?: string;
  calendarDate?: string;
  calendarTagIds?: string[];
  dateConfig?: DateContext;
}) =>
  withoutSelectedItem(
    withViewOverrides({
      baseUrl:
        params.currentView === "list" || params.currentView === "table"
          ? buildFilterUrl(params.baseSpaceUrl, {}, params.filter)
          : buildCalendarUrl(params.baseSpaceUrl, params),
      hasViewOverride: params.hasViewOverride,
      currentView: params.currentView,
    }),
  );

const buildCalendarUrl = (
  baseSpaceUrl: string,
  params: {
    currentView: string;
    calendarView?: string;
    calendarDate?: string;
    calendarTagIds?: string[];
    dateConfig?: DateContext;
  },
) => {
  if (params.currentView !== "calendar") return baseSpaceUrl;
  const url = new URL(baseSpaceUrl, "http://localhost");
  if (params.calendarView) url.searchParams.set("cv", params.calendarView);
  if (params.calendarDate) url.searchParams.set("cd", calendar.formatDateKey(params.calendarDate, params.dateConfig));
  if (params.calendarTagIds && params.calendarTagIds.length > 0) url.searchParams.set("ctags", params.calendarTagIds.join(","));
  const query = url.searchParams.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
};
