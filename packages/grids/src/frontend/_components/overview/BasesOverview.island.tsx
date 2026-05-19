import { AppOverview, navigateTo, Pagination, prompts, TextInput } from "@valentinkolb/cloud/ui";
import { mutation as mutations, timed } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Base } from "../../../service";
import { errorMessage } from "../utils/api-helpers";

type TemplateSummary = {
  id: string;
  name: string;
  description: string;
  icon: string;
};

type Props = {
  bases: Base[];
  total: number;
  limit: number;
  offset: number;
  templates: TemplateSummary[];
  initialQuery: string;
};

type BaseListResponse = {
  items: Base[];
  total: number;
  limit: number;
  offset: number;
};

const setQueryParam = (value: string, page: number) => {
  const url = new URL(window.location.href);
  const trimmed = value.trim();
  if (trimmed) url.searchParams.set("q", trimmed);
  else url.searchParams.delete("q");
  if (page > 1) url.searchParams.set("page", String(page));
  else url.searchParams.delete("page");
  window.history.replaceState({}, "", url.toString());
};

export default function BasesOverview(props: Props) {
  const [query, setQuery] = createSignal(props.initialQuery);
  const [bases, setBases] = createSignal<Base[]>(props.bases);
  const [total, setTotal] = createSignal(props.total);
  const [offset, setOffset] = createSignal(props.offset);
  let abortCtl: AbortController | null = null;

  const currentPage = createMemo(() => Math.floor(offset() / props.limit) + 1);
  const totalPages = createMemo(() => Math.ceil(total() / props.limit));
  const paginationBaseUrl = createMemo(() => {
    const q = query().trim();
    return q ? `/app/grids?q=${encodeURIComponent(q)}&page=` : "/app/grids?page=";
  });

  const loadBases = async (value: string, page = 1) => {
    abortCtl?.abort();
    abortCtl = new AbortController();
    const url = new URL("/api/grids/bases", window.location.origin);
    const q = value.trim();
    if (q) url.searchParams.set("q", q);
    url.searchParams.set("limit", String(props.limit));
    url.searchParams.set("offset", String((page - 1) * props.limit));
    const res = await fetch(url.toString(), { credentials: "same-origin", signal: abortCtl.signal });
    if (!res.ok) throw new Error(await errorMessage(res, "Failed to load bases"));
    const body = (await res.json()) as BaseListResponse;
    setBases(body.items);
    setTotal(body.total);
    setOffset(body.offset);
  };
  const searchDebounce = timed.debounce((value: string) => {
    void loadBases(value, 1).catch((e) => {
      if ((e as Error).name !== "AbortError") prompts.error((e as Error).message);
    });
  }, 250);
  onCleanup(() => abortCtl?.abort());

  const createBaseMutation = mutations.create<Base, { name: string; description: string }>({
    mutation: async (input) => {
      const res = await apiClient.bases.$post({
        json: { name: input.name, description: input.description || null },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create base"));
      return (await res.json()) as Base;
    },
    onSuccess: (base) => navigateTo(`/app/grids/${base.shortId}`),
    onError: (e) => prompts.error(e.message),
  });

  const createFromTemplateMutation = mutations.create<Base, { templateId: string; name?: string; withSampleData: boolean }>({
    mutation: async (input) => {
      const res = await apiClient.templates[":templateId"].$post({
        param: { templateId: input.templateId },
        json: {
          name: input.name?.trim() || undefined,
          withSampleData: input.withSampleData,
        },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create base from template"));
      return (await res.json()) as Base;
    },
    onSuccess: (base) => navigateTo(`/app/grids/${base.shortId}`),
    onError: (e) => prompts.error(e.message),
  });

  const createBlank = async () => {
    const result = await prompts.form({
      title: "New base",
      icon: "ti ti-database-plus",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: "e.g. CRM, Inventory" },
        description: { type: "text", label: "Description", multiline: true, placeholder: "Optional" },
      },
      confirmText: "Create",
    });
    if (!result) return;
    createBaseMutation.mutate({
      name: String(result.name).trim(),
      description: String(result.description ?? "").trim(),
    });
  };

  const createFromTemplate = async (template: TemplateSummary) => {
    const result = await prompts.form({
      title: template.name,
      icon: template.icon,
      fields: {
        name: {
          type: "text",
          label: "Name",
          placeholder: template.name,
        },
        withSampleData: {
          type: "boolean",
          label: "Include sample data",
          default: true,
        },
      },
      confirmText: "Create",
    });
    if (!result) return;
    createFromTemplateMutation.mutate({
      templateId: template.id,
      name: String(result.name ?? "").trim() || undefined,
      withSampleData: Boolean(result.withSampleData),
    });
  };

  const onSearchInput = (value: string) => {
    setQuery(value);
    setOffset(0);
    setQueryParam(value, 1);
    searchDebounce.debouncedFn(value);
  };

  const overviewDescription = createMemo(() =>
    query().trim()
      ? `${total()} match${total() === 1 ? "" : "es"}`
      : total() === 0
        ? "Create a base to start storing records, views, forms, and dashboards."
        : `${bases().length} of ${total()} base${total() === 1 ? "" : "s"} shown`,
  );

  return (
    <AppOverview title="Grids" subtitle="Structured bases for records, views, forms, and dashboards." icon="ti ti-table">
      <AppOverview.Main
        title="Your bases"
        description={overviewDescription()}
        toolbar={
          <TextInput
            name="grids-base-search"
            type="search"
            ariaLabel="Search bases"
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
        {/*
          AppOverview owns the shared shell only. Search, pagination,
          mutations, and card rendering stay in Grids.
        */}
        <Show
          when={bases().length > 0}
          fallback={
            query().trim() ? (
              <AppOverview.EmptyState title="No matching bases" description="Try a different search term." icon="ti ti-search" />
            ) : (
              <AppOverview.EmptyState
                title="No bases yet"
                description="Start from a template if you want a complete working setup, or create a blank base for a custom schema."
                icon="ti ti-database-plus"
                class="min-h-72"
              />
            )
          }
        >
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <For each={bases()}>
              {(base) => (
                <a
                  href={`/app/grids/${base.shortId}`}
                  class="paper p-4 flex items-center gap-4 hover:paper-highlighted transition-all no-underline"
                  style={`view-transition-name: grids-base-card-${base.id}`}
                >
                  <div class="w-10 h-10 thumbnail bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0">
                    <i class="ti ti-database text-lg text-blue-600 dark:text-blue-400" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <span
                      class="text-sm font-semibold text-primary block truncate"
                      style={`view-transition-name: grids-base-name-${base.id}`}
                    >
                      {base.name}
                    </span>
                    <p class="text-xs text-dimmed truncate">{base.description || "No description"}</p>
                  </div>
                  <i class="ti ti-chevron-right text-dimmed" />
                </a>
              )}
            </For>
          </div>
          <Pagination currentPage={currentPage()} totalPages={totalPages()} baseUrl={paginationBaseUrl()} />
        </Show>
      </AppOverview.Main>

      <AppOverview.Aside title="Create" description="Start structured, or build from scratch.">
        <div class="grid grid-cols-1 gap-2">
          <For each={props.templates}>
            {(template) => (
              <button
                type="button"
                class="paper p-4 text-left flex items-start gap-3 hover:paper-highlighted transition-all"
                onClick={() => createFromTemplate(template)}
                disabled={createFromTemplateMutation.loading()}
              >
                <span class="w-9 h-9 thumbnail bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                  <i class={`${template.icon} text-lg text-primary`} />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-semibold text-primary">{template.name}</span>
                  <span class="block text-xs text-dimmed leading-snug line-clamp-2">{template.description}</span>
                </span>
              </button>
            )}
          </For>

          <button
            type="button"
            class="paper p-4 text-left flex items-start gap-3 hover:paper-highlighted transition-all"
            onClick={createBlank}
            disabled={createBaseMutation.loading()}
          >
            <span class="w-9 h-9 thumbnail bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0">
              <i class="ti ti-plus text-lg text-blue-600 dark:text-blue-400" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold text-primary">Blank base</span>
              <span class="block text-xs text-dimmed leading-snug">Create an empty base and design the schema yourself.</span>
            </span>
          </button>
        </div>
      </AppOverview.Aside>
    </AppOverview>
  );
}
