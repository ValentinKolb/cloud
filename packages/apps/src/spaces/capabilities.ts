import type { AppSearchInput, AppSearchResult } from "@valentinkolb/cloud/contracts/app";
import { spacesService } from "./service";

const SEARCH_TAGS = ["space", "task", "event", "kanban", "calendar"] as const;
const SEARCH_HELP = "Find spaces, tasks, and events in your workspace.";
const SEARCH_TAG_HELP = [
  { tag: "space", help: "Show space-level results." },
  { tag: "task", help: "Focus on tasks." },
  { tag: "event", help: "Focus on events with time range." },
  { tag: "kanban", help: "Focus on board-related items." },
  { tag: "calendar", help: "Focus on calendar entries." },
] as const;
const hasAllTags = (requested: string[]) => requested.every((tag) => SEARCH_TAGS.includes(tag as (typeof SEARCH_TAGS)[number]));

const toItemFilter = (query: string, pageSize: number) => ({
  type: "all" as const,
  status: "all" as const,
  priority: undefined,
  tagIds: undefined,
  assigneeIds: undefined,
  assignedTo: "all" as const,
  columnIds: undefined,
  deadlineFilter: "all" as const,
  search: query,
  sort: "created" as const,
  sortDesc: true,
  groupBy: "none" as const,
  page: 1,
  pageSize,
});
const itemKind = (item: { startsAt: string | null; endsAt: string | null }) => (item.startsAt && item.endsAt ? "Event" : "Task");

export const search = async (input: AppSearchInput): Promise<AppSearchResult[]> => {
  const user = input.ctx.get("user");
  if (!user.roles.includes("ipa")) return [];
  if (input.tags.length > 0 && !hasAllTags(input.tags)) return [];

  const spacesPage = await spacesService.space.list({
    userId: user.id,
    groups: user.memberofGroup,
    pagination: { page: 1, perPage: input.limit },
    filter: { query: input.query },
  });

  const spaceItems = spacesPage.items.map((entry) => ({
    id: `space:${entry.id}`,
    title: entry.name,
    href: `/app/spaces/${entry.id}`,
    preview: entry.description ?? undefined,
    icon: "ti ti-layout-kanban",
    priority: 7 as const,
    metadata: [
      { label: "Type", value: "Space" },
    ],
  }));

  const itemPages = await Promise.all(
    spacesPage.items.map((space) =>
      spacesService.item.listFiltered({
        spaceId: space.id,
        filter: toItemFilter(input.query, input.limit),
        currentUserId: user.id,
      }),
    ),
  );

  const itemItems = itemPages.flatMap((page, index) => {
    const space = spacesPage.items[index];
    if (!space) return [];
    return page.items.map((item) => ({
      id: `space-item:${item.id}`,
      title: item.title,
      href: `/app/spaces/${space.id}?item=${item.id}`,
      preview: item.description ?? undefined,
      icon: item.startsAt && item.endsAt ? "ti ti-calendar-event" : "ti ti-checkbox",
      priority: 8 as const,
      metadata: [
        { label: "Type", value: "Space Item" },
        { label: "Space", value: space.name },
        { label: "Item Kind", value: itemKind(item) },
      ],
    }));
  });

  return [...itemItems, ...spaceItems].slice(0, input.limit);
};

export const spacesCapabilities = {
  search: {
    tags: [...SEARCH_TAGS],
    help: SEARCH_HELP,
    tagHelp: [...SEARCH_TAG_HELP],
    run: search,
  },
} as const;
