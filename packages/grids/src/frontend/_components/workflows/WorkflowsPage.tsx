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
import type { WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, lazy, onMount, Show, Suspense } from "solid-js";
import { apiClient } from "../../../api/client";
import type { Table } from "../../../service";
import type {
  GridsWorkflowChannel,
  GridsWorkflowLauncher,
  GridsWorkflow as Workflow,
  GridsWorkflowEmailDelivery as WorkflowEmailDelivery,
  GridsWorkflowRun as WorkflowRun,
  GridsWorkflowRunStats as WorkflowRunStats,
  GridsWorkflowRunStatsWindow as WorkflowRunStatsWindow,
} from "../../../workflows/contracts";
import { errorMessage } from "../utils/api-helpers";
import { WorkflowEditor } from "./WorkflowEditor";
import { EmailTemplateManager } from "./WorkflowEmailTemplates";
import { WorkflowLauncherManager } from "./WorkflowLauncherManager";
import { requestWorkflowRunInput } from "./WorkflowRunInputDialog";
import type { WorkflowScannerState } from "./WorkflowScannerSurface.island";
import {
  channelLabels,
  formatWorkflowRunDate as formatDate,
  formatWorkflowRunDuration as formatDuration,
  workflowRunStatusClass as statusClass,
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

type WorkflowsPageApi = {
  "by-base": {
    ":baseId": {
      $get: (input: { param: { baseId: string } }, options?: { init?: RequestInit }) => Promise<Response>;
      "run-stats": {
        $get: (input: { param: { baseId: string }; query: { window: string } }, options?: { init?: RequestInit }) => Promise<Response>;
      };
      runs: {
        $get: (input: { param: { baseId: string }; query: Record<string, string> }, options?: { init?: RequestInit }) => Promise<Response>;
      };
      "email-deliveries": {
        $get: (input: { param: { baseId: string }; query: Record<string, string> }, options?: { init?: RequestInit }) => Promise<Response>;
      };
    };
  };
  ":workflowId": {
    launchers: { $get: (input: { param: { workflowId: string } }, options?: { init?: RequestInit }) => Promise<Response> };
    invoke: {
      manual: {
        $post: (input: { param: { workflowId: string }; json: unknown }, options?: { init?: RequestInit }) => Promise<Response>;
      };
    };
  };
};

const workflowsPageApi = apiClient.workflows as unknown as WorkflowsPageApi;

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
      { value: "waiting", label: "Waiting", icon: "ti ti-hourglass" },
      { value: "succeeded", label: "Succeeded", icon: "ti ti-circle-check" },
      { value: "failed", label: "Failed", icon: "ti ti-alert-circle" },
      { value: "needs_attention", label: "Needs attention", icon: "ti ti-alert-triangle" },
      { value: "canceled", label: "Canceled", icon: "ti ti-ban" },
    ],
  },
];

const runChannelOptions: FilterChipSection[] = [
  {
    options: [
      { value: "all", label: "All channels", icon: "ti ti-list" },
      ...Object.entries(channelLabels).map(([value, label]) => ({ value, label, icon: "ti ti-route" })),
    ],
  },
];

type RunStatusFilter = "all" | WorkflowRun["status"];
type RunChannelFilter = "all" | GridsWorkflowChannel;

const formatMetricDuration = (ms: number | null): string => {
  if (ms === null) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return `${Math.round(ms / 60_000)}m`;
};

const formatPercent = (value: number): string => `${value.toFixed(value >= 10 ? 0 : 1)}%`;

const triggerSummary = (workflow: Workflow): string => {
  const triggers = workflow.plan.triggers.map((trigger) => trigger.kind);
  if (triggers.length === 0) return "No trigger";
  return triggers.map((trigger) => (trigger === "recordEvent" ? "Record event" : "Schedule")).join(", ");
};

const workflowTriggers = (workflow: Workflow): string[] => workflow.plan.triggers.map((trigger) => trigger.kind);

const workflowSearch = (workflow: Workflow): string =>
  [workflow.name, workflow.description ?? "", workflow.source, triggerSummary(workflow)].join(" ").toLowerCase();

const emptyStats = (): WorkflowRunStats => ({
  window: "24h",
  total: 0,
  queued: 0,
  running: 0,
  waiting: 0,
  succeeded: 0,
  failed: 0,
  canceled: 0,
  needsAttention: 0,
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
          <For each={workflowTriggers(props.workflow)}>
            {(trigger) => <span class="tag">{trigger === "recordEvent" ? "Record event" : "Schedule"}</span>}
          </For>
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
                  {props.showWorkflow ? (workflow()?.name ?? "Deleted workflow") : (channelLabels[run.channel] ?? run.channel)}
                </span>
                <span class="mt-0.5 block truncate text-dimmed">
                  {props.showWorkflow ? `${channelLabels[run.channel] ?? run.channel} · ` : ""}
                  {formatDate(run.createdAt)}
                </span>
                <Show when={run.error}>
                  {(error) => <span class="mt-1 block truncate text-red-600 dark:text-red-400">{error().message}</span>}
                </Show>
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
  const [runChannel, setRunChannel] = createSignal<RunChannelFilter>("all");
  const [items, setItems] = createSignal<Workflow[]>(props.workflows);
  const [launchers, setLaunchers] = createSignal<GridsWorkflowLauncher[]>([]);
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
      const res = await workflowsPageApi["by-base"][":baseId"].$get({ param: { baseId: props.baseId } }, { init: { signal: abortSignal } });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not load workflows."));
      setItems((await res.json()) as Workflow[]);
    },
    onError: (error) => prompts.error(error.message),
  });

  const statsMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const res = await workflowsPageApi["by-base"][":baseId"]["run-stats"].$get(
        { param: { baseId: props.baseId }, query: { window: statsWindow() } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not load workflow stats."));
      setStats((await res.json()) as WorkflowRunStats);
    },
    onError: (error) => prompts.error(error.message),
  });

  const fetchRuns = async (cursor?: string | null, signal?: AbortSignal): Promise<WorkflowRunPage> => {
    const res = await workflowsPageApi["by-base"][":baseId"].runs.$get(
      {
        param: { baseId: props.baseId },
        query: {
          limit: "50",
          ...(props.activeWorkflow ? { workflowId: props.activeWorkflow.id } : {}),
          ...(runStatus() !== "all" ? { status: runStatus() as WorkflowRun["status"] } : {}),
          ...(runChannel() !== "all" ? { channel: runChannel() as GridsWorkflowChannel } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
      { init: { signal } },
    );
    if (!res.ok) throw new Error(await errorMessage(res, "Could not load workflow runs."));
    return (await res.json()) as WorkflowRunPage;
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
    const res = await workflowsPageApi["by-base"][":baseId"]["email-deliveries"].$get(
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
    return (await res.json()) as WorkflowEmailDeliveryPage;
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

  const launchersMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const workflow = props.activeWorkflow;
      if (!workflow) {
        setLaunchers([]);
        return;
      }
      const res = await workflowsPageApi[":workflowId"].launchers.$get(
        { param: { workflowId: workflow.id } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not load workflow launchers."));
      setLaunchers(((await res.json()) as { items: GridsWorkflowLauncher[] }).items);
    },
    onError: (error) => prompts.error(error.message),
  });

  const reloadAll = () => {
    refreshWorkflowsMut.mutate();
    statsMut.mutate();
    runsMut.mutate();
    emailDeliveriesMut.mutate();
    launchersMut.mutate();
  };

  const changeStatsWindow = (value: string[]) => {
    setStatsWindow((value[0] as WorkflowRunStatsWindow | undefined) ?? "24h");
    statsMut.mutate();
  };

  const changeRunStatus = (value: string[]) => {
    setRunStatus((value[0] as RunStatusFilter | undefined) ?? "all");
    runsMut.mutate();
  };

  const changeRunChannel = (value: string[]) => {
    setRunChannel((value[0] as RunChannelFilter | undefined) ?? "all");
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

  const openLaunchers = async (workflow: Workflow) => {
    await dialogCore.open<void>(
      (close) => (
        <WorkflowLauncherManager
          workflow={workflow}
          onChanged={() => {
            props.onWorkflowChanged();
            reloadAll();
          }}
          onClose={close}
        />
      ),
      panelDialogWorkspaceOptions,
    );
  };

  const scannerReturnHref = (workflow: Workflow) =>
    `/app/grids/${encodeURIComponent(props.baseShortId)}/workflows/${encodeURIComponent(workflow.shortId)}`;

  const openScanner = async (workflow: Workflow, launcher: GridsWorkflowLauncher) => {
    if (launcher.config.kind !== "scanner" || !props.canRunActiveWorkflow) return;
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
                    launcherId: launcher.id,
                    expectedRevision: workflow.revision,
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

  const runMut = mutations.create<
    { runId: string; status: WorkflowRun["status"] },
    { input: Record<string, unknown>; mode: "execute" | "dryRun" }
  >({
    mutation: async ({ input, mode }, { abortSignal }) => {
      const workflow = props.activeWorkflow;
      if (!workflow) throw new Error("Choose a workflow first.");
      const res = await workflowsPageApi[":workflowId"].invoke.manual.$post(
        {
          param: { workflowId: workflow.id },
          json: {
            mode,
            inputs: input as Record<string, WorkflowJsonValue>,
            idempotencyKey: crypto.randomUUID(),
            expectedRevision: workflow.revision,
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not run workflow."));
      return (await res.json()) as { runId: string; status: WorkflowRun["status"] };
    },
    onSuccess: (receipt) => {
      toast.success(`Workflow run ${receipt.status}`);
      reloadAll();
      props.onSelectRun(receipt.runId);
    },
    onError: (error) => prompts.error(error.message),
  });

  const activeWorkflow = () => props.activeWorkflow;
  const scannerLaunchers = createMemo(() => launchers().filter((launcher) => launcher.enabled && launcher.config.kind === "scanner"));
  const runWorkflow = async (mode: "execute" | "dryRun" = "execute") => {
    const workflow = activeWorkflow();
    if (!workflow) return;
    const input = await requestWorkflowRunInput({ workflow, tables: props.tables });
    if (input === undefined) return;
    runMut.mutate({ input, mode });
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
                  "Monitor and run workflows directly or through scanners, selections, dashboards, schedules, and record events."}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Show when={activeWorkflow() && props.canRunActiveWorkflow}>
                <button
                  type="button"
                  class="btn-primary btn-sm"
                  disabled={runMut.loading() || activeWorkflow()?.enabled !== true}
                  onClick={() => void runWorkflow()}
                >
                  <i class={runMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-player-play"} /> Run workflow
                </button>
                <button type="button" class="btn-input btn-sm" disabled={runMut.loading()} onClick={() => void runWorkflow("dryRun")}>
                  <i class="ti ti-flask" /> Dry run
                </button>
              </Show>
              <For each={scannerLaunchers()}>
                {(launcher) => (
                  <button type="button" class="btn-input btn-sm" onClick={() => void openScanner(activeWorkflow()!, launcher)}>
                    <i class="ti ti-barcode" /> {launcher.name}
                  </button>
                )}
              </For>
              <Show when={props.editMode && activeWorkflow() && props.canManageActiveWorkflow}>
                <button type="button" class="btn-input-success btn-input-sm" onClick={() => void openLaunchers(activeWorkflow()!)}>
                  <i class="ti ti-rocket" /> Launchers
                </button>
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
              label="Channel"
              icon="ti ti-route"
              options={runChannelOptions}
              value={[runChannel()]}
              onChange={changeRunChannel}
              defaultValue={["all"]}
              isActive={runChannel() !== "all"}
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
              <p class="text-xs text-dimmed">Definitions and automatic triggers in this base.</p>
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
