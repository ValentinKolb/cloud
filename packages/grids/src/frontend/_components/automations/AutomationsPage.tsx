import {
  CheckboxCard,
  DataTable,
  type DataTableColumn,
  dialogCore,
  MultiSelectInput,
  PanelDialog,
  Placeholder,
  panelDialogOptions,
  prompts,
  Select,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { createResource, createSignal, For, type JSX, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DocumentTemplateSummary, FilterTree } from "../../../contracts";
import type { Automation, AutomationRun, Field, Table } from "../../../service";
import FilterPanel, { blankLeaf, type FilterLeaf, isFilterLeafComplete } from "../toolbar/FilterPanel";
import { errorMessage } from "../utils/api-helpers";

type Props = {
  baseId: string;
  baseShortId: string;
  tables: Table[];
  fieldsByTable: Record<string, Field[]>;
};

type TriggerKind = "manual" | "schedule" | "record.created" | "record.updated" | "record.deleted";
type ActionKind = "webhook" | "document";

const TRIGGER_OPTIONS: Array<{ id: TriggerKind; label: string; description: string; icon: string }> = [
  { id: "record.created", label: "Record created", description: "Run after a new record is added.", icon: "ti ti-plus" },
  { id: "record.updated", label: "Record updated", description: "Run after an existing record changes.", icon: "ti ti-brush" },
  { id: "record.deleted", label: "Record deleted", description: "Run after a record is deleted.", icon: "ti ti-trash" },
  { id: "schedule", label: "Schedule", description: "Run from a cron schedule.", icon: "ti ti-clock" },
  { id: "manual", label: "Manual", description: "Run only when an admin starts it.", icon: "ti ti-user-check" },
];

const ACTION_OPTIONS: Array<{ id: ActionKind; label: string; description: string; icon: string }> = [
  { id: "webhook", label: "Webhook", description: "Send a signed HTTP request.", icon: "ti ti-webhook" },
  { id: "document", label: "Document", description: "Generate a record document.", icon: "ti ti-file-type-pdf" },
];

const triggerLabel = (automation: Automation): string => {
  if (automation.trigger.kind === "manual") return "Manual";
  if (automation.trigger.kind === "schedule") return `Schedule · ${automation.trigger.cron}`;
  const table = automation.trigger.tableId ? "selected table" : "any table";
  return `Record ${automation.trigger.event} · ${table}`;
};

const targetHost = (automation: Automation): string => {
  if (automation.action.kind === "document") return "Document";
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
      header: "Action",
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
          <button type="button" class="btn-input-success btn-input-sm shrink-0" onClick={() => void openEditor()}>
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
  const [actionKind, setActionKind] = createSignal<ActionKind>(props.automation?.action.kind ?? "webhook");
  const [tableId, setTableId] = createSignal(props.automation?.trigger.kind === "record" ? (props.automation.trigger.tableId ?? "") : "");
  const [cron, setCron] = createSignal(props.automation?.trigger.kind === "schedule" ? props.automation.trigger.cron : "0 8 * * *");
  const [timezone, setTimezone] = createSignal(
    props.automation?.trigger.kind === "schedule" ? (props.automation.trigger.timezone ?? "") : "",
  );
  const [url, setUrl] = createSignal(props.automation?.action.kind === "webhook" ? props.automation.action.url : "");
  const [timeoutMs, setTimeoutMs] = createSignal(
    String(props.automation?.action.kind === "webhook" ? (props.automation.action.timeoutMs ?? 15000) : 15000),
  );
  const [templateId, setTemplateId] = createSignal(props.automation?.action.kind === "document" ? props.automation.action.templateId : "");
  const [secret, setSecret] = createSignal("");
  const [includeRecord, setIncludeRecord] = createSignal(props.automation?.payload.includeRecord !== false);
  const [fieldMode, setFieldMode] = createSignal(props.automation?.payload.fieldIds ? "selected" : "all");
  const [fieldIds, setFieldIds] = createSignal<string[]>(props.automation?.payload.fieldIds ?? []);
  const [filterRows, setFilterRows] = createSignal<FilterLeaf[]>(filterRowsFromTrigger(props.automation));
  const fields = () => (tableId() ? (props.fieldsByTable[tableId()] ?? []) : []);
  const isRecordTrigger = () => triggerKind().startsWith("record.");
  const isWebhookAction = () => actionKind() === "webhook";
  const isDocumentAction = () => actionKind() === "document";
  const selectedTableFields = () => fields().filter((field) => !field.deletedAt);

  const [templates] = createResource(
    () => (isDocumentAction() && tableId() ? tableId() : ""),
    async (selectedTableId) => {
      if (!selectedTableId) return [] as DocumentTemplateSummary[];
      const res = await apiClient.documents.templates["by-table"][":tableId"].$get({
        param: { tableId: selectedTableId },
        query: { min: "write" },
      });
      if (!res.ok) return [] as DocumentTemplateSummary[];
      return res.json();
    },
  );

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
        action:
          actionKind() === "document"
            ? { kind: "document" as const, templateId: templateId() }
            : { kind: "webhook" as const, url: url().trim(), timeoutMs: Number.isFinite(selectedTimeout) ? selectedTimeout : undefined },
        payload: {
          includeRecord: isWebhookAction() && isRecordTrigger() ? includeRecord() : false,
          fieldIds: isWebhookAction() && isRecordTrigger() && tableId() && fieldMode() === "selected" ? fieldIds() : undefined,
        },
        webhookSecret: isWebhookAction() && secret().trim() ? secret().trim() : undefined,
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
        <div class="flex flex-col gap-5">
          <TextInput
            label="Name"
            description="Shown in the automation list and run history."
            value={name}
            onInput={setName}
            required
            placeholder="e.g. Send paid invoices"
          />
          <TextInput
            label="Description"
            description="Optional admin notes about purpose, scope, or receiver."
            value={description}
            onInput={setDescription}
            placeholder="Optional context for admins"
            lines={3}
          />
          <CheckboxCard label="Enabled" description="Run this automation when the trigger matches." value={enabled} onChange={setEnabled} />
        </div>

        <div class="flex flex-col gap-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="sm:col-span-2">
              <Select
                label="Trigger"
                description="Choose when this automation runs."
                value={triggerKind}
                onChange={(value) => setTriggerKind(value as TriggerKind)}
                options={
                  isDocumentAction()
                    ? TRIGGER_OPTIONS.filter((option) => option.id === "record.created" || option.id === "record.updated")
                    : TRIGGER_OPTIONS
                }
              />
            </div>
            <Show when={isRecordTrigger()}>
              <Select
                label="Table"
                value={tableId}
                onChange={(value) => {
                  setTableId(value);
                  setTemplateId("");
                  setFilterRows([]);
                  setFieldIds([]);
                }}
                placeholder={isDocumentAction() ? "Select table" : "Any table"}
                options={[
                  ...(isDocumentAction() ? [] : [{ id: "", label: "Any table" }]),
                  ...props.tables.map((table) => ({ id: table.id, label: table.name })),
                ]}
              />
            </Show>
            <Show when={triggerKind() === "schedule"}>
              <TextInput label="Cron" value={cron} onInput={setCron} placeholder="0 8 * * *" />
              <TextInput label="Timezone" value={timezone} onInput={setTimezone} placeholder="Europe/Berlin" />
            </Show>
          </div>
        </div>

        <Show when={isRecordTrigger() && tableId()}>
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-2">
              <div>
                <h3 class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">Filter</h3>
                <p class="mt-0.5 text-xs text-dimmed">Run only when the saved record matches.</p>
              </div>
              <button
                type="button"
                class="btn-input-success btn-input-sm"
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
          </div>
        </Show>

        <div class="flex flex-col gap-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <Select
              label="Action"
              value={actionKind}
              onChange={(value) => {
                const next = value as ActionKind;
                setActionKind(next);
                if (
                  next === "document" &&
                  (triggerKind() === "manual" || triggerKind() === "schedule" || triggerKind() === "record.deleted")
                ) {
                  setTriggerKind("record.updated");
                }
              }}
              options={ACTION_OPTIONS}
            />
            <Show when={isDocumentAction()}>
              <Select
                label="Document template"
                description="Generated for the matching record."
                value={templateId}
                onChange={setTemplateId}
                placeholder={tableId() ? "Choose template" : "Select a table first"}
                options={(templates() ?? []).map((template) => ({
                  id: template.id,
                  label: template.name,
                  description: template.enabled ? "Enabled" : "Disabled",
                }))}
              />
            </Show>
            <Show when={isWebhookAction()}>
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
            </Show>
          </div>
        </div>

        <Show when={isWebhookAction() && isRecordTrigger()}>
          <div class="flex flex-col gap-3">
            <div>
              <h3 class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">Payload</h3>
              <p class="mt-0.5 text-xs text-dimmed">Choose which record values the webhook receives.</p>
            </div>
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
                  <MultiSelectInput
                    label="Selected fields"
                    description="Only these fields are included in the webhook payload."
                    icon="ti ti-columns"
                    placeholder="Choose fields"
                    value={fieldIds}
                    onChange={setFieldIds}
                    options={selectedTableFields().map((field) => ({
                      id: field.id,
                      label: field.name,
                      description: field.type,
                      icon: field.icon ?? "ti ti-columns",
                    }))}
                    clearable
                  />
                </Show>
              </Show>
            </div>
          </div>
        </Show>

        <Show when={props.automation}>
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">Recent runs</h3>
                <p class="mt-0.5 text-xs text-dimmed">Last executions for this automation.</p>
              </div>
              <button type="button" class="btn-simple btn-sm" onClick={() => void refetchRuns()}>
                <i class="ti ti-refresh" /> Refresh
              </button>
            </div>
            <div class="mt-3 flex flex-col gap-2 text-xs">
              <For
                each={runs()?.items ?? []}
                fallback={
                  <Placeholder align="left" class="px-0 py-2">
                    No runs yet.
                  </Placeholder>
                }
              >
                {(run) => (
                  <div class="paper flex items-center justify-between gap-3 px-2.5 py-1.5">
                    <span class={run.status === "failed" ? "text-red-600 dark:text-red-400" : "text-secondary"}>{run.status}</span>
                    <span class="text-dimmed">{run.httpStatus ?? "-"}</span>
                    <span class="text-dimmed">{run.durationMs == null ? "-" : `${run.durationMs}ms`}</span>
                    <span class="text-dimmed">{new Date(run.createdAt).toLocaleString()}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
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
