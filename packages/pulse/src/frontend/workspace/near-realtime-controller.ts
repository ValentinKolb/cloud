import { type Accessor, createEffect, onCleanup } from "solid-js";
import type { PulseDashboard } from "../../contracts";
import type { WorkspaceView } from "./types";

type NearRealtimeControllerDeps = {
  selectedBaseId: Accessor<string>;
  activeView: Accessor<WorkspaceView>;
  selectedDashboard: Accessor<PulseDashboard | null>;
  refreshSources: (baseId: string, signal: AbortSignal) => Promise<void>;
  refreshActivity: (baseId: string, signal: AbortSignal) => Promise<void>;
  refreshDashboard: (baseId: string, signal: AbortSignal) => Promise<void>;
  refreshResources: (baseId: string, signal: AbortSignal) => Promise<void>;
};

const refreshInterval = (view: WorkspaceView, dashboard: PulseDashboard | null): number | null => {
  if (view === "dashboard") {
    const interval = dashboard?.config.refreshIntervalSeconds;
    return interval === null ? null : (interval ?? 5);
  }
  return view === "sources" ||
    view === "resources" ||
    view === "resource-detail" ||
    view === "activity-events" ||
    view === "activity-states" ||
    view === "activity-metrics"
    ? 5
    : null;
};

export const installNearRealtimeController = (deps: NearRealtimeControllerDeps): void => {
  createEffect(() => {
    const baseId = deps.selectedBaseId();
    const view = deps.activeView();
    const dashboard = deps.selectedDashboard();
    if (!baseId) return;
    const intervalSeconds = refreshInterval(view, dashboard);
    if (intervalSeconds === null) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let currentRefresh: AbortController | undefined;
    let failures = 0;

    const schedule = (delayMs: number) => {
      if (disposed) return;
      timer = setTimeout(run, delayMs + Math.floor(Math.random() * 350));
    };

    const run = () => {
      if (disposed) return;
      if (document.hidden) {
        schedule(intervalSeconds * 1000);
        return;
      }
      currentRefresh?.abort();
      const refresh = new AbortController();
      currentRefresh = refresh;
      const task =
        view === "dashboard"
          ? deps.refreshDashboard(baseId, refresh.signal)
          : view === "sources"
            ? deps.refreshSources(baseId, refresh.signal)
            : view === "resources" || view === "resource-detail"
              ? deps.refreshResources(baseId, refresh.signal)
              : deps.refreshActivity(baseId, refresh.signal);

      task
        .then(() => {
          failures = 0;
        })
        .catch((error) => {
          if (refresh.signal.aborted) return;
          failures += 1;
          console.warn("Pulse workspace refresh failed", error);
        })
        .finally(() => {
          if (currentRefresh === refresh) currentRefresh = undefined;
          schedule(Math.min(60_000, intervalSeconds * 1000 * Math.max(1, 2 ** failures)));
        });
    };

    schedule(intervalSeconds * 1000);
    onCleanup(() => {
      disposed = true;
      if (timer) clearTimeout(timer);
      currentRefresh?.abort();
    });
  });
};
