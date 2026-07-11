import { dialogCore, PanelDialog, panelDialogWorkspaceOptions, toast } from "@valentinkolb/cloud/ui";
import { createSignal, lazy, Show, Suspense } from "solid-js";
import { apiClient } from "@/api/client";
import type { WorkflowButtonWidget as WorkflowButtonWidgetConfig } from "../../../service";
import { errorMessage } from "../utils/api-helpers";
import type { WorkflowScannerState } from "../workflows/WorkflowScannerSurface.island";
import type { WidgetData } from "./widget-data";

const WorkflowScannerSurface = lazy(() => import("../workflows/WorkflowScannerSurface.island"));

type Props = {
  dashboardId: string;
  baseShortId: string;
  widget: WorkflowButtonWidgetConfig;
  data: WidgetData;
};

export default function WorkflowButtonWidget(props: Props) {
  const [running, setRunning] = createSignal(false);
  const isWorkflowButton = (d: WidgetData): d is Extract<WidgetData, { kind: "workflow-button" }> => d.kind === "workflow-button";
  const data = () => (isWorkflowButton(props.data) ? props.data : null);
  const title = () => data()?.title || props.widget.title || "Run workflow";
  const description = () => data()?.description ?? props.widget.description ?? null;
  const buttonLabel = () => data()?.buttonLabel || props.widget.buttonLabel || "Run";
  const disabledReason = () => data()?.disabledReason ?? null;
  const canRun = () => Boolean(data()?.canRun) && !running();

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
      const res = await apiClient.dashboards[":dashboardId"].widgets[":widgetId"].run.$post({
        param: { dashboardId: props.dashboardId, widgetId: props.widget.id },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Workflow could not be started"));
      toast.success("Workflow started");
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
          <div class="flex-1 flex items-center justify-center text-xs text-dimmed px-3 py-2 text-center">
            <Show when={props.data.kind === "error"} fallback="Loading...">
              <span class="text-red-600 dark:text-red-400">{(props.data as { kind: "error"; reason: string }).reason}</span>
            </Show>
          </div>
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
          </div>
        </div>
      </Show>
    </div>
  );
}
