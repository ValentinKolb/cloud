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
} from "@valentinkolb/cloud/ui";
import type { WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, lazy, onCleanup, onMount, Show, Suspense } from "solid-js";
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
  WorkflowTriggerRuntimeState,
} from "../../../workflows/contracts";
import { errorMessage } from "../utils/api-helpers";
import type { WorkspaceWorkflowOverview } from "../workspace/workspace-state-model";
import { WorkflowAutomaticTriggerState } from "./WorkflowAutomaticTriggerState";
import { WorkflowEditor } from "./WorkflowEditor";
import { WorkflowLauncherManager } from "./WorkflowLauncherManager";
import { WorkflowRevisionHistory } from "./WorkflowRevisionHistory";
import { requestWorkflowRunInput } from "./WorkflowRunInputDialog";
import type { WorkflowScannerState } from "./WorkflowScannerSurface";
import {
  channelLabels,
  formatWorkflowRunDate as formatDate,
  formatWorkflowRunDuration as formatDuration,
  isTerminalWorkflowRunStatus,
  workflowRunStatusClass as statusClass,
} from "./workflow-display";
import { reconcileWorkflowRunList, type WorkflowRunListFilter } from "./workflow-run-list";
import {
  parseWorkflowUrlState,
  type WorkflowRunChannelFilter,
  type WorkflowRunStatusFilter,
  type WorkflowUrlState,
  workflowUrlStateHref,
} from "./workflow-url-state";

const WorkflowScannerSurface = lazy(() => import("./WorkflowScannerSurface"));

type Props = {
  baseId: string;
  baseShortId: string;
  tables: Table[];
  activeWorkflow: Workflow | null;
  selectedRunId: string | null;
  runUpdate: WorkflowRun | null;
  canCreateWorkflows: boolean;
  canRunActiveWorkflow: boolean;
  canManageActiveWorkflow: boolean;
  editMode: boolean;
  initialOverview: WorkspaceWorkflowOverview;
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
    "trigger-state": { $get: (input: { param: { workflowId: string } }, options?: { init?: RequestInit }) => Promise<Response> };
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

type WorkflowLoadArea = "stats" | "runs" | "launchers" | "triggers";

const formatMetricDuration = (ms: number | null): string => {
  if (ms === null) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return `${Math.round(ms / 60_000)}m`;
};

const formatPercent = (value: number): string => `${value.toFixed(value >= 10 ? 0 : 1)}%`;

const triggerSummary = (workflow: Workflow): string => {
  const triggers = workflow.plan.triggers.map((trigger) => trigger.kind);
  if (triggers.length === 0) return "No automatic trigger";
  return triggers.map((trigger) => (trigger === "recordEvent" ? "Record event" : "Schedule")).join(", ");
};

function EmailDeliveryTable(props: {
  deliveries: WorkflowEmailDelivery[];
  loading?: boolean;
  nextCursor?: string | null;
  onLoadMore?: () => void;
}) {
  const recipients = (delivery: WorkflowEmailDelivery) =>
    delivery.recipients.map((recipient) => `${recipient.kind}:${recipient.recipient}`).join(", ") || "-";
  const columns = createMemo<DataTableColumn<WorkflowEmailDelivery>[]>(() => [
    { id: "status", header: "Status", value: (delivery) => delivery.status },
    { id: "subject", header: "Subject", value: (delivery) => delivery.subject, cellClass: "max-w-72" },
    { id: "recipients", header: "Recipients", value: recipients, cellClass: "max-w-72" },
    { id: "sent", header: "Sent", value: (delivery) => delivery.createdAt, cellClass: "whitespace-nowrap" },
  ]);
  return (
    <section class="flex min-h-0 flex-1 flex-col">
      <DataTable
        rows={props.deliveries}
        columns={columns()}
        getRowId={(delivery) => delivery.id}
        density="compact"
        highlightColumns={false}
        class="paper min-h-[20rem] flex-1 overflow-auto"
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
          if (col.id === "sent") return <span class="text-dimmed">{formatDate(delivery.createdAt)}</span>;
          if (col.id === "recipients") return <span class="text-dimmed">{recipients(delivery)}</span>;
          return render(value);
        }}
      />
    </section>
  );
}

export default function WorkflowsPage(props: Props) {
  const [statsWindow, setStatsWindow] = createSignal<WorkflowRunStatsWindow>(props.initialOverview.filters.window);
  const [runStatus, setRunStatus] = createSignal<WorkflowRunStatusFilter>(props.initialOverview.filters.status);
  const [runChannel, setRunChannel] = createSignal<WorkflowRunChannelFilter>(props.initialOverview.filters.channel);
  const [launchers, setLaunchers] = createSignal<GridsWorkflowLauncher[]>(props.initialOverview.launchers);
  const [triggerState, setTriggerState] = createSignal<WorkflowTriggerRuntimeState | null>(props.initialOverview.triggerState);
  const [stats, setStats] = createSignal<WorkflowRunStats | null>(props.initialOverview.stats);
  const [runs, setRuns] = createSignal<WorkflowRun[]>(props.initialOverview.runs.items);
  const [nextCursor, setNextCursor] = createSignal<string | null>(props.initialOverview.runs.nextCursor);
  const [emailDeliveries, setEmailDeliveries] = createSignal<WorkflowEmailDelivery[]>([]);
  const [nextEmailCursor, setNextEmailCursor] = createSignal<string | null>(null);
  const [emailLoadError, setEmailLoadError] = createSignal<string | null>(null);
  const [emailActivityOpen, setEmailActivityOpen] = createSignal(false);
  const [loadErrors, setLoadErrors] = createSignal<Partial<Record<WorkflowLoadArea, string>>>({});

  const activeStats = createMemo(() => {
    const workflow = props.activeWorkflow;
    return workflow ? (stats()?.byWorkflow.find((row) => row.workflowId === workflow.id) ?? null) : null;
  });
  const loadError = createMemo(() => Object.values(loadErrors())[0] ?? null);
  const setLoadFailure = (area: WorkflowLoadArea, message?: string) => {
    setLoadErrors((current) => {
      const next = { ...current };
      if (message) next[area] = message;
      else delete next[area];
      return next;
    });
  };
  const currentRunFilter = (): WorkflowRunListFilter => {
    const status = runStatus();
    const channel = runChannel();
    return {
      workflowId: props.activeWorkflow?.id ?? null,
      status: status === "all" ? null : status,
      channel: channel === "all" ? null : channel,
    };
  };

  const statsMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const res = await workflowsPageApi["by-base"][":baseId"]["run-stats"].$get(
        { param: { baseId: props.baseId }, query: { window: statsWindow() } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not load workflow stats."));
      setStats((await res.json()) as WorkflowRunStats);
    },
    onSuccess: () => setLoadFailure("stats"),
    onError: (error) => setLoadFailure("stats", error.message),
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

  const runsMut = mutations.create<WorkflowRunPage, void>({
    mutation: async (_, { abortSignal }) => {
      return fetchRuns(null, abortSignal);
    },
    onSuccess: (page) => {
      setRuns(reconcileWorkflowRunList(page.items, props.runUpdate, currentRunFilter(), true));
      setNextCursor(page.nextCursor ?? null);
      setLoadFailure("runs");
    },
    onError: (error) => setLoadFailure("runs", error.message),
  });

  const loadMoreRunsMut = mutations.create<WorkflowRunPage | null, void>({
    mutation: async (_, { abortSignal }) => {
      const cursor = nextCursor();
      return cursor ? fetchRuns(cursor, abortSignal) : null;
    },
    onSuccess: (page) => {
      if (!page) return;
      setRuns((current) => reconcileWorkflowRunList([...current, ...page.items], props.runUpdate, currentRunFilter(), true));
      setNextCursor(page.nextCursor ?? null);
      setLoadFailure("runs");
    },
    onError: (error) => setLoadFailure("runs", error.message),
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
    onSuccess: () => setEmailLoadError(null),
    onError: (error) => setEmailLoadError(error.message),
  });

  let appliedRunUpdate = "";
  createEffect(() => {
    const update = props.runUpdate;
    if (!update) return;
    const signature = `${update.id}:${update.status}:${update.finishedAt ?? ""}:${update.error?.message ?? ""}`;
    if (signature === appliedRunUpdate) return;
    appliedRunUpdate = signature;

    setRuns((current) => reconcileWorkflowRunList(current, update, currentRunFilter(), true));

    if (isTerminalWorkflowRunStatus(update.status)) {
      statsMut.mutate();
      if (emailActivityOpen()) emailDeliveriesMut.mutate();
    }
  });

  const loadMoreEmailDeliveriesMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const cursor = nextEmailCursor();
      if (!cursor) return;
      const page = await fetchEmailDeliveries(cursor, abortSignal);
      setEmailDeliveries((current) => [...current, ...page.items]);
      setNextEmailCursor(page.nextCursor ?? null);
    },
    onSuccess: () => setEmailLoadError(null),
    onError: (error) => setEmailLoadError(error.message),
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
    onSuccess: () => setLoadFailure("launchers"),
    onError: (error) => setLoadFailure("launchers", error.message),
  });

  const triggerStateMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const workflow = props.activeWorkflow;
      if (!workflow) {
        setTriggerState(null);
        return;
      }
      const response = await workflowsPageApi[":workflowId"]["trigger-state"].$get(
        { param: { workflowId: workflow.id } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not load automatic trigger state."));
      setTriggerState((await response.json()) as WorkflowTriggerRuntimeState);
    },
    onSuccess: () => setLoadFailure("triggers"),
    onError: (error) => setLoadFailure("triggers", error.message),
  });

  const reloadAll = () => {
    setLoadErrors({});
    statsMut.mutate();
    runsMut.mutate();
    launchersMut.mutate();
    triggerStateMut.mutate();
  };

  const currentUrlState = (): WorkflowUrlState => ({
    window: statsWindow(),
    status: runStatus(),
    channel: runChannel(),
  });

  const pushUrlState = (state: WorkflowUrlState) => {
    const href = workflowUrlStateHref(new URL(window.location.href), state);
    window.history.pushState(window.history.state, "", href);
  };

  const changeStatsWindow = (value: string[]) => {
    const next = (value[0] as WorkflowRunStatsWindow | undefined) ?? "24h";
    if (next === statsWindow()) return;
    setStatsWindow(next);
    pushUrlState(currentUrlState());
    statsMut.mutate();
  };

  const changeRunStatus = (value: string[]) => {
    const next = (value[0] as WorkflowRunStatusFilter | undefined) ?? "all";
    if (next === runStatus()) return;
    setRunStatus(next);
    pushUrlState(currentUrlState());
    runsMut.mutate();
  };

  const changeRunChannel = (value: string[]) => {
    const next = (value[0] as WorkflowRunChannelFilter | undefined) ?? "all";
    if (next === runChannel()) return;
    setRunChannel(next);
    pushUrlState(currentUrlState());
    runsMut.mutate();
  };

  onMount(() => {
    const onPopState = () => {
      const next = parseWorkflowUrlState(new URL(window.location.href).searchParams);
      const refreshStats = next.window !== statsWindow();
      const refreshRuns = next.status !== runStatus() || next.channel !== runChannel();

      setStatsWindow(next.window);
      setRunStatus(next.status);
      setRunChannel(next.channel);
      if (refreshStats) statsMut.mutate();
      if (refreshRuns) runsMut.mutate();
    };

    window.addEventListener("popstate", onPopState);
    onCleanup(() => window.removeEventListener("popstate", onPopState));
  });

  const openEditor = async (workflow: Workflow) => {
    await dialogCore.open<void>(
      (close) => (
        <WorkflowEditor
          baseId={props.baseId}
          baseShortId={props.baseShortId}
          tables={props.tables}
          workflow={workflow}
          onChanged={() => props.onWorkflowChanged()}
          onClose={close}
        />
      ),
      { ...panelDialogWorkspaceOptions, cancelBehavior: "ignore" },
    );
  };

  const openLaunchers = async (workflow: Workflow) => {
    await dialogCore.open<void>(
      (close) => <WorkflowLauncherManager workflow={workflow} tables={props.tables} onChanged={props.onWorkflowChanged} onClose={close} />,
      panelDialogWorkspaceOptions,
    );
  };

  const openHistory = async (workflow: Workflow) => {
    await dialogCore.open<void>(
      (close) => (
        <WorkflowRevisionHistory
          workflow={workflow}
          canRestore={props.canManageActiveWorkflow}
          onChanged={props.onWorkflowChanged}
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
      props.onSelectRun(receipt.runId);
      runsMut.mutate();
      statsMut.mutate();
    },
    onError: (error) => prompts.error(error.message),
  });

  const activeWorkflow = () => props.activeWorkflow;
  const scannerLaunchers = createMemo(() => launchers().filter((launcher) => launcher.enabled && launcher.config.kind === "scanner"));
  const runWorkflow = async (mode: "execute" | "dryRun" = "execute") => {
    const workflow = activeWorkflow();
    if (!workflow) return;
    const input = await requestWorkflowRunInput({ workflow, tables: props.tables, mode });
    if (input === undefined) return;
    runMut.mutate({ input, mode });
  };

  const runColumns = createMemo<DataTableColumn<WorkflowRun>[]>(() => [
    { id: "status", header: "Status", value: (run) => run.status, cellClass: "whitespace-nowrap" },
    { id: "started", header: "Started", value: (run) => run.createdAt, cellClass: "whitespace-nowrap" },
    { id: "channel", header: "Channel", value: (run) => run.channel, cellClass: "whitespace-nowrap" },
    { id: "mode", header: "Mode", value: (run) => run.mode, cellClass: "whitespace-nowrap" },
    { id: "result", header: "Result", value: (run) => run.error?.message ?? run.resultMessage, cellClass: "max-w-[32rem]" },
    { id: "duration", header: "Duration", value: (run) => formatDuration(run), cellClass: "whitespace-nowrap" },
    { id: "revision", header: "Revision", value: (run) => run.workflowRevision, align: "right" },
  ]);

  const openEmailActivity = async () => {
    const workflow = activeWorkflow();
    if (!workflow) return;
    setEmailDeliveries([]);
    setNextEmailCursor(null);
    setEmailLoadError(null);
    setEmailActivityOpen(true);
    emailDeliveriesMut.mutate();
    try {
      await dialogCore.open<void>(
        (close) => (
          <PanelDialog surface="floating">
            <PanelDialog.Header
              title="Email activity"
              subtitle={`Messages sent by ${workflow.name}`}
              icon="ti ti-mail"
              close={() => close()}
            />
            <PanelDialog.Body>
              <div class="flex min-h-[24rem] flex-1 flex-col gap-2">
                <Show when={emailLoadError()}>
                  {(message) => (
                    <div class="info-block-danger flex items-center justify-between gap-3 text-sm" role="alert">
                      <span>{message()}</span>
                      <button type="button" class="btn-simple btn-sm shrink-0" onClick={() => emailDeliveriesMut.mutate()}>
                        <i class="ti ti-refresh" aria-hidden="true" /> Retry
                      </button>
                    </div>
                  )}
                </Show>
                <EmailDeliveryTable
                  deliveries={emailDeliveries()}
                  loading={emailDeliveriesMut.loading() || loadMoreEmailDeliveriesMut.loading()}
                  nextCursor={nextEmailCursor()}
                  onLoadMore={() => loadMoreEmailDeliveriesMut.mutate()}
                />
              </div>
            </PanelDialog.Body>
          </PanelDialog>
        ),
        panelDialogWorkspaceOptions,
      );
    } finally {
      setEmailActivityOpen(false);
      emailDeliveriesMut.abort();
      loadMoreEmailDeliveriesMut.abort();
    }
  };

  return (
    <Show
      when={activeWorkflow()}
      fallback={
        <div class="flex min-h-0 flex-1">
          <Placeholder
            surface="paper"
            class="flex-1"
            title="No workflows yet"
            description={
              props.editMode ? "Create a workflow from the Workflows section in the sidebar." : "Turn on Edit mode to create a workflow."
            }
          />
        </div>
      }
    >
      {(workflow) => (
        <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden" data-scroll-preserve="grids-workflow-runs">
          <header class="flex min-w-0 flex-col gap-2" style="view-transition-name: grids-workflows-title">
            <div class="min-w-0">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <h1 class="min-w-0 truncate text-base font-semibold text-primary">{workflow().name}</h1>
                <span class={`badge ${workflow().enabled ? "badge-success" : "badge-neutral"}`}>
                  {workflow().enabled ? "enabled" : "disabled"}
                </span>
                <span class="tag">{triggerSummary(workflow())}</span>
              </div>
              <Show when={workflow().description}>{(description) => <p class="mt-0.5 text-xs text-dimmed">{description()}</p>}</Show>
            </div>
            <div class="flex min-w-0 flex-wrap items-center gap-2" role="toolbar" aria-label="Workflow actions">
              <Show when={props.canRunActiveWorkflow}>
                <button
                  type="button"
                  class="btn-primary btn-sm shrink-0"
                  disabled={runMut.loading() || !workflow().enabled}
                  onClick={() => void runWorkflow()}
                >
                  <i class={runMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-player-play"} /> Run workflow
                </button>
                <button
                  type="button"
                  class="btn-input btn-sm shrink-0"
                  disabled={runMut.loading()}
                  onClick={() => void runWorkflow("dryRun")}
                >
                  <i class="ti ti-flask" /> Dry run
                </button>
                <For each={scannerLaunchers()}>
                  {(launcher) => (
                    <button type="button" class="btn-input btn-sm shrink-0" onClick={() => void openScanner(workflow(), launcher)}>
                      <i class="ti ti-barcode" /> {launcher.name}
                    </button>
                  )}
                </For>
              </Show>
              <Show when={props.editMode && props.canManageActiveWorkflow}>
                <button type="button" class="btn-input-success btn-input-sm shrink-0" onClick={() => void openLaunchers(workflow())}>
                  <i class="ti ti-rocket" /> Run options
                </button>
                <button type="button" class="btn-input-success btn-input-sm shrink-0" onClick={() => void openHistory(workflow())}>
                  <i class="ti ti-history" /> History
                </button>
                <button type="button" class="btn-input-success btn-input-sm shrink-0" onClick={() => void openEditor(workflow())}>
                  <i class="ti ti-settings" /> Manage
                </button>
              </Show>
            </div>
          </header>

          <Show when={triggerState() && (triggerState()!.schedule || triggerState()!.recordEvents.length > 0) ? triggerState() : null}>
            {(state) => <WorkflowAutomaticTriggerState state={state()} tables={props.tables} />}
          </Show>

          <Show when={loadError()}>
            {(message) => (
              <div class="info-block-danger flex items-center justify-between gap-3 text-sm" role="alert">
                <span>{message()}</span>
                <button type="button" class="btn-simple btn-sm shrink-0" onClick={reloadAll}>
                  <i class="ti ti-refresh" aria-hidden="true" /> Retry
                </button>
              </div>
            )}
          </Show>

          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs text-dimmed">Health over {statsWindowLabels[statsWindow()]}</span>
            <FilterChip
              label="Metrics window"
              icon="ti ti-clock"
              options={statsWindowOptions}
              value={[statsWindow()]}
              onChange={changeStatsWindow}
              defaultValue={["24h"]}
              isActive={statsWindow() !== "24h"}
            />
          </div>

          <Show
            when={stats()}
            fallback={
              <Placeholder
                surface="paper"
                state={statsMut.loading() ? "loading" : "error"}
                title={statsMut.loading() ? "Loading workflow statistics" : "Workflow statistics unavailable"}
              />
            }
          >
            <StatGrid columns={5} size="sm">
              <StatCell
                label="Last run"
                value={activeStats()?.latestStatus?.replaceAll("_", " ") ?? "No runs"}
                sub={activeStats()?.lastRunAt ? formatDate(activeStats()?.lastRunAt ?? "") : statsWindowLabels[statsWindow()]}
                valueClass={
                  activeStats()?.latestStatus === "failed" || activeStats()?.latestStatus === "needs_attention"
                    ? "text-red-600 dark:text-red-400"
                    : undefined
                }
              />
              <StatCell label="Runs" value={activeStats()?.total ?? 0} accent={{ tone: "zinc", icon: "ti ti-list" }} />
              <StatCell
                label="Active"
                value={(activeStats()?.running ?? 0) + (activeStats()?.queued ?? 0) + (activeStats()?.waiting ?? 0)}
                accent={{ tone: "blue", icon: "ti ti-player-play" }}
              />
              <StatCell
                label="Error rate"
                value={formatPercent(activeStats()?.errorRate ?? 0)}
                valueClass={
                  (activeStats()?.failed ?? 0) + (activeStats()?.needsAttention ?? 0) > 0 ? "text-red-600 dark:text-red-400" : undefined
                }
                accent={
                  (activeStats()?.failed ?? 0) + (activeStats()?.needsAttention ?? 0) > 0
                    ? { tone: "red", icon: "ti ti-alert-triangle" }
                    : undefined
                }
              />
              <StatCell
                label="P99 runtime"
                value={formatMetricDuration(activeStats()?.p99DurationMs ?? null)}
                accent={{ tone: "zinc", icon: "ti ti-hourglass" }}
              />
            </StatGrid>
          </Show>

          <section class="flex min-h-0 flex-1 flex-col gap-2">
            <div class="flex flex-wrap items-end justify-between gap-2">
              <div class="min-w-0">
                <h2 class="text-sm font-semibold text-primary">Runs</h2>
                <p class="text-xs text-dimmed">Select a run to inspect its steps, outputs, and generated documents.</p>
              </div>
              <button type="button" class="btn-input btn-sm shrink-0" onClick={() => void openEmailActivity()}>
                <i class="ti ti-mail" /> Email activity
              </button>
            </div>
            <div class="flex flex-wrap items-center gap-2">
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
                <i
                  class={
                    runsMut.loading() || statsMut.loading() || triggerStateMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"
                  }
                />{" "}
                Refresh
              </button>
            </div>
            <DataTable
              rows={runs()}
              columns={runColumns()}
              getRowId={(run) => run.id}
              selectedRowId={props.selectedRunId}
              density="compact"
              highlightColumns={false}
              fillHeight
              class="paper min-h-[18rem] flex-1 overflow-auto"
              scrollPreserveKey={`grids-workflow-runs-${workflow().id}`}
              hasMore={!!nextCursor()}
              loadingMore={runsMut.loading() || loadMoreRunsMut.loading()}
              onLoadMore={() => loadMoreRunsMut.mutate()}
              onRowClick={(run) => props.onSelectRun(run.id)}
              empty={runsMut.loading() ? "Loading workflow runs..." : "No runs match these filters."}
              renderCell={({ row: run, col, render, value }) => {
                if (col.id === "status") return <span class={`badge ${statusClass(run.status)}`}>{run.status.replaceAll("_", " ")}</span>;
                if (col.id === "started") return <span class="text-dimmed">{formatDate(run.createdAt)}</span>;
                if (col.id === "channel") return channelLabels[run.channel] ?? run.channel;
                if (col.id === "mode") return run.mode === "dryRun" ? "Dry run" : "Execute";
                if (col.id === "result") {
                  return (
                    <span class={run.error ? "text-red-600 dark:text-red-400" : "text-dimmed"}>
                      {run.error?.message ?? run.resultMessage ?? "—"}
                    </span>
                  );
                }
                return render(value);
              }}
            />
          </section>
        </div>
      )}
    </Show>
  );
}
