import { dialogCore, PanelDialog, panelDialogOptions, TextInput } from "@valentinkolb/cloud/ui";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { WorkflowRunEventSummary, WorkflowRunStepSummary } from "../../../lib/workflow-run-events";
import { errorMessage } from "../utils/api-helpers";
import { createScannerEngine, type ScannerDetection, type ScannerEngine } from "./scanner-engine";
import { createWorkflowRunEventBuffer } from "./workflow-run-event-buffer";
import { createWorkflowRunEventsProvider } from "./workflow-run-events-provider";

export type WorkflowScannerState = {
  baseShortId: string;
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
  run: WorkflowRunEventSummary | null;
  steps: WorkflowRunStepSummary[];
  createdAt: number;
};

type Props = {
  state: WorkflowScannerState;
  mode: "page" | "dialog";
};

type VideoBox = { x: number; y: number; width: number; height: number };

const MAX_ACTIVE_SCAN_RUNS = 8;

const isTerminal = (run: WorkflowRunEventSummary): boolean =>
  run.status === "succeeded" || run.status === "failed" || run.status === "canceled";

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

async function openScanDetails(item: ScanLogItem) {
  await dialogCore.open<void>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header title="Scan details" subtitle={item.run?.id ?? item.code} icon="ti ti-barcode" close={() => close()} />
        <PanelDialog.Body>
          <PanelDialog.Section title="Result" icon="ti ti-activity">
            <div class="grid gap-2 text-sm sm:grid-cols-2">
              <div class="paper bg-zinc-50 p-3 dark:bg-zinc-900">
                <p class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">Status</p>
                <p class={`mt-1 font-semibold ${statusClass(item.status)}`}>{item.status}</p>
              </div>
              <div class="paper bg-zinc-50 p-3 dark:bg-zinc-900">
                <p class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">Format</p>
                <p class="mt-1 font-mono text-sm">{item.format ?? "-"}</p>
              </div>
              <div class="paper bg-zinc-50 p-3 dark:bg-zinc-900 sm:col-span-2">
                <p class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">Message</p>
                <p class="mt-1 text-sm">{item.message}</p>
              </div>
              <div class="paper bg-zinc-50 p-3 dark:bg-zinc-900 sm:col-span-2">
                <p class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">Scanned value</p>
                <p class="mt-1 break-all font-mono text-xs">{item.code}</p>
              </div>
            </div>
          </PanelDialog.Section>
          <PanelDialog.Section title="Steps" icon="ti ti-list-details">
            <Show when={item.steps.length > 0} fallback={<p class="text-sm text-dimmed">No step data loaded yet.</p>}>
              <div class="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                <For each={item.steps}>
                  {(step) => (
                    <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-zinc-100 p-3 text-sm last:border-b-0 dark:border-zinc-800">
                      <div class="min-w-0">
                        <p class="truncate font-medium text-primary">{step.stepPath}</p>
                        <p class="text-xs text-dimmed">{step.kind}</p>
                        <Show when={step.error}>
                          <p class="mt-1 text-xs text-red-600 dark:text-red-400">{step.error}</p>
                        </Show>
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
          <span />
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
  const [detections, setDetections] = createSignal<ScannerDetection[]>([]);
  const [logs, setLogs] = createSignal<ScanLogItem[]>([]);
  const [manualCode, setManualCode] = createSignal("");
  const [videoBox, setVideoBox] = createSignal<VideoBox>({ x: 0, y: 0, width: 1, height: 1 });
  const recentCodes = new Map<string, number>();

  const counts = createMemo(() => {
    const items = logs();
    return {
      total: items.length,
      ok: items.filter((item) => item.status === "succeeded").length,
      failed: items.filter((item) => item.status === "failed").length,
      active: items.filter((item) => item.status === "queued" || item.status === "running").length,
    };
  });

  const updateLog = (id: string, patch: Partial<ScanLogItem>) => {
    setLogs((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const fetchSteps = async (runId: string) => {
    const res = await apiClient.workflows.runs[":runId"].steps.$get({ param: { runId } });
    if (!res.ok) throw new Error(await errorMessage(res, "Request failed"));
    const payload = await res.json();
    return payload.items;
  };

  const applyRun = (logId: string, run: WorkflowRunEventSummary, steps?: WorkflowRunStepSummary[]) => {
    const status: ScanStatus =
      run.status === "succeeded" ? "succeeded" : run.status === "failed" || run.status === "canceled" ? "failed" : "running";
    updateLog(logId, {
      run,
      status,
      message: run.resultMessage ?? run.error ?? (status === "succeeded" ? "Succeeded" : status === "failed" ? "Failed" : "Running"),
      ...(steps ? { steps } : {}),
    });
  };

  const refreshRun = async (logId: string, runId: string) => {
    if (props.state.dashboardId && props.state.dashboardWidgetId) {
      const res = await apiClient.dashboards[":dashboardId"].widgets[":widgetId"].runs[":runId"].$get({
        param: { dashboardId: props.state.dashboardId, widgetId: props.state.dashboardWidgetId, runId },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Request failed"));
      const payload = await res.json();
      applyRun(logId, payload.run, payload.steps);
      return;
    }
    const res = await apiClient.workflows.runs[":runId"].$get({ param: { runId } });
    if (!res.ok) throw new Error(await errorMessage(res, "Request failed"));
    const run = await res.json();
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
    const active = logs().filter((item) => item.run && (item.status === "queued" || item.status === "running"));
    await Promise.all(active.map((item) => refreshRun(item.id, item.run!.id).catch(() => undefined)));
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
      const item = logs().find((candidate) => candidate.run?.id === event.run.id);
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
      setLogs((items) =>
        items.map((item) =>
          item.status === "queued" || item.status === "running" ? { ...item, status: "failed", message: error.message } : item,
        ),
      );
    },
    onFatal: () => {
      streamReady = false;
      startFallback();
    },
  });

  const runScan = async (code: string, format: string | null) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    const now = Date.now();
    const last = recentCodes.get(trimmed) ?? 0;
    if (now - last < 2500) return;
    recentCodes.set(trimmed, now);

    const id = crypto.randomUUID();
    if (counts().active >= MAX_ACTIVE_SCAN_RUNS) {
      setLogs((items) => [
        {
          id,
          code: trimmed,
          format,
          status: "failed",
          message: "Scanner is busy. Wait for active workflow runs to finish.",
          run: null,
          steps: [],
          createdAt: now,
        },
        ...items.slice(0, 99),
      ]);
      return;
    }

    setLogs((items) => [
      { id, code: trimmed, format, status: "queued", message: "Queued", run: null, steps: [], createdAt: now },
      ...items.slice(0, 99),
    ]);

    try {
      const res =
        props.state.dashboardId && props.state.dashboardWidgetId
          ? await apiClient.dashboards[":dashboardId"].widgets[":widgetId"].scan.$post({
              param: { dashboardId: props.state.dashboardId, widgetId: props.state.dashboardWidgetId },
              json: { code: trimmed },
            })
          : await apiClient.workflows[":workflowId"].run.scanner.$post({
              param: { workflowId: props.state.workflowId },
              json: { code: trimmed },
            });
      if (!res.ok) throw new Error(await errorMessage(res, "Scanner workflow could not be started"));
      const run = await res.json();
      const pending = pendingRunEvents.take(run.id);
      if (pending) applyRun(id, pending.run, pending.steps);
      else updateLog(id, { run, status: run.status === "queued" ? "queued" : "running", message: "Queued" });
      setTimeout(() => {
        if (!disposed) void refreshRun(id, run.id).catch(() => !streamReady && startFallback());
      }, 1500);
    } catch (error) {
      updateLog(id, {
        status: "failed",
        message: error instanceof Error ? error.message : "Scanner workflow could not be started",
      });
    }
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
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (video) video.srcObject = null;
    setCameraRunning(false);
  };

  const startCamera = async () => {
    setCameraError(null);
    try {
      engine ??= createScannerEngine();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (!video) return;
      video.srcObject = stream;
      await video.play();
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
      ? "flex min-h-screen flex-col bg-zinc-950 text-zinc-50"
      : "flex h-full min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-50";

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
          >
            <i class="ti ti-arrow-left" />
          </a>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">{props.state.workflowName}</p>
            <p class="truncate text-xs text-zinc-400">Scanner</p>
          </div>
        </header>
      </Show>

      <main class="grid min-h-0 flex-1 grid-rows-[minmax(18rem,55%)_minmax(16rem,1fr)] gap-2 p-2 md:p-3">
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
              {cameraRunning() ? "Scanning" : "Camera off"}
            </span>
            <Show when={cameraError()}>
              <span class="rounded-full bg-red-600/90 px-2 py-1 text-xs font-medium text-white">{cameraError()}</span>
            </Show>
          </div>
          <div class="absolute right-3 top-3 flex items-center gap-2">
            <button
              type="button"
              class="btn-input btn-input-sm bg-black/70 text-white hover:bg-black/90"
              onClick={() => (cameraRunning() ? stopCamera() : void startCamera())}
            >
              <i class={`ti ${cameraRunning() ? "ti-video-off" : "ti-video"}`} />
              {cameraRunning() ? "Stop" : "Start"}
            </button>
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
          <form class="shrink-0 border-b border-zinc-800 p-2" onSubmit={submitManual}>
            <TextInput
              value={manualCode}
              onInput={setManualCode}
              placeholder="Enter scan code..."
              icon="ti ti-keyboard"
              name="manual-scan-code"
              autocomplete="off"
            />
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
                    onClick={() => void openScanDetails(item)}
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
