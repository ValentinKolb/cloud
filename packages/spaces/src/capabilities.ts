import type { AppSearchInput, AppSearchResult } from "@valentinkolb/cloud/contracts";
import { spacesService } from "./service";
import type { ItemAcrossKind } from "./service";

const SEARCH_TAGS = ["space", "spaces", "task", "tasks", "todo", "event", "events", "urgent", "kanban", "calendar"] as const;
const SEARCH_HELP = "Find spaces, tasks, and events in your workspace.";
const SEARCH_TAG_HELP = [
  { tag: "space", help: "Show spaces only." },
  { tag: "spaces", help: "Show spaces only (alias of #space)." },
  { tag: "task", help: "Show tasks only." },
  { tag: "tasks", help: "Show tasks only (alias of #task)." },
  { tag: "todo", help: "Show open tasks only." },
  { tag: "event", help: "Show events (items with a time range) only." },
  { tag: "events", help: "Show events only (alias of #event)." },
  { tag: "urgent", help: "Show urgent items only." },
  { tag: "kanban", help: "Show tasks only (alias of #task)." },
  { tag: "calendar", help: "Show events only (alias of #event)." },
] as const;

export const search = async (input: AppSearchInput): Promise<AppSearchResult[]> => {
  const user = input.ctx.get("user");
  if (!user.roles.includes("user")) return [];

  const tags = new Set(input.tags);
  const wantsSpaces = tags.has("space") || tags.has("spaces");
  const wantsTasks = tags.has("task") || tags.has("tasks") || tags.has("todo") || tags.has("kanban");
  const wantsEvents = tags.has("event") || tags.has("events") || tags.has("calendar");
  const itemFilterActive = tags.has("todo") || tags.has("urgent");
  const kindActive = wantsSpaces || wantsTasks || wantsEvents;
  const includeSpaces = !kindActive && !itemFilterActive ? true : wantsSpaces;
  const includeAllItemKinds = !kindActive || (itemFilterActive && !wantsTasks && !wantsEvents);
  const includeTasks = includeAllItemKinds || wantsTasks;
  const includeEvents = includeAllItemKinds || wantsEvents;

  if (!includeSpaces && !includeTasks && !includeEvents) return [];

  // searchAcross only makes sense with a non-empty query — no point listing
  // every visible item. Skip it (returns []) when the user only typed tags.
  let kinds: ItemAcrossKind = "all";
  if (includeTasks && !includeEvents) kinds = "task";
  else if (includeEvents && !includeTasks) kinds = "event";

  const [spacesPage, itemHits] = await Promise.all([
    includeSpaces
      ? spacesService.space.list({
          userId: user.id,
          groups: user.memberofGroupIds,
          pagination: { page: 1, perPage: input.limit },
          filter: { query: input.query },
        })
      : Promise.resolve({ items: [], page: 1, perPage: 0, total: 0, hasNext: false }),
    includeTasks || includeEvents
      ? spacesService.item.searchAcross({
          userId: user.id,
          groups: user.memberofGroupIds,
          query: input.query,
          kinds,
          status: tags.has("todo") ? "open" : undefined,
          priority: tags.has("urgent") ? ["urgent"] : undefined,
          limit: input.limit,
        })
      : Promise.resolve([]),
  ]);

  const spaceItems: AppSearchResult[] = spacesPage.items.map((entry) => ({
    id: `space:${entry.id}`,
    title: entry.name,
    href: `/app/spaces/${entry.id}`,
    preview: entry.description ?? undefined,
    icon: "ti ti-layout-kanban",
    priority: 7 as const,
    metadata: [{ label: "Type", value: "Space" }],
  }));

  const itemItems: AppSearchResult[] = itemHits.map(({ item, space }) => {
    const event = Boolean(item.startsAt && item.endsAt);
    return {
      id: `space-item:${item.id}`,
      title: item.title,
      href: `/app/spaces/${space.id}?item=${item.id}`,
      preview: item.description ?? undefined,
      icon: event ? "ti ti-calendar-event" : "ti ti-checkbox",
      priority: 8 as const,
      metadata: [
        { label: "Type", value: "Space Item" },
        { label: "Space", value: space.name },
        { label: "Item Kind", value: event ? "Event" : "Task" },
      ],
    };
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
