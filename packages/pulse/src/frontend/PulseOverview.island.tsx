import { AppOverview, prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { navigate, navigateTo } from "@valentinkolb/ssr/nav";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { PulseBase, PulseCapabilitySnapshot } from "../contracts";
import { jsonFetch } from "./http";
import PulseLayoutHelp from "./PulseLayoutHelp";

type Props = {
  bases: PulseBase[];
  initialQuery: string;
  capabilities: PulseCapabilitySnapshot | null;
};

const setQueryParam = (value: string) => {
  const url = new URL(window.location.href);
  const trimmed = value.trim();
  if (trimmed) url.searchParams.set("q", trimmed);
  else url.searchParams.delete("q");
  navigate(`${url.pathname}${url.search}`, { replace: true, scroll: "preserve", viewTransition: false });
};

const matchesBase = (base: PulseBase, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${base.name} ${base.description ?? ""} ${base.id}`.toLowerCase().includes(q);
};

export default function PulseOverview(props: Props) {
  const [query, setQuery] = createSignal(props.initialQuery);
  const [creating, setCreating] = createSignal(false);
  const filteredBases = createMemo(() => props.bases.filter((base) => matchesBase(base, query())));

  const onSearchInput = (value: string) => {
    setQuery(value);
    setQueryParam(value);
  };

  const createBase = async () => {
    const result = await prompts.form({
      title: "New Pulse base",
      icon: "ti ti-database-plus",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: "Operations" },
        description: { type: "text", label: "Description", multiline: true, placeholder: "Optional" },
      },
      confirmText: "Create",
    });
    if (!result) return;

    const name = String(result.name ?? "").trim();
    if (!name) return;
    setCreating(true);
    try {
      const base = await jsonFetch<PulseBase>(
        "/api/pulse/bases",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            description: String(result.description ?? "").trim() || null,
          }),
        },
        "Failed to create Pulse base",
      );
      toast.success("Pulse base created");
      navigateTo(`/app/pulse/${base.id}`);
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Could not create Pulse base");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <PulseLayoutHelp />
      <AppOverview
        title="Pulse"
        subtitle="Metrics, events, states, and realtime dashboards."
        icon="ti ti-activity-heartbeat"
      >
        <AppOverview.Main
          title="Your Pulse bases"
          description={
            props.bases.length === 0
              ? "Create a base for servers, websites, business metrics, or automation telemetry."
              : `${props.bases.length} base${props.bases.length === 1 ? "" : "s"} available`
          }
          toolbar={
            <TextInput
              name="pulse-search"
              type="search"
              ariaLabel="Search Pulse bases"
              placeholder="Search bases..."
              icon="ti ti-search"
              activeIcon="ti ti-search"
              value={query}
              onInput={onSearchInput}
              clearable
              onClear={() => onSearchInput("")}
            />
          }
        >
          <Show
            when={props.bases.length > 0}
            fallback={
              <AppOverview.EmptyState
                title="No Pulse bases yet"
                description="Create a base to collect, explore, and visualize related telemetry."
                icon="ti ti-activity-heartbeat"
                class="min-h-72"
              >
                <button type="button" class="btn-secondary btn-sm" disabled={creating()} onClick={() => void createBase()}>
                  <i class="ti ti-plus" /> Create a base
                </button>
              </AppOverview.EmptyState>
            }
          >
            <Show
              when={filteredBases().length > 0}
              fallback={<AppOverview.EmptyState title="No matching bases" description="Try a different search term." icon="ti ti-search" />}
            >
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <For each={filteredBases()}>
                  {(base) => (
                    <a
                      href={`/app/pulse/${base.id}`}
                      class="paper group flex items-center gap-4 p-4 no-underline transition-all hover:paper-highlighted"
                    >
                      <div class="thumbnail flex h-10 w-10 shrink-0 items-center justify-center bg-white shadow-[var(--theme-shadow-elevated)] dark:bg-zinc-950">
                        <i class="ti ti-activity-heartbeat app-accent-text text-lg" />
                      </div>
                      <div class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-semibold text-primary">{base.name}</span>
                        <p class="truncate text-xs text-dimmed">{base.description || `${base.rawRetentionDays} day raw retention`}</p>
                      </div>
                      <i class="ti ti-chevron-right text-dimmed transition-colors group-hover:app-accent-text" />
                    </a>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </AppOverview.Main>

        <AppOverview.Aside title="Create" description="Sources and dashboards are configured inside the base.">
          <div class="grid grid-cols-1 gap-2">
            <button
              type="button"
              class="paper group flex items-start gap-3 p-4 text-left transition-all hover:paper-highlighted"
              disabled={creating()}
              onClick={() => void createBase()}
            >
              <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center bg-zinc-100 dark:bg-zinc-900">
                <i class="ti ti-plus app-accent-text text-lg" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-semibold text-primary">New base</span>
                <span class="block text-xs leading-snug text-dimmed">
                  Create a telemetry base for metrics, states, events, and dashboards.
                </span>
              </span>
              <i class="ti ti-chevron-right mt-1 shrink-0 text-dimmed transition-colors group-hover:app-accent-text" />
            </button>

            <Show when={props.capabilities && !props.capabilities.timescaleEnabled}>
              <div class="info-block-warning mt-2">
                TimescaleDB is not enabled here. Pulse still works in dev, but long historical dashboards can fall back to raw samples.
              </div>
            </Show>
          </div>
        </AppOverview.Aside>
      </AppOverview>
    </>
  );
}
