import { Combobox, type ComboboxOption, dialogCore, PanelDialog, panelDialogOptions, prompts } from "@valentinkolb/cloud/ui";
import { createEffect, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { RecordActor, RecordMetaQuery, RecordMetaUserKey } from "../../../contracts";
import { errorMessage } from "../utils/api-helpers";

type UserKeyConfig = {
  key: RecordMetaUserKey;
  label: string;
};

const USER_KEYS: UserKeyConfig[] = [
  {
    key: "createdBy",
    label: "Created by",
  },
  {
    key: "updatedBy",
    label: "Modified by",
  },
  {
    key: "deletedBy",
    label: "Deleted by",
  },
];

const cleanIds = (ids: string[] | undefined): string[] => [...new Set((ids ?? []).filter(Boolean))];

export const cleanRecordMetaQuery = (meta: RecordMetaQuery | null | undefined): RecordMetaQuery | undefined => {
  if (!meta) return undefined;
  const createdBy = cleanIds(meta.users?.createdBy);
  const updatedBy = cleanIds(meta.users?.updatedBy);
  const deletedBy = cleanIds(meta.users?.deletedBy);
  const users =
    createdBy.length || updatedBy.length || deletedBy.length
      ? {
          ...(createdBy.length ? { createdBy } : {}),
          ...(updatedBy.length ? { updatedBy } : {}),
          ...(deletedBy.length ? { deletedBy } : {}),
        }
      : undefined;
  return users ? { users } : undefined;
};

export const recordMetaActiveCount = (meta: RecordMetaQuery | null | undefined): number => {
  const cleaned = cleanRecordMetaQuery(meta);
  if (!cleaned) return 0;
  return USER_KEYS.reduce((count, cfg) => count + (cleaned.users?.[cfg.key]?.length ? 1 : 0), 0);
};

const actorToOption = (actor: RecordActor): ComboboxOption => ({
  id: actor.id,
  label: actor.label,
  description: actor.subtitle ?? undefined,
  icon: "ti-user",
});

const fetchActors = async (tableId: string, kind: RecordMetaUserKey | "any", query: string, ids: string[] = []): Promise<RecordActor[]> => {
  const res = await apiClient.tables[":tableId"]["record-actors"].$get({
    param: { tableId },
    query: {
      kind,
      q: query,
      ids: ids.join(","),
      limit: String(ids.length > 0 ? Math.max(ids.length, 12) : 12),
    },
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Failed to load users"));
  return (await res.json()).items;
};

const ActorPicker = (props: {
  tableId: string;
  config: UserKeyConfig;
  selectedIds: () => string[];
  labels: () => Record<string, RecordActor>;
  setLabels: (next: Record<string, RecordActor>) => void;
  onChange: (next: string[]) => void;
}) => {
  const selectedActors = () => props.selectedIds().map((id) => props.labels()[id] ?? { id, label: id, subtitle: null });

  createEffect(() => {
    const missing = props.selectedIds().filter((id) => !props.labels()[id]);
    if (missing.length === 0) return;
    void fetchActors(props.tableId, "any", "", missing)
      .then((actors) => {
        const next = { ...props.labels() };
        for (const actor of actors) next[actor.id] = actor;
        props.setLabels(next);
      })
      .catch((error) => prompts.error(error instanceof Error ? error.message : "Failed to load users"));
  });

  const remove = (id: string) => props.onChange(props.selectedIds().filter((selected) => selected !== id));
  const add = (option: ComboboxOption) => {
    if (props.selectedIds().includes(option.id)) return;
    props.setLabels({
      ...props.labels(),
      [option.id]: { id: option.id, label: option.label, subtitle: option.description ?? null },
    });
    props.onChange([...props.selectedIds(), option.id]);
  };

  return (
    <div class="grid gap-2 py-1 md:grid-cols-[10rem_1fr] md:items-start">
      <div class="min-w-0 pt-1">
        <div class="text-sm font-medium leading-tight">{props.config.label}</div>
      </div>
      <div class="min-w-0">
        <Show when={selectedActors().length > 0}>
          <div class="mb-2 flex flex-wrap gap-1.5">
            <For each={selectedActors()}>
              {(actor) => (
                <button
                  type="button"
                  class="badge max-w-full gap-1 border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  onClick={() => remove(actor.id)}
                >
                  <span class="truncate">{actor.label}</span>
                  <i class="ti ti-x text-xs opacity-60" />
                </button>
              )}
            </For>
          </div>
        </Show>
        <Combobox
          placeholder="Search users..."
          fetchData={async (query) => (await fetchActors(props.tableId, props.config.key, query)).map(actorToOption)}
          onSelect={add}
        />
      </div>
    </div>
  );
};

export const openRecordMetadataDialog = (args: {
  tableId: string;
  initial?: RecordMetaQuery | null;
}): Promise<RecordMetaQuery | undefined | null> =>
  dialogCore.open<RecordMetaQuery | undefined | null>((close) => {
    const initial = cleanRecordMetaQuery(args.initial);
    const [createdBy, setCreatedBy] = createSignal<string[]>(cleanIds(initial?.users?.createdBy));
    const [updatedBy, setUpdatedBy] = createSignal<string[]>(cleanIds(initial?.users?.updatedBy));
    const [deletedBy, setDeletedBy] = createSignal<string[]>(cleanIds(initial?.users?.deletedBy));
    const [labels, setLabels] = createSignal<Record<string, RecordActor>>({});

    const build = (): RecordMetaQuery | undefined =>
      cleanRecordMetaQuery({
        users: {
          createdBy: createdBy(),
          updatedBy: updatedBy(),
          deletedBy: deletedBy(),
        },
      });

    const apply = () => close(build());

    return (
      <PanelDialog>
        <PanelDialog.Header
          title="Record metadata"
          subtitle="Filter by who created, modified, or deleted records."
          icon="ti ti-user-search"
          close={() => close(null)}
        />
        <PanelDialog.Body>
          <div class="flex flex-col gap-3">
            <For each={USER_KEYS}>
              {(config) => (
                <ActorPicker
                  tableId={args.tableId}
                  config={config}
                  selectedIds={() => (config.key === "createdBy" ? createdBy() : config.key === "updatedBy" ? updatedBy() : deletedBy())}
                  labels={labels}
                  setLabels={setLabels}
                  onChange={(next) => {
                    if (config.key === "createdBy") setCreatedBy(next);
                    else if (config.key === "updatedBy") setUpdatedBy(next);
                    else setDeletedBy(next);
                  }}
                />
              )}
            </For>
          </div>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <button type="button" class="btn-simple btn-sm" onClick={() => close(undefined)}>
            Clear
          </button>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-simple btn-sm" onClick={() => close(null)}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" onClick={apply}>
              Apply
            </button>
          </div>
        </PanelDialog.Footer>
      </PanelDialog>
    );
  }, panelDialogOptions);
