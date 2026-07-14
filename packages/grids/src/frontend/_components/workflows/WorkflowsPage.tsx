import {
  DataTable,
  type DataTableColumn,
  dialogCore,
  FilterChip,
  type FilterChipSection,
  PanelDialog,
  Placeholder,
  panelDialogWorkspaceOptions,
  prompts,
  StatCell,
  StatGrid,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, lazy, onMount, Show, Suspense } from "solid-js";
import { apiClient } from "../../../api/client";
import type {
  Workflow,
  WorkflowEmailDelivery,
  WorkflowRun,
  WorkflowRunStats,
  WorkflowRunStatsWindow,
  WorkflowTriggerKind,
} from "../../../contracts";
import type { Table } from "../../../service";
import { errorMessage } from "../utils/api-helpers";
import { WorkflowEditor } from "./WorkflowEditor";
import { EmailTemplateManager } from "./WorkflowEmailTemplates";
import { requestWorkflowRunInput } from "./WorkflowRunInputDialog";
import type { WorkflowScannerState } from "./WorkflowScannerSurface.island";
import {
  formatWorkflowRunDate as formatDate,
  formatWorkflowRunDuration as formatDuration,
  workflowRunStatusClass as statusClass,
  triggerLabels,
} from "./workflow-display";
import { activeWorkflowTriggers, directWorkflowRunTriggers } from "./workflow-trigger-actions";

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

const formatMetricDuration = (ms: number | null): string => {
  if (ms === null) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return `${Math.round(ms / 60_000)}m`;
};

const formatPercent = (value: number): string => `${value.toFixed(value >= 10 ? 0 : 1)}%`;

const triggerSummary = (workflow: Workflow): string => {
  const triggers = activeWorkflowTriggers(workflow.compiled);
  if (triggers.length === 0) return "No trigger";
  return triggers.map((trigger) => triggerLabels[trigger] ?? trigger).join(", ");
};

const workflowTriggers = (workflow: Workflow): WorkflowTriggerKind[] => activeWorkflowTriggers(workflow.compiled);

const workflowSearch = (workflow: Workflow): string =>
  [workflow.name, workflow.description ?? "", workflow.source, triggerSummary(workflow)].join(" ").toLowerCase();

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
      aria-current={props.active ? "page" : undefined}
      class={`flex min-w-0 items-start gap-3 rounded-[var(--ui-radius-control)] px-3 py-2 text-left transition-colors ${
        props.active ? "list-item-active" : "hover:bg-[var(--ui-hover)]"
      }`}
    >
      <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] text-secondary">
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
    <div class="flex min-h-0 flex-col gap-1 p-1">
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
              aria-pressed={props.selectedRunId === run.id}
              class={`grid w-full grid-cols-[auto_1fr_auto] items-start gap-3 rounded-[var(--ui-radius-control)] px-3 py-2 text-left text-xs transition-colors ${
                props.selectedRunId === run.id ? "list-item-active" : "hover:bg-[var(--ui-hover)]"
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
        <div class="px-3 py-2 text-center">
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
  const columns = createMemo<DataTableColumn<WorkflowEmailDelivery>[]>(() => [
    { id: "status", header: "Status", value: (delivery) => delivery.status },
    ...(props.showWorkflow
      ? [{ id: "workflow", header: "Workflow", value: (delivery: WorkflowEmailDelivery) => delivery.workflowId }]
      : []),
    { id: "subject", header: "Subject", value: (delivery) => delivery.subject, cellClass: "max-w-72" },
    { id: "recipients", header: "Recipients", value: recipients, cellClass: "max-w-72" },
    { id: "sent", header: "Sent", value: (delivery) => delivery.createdAt, cellClass: "whitespace-nowrap" },
  ]);
  return (
    <section class="paper min-h-0 overflow-hidden">
      <div class="flex items-center justify-between gap-2 px-3 py-2">
        <div class="min-w-0">
          <h2 class="truncate text-sm font-semibold text-primary">Email deliveries</h2>
          <p class="text-xs text-dimmed">Workflow sendEmail audit trail.</p>
        </div>
      </div>
      <DataTable
        rows={props.deliveries}
        columns={columns()}
        getRowId={(delivery) => delivery.id}
        density="compact"
        highlightColumns={false}
        class="max-h-[34rem] min-h-0 overflow-auto"
        hasMore={!!props.nextCursor}
        loadingMore={props.loading}
        onLoadMore={props.onLoadMore}
        empty={props.loading ? "Loading email deliveries..." : "No workflow emails sent yet."}
        renderCell={({ row: delivery, col, render, value }) => {
          if (col.id === "status") {
            return (
              <span class="flex min-w-0 flex-col items-start gap-1">
                <span class={`badge ${delivery.status === "failed" ? "badge-danger" : "badge-success"}`}>{delivery.status}</span>
                <Show when={delivery.error}>
                  {(error) => <span class="block max-w-48 truncate text-red-600 dark:text-red-400">{error()}</span>}
                </Show>
              </span>
            );
          }
          if (col.id === "workflow") {
            return delivery.workflowId ? (workflowById().get(delivery.workflowId)?.name ?? "Deleted workflow") : "-";
          }
          if (col.id === "sent") return <span class="text-dimmed">{formatDate(delivery.createdAt)}</span>;
          if (col.id === "recipients") return <span class="text-dimmed">{recipients(delivery)}</span>;
          return render(value);
        }}
      />
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
          baseId={props.baseId}
          baseShortId={props.baseShortId}
          tables={props.tables}
          workflow={workflow}
          onSaved={() => {
            props.onWorkflowChanged();
            reloadAll();
          }}
          onClose={close}
        />
      ),
      { ...panelDialogWorkspaceOptions, cancelBehavior: "ignore" },
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

  const runMut = mutations.create<WorkflowRun | null, { triggerKind: WorkflowTriggerKind; input: Record<string, unknown> }>({
    mutation: async ({ triggerKind, input }, { abortSignal }) => {
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
      const res = await endpoint.$post({ param: { workflowId: workflow.id }, json: { input } }, { init: { signal: abortSignal } });
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
  const runTriggers = () => (activeWorkflow() && props.canRunActiveWorkflow ? directWorkflowRunTriggers(activeWorkflow()!.compiled) : []);
  const runWorkflow = async (triggerKind: WorkflowTriggerKind) => {
    const workflow = activeWorkflow();
    if (!workflow) return;
    const input =
      triggerKind === "form" || triggerKind === "api" ? await requestWorkflowRunInput({ workflow, triggerKind, tables: props.tables }) : {};
    if (input === undefined) return;
    runMut.mutate({ triggerKind, input });
  };

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
                    <button type="button" class="btn-primary btn-sm" disabled={runMut.loading()} onClick={() => void runWorkflow(trigger)}>
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

        <StatGrid columns={4} size="sm">
          <StatCell label="Running" value={stats().running + stats().queued} accent={{ tone: "blue", icon: "ti ti-player-play" }} />
          <StatCell label="Succeeded" value={stats().succeeded} accent={{ tone: "emerald", icon: "ti ti-circle-check" }} />
          <StatCell
            label="Error rate"
            value={formatPercent(stats().errorRate)}
            valueClass={stats().failed > 0 ? "text-red-600 dark:text-red-400" : undefined}
            accent={stats().failed > 0 ? { tone: "red", icon: "ti ti-alert-triangle" } : undefined}
          />
          <StatCell
            label="P99 runtime"
            value={formatMetricDuration(stats().p99DurationMs)}
            accent={{ tone: "zinc", icon: "ti ti-hourglass" }}
          />
        </StatGrid>

        <div class="grid min-h-0 gap-2 xl:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)]">
          <section class="paper min-h-0 overflow-hidden">
            <div class="px-3 py-2">
              <h2 class="text-sm font-semibold text-primary">{activeWorkflow() ? "Workflows" : "Workflow catalog"}</h2>
              <p class="text-xs text-dimmed">Definitions and trigger surfaces in this base.</p>
            </div>
            <div class="flex max-h-[34rem] min-h-0 flex-col gap-1 overflow-y-auto p-1">
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
