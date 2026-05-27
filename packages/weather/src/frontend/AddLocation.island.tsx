import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { AppWorkspace, navigateTo, prompts, toast } from "@valentinkolb/cloud/ui";
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

const AddLocationButton = (props: { variant?: "button" | "sidebar" }) => {
  const addMutation = mutations.create({
    mutation: async () => {
      const selected = await prompts.search<GeoResult>(searchLocations, {
        title: "Add Location",
        icon: "ti ti-map-pin",
        placeholder: "Search for a city in Germany...",
        minQueryLength: 2,
        emptyText: "Type at least 2 characters.",
        noResultsText: "No German cities found.",
        size: "small",
      });
      const location = selected?.value;
      if (!location) return null;

      const res = await apiClient.locations.$post({
        json: {
          name: location.name,
          state: location.state,
          lat: location.lat,
          lon: location.lon,
        },
      });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message ?? "Failed to add location");
      }
      return (await res.json()) as { id: string };
    },
    onSuccess: (result) => {
      if (!result) return;
      toast.success("Location added");
      navigateTo(`/app/weather/${result.id}`);
    },
    onError: (err) => {
      prompts.error(err.message);
    },
  });

  if (props.variant === "sidebar") {
    return (
      <AppWorkspace.SidebarItem
        icon={addMutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"}
        disabled={addMutation.loading()}
        onClick={() => addMutation.mutate({})}
      >
        Add Location
      </AppWorkspace.SidebarItem>
    );
  }

  return (
    <button type="button" onClick={() => addMutation.mutate({})} disabled={addMutation.loading()} class="btn-secondary btn-sm w-full">
      {addMutation.loading() ? (
        <i class="ti ti-loader-2 animate-spin" />
      ) : (
        <>
          <i class="ti ti-plus" />
          Add Location
        </>
      )}
    </button>
  );
};

export default AddLocationButton;
