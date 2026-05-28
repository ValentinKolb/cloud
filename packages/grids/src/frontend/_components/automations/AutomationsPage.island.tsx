import {
  CheckboxCard,
  DataTable,
  type DataTableColumn,
  Select,
  TextInput,
  dialogCore,
  panelDialogOptions,
  PanelDialog,
  prompts,
  toast,
} from "@valentinkolb/cloud/ui";
import { createResource, createSignal, For, type JSX, Show } from "solid-js";
import type { Automation, AutomationRun, Field, Table } from "../../../service";
import type { FilterTree } from "../../../contracts";
import { apiClient } from "../../../api/client";
import FilterPanel, { blankLeaf, isFilterLeafComplete, type FilterLeaf } from "../toolbar/FilterPanel";
import { errorMessage } from "../utils/api-helpers";

type Props = {
  baseId: string;
  baseShortId: string;
  tables: Table[];
  fieldsByTable: Record<string, Field[]>;
};

type TriggerKind = "manual" | "schedule" | "record.created" | "record.updated" | "record.deleted";

const triggerLabel = (automation: Automation): string => {
  if (automation.trigger.kind === "manual") return "Manual";
  if (automation.trigger.kind === "schedule") return `Schedule · ${automation.trigger.cron}`;
  const table = automation.trigger.tableId ? "selected table" : "any table";
  return `Record ${automation.trigger.event} · ${table}`;
};

const targetHost = (automation: Automation): string => {
  try {
    return new URL(automation.action.url).host;
  } catch {
    return automation.action.url;
  }
};

const triggerKindOf = (automation?: Automation): TriggerKind => {
  if (!automation || automation.trigger.kind === "manual") return "manual";
  if (automation.trigger.kind === "schedule") return "schedule";
  return `record.${automation.trigger.event}` as TriggerKind;
};

const filterRowsFromTrigger = (automation?: Automation): FilterLeaf[] => {
  const filter = automation?.trigger.kind === "record" ? automation.trigger.filter : undefined;
  if (!filter || typeof filter !== "object" || (filter as { op?: string }).op !== "AND") return [];
  const filters = (filter as { filters?: unknown[] }).filters;
  return Array.isArray(filters)
    ? filters.filter((item): item is FilterLeaf => !!item && typeof item === "object" && "fieldId" in item)
    : [];
};

export default function AutomationsPage(props: Props) {
  const [items, { refetch }] = createResource(async () => {
    const res = await apiClient.automations["by-base"][":baseId"].$get({ param: { baseId: props.baseId } });
    if (!res.ok) throw new Error(await errorMessage(res, "Could not load automations."));
    return res.json();
  });

  const columns: DataTableColumn<Automation>[] = [
    {
      id: "name",
      header: "Automation",
      value: (a) => a.name,
    },
    {
      id: "target",
      header: "Webhook",
      value: (a) => targetHost(a),
      cellClass: "text-secondary",
    },
    {
      id: "enabled",
      header: "State",
      value: (a) => (a.enabled ? "Enabled" : "Disabled"),
    },
    {
      id: "actions",
      header: "",
      value: () => "",
      cellClass: "text-right",
    },
  ];

  const renderCell = (ctx: {
    row: Automation;
    col: DataTableColumn<Automation>;
    value: unknown;
    render: (value: unknown) => JSX.Element;
  }): JSX.Element => {
    if (ctx.col.id === "name") {
      return (
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="truncate font-medium text-primary">{ctx.row.name}</span>
          <span class="truncate text-xs text-dimmed">{triggerLabel(ctx.row)}</span>
        </div>
      );
    }
    if (ctx.col.id === "enabled") {
      return <span class={`badge ${ctx.row.enabled ? "badge-success" : "badge-neutral"}`}>{ctx.row.enabled ? "Enabled" : "Disabled"}</span>;
    }
    if (ctx.col.id === "actions") {
      return (
        <div class="flex justify-end gap-1">
          <button
            type="button"
            class="icon-btn"
            onClick={() => void runAutomation(ctx.row)}
            title="Run automation"
            aria-label="Run automation"
          >
            <i class="ti ti-player-play" />
          </button>
          <button
            type="button"
            class="icon-btn"
            onClick={() => void openEditor(ctx.row)}
            title="Edit automation"
            aria-label="Edit automation"
          >
            <i class="ti ti-settings" />
          </button>
        </div>
      );
    }
    return ctx.render(ctx.value);
  };

  const runAutomation = async (automation: Automation) => {
    try {
      const res = await apiClient.automations[":automationId"].run.$post({
        param: { automationId: automation.id },
        json: { reason: "manual" },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not run automation."));
      toast.success("Automation run started");
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Could not run automation.");
    }
  };

  const openEditor = async (automation?: Automation) => {
    await dialogCore.open<void>(
      (close) => <AutomationEditor automation={automation} {...props} onSaved={() => void refetch()} onClose={close} />,
      panelDialogOptions,
    );
  };

  return (
    <div class="flex-1 min-h-0 overflow-y-auto" style="scrollbar-gutter: stable" data-scroll-preserve="grids-automations-main">
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-3" style="view-transition-name: grids-automations-title">
          <div class="min-w-0">
            <h1 class="min-w-0 text-base font-semibold text-primary">Automations</h1>
            <p class="mt-0.5 text-xs text-dimmed">Send webhooks when records change or on a schedule.</p>
          </div>
          <button type="button" class="btn-input btn-input-sm shrink-0" onClick={() => void openEditor()}>
            <i class="ti ti-plus" /> Add automation
          </button>
        </div>

        <DataTable
          rows={items() ?? []}
          columns={columns}
          getRowId={(row) => row.id}
          hoverRows
          class="paper overflow-x-auto"
          renderCell={renderCell}
          empty={
            <div class="text-center text-sm text-dimmed">
              <i class="ti ti-bolt text-lg" />
              <p class="mt-2 font-medium text-primary">No automations yet</p>
              <p>Create one webhook automation for record changes or schedules.</p>
            </div>
          }
        />
      </div>
    </div>
  );
}

function AutomationEditor(props: Props & { automation?: Automation; onSaved: () => void; onClose: () => void }) {
  const [name, setName] = createSignal(props.automation?.name ?? "");
  const [description, setDescription] = createSignal(props.automation?.description ?? "");
  const [enabled, setEnabled] = createSignal(props.automation?.enabled ?? true);
  const [triggerKind, setTriggerKind] = createSignal<TriggerKind>(triggerKindOf(props.automation));
  const [tableId, setTableId] = createSignal(props.automation?.trigger.kind === "record" ? (props.automation.trigger.tableId ?? "") : "");
  const [cron, setCron] = createSignal(props.automation?.trigger.kind === "schedule" ? props.automation.trigger.cron : "0 8 * * *");
  const [timezone, setTimezone] = createSignal(
    props.automation?.trigger.kind === "schedule" ? (props.automation.trigger.timezone ?? "") : "",
  );
  const [url, setUrl] = createSignal(props.automation?.action.url ?? "");
  const [timeoutMs, setTimeoutMs] = createSignal(String(props.automation?.action.timeoutMs ?? 15000));
  const [secret, setSecret] = createSignal("");
  const [includeRecord, setIncludeRecord] = createSignal(props.automation?.payload.includeRecord !== false);
  const [fieldMode, setFieldMode] = createSignal(props.automation?.payload.fieldIds ? "selected" : "all");
  const [fieldIds, setFieldIds] = createSignal<string[]>(props.automation?.payload.fieldIds ?? []);
  const [filterRows, setFilterRows] = createSignal<FilterLeaf[]>(filterRowsFromTrigger(props.automation));
  const fields = () => (tableId() ? (props.fieldsByTable[tableId()] ?? []) : []);
  const isRecordTrigger = () => triggerKind().startsWith("record.");
  const selectedTableFields = () => fields().filter((field) => !field.deletedAt);

  const [runs, { refetch: refetchRuns }] = createResource(
    () => props.automation?.id,
    async (automationId) => {
      if (!automationId) return { items: [] as AutomationRun[] };
      const res = await apiClient.automations[":automationId"].runs.$get({ param: { automationId } });
      if (!res.ok) return { items: [] as AutomationRun[] };
      return res.json();
    },
  );

  const filter = (): FilterTree | undefined => {
    const valid = filterRows().filter((row) => isFilterLeafComplete(row, fields()));
    return valid.length > 0 ? { op: "AND", filters: valid } : undefined;
  };

  const save = async () => {
    try {
      const kind = triggerKind();
      const trigger =
        kind === "manual"
          ? { kind: "manual" as const }
          : kind === "schedule"
            ? { kind: "schedule" as const, cron: cron().trim(), timezone: timezone().trim() || undefined }
            : {
                kind: "record" as const,
                event: kind.split(".")[1] as "created" | "updated" | "deleted",
                tableId: tableId() || undefined,
                filter: tableId() ? filter() : undefined,
              };
      const selectedTimeout = Number(timeoutMs());
      const payload = {
        name: name().trim(),
        description: description().trim() || null,
        enabled: enabled(),
        trigger,
        action: { kind: "webhook" as const, url: url().trim(), timeoutMs: Number.isFinite(selectedTimeout) ? selectedTimeout : undefined },
        payload: {
          includeRecord: isRecordTrigger() ? includeRecord() : false,
          fieldIds: isRecordTrigger() && tableId() && fieldMode() === "selected" ? fieldIds() : undefined,
        },
        webhookSecret: secret().trim() ? secret().trim() : undefined,
      };
      const res = props.automation
        ? await apiClient.automations[":automationId"].$patch({ param: { automationId: props.automation.id }, json: payload })
        : await apiClient.automations["by-base"][":baseId"].$post({ param: { baseId: props.baseId }, json: payload });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not save automation."));
      props.onSaved();
      props.onClose();
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Could not save automation.");
    }
  };

  const remove = async () => {
    if (!props.automation) return;
    const ok = await prompts.confirm(`Delete "${props.automation.name}"?`, { variant: "danger", confirmText: "Delete automation" });
    if (!ok) return;
    const res = await apiClient.automations[":automationId"].$delete({ param: { automationId: props.automation.id } });
    if (!res.ok) return prompts.error(await errorMessage(res, "Could not delete automation."));
    props.onSaved();
    props.onClose();
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.automation ? `Edit automation — ${props.automation.name}` : "New automation"}
        icon="ti ti-bolt"
        close={props.onClose}
      />

      <PanelDialog.Body>
        <PanelDialog.Section title="Identity" icon="ti ti-id">
          <TextInput label="Name" value={name} onInput={setName} required placeholder="e.g. Send paid invoices" />
          <TextInput label="Description" value={description} onInput={setDescription} placeholder="Optional context for admins" lines={3} />
          <CheckboxCard label="Enabled" description="Run this automation when the trigger matches." value={enabled} onChange={setEnabled} />
        </PanelDialog.Section>

        <PanelDialog.Section title="Trigger" icon="ti ti-bolt">
          <div class="grid gap-3 sm:grid-cols-2">
            <Select
              label="Type"
              value={triggerKind}
              onChange={(value) => setTriggerKind(value as TriggerKind)}
              options={[
                { id: "record.created", label: "Record created" },
                { id: "record.updated", label: "Record updated" },
                { id: "record.deleted", label: "Record deleted" },
                { id: "schedule", label: "Schedule" },
                { id: "manual", label: "Manual" },
              ]}
            />
            <Show when={isRecordTrigger()}>
              <Select
                label="Table"
                value={tableId}
                onChange={(value) => {
                  setTableId(value);
                  setFilterRows([]);
                  setFieldIds([]);
                }}
                placeholder="Any table"
                options={[{ id: "", label: "Any table" }, ...props.tables.map((table) => ({ id: table.id, label: table.name }))]}
              />
            </Show>
            <Show when={triggerKind() === "schedule"}>
              <TextInput label="Cron" value={cron} onInput={setCron} placeholder="0 8 * * *" />
              <TextInput label="Timezone" value={timezone} onInput={setTimezone} placeholder="Europe/Berlin" />
            </Show>
          </div>
        </PanelDialog.Section>

        <Show when={isRecordTrigger() && tableId()}>
          <PanelDialog.Section title="Filter" subtitle="Run only when the saved record matches." icon="ti ti-filter">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-medium text-secondary">Conditions</span>
              <button
                type="button"
                class="btn-simple btn-sm"
                onClick={() => setFilterRows([...filterRows(), blankLeaf(fields())].filter(Boolean) as FilterLeaf[])}
              >
                <i class="ti ti-plus" /> Add filter
              </button>
            </div>
            <Show when={filterRows().length > 0} fallback={<p class="mt-3 text-sm text-dimmed">No filter. Every matching event runs.</p>}>
              <div class="mt-3">
                <FilterPanel fields={fields()} rows={filterRows} onRowsChange={setFilterRows} />
              </div>
            </Show>
          </PanelDialog.Section>
        </Show>

        <PanelDialog.Section title="Action" icon="ti ti-webhook">
          <div class="grid gap-3 sm:grid-cols-2">
            <TextInput label="Webhook URL" value={url} onInput={setUrl} placeholder="https://api.example.com/grids" required />
            <TextInput label="Timeout ms" value={timeoutMs} onInput={setTimeoutMs} placeholder="15000" />
            <div class="sm:col-span-2">
              <TextInput
                label={props.automation?.webhookSecretSet ? "Replace secret" : "Secret"}
                value={secret}
                onInput={setSecret}
                placeholder={props.automation?.webhookSecretSet ? "Leave empty to keep current secret" : "Optional HMAC secret"}
              />
            </div>
          </div>
        </PanelDialog.Section>

        <Show when={isRecordTrigger()}>
          <PanelDialog.Section title="Payload" icon="ti ti-package">
            <div class="flex flex-col gap-3">
              <CheckboxCard
                label="Include record data"
                description="Send record values with the event metadata."
                value={includeRecord}
                onChange={setIncludeRecord}
              />
              <Show when={tableId()}>
                <Select
                  label="Fields"
                  value={fieldMode}
                  onChange={setFieldMode}
                  options={[
                    { id: "all", label: "All fields" },
                    { id: "selected", label: "Selected fields" },
                  ]}
                />
                <Show when={fieldMode() === "selected"}>
                  <div class="grid gap-2 sm:grid-cols-2">
                    <For each={selectedTableFields()}>
                      {(field) => (
                        <CheckboxCard
                          label={field.name}
                          description={field.type}
                          value={() => fieldIds().includes(field.id)}
                          onChange={(checked) =>
                            setFieldIds(checked ? [...fieldIds(), field.id] : fieldIds().filter((id) => id !== field.id))
                          }
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>
          </PanelDialog.Section>
        </Show>

        <Show when={props.automation}>
          <PanelDialog.Section title="Recent runs" icon="ti ti-history">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-secondary">Last executions</span>
              <button type="button" class="btn-simple btn-sm" onClick={() => void refetchRuns()}>
                <i class="ti ti-refresh" /> Refresh
              </button>
            </div>
            <div class="mt-3 flex flex-col gap-2 text-xs">
              <For each={runs()?.items ?? []} fallback={<p class="text-dimmed">No runs yet.</p>}>
                {(run) => (
                  <div class="flex items-center justify-between gap-3 rounded border border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
                    <span class={run.status === "failed" ? "text-red-600 dark:text-red-400" : "text-secondary"}>{run.status}</span>
                    <span class="text-dimmed">{run.httpStatus ?? "-"}</span>
                    <span class="text-dimmed">{run.durationMs == null ? "-" : `${run.durationMs}ms`}</span>
                    <span class="text-dimmed">{new Date(run.createdAt).toLocaleString()}</span>
                  </div>
                )}
              </For>
            </div>
          </PanelDialog.Section>
        </Show>
      </PanelDialog.Body>

      <PanelDialog.Footer>
        <div>
          {props.automation && (
            <button type="button" class="btn-danger btn-sm" onClick={() => void remove()}>
              Delete automation
            </button>
          )}
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn-input btn-sm" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" onClick={() => void save()}>
            Save
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}
