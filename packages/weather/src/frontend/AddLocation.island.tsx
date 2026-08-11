import { navigateTo } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { AppWorkspace, Button, openSpotlightSearch, prompts, toast } from "@k2b/ui";
import { createSignal, onCleanup } from "solid-js";
import { apiClient } from "@/api/client";

type GeoResult = {
  name: string;
  lat: number;
  lon: number;
  country?: string;
  state?: string;
};

const locationDescription = (location: GeoResult) =>
  [location.state, location.country].filter(Boolean).join(", ") || `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`;

const searchLocations = async ({ query, abortSignal }: { query: string; abortSignal: AbortSignal }) => {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const res = await apiClient.geo.search.$get({ query: { q: trimmed, country: "DE" } }, { init: { signal: abortSignal } });
  if (!res.ok) {
    const data = (await res.json()) as { message?: string };
    throw new Error(data.message ?? "City search failed");
  }

  const locations = (await res.json()) as GeoResult[];
  return locations.map((location) => ({
    label: location.name,
    desc: locationDescription(location),
    icon: "ti ti-map-pin",
    value: location,
  }));
};

const AddLocationButton = (props: { variant?: "button" | "sidebar" | "overview" }) => {
  const [selecting, setSelecting] = createSignal(false);
  let disposed = false;
  const addMutation = mutations.create<{ id: string }, GeoResult>({
    mutation: async (location, { abortSignal }) => {
      const res = await apiClient.locations.$post(
        {
          json: {
            name: location.name,
            state: location.state,
            lat: location.lat,
            lon: location.lon,
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message ?? "Failed to add location");
      }
      return (await res.json()) as { id: string };
    },
    onSuccess: (result) => {
      toast.success("Location added");
      navigateTo(`/app/weather/${result.id}`);
    },
    onError: (err) => {
      prompts.error(err.message);
    },
  });

  onCleanup(() => {
    disposed = true;
    addMutation.abort();
  });

  const selectLocation = async () => {
    if (selecting() || addMutation.loading()) return;
    setSelecting(true);
    try {
      const selected = await openSpotlightSearch<GeoResult>({
        resolve: searchLocations,
        title: "Add location",
        icon: "ti ti-map-pin",
        placeholder: "Search for a city in Germany...",
        minQueryLength: 2,
        emptyText: "Type at least 2 characters.",
        noResultsText: "No German cities found.",
        size: "small",
      });
      if (!disposed && selected?.value) await addMutation.mutate({ ...selected.value });
    } finally {
      if (!disposed) setSelecting(false);
    }
  };
  const loading = () => selecting() || addMutation.loading();

  if (props.variant === "sidebar") {
    return (
      <AppWorkspace.SidebarItem
        icon={loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"}
        disabled={loading()}
        onClick={() => void selectLocation()}
      >
        Add Location
      </AppWorkspace.SidebarItem>
    );
  }

  if (props.variant === "overview") {
    return (
      <button
        type="button"
        onClick={() => void selectLocation()}
        disabled={loading()}
        class="paper flex w-full items-start gap-3 p-4 text-left transition-all hover:paper-highlighted"
      >
        <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--app-accent)_10%,var(--ui-surface))] text-[var(--ui-app-accent-text)]">
          <i class={loading() ? "ti ti-loader-2 animate-spin" : "ti ti-map-pin-plus"} aria-hidden="true" />
        </span>
        <span class="min-w-0">
          <span class="block text-sm font-medium text-primary">Add location</span>
          <span class="mt-0.5 block text-xs text-dimmed">Search German cities and save a forecast.</span>
        </span>
      </button>
    );
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      class="w-full"
      onClick={() => void selectLocation()}
      loading={loading()}
      loadingLabel="Adding location"
    >
      <i class="ti ti-plus" aria-hidden="true" />
      Add location
    </Button>
  );
};

export default AddLocationButton;
