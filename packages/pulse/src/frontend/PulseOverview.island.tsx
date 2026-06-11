import { AppOverview, prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { navigate, navigateTo } from "@valentinkolb/ssr/nav";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { PulseBase, PulseCapabilitySnapshot } from "../contracts";
import PulseLayoutHelp from "./PulseLayoutHelp";

type Props = {
  bases: PulseBase[];
  initialQuery: string;
  capabilities: PulseCapabilitySnapshot | null;
};

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  return fallback;
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

  const createBase = async (starter?: { name: string; description: string }) => {
    const result = await prompts.form({
      title: starter ? starter.name : "New Pulse base",
      icon: "ti ti-database-plus",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: starter?.name ?? "Operations" },
        description: { type: "text", label: "Description", multiline: true, placeholder: starter?.description ?? "Optional" },
      },
      confirmText: "Create",
    });
    if (!result) return;

    const name = String(result.name ?? "").trim() || starter?.name;
    if (!name) return;
    setCreating(true);
    try {
      const response = await fetch("/api/pulse/bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: String(result.description ?? "").trim() || starter?.description || null,
        }),
      });
      if (!response.ok) throw new Error(await readError(response, "Failed to create Pulse base"));
      const base = (await response.json()) as PulseBase;
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
      <AppOverview title="Pulse" subtitle="Metrics, events, states, and realtime dashboards." icon="ti ti-activity-heartbeat">
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
              <AppOverview.EmptyState title="No Pulse bases yet" icon="ti ti-activity-heartbeat" class="min-h-72">
                <p class="max-w-sm text-xs text-dimmed">
                  Start with infrastructure monitoring, then add custom app and business telemetry later.
                </p>
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
                        <i class="ti ti-activity-heartbeat text-lg text-blue-600 dark:text-blue-400" />
                      </div>
                      <div class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-semibold text-primary">{base.name}</span>
                        <p class="truncate text-xs text-dimmed">{base.description || `${base.retentionDays} day retention`}</p>
                      </div>
                      <i class="ti ti-chevron-right text-dimmed transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                    </a>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </AppOverview.Main>

        <AppOverview.Aside
          title="Create"
          description="Choose the first telemetry shape. Sources and dashboards are configured inside the base."
        >
          <div class="grid grid-cols-1 gap-2">
            <button
              type="button"
              class="paper group flex items-start gap-3 p-4 text-left transition-all hover:paper-highlighted"
              disabled={creating()}
              onClick={() =>
                void createBase({ name: "Operations", description: "Services, jobs, business processes, devices, and infrastructure telemetry." })
              }
            >
              <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center bg-white shadow-[var(--theme-shadow-elevated)] dark:bg-zinc-950">
                <i class="ti ti-server-2 text-lg text-primary" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-semibold text-primary">Server monitoring</span>
                <span class="line-clamp-2 block text-xs leading-snug text-dimmed">A balanced starter for services, jobs, devices, and business processes.</span>
              </span>
              <i class="ti ti-chevron-right mt-1 shrink-0 text-dimmed transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
            </button>

            <button
              type="button"
              class="paper group flex items-start gap-3 p-4 text-left transition-all hover:paper-highlighted"
              disabled={creating()}
              onClick={() => void createBase()}
            >
              <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center bg-blue-100 dark:bg-blue-900/50">
                <i class="ti ti-plus text-lg text-blue-600 dark:text-blue-400" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-semibold text-primary">Blank base</span>
                <span class="block text-xs leading-snug text-dimmed">Create an empty telemetry base for custom metrics and events.</span>
              </span>
              <i class="ti ti-chevron-right mt-1 shrink-0 text-dimmed transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
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
