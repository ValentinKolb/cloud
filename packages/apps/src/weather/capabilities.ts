import type { AppSearchInput, AppSearchResult } from "@valentinkolb/cloud/contracts/app";
import { weatherService } from "./service";

const SEARCH_TAGS = ["weather", "forecast", "location", "temperature"] as const;
const SEARCH_HELP = "Find saved weather locations and forecasts.";
const SEARCH_TAG_HELP = [
  { tag: "weather", help: "Search weather-related results." },
  { tag: "forecast", help: "Focus on forecast locations." },
  { tag: "location", help: "Find saved locations." },
  { tag: "temperature", help: "Focus on temperature context." },
] as const;
const supportsWeatherApp = (roles: string[]) => roles.includes("user");
const hasAllTags = (requested: string[]) => requested.every((tag) => SEARCH_TAGS.includes(tag as (typeof SEARCH_TAGS)[number]));

export const search = async (input: AppSearchInput): Promise<AppSearchResult[]> => {
  const user = input.ctx.get("user");
  if (!supportsWeatherApp(user.roles)) return [];
  if (input.tags.length > 0 && !hasAllTags(input.tags)) return [];

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
