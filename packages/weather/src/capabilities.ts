import type { AppSearchInput, AppSearchResult } from "@valentinkolb/cloud/contracts";
import { weatherService } from "@valentinkolb/cloud/services";

const SEARCH_TAGS = ["weather", "forecast", "location", "temperature"] as const;
const SEARCH_HELP = "Find saved weather locations.";
// All four tags act as routing aliases for "include the weather app". The
// underlying data set (saved locations) is the same regardless of which one
// the user typed — there is no useful sub-facet to filter by.
const SEARCH_TAG_HELP = [
  { tag: "weather", help: "Show saved weather locations." },
  { tag: "forecast", help: "Show saved weather locations (alias of #weather)." },
  { tag: "location", help: "Show saved weather locations (alias of #weather)." },
  { tag: "temperature", help: "Show saved weather locations (alias of #weather)." },
] as const;
const supportsWeatherApp = (roles: string[]) => roles.includes("user");

export const search = async (input: AppSearchInput): Promise<AppSearchResult[]> => {
  const user = input.ctx.get("user");
  if (!supportsWeatherApp(user.roles)) return [];

  const page = await weatherService.location.saved.list({
    userId: user.id,
    pagination: { page: 1, perPage: input.limit },
    filter: { query: input.query },
  });

  return page.items.slice(0, input.limit).map((entry) => ({
    id: `weather:${entry.id}`,
    title: entry.name,
    href: `/app/weather/${entry.id}`,
    preview: entry.state ?? undefined,
    icon: "ti ti-temperature-celsius",
    priority: 6 as const,
    metadata: [
      { label: "Type", value: "Location" },
      { label: "Location", value: entry.name },
      ...(entry.state ? [{ label: "State", value: entry.state }] : []),
    ],
  }));
};

export const weatherCapabilities = {
  search: {
    tags: [...SEARCH_TAGS],
    help: SEARCH_HELP,
    tagHelp: [...SEARCH_TAG_HELP],
    run: search,
  },
} as const;
