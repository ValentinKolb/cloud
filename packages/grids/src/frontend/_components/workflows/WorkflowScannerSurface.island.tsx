import { dialogCore, PanelDialog, panelDialogOptions, TextInput } from "@valentinkolb/cloud/ui";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { WorkflowRunEventSummary, WorkflowRunStepSummary } from "../../../lib/workflow-run-events";
import { errorMessage } from "../utils/api-helpers";
import { createScannerEngine, type ScannerDetection, type ScannerEngine } from "./scanner-engine";
import { createWorkflowRunEventBuffer } from "./workflow-run-event-buffer";

type WorkflowRunsApi = {
  [":runId"]: {
    $get: (input: { param: { runId: string } }) => Promise<Response>;
    steps: { $get: (input: { param: { runId: string } }) => Promise<Response> };
  };
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

const workflowRunsApi = apiClient.workflows.runs as unknown as WorkflowRunsApi;
const dashboardWorkflowRunsApi = apiClient.dashboards as unknown as DashboardWorkflowRunsApi;

import { createWorkflowRunEventsProvider } from "./workflow-run-events-provider";
import { acquireScannerStream, stopScannerStream } from "./workflow-scanner-camera";
import { invokeWorkflowScannerRequest, type WorkflowScannerTransport, workflowScannerResponseKind } from "./workflow-scanner-request";

export type WorkflowScannerState = {
  baseShortId: string;
  launcherId: string;
  expectedRevision: number;
  workflowId: string;
  workflowShortId?: string;
  dashboardId?: string | null;
  dashboardWidgetId?: string | null;
  workflowName: string;
  workflowDescription: string | null;
  initialCode: string | null;
  returnHref: string | null;
};

type ScanStatus = "queued" | "running" | "succeeded" | "failed";

type ScanLogItem = {
  id: string;
  code: string;
  format: string | null;
  status: ScanStatus;
  message: string;
  runId: string | null;
  run: WorkflowRunEventSummary | null;
  steps: WorkflowRunStepSummary[];
  createdAt: number;
};

type Props = {
  state: WorkflowScannerState;
  mode: "page" | "dialog";
};

type VideoBox = { x: number; y: number; width: number; height: number };

type ScanAnnouncement = {
  id: number;
  text: string;
};

const MAX_ACTIVE_SCAN_RUNS = 8;

const isTerminal = (run: WorkflowRunEventSummary): boolean =>
  run.status === "succeeded" || run.status === "failed" || run.status === "canceled" || run.status === "needs_attention";

const statusClass = (status: ScanStatus) =>
  status === "succeeded"
    ? "text-emerald-700 dark:text-emerald-300"
    : status === "failed"
      ? "text-red-700 dark:text-red-300"
      : "text-blue-700 dark:text-blue-300";

const displayTime = (value: number) =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

async function openScanDetails(item: ScanLogItem, retry?: () => void) {
  await dialogCore.open<void>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header title="Scan details" subtitle={item.runId ?? item.code} icon="ti ti-barcode" close={() => close()} />
        <PanelDialog.Body>
          <PanelDialog.Section title="Result" icon="ti ti-activity">
            <dl class="grid gap-x-3 gap-y-2 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
              <dt class="text-dimmed">Status</dt>
              <dd class={`font-semibold ${statusClass(item.status)}`}>{item.status}</dd>
              <dt class="text-dimmed">Format</dt>
              <dd class="font-mono">{item.format ?? "-"}</dd>
              <dt class="text-dimmed">Message</dt>
              <dd>{item.message}</dd>
              <dt class="text-dimmed">Scanned value</dt>
              <dd class="break-all font-mono text-xs">{item.code}</dd>
            </dl>
          </PanelDialog.Section>
          <PanelDialog.Section title="Steps" icon="ti ti-list-details">
            <Show when={item.steps.length > 0} fallback={<p class="text-sm text-dimmed">No step data loaded yet.</p>}>
              <div class="flex flex-col gap-2">
                <For each={item.steps}>
                  {(step) => (
                    <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-1 text-sm">
                      <div class="min-w-0">
                        <p class="truncate font-medium text-primary">{step.sourcePath.length > 0 ? step.sourcePath.join(".") : step.key}</p>
                        <p class="text-xs text-dimmed">{step.action ?? step.kind}</p>
                      </div>
                      <span
                        class={`text-xs font-semibold ${statusClass(step.status === "failed" ? "failed" : step.status === "succeeded" ? "succeeded" : "running")}`}
                      >
                        {step.status}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </PanelDialog.Section>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <Show when={retry} fallback={<span />}>
            {(retryAction) => (
              <button
                type="button"
                class="btn-input"
                onClick={() => {
                  close();
                  retryAction()();
                }}
              >
                <i class="ti ti-refresh" aria-hidden="true" /> Retry
              </button>
            )}
          </Show>
          <button type="button" class="btn-input" onClick={() => close()}>
            Close
          </button>
        </PanelDialog.Footer>
      </PanelDialog>
    ),
    panelDialogOptions,
  );
}

export default function WorkflowScannerSurface(props: Props) {
  let cameraFrame: HTMLElement | undefined;
  let video: HTMLVideoElement | undefined;
  let stream: MediaStream | null = null;
  let engine: ScannerEngine | null = null;
  let disposed = false;
  let decoding = false;
  let initialCodeSubmitted = false;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let streamReady = false;
  const pendingRunEvents = createWorkflowRunEventBuffer();

  const [cameraRunning, setCameraRunning] = createSignal(false);
  const [cameraError, setCameraError] = createSignal<string | null>(null);
  const [pauseReason, setPauseReason] = createSignal<string | null>(null);
  const [detections, setDetections] = createSignal<ScannerDetection[]>([]);
  const [logs, setLogs] = createSignal<ScanLogItem[]>([]);
  const [announcements, setAnnouncements] = createSignal<ScanAnnouncement[]>([]);
  const [manualCode, setManualCode] = createSignal("");
  const [videoBox, setVideoBox] = createSignal<VideoBox>({ x: 0, y: 0, width: 1, height: 1 });
  const recentCodes = new Map<string, number>();
  let announcementId = 0;
  const scannerTransport: WorkflowScannerTransport = {
    invokeDashboard: (input) => apiClient.dashboards[":dashboardId"].widgets[":widgetId"].scan.$post(input),
    invokeLauncher: (input) => apiClient.workflows.launchers[":launcherId"].invoke.scanner.$post(input),
  };

  const counts = createMemo(() => {
    const items = logs();
    return {
      total: items.length,
      ok: items.filter((item) => item.status === "succeeded").length,
      failed: items.filter((item) => item.status === "failed").length,
      active: items.filter((item) => item.status === "queued" || item.status === "running").length,
    };
  });
  const announceLog = (item: ScanLogItem) => {
    const announcement = {
      id: ++announcementId,
      text: `Scan ${item.code}: ${item.message}. Status ${item.status}.`,
    };
    setAnnouncements((items) => [...items.slice(-9), announcement]);
  };

  const prependLog = (item: ScanLogItem) => {
    setLogs((items) => [item, ...items.slice(0, 99)]);
    announceLog(item);
  };

  const updateLog = (id: string, patch: Partial<ScanLogItem>) => {
    const current = logs().find((item) => item.id === id);
    if (!current) return;
    const next = { ...current, ...patch };
    setLogs((items) => items.map((item) => (item.id === id ? next : item)));
    if (next.status !== current.status || next.message !== current.message) announceLog(next);
  };

  const fetchSteps = async (runId: string): Promise<WorkflowRunStepSummary[]> => {
    const res = await workflowRunsApi[":runId"].steps.$get({ param: { runId } });
    if (!res.ok) throw new Error(await errorMessage(res, "Request failed"));
    const payload = (await res.json()) as { items: WorkflowRunStepSummary[] };
    return payload.items;
  };

  const applyRun = (logId: string, run: WorkflowRunEventSummary, steps?: WorkflowRunStepSummary[]) => {
    const status: ScanStatus =
      run.status === "succeeded"
        ? "succeeded"
        : run.status === "failed" || run.status === "canceled" || run.status === "needs_attention"
          ? "failed"
          : "running";
    updateLog(logId, {
      run,
      status,
      runId: run.id,
      message:
        run.resultMessage ?? run.error?.message ?? (status === "succeeded" ? "Succeeded" : status === "failed" ? "Failed" : "Running"),
      ...(steps ? { steps } : {}),
    });
  };

  const refreshRun = async (logId: string, runId: string) => {
    if (props.state.dashboardId && props.state.dashboardWidgetId) {
      const res = await dashboardWorkflowRunsApi[":dashboardId"].widgets[":widgetId"].runs[":runId"].$get({
        param: { dashboardId: props.state.dashboardId, widgetId: props.state.dashboardWidgetId, runId },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Request failed"));
      const payload = (await res.json()) as { run: WorkflowRunEventSummary; steps: WorkflowRunStepSummary[] };
      applyRun(logId, payload.run, payload.steps);
      return;
    }
    const res = await workflowRunsApi[":runId"].$get({ param: { runId } });
    if (!res.ok) throw new Error(await errorMessage(res, "Request failed"));
    const run = (await res.json()) as WorkflowRunEventSummary;
    let steps: WorkflowRunStepSummary[] | undefined;
    if (isTerminal(run)) {
      try {
        steps = await fetchSteps(run.id);
      } catch {
        // The run result remains useful when optional step details cannot be loaded.
      }
    }
    applyRun(logId, run, steps);
  };

  const refreshActiveRuns = async () => {
    const active = logs().filter((item) => item.runId && (item.status === "queued" || item.status === "running"));
    await Promise.all(active.map((item) => refreshRun(item.id, item.runId!).catch(() => undefined)));
  };

  const stopFallback = () => {
    if (fallbackTimer) clearInterval(fallbackTimer);
    fallbackTimer = null;
  };

  const stopWatchdog = () => {
    if (watchdogTimer) clearInterval(watchdogTimer);
    watchdogTimer = null;
  };

  const startFallback = () => {
    if (fallbackTimer || disposed) return;
    fallbackTimer = setInterval(() => void refreshActiveRuns(), 2500);
  };

  const runEvents = createWorkflowRunEventsProvider({
    workflowId: props.state.workflowId,
    dashboardId: props.state.dashboardId,
    dashboardWidgetId: props.state.dashboardWidgetId,
    onReady: () => {
      streamReady = true;
      stopFallback();
      void refreshActiveRuns();
    },
    onEvent: (event) => {
      const item = logs().find((candidate) => candidate.runId === event.run.id);
      if (item) {
        applyRun(item.id, event.run, event.steps);
        return;
      }
      pendingRunEvents.push(event);
    },
    onError: () => {
      streamReady = false;
      startFallback();
    },
    onRevoked: (error) => {
      streamReady = false;
      stopFallback();
      stopWatchdog();
      setCameraError(error.message);
      const revoked = logs()
        .filter((item) => item.status === "queued" || item.status === "running")
        .map((item) => ({ ...item, status: "failed" as const, message: error.message }));
      setLogs((items) =>
        items.map((item) =>
          item.status === "queued" || item.status === "running" ? { ...item, status: "failed", message: error.message } : item,
        ),
      );
      for (const item of revoked) announceLog(item);
    },
    onFatal: () => {
      streamReady = false;
      startFallback();
    },
  });

  const submitScan = async (item: Pick<ScanLogItem, "id" | "code">) => {
    try {
      const res = await invokeWorkflowScannerRequest(
        scannerTransport,
        {
          launcherId: props.state.launcherId,
          dashboardId: props.state.dashboardId,
          dashboardWidgetId: props.state.dashboardWidgetId,
        },
        { operationId: item.id, expectedRevision: props.state.expectedRevision, code: item.code },
      );
      const responseKind = workflowScannerResponseKind(res);
      if (responseKind === "revision-conflict") {
        const message = await errorMessage(res, "Workflow changed while the scanner was open");
        const pausedMessage = `${message} Restart the scanner to load the latest workflow revision.`;
        setPauseReason(pausedMessage);
        stopCamera();
        updateLog(item.id, { status: "failed", message: pausedMessage });
        return;
      }
      if (responseKind === "failed") throw new Error(await errorMessage(res, "Scanner workflow could not be started"));
      const receipt = (await res.json()) as { id?: string; runId?: string; status: string };
      const runId = receipt.runId ?? receipt.id;
      if (!runId) throw new Error("Scanner workflow did not return a run ID.");
      const pending = pendingRunEvents.take(runId);
      if (pending) applyRun(item.id, pending.run, pending.steps);
      else {
        const status = receipt.status === "queued" ? "queued" : "running";
        updateLog(item.id, { runId, status, message: status === "queued" ? "Queued" : "Running" });
      }
      setTimeout(() => {
        if (!disposed) void refreshRun(item.id, runId).catch(() => !streamReady && startFallback());
      }, 1500);
    } catch (error) {
      updateLog(item.id, {
        status: "failed",
        message: error instanceof Error ? error.message : "Scanner workflow could not be started",
      });
    }
  };

  const runScan = async (code: string, format: string | null) => {
    const trimmed = code.trim();
    if (!trimmed || pauseReason()) return;
    const now = Date.now();
    const last = recentCodes.get(trimmed) ?? 0;
    if (now - last < 2500) return;
    recentCodes.set(trimmed, now);

    const item: ScanLogItem = {
      id: crypto.randomUUID(),
      code: trimmed,
      format,
      status: counts().active >= MAX_ACTIVE_SCAN_RUNS ? "failed" : "queued",
      message: counts().active >= MAX_ACTIVE_SCAN_RUNS ? "Scanner is busy. Wait for active workflow runs to finish." : "Queued",
      runId: null,
      run: null,
      steps: [],
      createdAt: now,
    };
    prependLog(item);
    if (item.status === "queued") await submitScan(item);
  };

  const retryScan = (item: ScanLogItem) => {
    if (pauseReason() || item.runId || counts().active >= MAX_ACTIVE_SCAN_RUNS) return;
    updateLog(item.id, { status: "queued", message: "Retrying" });
    void submitScan(item);
  };

  const updateVideoBox = () => {
    if (!cameraFrame || !video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      setVideoBox({ x: 0, y: 0, width: 1, height: 1 });
      return;
    }
    const frame = cameraFrame.getBoundingClientRect();
    if (frame.width <= 0 || frame.height <= 0) return;
    const videoRatio = video.videoWidth / video.videoHeight;
    const frameRatio = frame.width / frame.height;
    if (videoRatio > frameRatio) {
      const height = frameRatio / videoRatio;
      setVideoBox({ x: 0, y: (1 - height) / 2, width: 1, height });
    } else {
      const width = videoRatio / frameRatio;
      setVideoBox({ x: (1 - width) / 2, y: 0, width, height: 1 });
    }
  };

  const detectionStyle = (box: NonNullable<ScannerDetection["boundingBox"]>) => {
    const display = videoBox();
    return {
      left: `${(display.x + box.x * display.width) * 100}%`,
      top: `${(display.y + box.y * display.height) * 100}%`,
      width: `${box.width * display.width * 100}%`,
      height: `${box.height * display.height * 100}%`,
    };
  };

  const tick = async () => {
    if (disposed || !cameraRunning()) return;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || decoding || !engine) {
      window.setTimeout(() => void tick(), 220);
      return;
    }
    decoding = true;
    try {
      updateVideoBox();
      const found = await engine.decodeVideoFrame(video);
      setDetections(found);
      for (const detection of found) void runScan(detection.rawValue, detection.format);
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "Scanner failed");
    } finally {
      decoding = false;
      window.setTimeout(() => void tick(), 220);
    }
  };

  const stopCamera = () => {
    if (stream) stopScannerStream(stream);
    stream = null;
    if (video) video.srcObject = null;
    setCameraRunning(false);
  };

  const startCamera = async () => {
    if (pauseReason()) return;
    setCameraError(null);
    try {
      engine ??= createScannerEngine();
      const acquired = await acquireScannerStream(navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices), () => disposed);
      if (!acquired) return;
      if (!video) {
        stopScannerStream(acquired);
        return;
      }
      stream = acquired;
      video.srcObject = stream;
      await video.play();
      if (disposed) {
        stopCamera();
        return;
      }
      updateVideoBox();
      setCameraRunning(true);
      void tick();
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "Camera could not be started");
      stopCamera();
    }
  };

  const submitManual = (event: SubmitEvent) => {
    event.preventDefault();
    const code = manualCode().trim();
    setManualCode("");
    void runScan(code, "manual");
  };

  const submitInitialCode = () => {
    if (initialCodeSubmitted) return;
    const code = props.state.initialCode?.trim();
    if (!code) return;
    initialCodeSubmitted = true;
    void runScan(code, "link");
  };

  onMount(() => {
    window.addEventListener("resize", updateVideoBox);
    runEvents.connect();
    watchdogTimer = setInterval(() => void refreshActiveRuns(), 10_000);
    submitInitialCode();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera scanning is not supported in this browser.");
      return;
    }
    void startCamera();
  });

  onCleanup(() => {
    disposed = true;
    window.removeEventListener("resize", updateVideoBox);
    stopFallback();
    stopWatchdog();
    pendingRunEvents.clear();
    runEvents.dispose();
    stopCamera();
  });

  const shellClass =
    props.mode === "page"
      ? "flex h-[100dvh] min-h-0 flex-col bg-zinc-950 text-zinc-50"
      : "flex h-full min-h-0 flex-1 flex-col bg-zinc-950 text-zinc-50";
  const mainClass =
    props.mode === "page"
      ? "grid min-h-0 flex-1 grid-rows-[minmax(14rem,45dvh)_minmax(0,1fr)] gap-2 p-2 md:p-3"
      : "grid min-h-0 flex-1 grid-rows-2 gap-2 p-2 md:p-3";

  return (
    <div class={shellClass}>
      <Show when={props.mode === "page"}>
        <header class="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
          <a
            href={
              props.state.returnHref ??
              `/app/grids/${props.state.baseShortId}/workflows/${props.state.workflowShortId ?? props.state.workflowId}`
            }
            class="icon-btn text-zinc-200 hover:text-white"
            aria-label="Back to workflow"
          >
            <i class="ti ti-arrow-left" />
          </a>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">{props.state.workflowName}</p>
            <p class="truncate text-xs text-zinc-400">Scanner</p>
          </div>
        </header>
      </Show>

      <main class={mainClass}>
        <div class="sr-only" aria-live="polite" aria-relevant="additions text">
          <For each={announcements()}>{(announcement) => <p>{announcement.text}</p>}</For>
        </div>
        <section ref={cameraFrame} class="paper relative min-h-0 overflow-hidden border-zinc-800 bg-black">
          <video ref={video} class="h-full w-full object-contain" playsinline autoplay muted />
          <div class="pointer-events-none absolute inset-0">
            <For each={detections()}>
              {(detection) => (
                <Show when={detection.boundingBox}>
                  {(box) => (
                    <div
                      class="absolute rounded-lg border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.12)]"
                      style={detectionStyle(box())}
                    />
                  )}
                </Show>
              )}
            </For>
          </div>
          <div class="absolute left-3 top-3 flex flex-wrap items-center gap-2">
            <span class="rounded-full bg-black/70 px-2 py-1 text-xs font-medium text-white">
              {pauseReason() ? "Paused" : cameraRunning() ? "Scanning" : "Camera off"}
            </span>
            <Show when={cameraError()}>
              <span class="rounded-full bg-red-600/90 px-2 py-1 text-xs font-medium text-white" role="alert">
                {cameraError()}
              </span>
            </Show>
            <Show when={pauseReason()}>
              {(reason) => (
                <span class="max-w-[min(36rem,75vw)] rounded bg-red-600/90 px-2 py-1 text-xs font-medium text-white" role="alert">
                  {reason()}
                </span>
              )}
            </Show>
          </div>
          <div class="absolute right-3 top-3 flex items-center gap-2">
            <Show
              when={pauseReason()}
              fallback={
                <button
                  type="button"
                  class="btn-input btn-input-sm bg-black/70 text-white hover:bg-black/90"
                  onClick={() => (cameraRunning() ? stopCamera() : void startCamera())}
                >
                  <i class={`ti ${cameraRunning() ? "ti-video-off" : "ti-video"}`} />
                  {cameraRunning() ? "Stop" : "Start"}
                </button>
              }
            >
              <button
                type="button"
                class="btn-input btn-input-sm bg-black/70 text-white hover:bg-black/90"
                onClick={() => window.location.reload()}
              >
                <i class="ti ti-refresh" aria-hidden="true" /> Restart
              </button>
            </Show>
          </div>
        </section>

        <section class="paper flex min-h-0 flex-col overflow-hidden border-zinc-800 bg-zinc-950">
          <div class="grid shrink-0 grid-cols-4 border-b border-zinc-800 text-center">
            <div class="p-2">
              <p class="text-lg font-semibold">{counts().total}</p>
              <p class="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Scans</p>
            </div>
            <div class="p-2">
              <p class="text-lg font-semibold text-emerald-400">{counts().ok}</p>
              <p class="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Ok</p>
            </div>
            <div class="p-2">
              <p class="text-lg font-semibold text-blue-400">{counts().active}</p>
              <p class="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Active</p>
            </div>
            <div class="p-2">
              <p class="text-lg font-semibold text-red-400">{counts().failed}</p>
              <p class="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Errors</p>
            </div>
          </div>
          <form class="flex shrink-0 items-center gap-2 border-b border-zinc-800 p-2" onSubmit={submitManual}>
            <div class="min-w-0 flex-1">
              <TextInput
                value={manualCode}
                onInput={setManualCode}
                placeholder="Enter scan code..."
                ariaLabel="Scan code"
                icon="ti ti-keyboard"
                name="manual-scan-code"
                autocomplete="off"
                disabled={Boolean(pauseReason())}
              />
            </div>
            <button type="submit" class="btn-input btn-sm shrink-0" disabled={!manualCode().trim() || Boolean(pauseReason())}>
              <i class="ti ti-scan" aria-hidden="true" /> Scan
            </button>
          </form>
          <div class="min-h-0 flex-1 overflow-y-auto">
            <Show
              when={logs().length > 0}
              fallback={<div class="flex h-full items-center justify-center px-4 text-center text-sm text-zinc-500">No scans yet.</div>}
            >
              <For each={logs()}>
                {(item) => (
                  <button
                    type="button"
                    class="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-zinc-800 px-3 py-2 text-left transition-colors hover:bg-white/5"
                    onClick={() =>
                      void openScanDetails(
                        item,
                        item.status === "failed" && !item.runId && !pauseReason() ? () => retryScan(item) : undefined,
                      )
                    }
                  >
                    <i
                      class={`ti ${
                        item.status === "succeeded"
                          ? "ti-circle-check"
                          : item.status === "failed"
                            ? "ti-alert-circle"
                            : "ti-loader-2 animate-spin"
                      } ${statusClass(item.status)}`}
                    />
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-medium text-zinc-100">{item.message}</span>
                      <span class="block truncate font-mono text-[11px] text-zinc-500">{item.code}</span>
                    </span>
                    <span class="text-xs text-zinc-500">{displayTime(item.createdAt)}</span>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </section>
      </main>
    </div>
  );
}
