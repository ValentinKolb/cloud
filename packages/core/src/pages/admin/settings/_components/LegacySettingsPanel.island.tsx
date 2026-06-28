import { coreClient } from "@valentinkolb/cloud/clients/core";
import { DataTable, type DataTableColumn, PanelDialog, prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createResource, Show } from "solid-js";

type LegacySetting = {
  key: string;
  updatedAt: string | null;
  decryptable: boolean;
};

const errorMessage = async (response: Response, fallback: string): Promise<string> => {
  const data = (await response.json().catch(() => null)) as { message?: string } | null;
  return data?.message ?? fallback;
};

const loadLegacySettings = async (): Promise<LegacySetting[]> => {
  const response = await coreClient.admin.core.settings.legacy.$get();
  if (!response.ok) throw new Error(await errorMessage(response, "Failed to load legacy settings"));
  return response.json();
};

const formatDate = (value: string | null) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const columns: DataTableColumn<LegacySetting>[] = [
  { id: "key", header: "Key", value: (row) => row.key },
  {
    id: "status",
    header: "Status",
    value: (row) => row.decryptable,
    headerClass: "w-px text-center whitespace-nowrap",
    cellClass: "w-px text-center whitespace-nowrap",
  },
  {
    id: "updated",
    header: "Updated",
    value: (row) => row.updatedAt,
    headerClass: "w-px text-right",
    cellClass: "w-px text-right whitespace-nowrap",
  },
];

export function LegacySettingsSection() {
  const [legacySettings, { refetch }] = createResource(loadLegacySettings);

  const cleanup = mutation.create<{ deleted: string[] }, void>({
    mutation: async () => {
      const items = legacySettings() ?? [];
      if (items.length === 0) return { deleted: [] };
      const confirmed = await prompts.confirm(
        `Delete ${items.length} legacy setting${items.length === 1 ? "" : "s"}? Active registered settings are excluded server-side.`,
        {
          title: "Clean up legacy settings",
          icon: "ti ti-trash",
          variant: "danger",
          confirmText: "Clean up",
        },
      );
      if (!confirmed) return { deleted: [] };

      const response = await coreClient.admin.core.settings.legacy.$delete();
      if (!response.ok) throw new Error(await errorMessage(response, "Failed to clean up legacy settings"));
      return response.json();
    },
    onSuccess: (result) => {
      if (result.deleted.length > 0)
        toast.success(`Deleted ${result.deleted.length} legacy setting${result.deleted.length === 1 ? "" : "s"}`);
      void refetch();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog.Section
      title="Legacy Settings"
      subtitle="Persisted settings that are no longer registered by the running Cloud version. Cleanup never deletes active registered keys."
      icon="ti ti-database-off"
      actions={
        <button
          type="button"
          class="btn-input btn-input-sm shrink-0"
          onClick={() => void cleanup.mutate()}
          disabled={cleanup.loading() || legacySettings.loading || (legacySettings()?.length ?? 0) === 0}
        >
          <i class={`ti ${cleanup.loading() ? "ti-loader-2 animate-spin" : "ti-trash"} text-sm`} />
          Clean up
        </button>
      }
    >
      <Show when={!legacySettings.loading} fallback={<div class="p-3 text-xs text-dimmed">Loading legacy settings...</div>}>
        <DataTable
          rows={legacySettings() ?? []}
          columns={columns}
          getRowId={(row) => row.key}
          density="compact"
          hoverRows
          highlightColumns={false}
          class="overflow-x-auto"
          tableClass="w-full text-xs"
          empty="No legacy settings found."
          renderCell={({ row, col }) => {
            if (col.id === "key") return <code class="text-[10px] text-primary">{row.key}</code>;
            if (col.id === "status") {
              return row.decryptable ? (
                <span class="mx-auto inline-flex rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  unregistered
                </span>
              ) : (
                <span class="mx-auto inline-flex rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-500">unreadable</span>
              );
            }
            if (col.id === "updated") return <span class="text-[10px] tabular-nums text-dimmed">{formatDate(row.updatedAt)}</span>;
            return "";
          }}
        />
      </Show>
    </PanelDialog.Section>
  );
}

export default function LegacySettingsPanel() {
  return <LegacySettingsSection />;
}
