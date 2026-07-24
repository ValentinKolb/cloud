import { dialogCore, PanelDialog, panelDialogWorkspaceOptions, toast } from "@valentinkolb/cloud/ui";
import type { WorkflowBoundPlan, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { createEffect, createSignal, lazy, onCleanup, Show, Suspense } from "solid-js";
import { apiClient } from "@/api/client";
import type { WorkflowButtonWidget as WorkflowButtonWidgetConfig } from "../../../service";
import type { GridsWorkflowRun } from "../../../workflows/contracts";
import { errorMessage } from "../utils/api-helpers";
import { requestWorkflowRunInput } from "../workflows/WorkflowRunInputDialog";
import type { WorkflowScannerState } from "../workflows/WorkflowScannerSurface";
import { isTerminalWorkflowRunStatus, workflowRunStatusClass } from "../workflows/workflow-display";
import { createWorkflowRunEventsProvider } from "../workflows/workflow-run-events-provider";
import DashboardWidgetState from "./DashboardWidgetState";
import type { WidgetData } from "./widget-data";

const WorkflowScannerSurface = lazy(() => import("../workflows/WorkflowScannerSurface"));

type Props = {
  dashboardId: string;
  baseShortId: string;
  widget: WorkflowButtonWidgetConfig;
  data: WidgetData;
};

type DashboardWorkflowInputContract = {
  workflow: {
    id: string;
    name: string;
    plan: Pick<WorkflowBoundPlan, "inputs" | "bindings">;
  };
  tables: Array<{ id: string; shortId: string; name: string }>;
};

type DashboardWorkflowRunsApi = {
  [":dashboardId"]: {
    widgets: {
      [":widgetId"]: {
        runs: {
          [":runId"]: {
            $get: (input: { param: { dashboardId: string; widgetId: string; runId: string } }) => Promise<Response>;
          };
        };
      };
    };
  };
};

const dashboardWorkflowRunsApi = apiClient.dashboards as unknown as DashboardWorkflowRunsApi;
const RUN_STATUS_POLL_MS = 2_000;

export default function WorkflowButtonWidget(props: Props) {
  const [running, setRunning] = createSignal(false);
  const [launchedRunId, setLaunchedRunId] = createSignal<string | null>(null);
  const [launchedRunStatus, setLaunchedRunStatus] = createSignal<GridsWorkflowRun["status"] | null>(null);
  const isWorkflowButton = (d: WidgetData): d is Extract<WidgetData, { kind: "workflow-button" }> => d.kind === "workflow-button";
  const data = () => (isWorkflowButton(props.data) ? props.data : null);
  const title = () => data()?.title || props.widget.title || "Run workflow";
  const description = () => data()?.description ?? props.widget.description ?? null;
  const buttonLabel = () => data()?.buttonLabel || props.widget.buttonLabel || "Run";
  const disabledReason = () => data()?.disabledReason ?? null;
  const canRun = () => Boolean(data()?.canRun) && !running();
  const runHref = () => {
    const d = data();
    const runId = launchedRunId();
    if (!d?.canInspectRun || !runId) return null;
    return `/app/grids/${encodeURIComponent(props.baseShortId)}/workflows/${encodeURIComponent(
      d.workflowShortId,
    )}?run=${encodeURIComponent(runId)}`;
  };

  createEffect(() => {
    const runId = launchedRunId();
    const d = data();
    if (!runId || !d) return;
    let stopped = false;
    let refreshInFlight = false;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let events: ReturnType<typeof createWorkflowRunEventsProvider> | null = null;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = null;
      events?.dispose();
      events = null;
    };
    const applyStatus = (status: GridsWorkflowRun["status"]) => {
      setLaunchedRunStatus(status);
      if (isTerminalWorkflowRunStatus(status)) stop();
    };
    const refresh = async () => {
      if (stopped || refreshInFlight) return;
      refreshInFlight = true;
      try {
        const response = await dashboardWorkflowRunsApi[":dashboardId"].widgets[":widgetId"].runs[":runId"].$get({
          param: { dashboardId: props.dashboardId, widgetId: props.widget.id, runId },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { run: Pick<GridsWorkflowRun, "id" | "status"> };
        if (payload.run.id === runId) applyStatus(payload.run.status);
      } catch {
        // Live events or the next poll can recover a transient status request.
      } finally {
        refreshInFlight = false;
      }
    };
    events = createWorkflowRunEventsProvider({
      workflowId: d.workflowId,
      dashboardId: props.dashboardId,
      dashboardWidgetId: props.widget.id,
      onEvent: (event) => {
        if (event.run.id !== runId) return;
        applyStatus(event.run.status);
      },
    });
    events.connect();
    fallbackTimer = setInterval(() => void refresh(), RUN_STATUS_POLL_MS);
    void refresh();
    onCleanup(stop);
  });

  const openScanner = () => {
    const d = data();
    if (!d || d.action !== "scanner" || !canRun()) return;
    void dialogCore.open<void>(
      (close) => (
        <PanelDialog surface="floating">
          <PanelDialog.Header
            title={`${title()} scanner`}
            subtitle={props.widget.description ?? d.workflowName}
            icon="ti ti-barcode"
            close={() => close()}
          />
          <PanelDialog.Body>
            <Suspense fallback={<div class="p-4 text-sm text-dimmed">Loading scanner...</div>}>
              <WorkflowScannerSurface
                mode="dialog"
                state={
                  {
                    baseShortId: props.baseShortId,
                    launcherId: d.launcherId,
                    expectedRevision: d.expectedRevision,
                    workflowId: d.workflowId,
                    dashboardId: props.dashboardId,
                    dashboardWidgetId: props.widget.id,
                    workflowName: d.workflowName,
                    workflowDescription: description(),
                    initialCode: null,
                    returnHref: `/app/grids/${props.baseShortId}/dashboard/${props.dashboardId}`,
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

  const run = async () => {
    if (!canRun()) return;
    if (data()?.action === "scanner") {
      openScanner();
      return;
    }
    setRunning(true);
    try {
      let inputs: Record<string, WorkflowJsonValue> = {};
      if (data()?.inputMode === "prompt") {
        const contractResponse: Response = await apiClient.dashboards[":dashboardId"].widgets[":widgetId"]["input-contract"].$get({
          param: { dashboardId: props.dashboardId, widgetId: props.widget.id },
        });
        if (!contractResponse.ok) {
          throw new Error(await errorMessage(contractResponse, "Workflow inputs could not be loaded"));
        }
        const contract = (await contractResponse.json()) as DashboardWorkflowInputContract;
        const prompted = await requestWorkflowRunInput({ workflow: contract.workflow, tables: contract.tables, mode: "execute" });
        if (prompted === undefined) return;
        inputs = prompted;
      }
      const res = await apiClient.dashboards[":dashboardId"].widgets[":widgetId"].run.$post({
        param: { dashboardId: props.dashboardId, widgetId: props.widget.id },
        json: { inputs },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Workflow could not be started"));
      const receipt = (await res.json()) as Pick<GridsWorkflowRun, "id" | "status">;
      setLaunchedRunId(receipt.id);
      setLaunchedRunStatus(receipt.status);
      toast.success("Workflow started", {
        action: runHref() ? { label: "Open run", href: runHref()! } : undefined,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Workflow could not be started");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div class="paper flex-1 w-full flex flex-col min-h-0 min-w-0 overflow-hidden">
      <Show
        when={data()}
        fallback={
          <DashboardWidgetState
            kind={props.data.kind === "error" ? "error" : "loading"}
            detail={props.data.kind === "error" ? props.data.reason : null}
          />
        }
      >
        <div class="flex flex-1 min-h-0 flex-col gap-3 p-4">
          <div class="min-w-0">
            <h3 class="truncate text-sm font-semibold text-primary">{title()}</h3>
            <Show when={description()}>
              <p class="mt-1 line-clamp-3 text-xs leading-snug text-dimmed">{description()}</p>
            </Show>
          </div>
          <div class="mt-auto flex flex-wrap items-center gap-2">
            <Show
              when={data()?.action === "scanner"}
              fallback={
                <button type="button" class="btn-primary btn-sm" disabled={!canRun()} onClick={run}>
                  <i class={running() ? "ti ti-loader-2 animate-spin" : "ti ti-player-play"} />
                  {running() ? "Running..." : buttonLabel()}
                </button>
              }
            >
              <button type="button" class="btn-primary btn-sm" disabled={!canRun()} onClick={openScanner}>
                <i class="ti ti-barcode" />
                {buttonLabel()}
              </button>
            </Show>
            <Show when={disabledReason()}>
              <span class="text-xs text-dimmed">{disabledReason()}</span>
            </Show>
            <Show when={launchedRunStatus()}>
              {(status) => <span class={`badge ${workflowRunStatusClass(status())}`}>{status().replaceAll("_", " ")}</span>}
            </Show>
            <Show when={runHref()}>
              {(href) => (
                <a class="btn-simple btn-sm" href={href()}>
                  Open run <i class="ti ti-arrow-right" />
                </a>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
