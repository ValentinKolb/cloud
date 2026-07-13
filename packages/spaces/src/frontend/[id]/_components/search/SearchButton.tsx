import {
  isSpotlightShortcut,
  openSpotlightSearch,
  SPOTLIGHT_SHORTCUT_TITLE,
  SpotlightButton,
  type SpotlightButtonVariant,
} from "@valentinkolb/cloud/ui";
import { onCleanup, onMount } from "solid-js";
import { apiClient } from "@/api/client";
import type { ItemFilter, SpaceColumn, SpaceItem } from "@/contracts";
import { requestSpacesRouteNavigation } from "../workspace/workspace-events";

type Props = {
  spaceId: string;
  spaceName: string;
  columns: SpaceColumn[];
  query: string;
  variant?: SpotlightButtonVariant;
  registerShortcut?: boolean;
};

const PAGE_SIZE = 20;

const buildItemHref = (spaceId: string, query: string, itemId: string) => {
  const params = new URLSearchParams(query);
  params.set("item", itemId);
  params.delete("mode");
  const search = params.toString();
  return `/app/spaces/${spaceId}${search ? `?${search}` : ""}`;
};

const itemIcon = (item: SpaceItem) => (item.startsAt && item.endsAt ? "ti ti-calendar-event" : "ti ti-checkbox");

const itemKind = (item: SpaceItem) => (item.startsAt && item.endsAt ? "Event" : "Task");

const compactDescription = (value: string | null | undefined, query: string): string | undefined => {
  if (!value) return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;

  const needle = query.trim().toLowerCase();
  const index = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (index === -1) return text.slice(0, 120);

  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + needle.length + 80);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
};

const itemDescription = (item: SpaceItem, columns: SpaceColumn[], query: string): string | undefined => {
  const column = columns.find((entry) => entry.id === item.columnId);
  const meta = [itemKind(item), column?.name, item.completedAt ? "Completed" : undefined, item.priority ?? undefined].filter(Boolean);
  const snippet = compactDescription(item.description, query);
  return [...meta, snippet].join(" - ") || undefined;
};

const searchRequest = (query: string): ItemFilter => ({
  type: "all",
  status: "all",
  assignedTo: "all",
  deadlineFilter: "all",
  search: query,
  sort: "updated",
  sortDesc: true,
  groupBy: "none",
  page: 1,
  pageSize: PAGE_SIZE,
});

export default function SearchButton(props: Props) {
  const openSearch = async () => {
    const selected = await openSpotlightSearch<SpaceItem>({
      title: `Search in ${props.spaceName}`,
      icon: "ti ti-layout-kanban",
      placeholder: "Search items...",
      minQueryLength: 1,
      noResultsText: "No items found.",
      resolve: async ({ query, abortSignal }) => {
        const trimmed = query.trim();
        if (!trimmed) return [];

        const response = await apiClient[":id"].items.filter.$post(
          {
            param: { id: props.spaceId },
            json: searchRequest(trimmed),
          },
          { init: { signal: abortSignal } },
        );
        if (!response.ok) return [];

        const payload = await response.json();
        return payload.items.map((item) => ({
          value: item,
          label: item.title,
          desc: itemDescription(item, props.columns, trimmed),
          icon: itemIcon(item),
        }));
      },
    });

    if (selected?.value) {
      requestSpacesRouteNavigation(buildItemHref(props.spaceId, props.query, selected.value.id), { scroll: "preserve" });
    }
  };

  onMount(() => {
    if (!props.registerShortcut) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSpotlightShortcut(event)) return;
      event.preventDefault();
      void openSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <SpotlightButton
      variant={props.variant}
      label="Search Items"
      onClick={openSearch}
      title={`Search items (${SPOTLIGHT_SHORTCUT_TITLE})`}
      ariaLabel="Search items"
    />
  );
}
