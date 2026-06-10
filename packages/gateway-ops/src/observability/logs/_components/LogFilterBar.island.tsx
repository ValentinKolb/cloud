import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { FilterChip, type FilterChipSection, prompts } from "@valentinkolb/cloud/ui";
import { navigateTo, refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient as loggingClient } from "../api-client";
import { buildLogFilterUrl, defaultLogFilter, hasActiveLogFilters, type LogFilterState } from "./types";

type Props = {
  filter: LogFilterState;
  sources: string[];
  retentionDays: number;
};

const LEVEL_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "all", label: "All", icon: "ti ti-list" },
      { value: "debug", label: "Debug", icon: "ti ti-bug" },
      { value: "info", label: "Info", icon: "ti ti-info-circle" },
      { value: "warn", label: "Warn", icon: "ti ti-alert-triangle" },
      { value: "error", label: "Error", icon: "ti ti-alert-circle" },
    ],
  },
];

export default function LogFilterBar(props: Props) {
  const baseUrl = "/admin/observability/logs";
  const { filter } = props;

  const navigate = (params: Partial<LogFilterState>) => {
    navigateTo(buildLogFilterUrl(baseUrl, { ...params, page: 1 }, filter));
  };

  const sourceOptions = (): FilterChipSection[] => [
    { multiple: true, options: props.sources.map((s) => ({ value: s, label: s, icon: "ti ti-code" })) },
  ];

  const hasFilters = hasActiveLogFilters(filter);
  const searchAction = buildLogFilterUrl(baseUrl, { level: filter.level, sources: filter.sources }, filter);

  // ── Settings mutation ──
  const saveMutation = mutations.create<void, number>({
    mutation: async (days) => {
      const res = await loggingClient.settings.retention.$put({ json: { retentionDays: days } });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message ?? "Failed to save.");
      }
    },
    onSuccess: () => prompts.alert("Log retention updated.", { title: "Saved", icon: "ti ti-check" }),
    onError: (err) => prompts.error(err.message),
  });

  const handleSettings = async () => {
    const result = await prompts.form({
      title: "Log Settings",
      icon: "ti ti-settings",
      confirmText: "Save",
      fields: {
        retention_days: { type: "number" as const, label: "Retention (days)", default: props.retentionDays, min: 1, required: true },
      },
    });
    if (result) await saveMutation.mutate(result.retention_days);
  };

  // ── Cleanup mutation ──
  const cleanupMutation = mutations.create<{ deleted: number }, number>({
    mutation: async (days) => {
      const res = await loggingClient.cleanup.$delete({ query: { days: String(days) } });
      const result = await res.json();
      if (!res.ok) throw new Error((result as { message?: string }).message ?? "Failed to cleanup.");
      return result as { deleted: number };
    },
    onSuccess: async (data) => {
      await prompts.alert(`Deleted ${data.deleted} log entries.`, { title: "Cleanup Complete", icon: "ti ti-check" });
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleCleanup = async () => {
    const result = await prompts.form({
      title: "Cleanup Logs",
      icon: "ti ti-trash",
      confirmText: "Delete",
      variant: "danger",
      fields: { days: { type: "number" as const, label: "Delete entries older than (days)", default: 30, min: 1, required: true } },
    });
    if (result) await cleanupMutation.mutate(result.days);
  };

  return (
    <div class="flex flex-col gap-2">
      {/* Row 1: search */}
      <SearchBar action={searchAction} value={filter.search} placeholder="Search logs..." ariaLabel="Search logs" />

      {/* Row 2: filters + count + actions */}
      <div class="flex items-center gap-2 flex-wrap">
        <FilterChip
          label="Level"
          icon="ti ti-filter"
          options={LEVEL_OPTIONS}
          value={[filter.level]}
          onChange={(v) => navigate({ level: v[0] ?? "all" })}
          isActive={filter.level !== defaultLogFilter.level}
          defaultValue={[defaultLogFilter.level]}
        />
        {props.sources.length > 0 && (
          <FilterChip
            label="Services"
            icon="ti ti-code"
            options={sourceOptions()}
            value={filter.sources}
            onChange={(value) => navigate({ sources: value })}
            isActive={filter.sources.length > 0}
            defaultValue={[]}
          />
        )}
        {hasFilters && (
          <a
            href={baseUrl}
            class="text-[10px] text-red-500 tabular-nums hidden sm:inline"
            aria-label="Clear all filters"
            title="Clear filters"
          >
            <i class="ti ti-x" /> Clear
          </a>
        )}
        <div class="ml-auto flex items-center gap-2 shrink-0">
          <button type="button" class="btn-input btn-sm" onClick={handleSettings} disabled={saveMutation.loading()} title="Settings">
            <i class={saveMutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-settings"} />
            <span class="hidden sm:inline">Settings</span>
          </button>
          <button type="button" class="btn-input btn-sm" onClick={handleCleanup} disabled={cleanupMutation.loading()} title="Cleanup">
            <i class={cleanupMutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-trash"} />
            <span class="hidden sm:inline">Cleanup</span>
          </button>
        </div>
      </div>
    </div>
  );
}
