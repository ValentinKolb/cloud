import { createSignal, For, Show } from "solid-js";
import { timing, mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { TextInput } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/weather/client";

type GeoResult = {
  name: string;
  lat: number;
  lon: number;
  country?: string;
  state?: string;
};

const LocationSearch = (props: { onSelect: (result: GeoResult) => void; adding: boolean }) => {
  const [search, setSearch] = createSignal("");
  const [results, setResults] = createSignal<GeoResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [addingName, setAddingName] = createSignal<string | null>(null);

  const doSearch = async (q: string) => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.geo.search.$get({
        query: { q: query, country: "DE" },
      });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        setResults([]);
        setError(data.message ?? "City search failed");
        return;
      }
      const data = (await res.json()) as GeoResult[];
      setResults(data);
    } catch (searchError) {
      setResults([]);
      setError(searchError instanceof Error ? searchError.message : "City search request failed");
    } finally {
      setLoading(false);
    }
  };

  const { debouncedFn: debouncedSearch } = timing.debounce(doSearch, 300);

  const handleInput = (value: string) => {
    setSearch(value);
    debouncedSearch(value);
  };

  const handleSelect = (result: GeoResult) => {
    setAddingName(result.name);
    props.onSelect(result);
  };

  return (
    <div class="flex flex-col gap-3">
      <TextInput icon="ti ti-search" placeholder="Search for a city in Germany..." value={() => search()} onInput={handleInput} />

      <div class="h-48 overflow-y-auto">
        <Show when={loading()}>
          <div class="flex items-center justify-center py-8 text-dimmed">
            <i class="ti ti-loader-2 animate-spin text-xl" />
          </div>
        </Show>

        <Show when={!loading() && !!error()}>
          <p class="flex items-center justify-center gap-1.5 py-8 text-center text-xs text-red-500">
            <i class="ti ti-alert-circle text-sm" />
            {error()}
          </p>
        </Show>

        <Show when={!loading() && !error() && search().length >= 2 && results().length === 0}>
          <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
            <i class="ti ti-search-off text-sm" />
            No German cities found
          </p>
        </Show>

        <Show when={!loading() && search().length < 2}>
          <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
            <i class="ti ti-search text-sm" />
            Type at least 2 characters
          </p>
        </Show>

        <Show when={!loading() && results().length > 0}>
          <div class="flex flex-col gap-1">
            <For each={results()}>
              {(result) => (
                <div class="flex items-center gap-3 rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    <i class="ti ti-map-pin text-sm" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">{result.name}</div>
                    <div class="truncate text-xs text-dimmed">{[result.state, result.country].filter(Boolean).join(", ")}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSelect(result)}
                    disabled={addingName() !== null || props.adding}
                    class="rounded-lg p-2 text-emerald-500 transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50 dark:hover:bg-emerald-900/20"
                    aria-label={`Add ${result.name}`}
                  >
                    <i class={addingName() === result.name ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

const AddLocationButton = () => {
  const addMutation = mutations.create({
    mutation: async (location: GeoResult) => {
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
      window.location.href = `/app/weather/${result.id}`;
    },
    onError: (err) => {
      prompts.error(err.message);
    },
  });

  const handleClick = () => {
    prompts.dialog(
      (close) => (
        <LocationSearch
          onSelect={(result) => {
            addMutation.mutate(result);
            close(null);
          }}
          adding={addMutation.loading()}
        />
      ),
      {
        title: "Add Location",
        icon: "ti ti-map-pin",
      },
    );
  };

  return (
    <button type="button" onClick={handleClick} disabled={addMutation.loading()} class="btn-secondary btn-sm w-full">
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
