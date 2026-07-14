import type { DateContext } from "@valentinkolb/stdlib";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { PulseDashboardSnapshot } from "../contracts";
import { jsonFetch } from "./http";
import { PublicDashboardSections } from "./PublicDashboardSections";
import {
  publicDashboardRefreshDelayMs,
  resolvePublicDashboardRefreshSeconds,
  type PublicDashboardDisplayHeight,
} from "./public-dashboard-runtime";
import { defaultPulseDateContext } from "./workspace/helpers";

type Props = {
  token: string;
  initialSnapshot: PulseDashboardSnapshot;
  initialDateConfig?: DateContext;
  displayHeight?: PublicDashboardDisplayHeight;
};

export default function PublicPulseDashboard(props: Props) {
  const [snapshot, setSnapshot] = createSignal(props.initialSnapshot);
  const dateContext = () => ({ ...defaultPulseDateContext, ...(props.initialDateConfig ?? {}) });
  const refreshIntervalSeconds = () => resolvePublicDashboardRefreshSeconds(snapshot().dashboard.config.refreshIntervalSeconds);

  const reload = async (signal?: AbortSignal) => {
    setSnapshot(
      await jsonFetch<PulseDashboardSnapshot>(`/api/pulse/public-dashboard/${props.token}`, { signal }, "Could not refresh dashboard"),
    );
  };

  const renderRefreshProgress = () => (
    <Show
      when={refreshIntervalSeconds()}
      fallback={
        <span class="inline-flex h-8 w-8 items-center justify-center text-zinc-500 dark:text-zinc-400">
          <i class="ti ti-player-pause text-sm" />
          <span class="sr-only">Manual refresh</span>
        </span>
      }
    >
      {(seconds) => (
        <span class="inline-flex h-8 w-8 items-center justify-center app-accent-text" title={`Refreshes every ${seconds()}s`}>
          <svg class="-rotate-90" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-opacity="0.18" stroke-width="3" />
            <circle
              cx="11"
              cy="11"
              r="8"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="3"
              stroke-dasharray="50.265"
              style={{ animation: `pulse-public-refresh-progress ${seconds()}s linear infinite` }}
            />
          </svg>
          <span class="sr-only">Refreshes every {seconds()} seconds</span>
        </span>
      )}
    </Show>
  );

  createEffect(() => {
    const intervalSeconds = resolvePublicDashboardRefreshSeconds(snapshot().dashboard.config.refreshIntervalSeconds);
    if (intervalSeconds === null) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let currentRefresh: AbortController | undefined;
    let failures = 0;

    const schedule = (delayMs: number) => {
      if (disposed) return;
      timer = setTimeout(run, delayMs);
    };

    const nextDelay = () => publicDashboardRefreshDelayMs(intervalSeconds, failures, Math.random());

    const run = () => {
      if (disposed) return;
      if (document.hidden) {
        schedule(intervalSeconds * 1000);
        return;
      }

      currentRefresh?.abort();
      const refresh = new AbortController();
      currentRefresh = refresh;
      reload(refresh.signal)
        .then(() => {
          failures = 0;
        })
        .catch((error) => {
          if (refresh.signal.aborted) return;
          failures += 1;
          console.warn("Pulse public dashboard refresh failed", error);
        })
        .finally(() => {
          if (currentRefresh === refresh) currentRefresh = undefined;
          schedule(nextDelay());
        });
    };

    schedule(nextDelay());
    onCleanup(() => {
      disposed = true;
      if (timer) clearTimeout(timer);
      currentRefresh?.abort();
    });
  });

  return (
    <main
      class={`bg-zinc-50 px-4 py-6 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 sm:px-6 lg:px-8 ${
        props.displayHeight === "full" ? "h-screen overflow-hidden" : "min-h-screen overflow-auto"
      }`}
    >
      <style>{`
        @keyframes pulse-public-refresh-progress {
          from { stroke-dashoffset: 50.265; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>
      <div class={`flex w-full flex-col gap-5 ${props.displayHeight === "full" ? "h-full min-h-0" : ""}`}>
        <header class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 class="text-3xl font-semibold tracking-normal">{snapshot().dashboard.name}</h1>
          </div>
          {renderRefreshProgress()}
        </header>

        <Show
          when={snapshot().dashboard.config.layout?.sections.length}
          fallback={<p class="paper p-8 text-center text-sm text-dimmed">This dashboard has no widgets.</p>}
        >
          <section class={`space-y-6 ${props.displayHeight === "full" ? "min-h-0 flex-1 overflow-hidden" : ""}`}>
            <PublicDashboardSections snapshot={snapshot()} dateContext={dateContext()} />
          </section>
        </Show>
      </div>
    </main>
  );
}
