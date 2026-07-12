import {
  AutocompleteEditor,
  CheckboxCard,
  dialogCore,
  FilterChip,
  type FilterChipSection,
  PanelDialog,
  Placeholder,
  panelDialogWorkspaceOptions,
  prompts,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { highlight } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, lazy, onCleanup, onMount, Show, Suspense } from "solid-js";
import { apiClient } from "../../../api/client";
import type {
  DslQueryPreviewDiagnostic,
  Workflow,
  WorkflowEmailDelivery,
  WorkflowRun,
  WorkflowRunStats,
  WorkflowRunStatsWindow,
  WorkflowTriggerKind,
} from "../../../contracts";
import type { Table } from "../../../service";
import { errorMessage } from "../utils/api-helpers";
import { EmailTemplateManager } from "./WorkflowEmailTemplates";
import type { WorkflowScannerState } from "./WorkflowScannerSurface.island";
import { buildBackendWorkflowCompletions } from "./workflow-autocomplete";
import {
  formatWorkflowRunDate as formatDate,
  formatWorkflowRunDuration as formatDuration,
  workflowRunStatusClass as statusClass,
  triggerLabels,
} from "./workflow-display";

const WorkflowScannerSurface = lazy(() => import("./WorkflowScannerSurface.island"));

type Props = {
  baseId: string;
  baseShortId: string;
  tables: Table[];
  workflows: Workflow[];
  activeWorkflow: Workflow | null;
  selectedRunId: string | null;
  canCreateWorkflows: boolean;
  canRunActiveWorkflow: boolean;
  canManageActiveWorkflow: boolean;
  editMode: boolean;
  onWorkflowChanged: () => void;
  onSelectRun: (runId: string | null) => void;
};

type WorkflowRunPage = {
  items: WorkflowRun[];
  nextCursor?: string | null;
};

type WorkflowEmailDeliveryPage = {
  items: WorkflowEmailDelivery[];
  nextCursor?: string | null;
};

const workflowHighlight = highlight.compile(
  [
    { kind: "placeholder", match: /\$\{\{\s*[^{}]+?\s*\}\}/ },
    { kind: "string", match: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/ },
    {
      kind: "keyword",
      match:
        /\b(?:inputs|triggers|steps|type|table|required|options|form|api|scanner|bulkSelection|dashboardButton|schedule|recordEvent|enabled|input|resolve|by|field|event|cron|timezone|updateRecord|createRecord|generateDocument|createDocumentLink|sendEmail|httpRequest|setVariable|succeed|fail|if|then|else|switch|cases|default|forEach|as|do|record|recordList|text|number|boolean|date|dateTime|select|method|url|headers|json|timeoutMs|saveAs|set|values|template|document|expiresIn|comment|to|email|user|data|batch|filename|tags|message|name|description)\b/,
    },
    { kind: "function", match: /\bnow\(\)/ },
    { kind: "placeholder", match: /\binputs\.[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_ -]+)?\b/ },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /[:{}\[\],-]/ },
    { kind: "comment", match: /#[^\n]*/ },
  ],
  { classPrefix: "doc-token-" },
);

const statsWindowLabels: Record<WorkflowRunStatsWindow, string> = {
  "10m": "10 min",
  "1h": "1 hour",
  "12h": "12 hours",
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

const statsWindowOptions: FilterChipSection[] = [
  {
    options: (Object.keys(statsWindowLabels) as WorkflowRunStatsWindow[]).map((value) => ({
      value,
      label: statsWindowLabels[value],
      icon: "ti ti-clock",
    })),
  },
];

const runStatusOptions: FilterChipSection[] = [
  {
    options: [
      { value: "all", label: "All statuses", icon: "ti ti-list" },
      { value: "queued", label: "Queued", icon: "ti ti-clock" },
      { value: "running", label: "Running", icon: "ti ti-loader" },
      { value: "succeeded", label: "Succeeded", icon: "ti ti-circle-check" },
      { value: "failed", label: "Failed", icon: "ti ti-alert-circle" },
      { value: "canceled", label: "Canceled", icon: "ti ti-ban" },
    ],
  },
];

const runTriggerOptions: FilterChipSection[] = [
  {
    options: [
      { value: "all", label: "All triggers", icon: "ti ti-list" },
      ...Object.entries(triggerLabels).map(([value, label]) => ({ value, label, icon: "ti ti-bolt" })),
    ],
  },
];

type RunStatusFilter = "all" | WorkflowRun["status"];
type RunTriggerFilter = "all" | WorkflowTriggerKind;

const workflowReferenceHref = (baseShortId: string) => `/app/grids/${encodeURIComponent(baseShortId)}/reference/workflows`;

const openWorkflowReferenceWindow = (baseShortId: string) => {
  if (typeof window === "undefined") return;
  window.open(workflowReferenceHref(baseShortId), "grids-workflow-reference", "popup,width=1120,height=820,resizable=yes,scrollbars=yes");
};

const formatMetricDuration = (ms: number | null): string => {
  if (ms === null) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return `${Math.round(ms / 60_000)}m`;
};

const formatPercent = (value: number): string => `${value.toFixed(value >= 10 ? 0 : 1)}%`;

const triggerSummary = (workflow: Workflow): string => {
  const triggers = Object.keys(workflow.compiled.triggers) as WorkflowTriggerKind[];
  if (triggers.length === 0) return "No trigger";
  return triggers.map((trigger) => triggerLabels[trigger] ?? trigger).join(", ");
};

const workflowTriggers = (workflow: Workflow): WorkflowTriggerKind[] => Object.keys(workflow.compiled.triggers) as WorkflowTriggerKind[];

const workflowSearch = (workflow: Workflow): string =>
  [workflow.name, workflow.description ?? "", workflow.source, triggerSummary(workflow)].join(" ").toLowerCase();

const yamlString = (value: string): string => JSON.stringify(value);

const defaultSource = (
  table?: Table,
) => `${table ? `inputs:\n  record:\n    type: record\n    table: ${yamlString(table.name)}\n` : ""}triggers:
  form: {}
steps:
  - setVariable:
      name: ranAt
      value: \${{ now() }}
`;

const directRunTriggers = (workflow: Workflow): WorkflowTriggerKind[] =>
  (["form", "api", "dashboardButton", "schedule"] as WorkflowTriggerKind[]).filter((trigger) => workflow.compiled.triggers[trigger]);

const emptyStats = (): WorkflowRunStats => ({
  window: "24h",
  total: 0,
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  canceled: 0,
  failedLast24h: 0,
  errorRate: 0,
  avgDurationMs: null,
  p99DurationMs: null,
  lastRunAt: null,
  byWorkflow: [],
});

function DiagnosticsPanel(props: { diagnostics: DslQueryPreviewDiagnostic[]; validating: boolean }) {
  const hasDiagnostics = () => props.diagnostics.length > 0;
  return (
    <div class={`text-xs ${hasDiagnostics() ? "info-block-danger" : "info-block-success"}`}>
      <div class="flex items-center gap-2 font-medium">
        <i class={`ti ${props.validating ? "ti-loader-2 animate-spin" : hasDiagnostics() ? "ti-alert-triangle" : "ti-circle-check"}`} />
        <span>{props.validating ? "Validating..." : hasDiagnostics() ? "Workflow YAML has diagnostics" : "Workflow YAML is valid"}</span>
      </div>
      <Show when={hasDiagnostics()}>
        <ul class="mt-2 space-y-1">
          <For each={props.diagnostics}>
            {(diagnostic) => (
              <li>
                <Show when={diagnostic.line || diagnostic.column}>
                  <span class="font-mono text-[11px] uppercase">
                    {diagnostic.line ? `Line ${diagnostic.line}` : ""}
                    {diagnostic.column ? ` · Col ${diagnostic.column}` : ""}
                    {": "}
                  </span>
                </Show>
                {diagnostic.message}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function WorkflowEditor(props: Props & { workflow?: Workflow; onSaved: () => void; onClose: () => void }) {
  const [name, setName] = createSignal(props.workflow?.name ?? "");
  const [description, setDescription] = createSignal(props.workflow?.description ?? "");
  const [enabled, setEnabled] = createSignal(props.workflow?.enabled ?? false);
  const [source, setSource] = createSignal(props.workflow?.source ?? defaultSource(props.tables[0]));
  const [diagnostics, setDiagnostics] = createSignal<DslQueryPreviewDiagnostic[]>([]);
  const [validating, setValidating] = createSignal(false);
  let validationTimer: ReturnType<typeof setTimeout> | undefined;
  let validationAbort: AbortController | undefined;

  const fetchAutocomplete = async (request: { source: string; caret: number }, signal: AbortSignal) => {
    const response = await apiClient.workflows["by-base"][":baseId"].autocomplete.$post(
      { param: { baseId: props.baseId }, json: request },
      { init: { signal } },
    );
    if (!response.ok) throw new Error(await errorMessage(response, "Could not load workflow suggestions."));
    return response.json();
  };

  const completions = createMemo(() =>
    buildBackendWorkflowCompletions({
      fetchAutocomplete,
      onDiagnostics: (response) => setDiagnostics(response.diagnostics),
    }),
  );

  const runValidation = async (value: string) => {
    validationAbort?.abort();
    const abort = new AbortController();
    validationAbort = abort;
    if (!value.trim()) {
      setDiagnostics([{ message: "Workflow source is required" }]);
      setValidating(false);
      return;
    }
    setValidating(true);
    try {
      const response = await fetchAutocomplete({ source: value, caret: value.length }, abort.signal);
      if (!abort.signal.aborted) setDiagnostics(response.diagnostics);
    } catch (error) {
      if (!abort.signal.aborted) setDiagnostics([{ message: error instanceof Error ? error.message : "Could not validate workflow." }]);
    } finally {
      if (!abort.signal.aborted) setValidating(false);
    }
  };

  createEffect(() => {
    const current = source();
    if (validationTimer) clearTimeout(validationTimer);
    validationTimer = setTimeout(() => void runValidation(current), 350);
  });

  onCleanup(() => {
    if (validationTimer) clearTimeout(validationTimer);
    validationAbort?.abort();
  });

  const saveMut = mutations.create<Workflow, void>({
    mutation: async (_, { abortSignal }) => {
      const payload = {
        name: name().trim(),
        description: description().trim() || null,
        enabled: enabled(),
        source: source(),
      };
      if (!payload.name) throw new Error("Name is required.");
      const res = props.workflow
        ? await apiClient.workflows[":workflowId"].$patch(
            { param: { workflowId: props.workflow.id }, json: payload },
            { init: { signal: abortSignal } },
          )
        : await apiClient.workflows["by-base"][":baseId"].$post(
            { param: { baseId: props.baseId }, json: payload },
            { init: { signal: abortSignal } },
          );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not save workflow."));
      return res.json();
    },
    onSuccess: (saved) => {
      toast.success(`Saved "${saved.name}"`);
      props.onSaved();
      props.onClose();
    },
    onError: (error) => prompts.error(error.message),
  });

  const deleteMut = mutations.create<{ deleted: boolean }, Workflow>({
    mutation: async (workflow, { abortSignal }) => {
      const confirmed = await prompts.confirm(`Delete "${workflow.name}"?`, {
        title: "Delete workflow",
        icon: "ti ti-trash",
        confirmText: "Delete workflow",
        variant: "danger",
      });
      if (!confirmed) return { deleted: false };
      const res = await apiClient.workflows[":workflowId"].$delete(
        { param: { workflowId: workflow.id } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not delete workflow."));
      return { deleted: true };
    },
    onSuccess: (result) => {
      if (!result.deleted) return;
      toast.success("Workflow deleted");
      props.onSaved();
      props.onClose();
    },
    onError: (error) => prompts.error(error.message),
  });

  const canSave = () =>
    name().trim().length > 0 && source().trim().length > 0 && diagnostics().length === 0 && !validating() && !saveMut.loading();

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.workflow ? `Manage workflow — ${props.workflow.name}` : "New workflow"}
        subtitle="Metadata, status, and executable YAML."
        icon="ti ti-route"
        close={props.onClose}
      />
      <PanelDialog.Body scrollPreserveKey={`grids-workflow-editor-${props.workflow?.id ?? "new"}`}>
        <div class="flex min-h-[34rem] flex-1 flex-col gap-2">
          <div class="grid shrink-0 gap-2 md:grid-cols-2">
            <TextInput label="Name" value={name} onInput={setName} required icon="ti ti-route" placeholder="Workflow name" />
            <TextInput label="Description" value={description} onInput={setDescription} icon="ti ti-align-left" placeholder="Optional" />
            <div class="md:col-span-2">
              <CheckboxCard
                label="Enabled"
                description="Enabled workflows can run from declared triggers and manual runs."
                icon="ti ti-player-play"
                value={enabled}
                onChange={setEnabled}
              />
            </div>
          </div>

          <section class="flex min-h-0 flex-1 flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <div>
                <h3 class="detail-section-label mb-0">YAML source</h3>
                <p class="text-xs text-dimmed">Defines inputs, triggers, and steps.</p>
              </div>
              <button type="button" class="btn-input btn-input-sm" onClick={() => openWorkflowReferenceWindow(props.baseShortId)}>
                <i class="ti ti-external-link" /> Open reference
              </button>
            </div>
            <div class="min-h-[24rem] flex-1">
              <AutocompleteEditor
                value={source}
                onInput={setSource}
                completions={completions()}
                highlight={workflowHighlight}
                variant="paper"
                fill
                restoreExpansionOnBackspace={false}
                placeholder={defaultSource(props.tables[0])}
                ariaLabel="Workflow YAML source"
              />
            </div>
            <DiagnosticsPanel diagnostics={diagnostics()} validating={validating()} />
          </section>
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <div>
          <Show when={props.workflow}>
            {(workflow) => (
              <button type="button" class="btn-danger btn-sm" disabled={deleteMut.loading()} onClick={() => deleteMut.mutate(workflow())}>
                <i class={deleteMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-trash"} /> Delete workflow
              </button>
            )}
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-input btn-sm" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" disabled={!canSave()} onClick={() => saveMut.mutate()}>
            <i class={saveMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} /> Save workflow
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

function StatCard(props: { label: string; value: number | string; icon: string; tone?: "default" | "danger" | "success" }) {
  const toneClass = () =>
    props.tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : props.tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-secondary";
  return (
    <div class="paper flex min-w-0 items-center gap-3 px-3 py-2">
      <span class={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-900 ${toneClass()}`}>
        <i class={`ti ti-${props.icon}`} />
      </span>
      <span class="min-w-0">
        <span class="block text-xs uppercase tracking-wider text-dimmed">{props.label}</span>
        <span class="block truncate text-lg font-semibold text-primary">{props.value}</span>
      </span>
    </div>
  );
}

function WorkflowCard(props: {
  baseShortId: string;
  workflow: Workflow;
  active?: boolean;
  stats?: WorkflowRunStats["byWorkflow"][number];
}) {
  const href = () => `/app/grids/${props.baseShortId}/workflows/${props.workflow.shortId}`;
  const stats = () => props.stats;
  return (
    <a
      href={href()}
      class={`flex min-w-0 items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
        props.active
          ? "border-blue-200 bg-blue-50/70 dark:border-blue-900/60 dark:bg-blue-950/20"
          : "border-zinc-100 bg-white hover:border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
      }`}
    >
      <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-secondary dark:bg-zinc-900">
        <i class="ti ti-route" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-semibold text-primary">{props.workflow.name}</span>
          <span class={`badge ${props.workflow.enabled ? "badge-success" : "badge-neutral"}`}>
            {props.workflow.enabled ? "enabled" : "disabled"}
          </span>
        </span>
        <Show when={props.workflow.description}>
          {(description) => <span class="mt-0.5 block truncate text-xs text-dimmed">{description()}</span>}
        </Show>
        <Show when={stats()}>
          {(row) => (
            <span class="mt-1 block truncate text-[11px] text-dimmed">
              {row().total} runs · {formatPercent(row().errorRate)} errors · p99 {formatMetricDuration(row().p99DurationMs)}
            </span>
          )}
        </Show>
        <span class="mt-2 flex flex-wrap gap-1">
          <For each={workflowTriggers(props.workflow)}>{(trigger) => <span class="tag">{triggerLabels[trigger] ?? trigger}</span>}</For>
        </span>
      </span>
    </a>
  );
}

function RunTimeline(props: {
  runs: WorkflowRun[];
  workflows: Workflow[];
  selectedRunId: string | null;
  showWorkflow?: boolean;
  loading?: boolean;
  nextCursor?: string | null;
  onSelect: (runId: string) => void;
  onLoadMore?: () => void;
}) {
  const workflowById = createMemo(() => new Map(props.workflows.map((workflow) => [workflow.id, workflow])));
  return (
    <div class="flex min-h-0 flex-col">
      <For
        each={props.runs}
        fallback={
          <Placeholder align="left" class="py-8">
            {props.loading ? "Loading runs..." : "No workflow runs yet."}
          </Placeholder>
        }
      >
        {(run) => {
          const workflow = () => (run.workflowId ? workflowById().get(run.workflowId) : null);
          return (
            <button
              type="button"
              class={`grid w-full grid-cols-[auto_1fr_auto] items-start gap-3 border-b border-zinc-100 px-3 py-2 text-left text-xs last:border-b-0 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/70 ${
                props.selectedRunId === run.id ? "bg-blue-50/60 dark:bg-blue-950/20" : ""
              }`}
              onClick={() => props.onSelect(run.id)}
            >
              <span class={`badge ${statusClass(run.status)}`}>{run.status}</span>
              <span class="min-w-0">
                <span class="block truncate font-medium text-primary">
                  {props.showWorkflow ? (workflow()?.name ?? "Deleted workflow") : (triggerLabels[run.triggerKind] ?? run.triggerKind)}
                </span>
                <span class="mt-0.5 block truncate text-dimmed">
                  {props.showWorkflow ? `${triggerLabels[run.triggerKind] ?? run.triggerKind} · ` : ""}
                  {formatDate(run.createdAt)}
                </span>
                <Show when={run.error}>{(error) => <span class="mt-1 block truncate text-red-600 dark:text-red-400">{error()}</span>}</Show>
              </span>
              <span class="whitespace-nowrap text-dimmed">{formatDuration(run)}</span>
            </button>
          );
        }}
      </For>
      <Show when={props.nextCursor}>
        <div class="border-t border-zinc-100 px-3 py-2 text-center dark:border-zinc-800">
          <button type="button" class="btn-simple btn-sm" onClick={props.onLoadMore} disabled={props.loading}>
            <i class={props.loading ? "ti ti-loader-2 animate-spin" : "ti ti-chevrons-down"} /> Load more
          </button>
        </div>
      </Show>
    </div>
  );
}

function EmailDeliveryTable(props: {
  deliveries: WorkflowEmailDelivery[];
  workflows: Workflow[];
  loading?: boolean;
  nextCursor?: string | null;
  showWorkflow?: boolean;
  onLoadMore?: () => void;
}) {
  const workflowById = createMemo(() => new Map(props.workflows.map((workflow) => [workflow.id, workflow])));
  const recipients = (delivery: WorkflowEmailDelivery) =>
    delivery.recipients.map((recipient) => `${recipient.kind}:${recipient.recipient}`).join(", ") || "-";
  return (
    <section class="paper min-h-0 overflow-hidden">
      <div class="flex items-center justify-between gap-2 px-3 py-2">
        <div class="min-w-0">
          <h2 class="truncate text-sm font-semibold text-primary">Email deliveries</h2>
          <p class="text-xs text-dimmed">Workflow sendEmail audit trail.</p>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-zinc-50 text-[11px] uppercase tracking-wider text-dimmed dark:bg-zinc-900/70">
            <tr>
              <th class="px-3 py-2 font-medium">Status</th>
              <Show when={props.showWorkflow}>
                <th class="px-3 py-2 font-medium">Workflow</th>
              </Show>
              <th class="px-3 py-2 font-medium">Subject</th>
              <th class="px-3 py-2 font-medium">Recipients</th>
              <th class="px-3 py-2 font-medium">Sent</th>
            </tr>
          </thead>
          <tbody>
            <For
              each={props.deliveries}
              fallback={
                <tr>
                  <td colSpan={props.showWorkflow ? 5 : 4}>
                    <Placeholder align="left" class="py-8">
                      {props.loading ? "Loading email deliveries..." : "No workflow emails sent yet."}
                    </Placeholder>
                  </td>
                </tr>
              }
            >
              {(delivery) => (
                <tr class="border-t border-zinc-100 dark:border-zinc-800">
                  <td class="px-3 py-2">
                    <span class={`badge ${delivery.status === "failed" ? "badge-danger" : "badge-success"}`}>{delivery.status}</span>
                    <Show when={delivery.error}>
                      {(error) => <span class="mt-1 block max-w-48 truncate text-red-600 dark:text-red-400">{error()}</span>}
                    </Show>
                  </td>
                  <Show when={props.showWorkflow}>
                    <td class="max-w-48 truncate px-3 py-2 text-primary">
                      {delivery.workflowId ? (workflowById().get(delivery.workflowId)?.name ?? "Deleted workflow") : "-"}
                    </td>
                  </Show>
                  <td class="max-w-72 truncate px-3 py-2 text-primary">{delivery.subject ?? "-"}</td>
                  <td class="max-w-72 truncate px-3 py-2 text-dimmed">{recipients(delivery)}</td>
                  <td class="whitespace-nowrap px-3 py-2 text-dimmed">{formatDate(delivery.createdAt)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={props.nextCursor}>
        <div class="border-t border-zinc-100 px-3 py-2 text-center dark:border-zinc-800">
          <button type="button" class="btn-simple btn-sm" onClick={props.onLoadMore} disabled={props.loading}>
            <i class={props.loading ? "ti ti-loader-2 animate-spin" : "ti ti-chevrons-down"} /> Load more
          </button>
        </div>
      </Show>
    </section>
  );
}

export default function WorkflowsPage(props: Props) {
  const [search, setSearch] = createSignal("");
  const [statsWindow, setStatsWindow] = createSignal<WorkflowRunStatsWindow>("24h");
  const [runStatus, setRunStatus] = createSignal<RunStatusFilter>("all");
  const [runTrigger, setRunTrigger] = createSignal<RunTriggerFilter>("all");
  const [items, setItems] = createSignal<Workflow[]>(props.workflows);
  const [stats, setStats] = createSignal<WorkflowRunStats>(emptyStats());
  const [runs, setRuns] = createSignal<WorkflowRun[]>([]);
  const [nextCursor, setNextCursor] = createSignal<string | null>(null);
  const [emailDeliveries, setEmailDeliveries] = createSignal<WorkflowEmailDelivery[]>([]);
  const [nextEmailCursor, setNextEmailCursor] = createSignal<string | null>(null);

  createEffect(() => setItems(props.workflows));

  const rows = createMemo(() => {
    const query = search().trim().toLowerCase();
    const workflows = [...items()].sort(
      (a, b) => a.position - b.position || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    return query ? workflows.filter((workflow) => workflowSearch(workflow).includes(query)) : workflows;
  });
  const statsByWorkflow = createMemo(() => new Map(stats().byWorkflow.map((row) => [row.workflowId, row])));

  const refreshWorkflowsMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const res = await apiClient.workflows["by-base"][":baseId"].$get(
        { param: { baseId: props.baseId } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not load workflows."));
      setItems(await res.json());
    },
    onError: (error) => prompts.error(error.message),
  });

  const statsMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const res = await apiClient.workflows["by-base"][":baseId"]["run-stats"].$get(
        { param: { baseId: props.baseId }, query: { window: statsWindow() } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not load workflow stats."));
      setStats(await res.json());
    },
    onError: (error) => prompts.error(error.message),
  });

  const fetchRuns = async (cursor?: string | null, signal?: AbortSignal): Promise<WorkflowRunPage> => {
    const res = await apiClient.workflows["by-base"][":baseId"].runs.$get(
      {
        param: { baseId: props.baseId },
        query: {
          limit: "50",
          ...(props.activeWorkflow ? { workflowId: props.activeWorkflow.id } : {}),
          ...(runStatus() !== "all" ? { status: runStatus() as WorkflowRun["status"] } : {}),
          ...(runTrigger() !== "all" ? { trigger: runTrigger() as WorkflowTriggerKind } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
      { init: { signal } },
    );
    if (!res.ok) throw new Error(await errorMessage(res, "Could not load workflow runs."));
    return res.json();
  };

  const runsMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const page = await fetchRuns(null, abortSignal);
      setRuns(page.items);
      setNextCursor(page.nextCursor ?? null);
    },
    onError: (error) => prompts.error(error.message),
  });

  const loadMoreRunsMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const cursor = nextCursor();
      if (!cursor) return;
      const page = await fetchRuns(cursor, abortSignal);
      setRuns((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor ?? null);
    },
    onError: (error) => prompts.error(error.message),
  });

  const fetchEmailDeliveries = async (cursor?: string | null, signal?: AbortSignal): Promise<WorkflowEmailDeliveryPage> => {
    const res = await apiClient.workflows["by-base"][":baseId"]["email-deliveries"].$get(
      {
        param: { baseId: props.baseId },
        query: {
          limit: "50",
          ...(props.activeWorkflow ? { workflowId: props.activeWorkflow.id } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
      { init: { signal } },
    );
    if (!res.ok) throw new Error(await errorMessage(res, "Could not load workflow email deliveries."));
    return res.json();
  };

  const emailDeliveriesMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const page = await fetchEmailDeliveries(null, abortSignal);
      setEmailDeliveries(page.items);
      setNextEmailCursor(page.nextCursor ?? null);
    },
    onError: (error) => prompts.error(error.message),
  });

  const loadMoreEmailDeliveriesMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const cursor = nextEmailCursor();
      if (!cursor) return;
      const page = await fetchEmailDeliveries(cursor, abortSignal);
      setEmailDeliveries((current) => [...current, ...page.items]);
      setNextEmailCursor(page.nextCursor ?? null);
    },
    onError: (error) => prompts.error(error.message),
  });

  const reloadAll = () => {
    refreshWorkflowsMut.mutate();
    statsMut.mutate();
    runsMut.mutate();
    emailDeliveriesMut.mutate();
  };

  const changeStatsWindow = (value: string[]) => {
    setStatsWindow((value[0] as WorkflowRunStatsWindow | undefined) ?? "24h");
    statsMut.mutate();
  };

  const changeRunStatus = (value: string[]) => {
    setRunStatus((value[0] as RunStatusFilter | undefined) ?? "all");
    runsMut.mutate();
  };

  const changeRunTrigger = (value: string[]) => {
    setRunTrigger((value[0] as RunTriggerFilter | undefined) ?? "all");
    runsMut.mutate();
  };

  onMount(reloadAll);

  const openEditor = async (workflow?: Workflow) => {
    await dialogCore.open<void>(
      (close) => (
        <WorkflowEditor
          {...props}
          workflow={workflow}
          onSaved={() => {
            props.onWorkflowChanged();
            reloadAll();
          }}
          onClose={close}
        />
      ),
      panelDialogWorkspaceOptions,
    );
  };

  const openEmailTemplates = async () => {
    await dialogCore.open<void>(
      (close) => (
        <EmailTemplateManager
          baseId={props.baseId}
          onChanged={() => {
            props.onWorkflowChanged();
          }}
          onClose={close}
        />
      ),
      panelDialogWorkspaceOptions,
    );
  };

  const scannerReturnHref = (workflow: Workflow) =>
    `/app/grids/${encodeURIComponent(props.baseShortId)}/workflows/${encodeURIComponent(workflow.shortId)}`;

  const openScanner = async (workflow: Workflow) => {
    if (!workflow.compiled.triggers.scanner || !props.canRunActiveWorkflow) return;
    await dialogCore.open<void>(
      (close) => (
        <PanelDialog surface="floating">
          <PanelDialog.Header
            title={`${workflow.name} scanner`}
            subtitle={workflow.description ?? "Workflow scanner"}
            icon="ti ti-barcode"
            close={() => close()}
          />
          <PanelDialog.Body>
            <Suspense fallback={<Placeholder>Loading scanner...</Placeholder>}>
              <WorkflowScannerSurface
                mode="dialog"
                state={
                  {
                    baseShortId: props.baseShortId,
                    workflowId: workflow.id,
                    workflowShortId: workflow.shortId,
                    workflowName: workflow.name,
                    workflowDescription: workflow.description,
                    initialCode: null,
                    returnHref: scannerReturnHref(workflow),
                  } satisfies WorkflowScannerState
                }
              />
            </Suspense>
          </PanelDialog.Body>
        </PanelDialog>
      ),
      panelDialogWorkspaceOptions,
    );
  };

  const runMut = mutations.create<WorkflowRun | null, WorkflowTriggerKind>({
    mutation: async (triggerKind, { abortSignal }) => {
      const workflow = props.activeWorkflow;
      if (!workflow) throw new Error("Choose a workflow first.");
      if (triggerKind === "schedule") {
        const res = await apiClient.workflows[":workflowId"].run.schedule.$post(
          { param: { workflowId: workflow.id } },
          { init: { signal: abortSignal } },
        );
        if (!res.ok) throw new Error(await errorMessage(res, "Could not run workflow."));
        await res.json();
        return null;
      }
      const endpoint =
        triggerKind === "api"
          ? apiClient.workflows[":workflowId"].run.api
          : triggerKind === "dashboardButton"
            ? apiClient.workflows[":workflowId"].run["dashboard-button"]
            : apiClient.workflows[":workflowId"].run.form;
      const res = await endpoint.$post({ param: { workflowId: workflow.id }, json: { input: {} } }, { init: { signal: abortSignal } });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not run workflow."));
      return res.json();
    },
    onSuccess: (run) => {
      toast.success(run ? `Workflow run ${run.status}` : "Scheduled workflow run requested");
      reloadAll();
      if (run) props.onSelectRun(run.id);
    },
    onError: (error) => prompts.error(error.message),
  });

  const activeWorkflow = () => props.activeWorkflow;
  const activeScannerWorkflow = () => {
    const workflow = activeWorkflow();
    return workflow && props.canRunActiveWorkflow && workflow.compiled.triggers.scanner ? workflow : null;
  };
  const runTriggers = () => (activeWorkflow() && props.canRunActiveWorkflow ? directRunTriggers(activeWorkflow()!) : []);

  return (
    <div class="flex-1 min-h-0 overflow-y-auto" style="scrollbar-gutter: stable" data-scroll-preserve="grids-workflows-main">
      <div class="flex flex-col gap-2">
        <div class="flex min-w-0 flex-col gap-2" style="view-transition-name: grids-workflows-title">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h1 class="min-w-0 text-base font-semibold text-primary">{activeWorkflow()?.name ?? "Workflows"}</h1>
              <p class="mt-0.5 text-xs text-dimmed">
                {activeWorkflow()?.description ??
                  "Monitor and run YAML workflows from forms, APIs, scanners, selections, schedules, and record events."}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Show when={activeWorkflow() && runTriggers().length > 0}>
                <For each={runTriggers()}>
                  {(trigger) => (
                    <button type="button" class="btn-primary btn-sm" disabled={runMut.loading()} onClick={() => runMut.mutate(trigger)}>
                      <i class={runMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-player-play"} /> Run{" "}
                      {triggerLabels[trigger] ?? trigger}
                    </button>
                  )}
                </For>
              </Show>
              <Show when={activeScannerWorkflow()}>
                {(workflow) => (
                  <button type="button" class="btn-primary btn-sm" onClick={() => void openScanner(workflow())}>
                    <i class="ti ti-barcode" /> Open Scanner
                  </button>
                )}
              </Show>
              <Show when={props.editMode && activeWorkflow() && props.canManageActiveWorkflow}>
                <button type="button" class="btn-input-success btn-input-sm" onClick={() => void openEditor(activeWorkflow()!)}>
                  <i class="ti ti-settings" /> Manage
                </button>
              </Show>
            </div>
          </div>
          <Show when={props.editMode && props.canCreateWorkflows}>
            <div class="flex items-center gap-2">
              <button type="button" class="btn-input-success btn-input-sm" onClick={() => void openEditor()}>
                <i class="ti ti-plus" /> Add workflow
              </button>
              <button type="button" class="btn-input-success btn-input-sm" onClick={() => void openEmailTemplates()}>
                <i class="ti ti-mail" /> Email templates
              </button>
            </div>
          </Show>
        </div>

        <div class="flex flex-col gap-2">
          <TextInput type="search" value={search} onInput={setSearch} icon="ti ti-search" placeholder="Search workflows..." clearable />
          <div class="flex flex-wrap items-center gap-2 text-xs text-dimmed">
            <span>{rows().length} workflows</span>
            <span>
              {stats().total} runs · {statsWindowLabels[stats().window]}
            </span>
            <FilterChip
              label="Window"
              icon="ti ti-clock"
              options={statsWindowOptions}
              value={[statsWindow()]}
              onChange={changeStatsWindow}
              defaultValue={["24h"]}
              isActive={statsWindow() !== "24h"}
            />
            <FilterChip
              label="Status"
              icon="ti ti-filter"
              options={runStatusOptions}
              value={[runStatus()]}
              onChange={changeRunStatus}
              defaultValue={["all"]}
              isActive={runStatus() !== "all"}
            />
            <FilterChip
              label="Trigger"
              icon="ti ti-bolt"
              options={runTriggerOptions}
              value={[runTrigger()]}
              onChange={changeRunTrigger}
              defaultValue={["all"]}
              isActive={runTrigger() !== "all"}
            />
            <button type="button" class="btn-simple btn-sm ml-auto" onClick={reloadAll}>
              <i class={runsMut.loading() || statsMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} /> Refresh
            </button>
          </div>
        </div>

        <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Running" value={stats().running + stats().queued} icon="player-play" />
          <StatCard label="Succeeded" value={stats().succeeded} icon="circle-check" tone="success" />
          <StatCard
            label="Error rate"
            value={formatPercent(stats().errorRate)}
            icon="alert-triangle"
            tone={stats().failed > 0 ? "danger" : "default"}
          />
          <StatCard label="P99 runtime" value={formatMetricDuration(stats().p99DurationMs)} icon="hourglass" />
        </div>

        <div class="grid min-h-0 gap-2 xl:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)]">
          <section class="paper min-h-0 overflow-hidden">
            <div class="px-3 py-2">
              <h2 class="text-sm font-semibold text-primary">{activeWorkflow() ? "Workflows" : "Workflow catalog"}</h2>
              <p class="text-xs text-dimmed">Definitions and trigger surfaces in this base.</p>
            </div>
            <div class="flex max-h-[34rem] min-h-0 flex-col gap-2 overflow-y-auto p-2">
              <For
                each={rows()}
                fallback={
                  <Placeholder align="left" class="py-8">
                    No workflows match this search.
                  </Placeholder>
                }
              >
                {(workflow) => (
                  <WorkflowCard
                    baseShortId={props.baseShortId}
                    workflow={workflow}
                    active={activeWorkflow()?.id === workflow.id}
                    stats={statsByWorkflow().get(workflow.id)}
                  />
                )}
              </For>
            </div>
          </section>

          <section class="paper min-h-0 overflow-hidden">
            <div class="flex items-center justify-between gap-2 px-3 py-2">
              <div class="min-w-0">
                <h2 class="truncate text-sm font-semibold text-primary">{activeWorkflow() ? "Workflow runs" : "Recent activity"}</h2>
                <p class="text-xs text-dimmed">
                  {activeWorkflow() ? "Executions for this workflow." : "Latest executions across visible workflows."}
                </p>
              </div>
            </div>
            <RunTimeline
              runs={runs()}
              workflows={items()}
              selectedRunId={props.selectedRunId}
              showWorkflow={!activeWorkflow()}
              loading={runsMut.loading() || loadMoreRunsMut.loading()}
              nextCursor={nextCursor()}
              onSelect={props.onSelectRun}
              onLoadMore={() => loadMoreRunsMut.mutate()}
            />
          </section>
        </div>

        <EmailDeliveryTable
          deliveries={emailDeliveries()}
          workflows={items()}
          showWorkflow={!activeWorkflow()}
          loading={emailDeliveriesMut.loading() || loadMoreEmailDeliveriesMut.loading()}
          nextCursor={nextEmailCursor()}
          onLoadMore={() => loadMoreEmailDeliveriesMut.mutate()}
        />
      </div>
    </div>
  );
}
