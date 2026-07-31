import {
  type CapabilityExecutionContext,
  type CloudResourceView,
  defineCapabilities,
  type UniversalSearchInput,
  UniversalSearchDataSchema,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import { ok } from "@k2b/stdlib";
import { buildSpaceItemHref } from "./routes";
import type { ItemAcrossKind } from "./service";
import { spacesService } from "./service";

const runSearch = async (input: UniversalSearchInput, context: CapabilityExecutionContext) => {
  const user = context.user;
  if (!user?.roles.includes("user")) return ok({ data: [] });

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
  if (!includeSpaces && !includeTasks && !includeEvents) return ok({ data: [] });

  let kinds: ItemAcrossKind = "all";
  if (includeTasks && !includeEvents) kinds = "task";
  else if (includeEvents && !includeTasks) kinds = "event";

  const [spacesPage, itemHits] = await Promise.all([
    includeSpaces
      ? spacesService.space.list({
          subject: context.accessSubject,
          pagination: { page: 1, perPage: input.limit },
          filter: { query: input.query },
        })
      : Promise.resolve({ items: [], page: 1, perPage: 0, total: 0, hasNext: false }),
    includeTasks || includeEvents
      ? spacesService.item.searchAcross({
          subject: context.accessSubject,
          query: input.query,
          kinds,
          status: tags.has("todo") ? "open" : undefined,
          priority: tags.has("urgent") ? ["urgent"] : undefined,
          limit: input.limit,
        })
      : Promise.resolve([]),
  ]);

  const spaceItems: CloudResourceView[] = spacesPage.items.map((entry) => ({
    ref: { type: "spaces.space", id: entry.id },
    title: entry.name,
    preview: entry.description ?? undefined,
    icon: "ti ti-layout-kanban",
    priority: 7,
    metadata: [{ label: "Type", value: "Space" }],
    links: [{ rel: "open", href: `/app/spaces/${entry.id}` }],
  }));
  const itemItems: CloudResourceView[] = itemHits.map(({ item, space }) => {
    const event = Boolean(item.startsAt && item.endsAt);
    return {
      ref: { type: "spaces.item", id: item.id },
      title: item.title,
      preview: item.description ?? undefined,
      icon: event ? "ti ti-calendar-event" : "ti ti-checkbox",
      priority: 8,
      metadata: [
        { label: "Type", value: "Space Item" },
        { label: "Space", value: space.name },
        { label: "Item Kind", value: event ? "Event" : "Task" },
      ],
      links: [{ rel: "open" as const, href: buildSpaceItemHref(space.id, item.id) }],
    };
  });
  return ok({ data: [...itemItems, ...spaceItems].slice(0, input.limit) });
};

export const spacesCapabilities = defineCapabilities({
  version: 1,
  types: {
    space: { title: "Space", description: "A permission-scoped collaboration space.", icon: "ti ti-layout-kanban" },
    item: { title: "Space item", description: "A task or event inside a space.", icon: "ti ti-checkbox" },
  },
  queries: {
    search: {
      title: "Search spaces",
      description: "Find accessible spaces, tasks, and events with optional workflow facets.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      universalSearch: {
        tags: [
          { tag: "space", title: "Spaces", description: "Show spaces only.", aliases: ["spaces"] },
          { tag: "task", title: "Tasks", description: "Show task items only.", aliases: ["tasks", "kanban"] },
          { tag: "todo", title: "Open tasks", description: "Show open tasks only." },
          { tag: "event", title: "Events", description: "Show items with a time range.", aliases: ["events", "calendar"] },
          { tag: "urgent", title: "Urgent", description: "Show urgent items only." },
        ],
      },
      run: runSearch,
    },
  },
});
