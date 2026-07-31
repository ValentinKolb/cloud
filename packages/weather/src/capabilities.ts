import {
  type CapabilityExecutionContext,
  type CloudResourceView,
  defineCapabilities,
  type UniversalSearchInput,
  UniversalSearchDataSchema,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import { weatherService } from "@valentinkolb/cloud/services";
import { ok } from "@k2b/stdlib";

const runSearch = async (input: UniversalSearchInput, context: CapabilityExecutionContext) => {
  const user = context.user;
  if (!user?.roles.includes("user")) return ok({ data: [] });

  const page = await weatherService.location.saved.list({
    userId: user.id,
    pagination: { page: 1, perPage: input.limit },
    filter: { query: input.query },
  });
  const data: CloudResourceView[] = page.items.slice(0, input.limit).map((entry) => ({
    ref: { type: "weather.location", id: entry.id },
    title: entry.name,
    preview: entry.state ?? undefined,
    icon: "ti ti-temperature-celsius",
    priority: 6,
    metadata: [
      { label: "Type", value: "Location" },
      { label: "Location", value: entry.name },
      ...(entry.state ? [{ label: "State", value: entry.state }] : []),
    ],
    links: [{ rel: "open", href: `/app/weather/${entry.id}` }],
  }));
  return ok({ data });
};

export const weatherCapabilities = defineCapabilities({
  version: 1,
  types: {
    location: { title: "Saved location", description: "A saved weather location owned by the current user.", icon: "ti ti-map-pin" },
  },
  queries: {
    search: {
      title: "Search weather locations",
      description: "Find the current user's saved weather locations.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      universalSearch: {
        tags: [
          {
            tag: "weather",
            title: "Weather",
            description: "Show saved weather locations.",
            aliases: ["forecast", "location", "temperature"],
          },
        ],
      },
      run: runSearch,
    },
  },
});
