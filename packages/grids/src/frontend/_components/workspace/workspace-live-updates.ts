import { type Accessor, createEffect, onCleanup, onMount } from "solid-js";
import { createGridsRecordEventsProvider } from "../records-view/grids-record-events-provider";
import { dashboardRecordTableIds } from "./dashboard-live-dependencies";
import { createGridsMetadataEventsProvider } from "./grids-metadata-events-provider";
import type { GridsWorkspaceState } from "./workspace-state";

type OkWorkspaceState = Extract<GridsWorkspaceState, { kind: "ok" }>;

type WorkspaceLiveUpdatesOptions = {
  state: Accessor<OkWorkspaceState>;
  applyWorkspaceHref: (href: string, options?: { preserveScroll?: boolean }) => Promise<boolean>;
  currentWorkspaceHref: () => string;
};

export const useWorkspaceLiveUpdates = ({ state, applyWorkspaceHref, currentWorkspaceHref }: WorkspaceLiveUpdatesOptions) => {
  let metadataRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let metadataPendingCursor: string | null = null;
  let metadataRefreshInFlight = false;
  let metadataProvider: ReturnType<typeof createGridsMetadataEventsProvider> | null = null;
  let dashboardRecordRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let dashboardRecordRefreshInFlight = false;
  let dashboardRecordRefreshQueued = false;
  let dashboardRecordProviderKey = "";
  let dashboardRecordProviders = new Map<string, ReturnType<typeof createGridsRecordEventsProvider>>();
  const dashboardRecordPendingCursors = new Map<string, string | null>();

  const runMetadataRefresh = async () => {
    if (metadataRefreshInFlight) return;
    metadataRefreshInFlight = true;
    const cursorToApply = metadataPendingCursor;
    let applied = false;
    try {
      applied = await applyWorkspaceHref(currentWorkspaceHref(), { preserveScroll: true });
      if (applied) {
        metadataProvider?.markApplied(cursorToApply);
        if (metadataPendingCursor === cursorToApply) metadataPendingCursor = null;
      }
    } catch (error) {
      console.warn("Could not refresh Grids workspace metadata", error);
    } finally {
      metadataRefreshInFlight = false;
      if (metadataPendingCursor && (!applied || metadataPendingCursor !== cursorToApply)) scheduleMetadataRefresh();
    }
  };

  const scheduleMetadataRefresh = () => {
    if (metadataRefreshTimer) clearTimeout(metadataRefreshTimer);
    metadataRefreshTimer = setTimeout(() => {
      metadataRefreshTimer = null;
      void runMetadataRefresh();
    }, 200);
  };

  const disposeDashboardRecordProviders = () => {
    for (const provider of dashboardRecordProviders.values()) provider.dispose();
    dashboardRecordProviders = new Map();
    dashboardRecordPendingCursors.clear();
    if (dashboardRecordRefreshTimer) {
      clearTimeout(dashboardRecordRefreshTimer);
      dashboardRecordRefreshTimer = null;
    }
  };

  const runDashboardRecordRefresh = async () => {
    if (state().route.kind !== "dashboard") return;
    if (dashboardRecordRefreshInFlight) {
      dashboardRecordRefreshQueued = true;
      return;
    }
    dashboardRecordRefreshInFlight = true;
    dashboardRecordRefreshQueued = false;
    const cursorsToApply = new Map(dashboardRecordPendingCursors);
    let applied = false;
    try {
      applied = await applyWorkspaceHref(currentWorkspaceHref(), { preserveScroll: true });
      if (applied) {
        for (const [tableId, cursor] of cursorsToApply) {
          dashboardRecordProviders.get(tableId)?.markApplied(cursor);
          if (dashboardRecordPendingCursors.get(tableId) === cursor) dashboardRecordPendingCursors.delete(tableId);
        }
      }
    } catch (error) {
      console.warn("Could not refresh Grids dashboard widgets", error);
    } finally {
      dashboardRecordRefreshInFlight = false;
      const shouldRunAgain = dashboardRecordRefreshQueued || dashboardRecordPendingCursors.size > 0;
      dashboardRecordRefreshQueued = false;
      if (shouldRunAgain) scheduleDashboardRecordRefresh();
    }
  };

  const scheduleDashboardRecordRefresh = () => {
    if (dashboardRecordRefreshTimer) clearTimeout(dashboardRecordRefreshTimer);
    dashboardRecordRefreshTimer = setTimeout(() => {
      dashboardRecordRefreshTimer = null;
      void runDashboardRecordRefresh();
    }, 200);
  };

  const refreshActiveDashboardRoute = () => {
    if (state().route.kind !== "dashboard") return;
    dashboardRecordRefreshQueued = true;
    scheduleDashboardRecordRefresh();
  };

  onMount(() => {
    metadataProvider = createGridsMetadataEventsProvider({
      baseId: state().base.id,
      onReady: () => {
        const route = state().route;
        if (route.kind === "query" && route.initialPreview !== undefined) return;
        scheduleMetadataRefresh();
      },
      onEvent: (cursor) => {
        metadataPendingCursor = cursor ?? metadataPendingCursor;
        scheduleMetadataRefresh();
      },
      onRevoked: () => {
        void applyWorkspaceHref(currentWorkspaceHref()).catch(() => window.location.reload());
      },
      onFatal: (error) => {
        console.warn("Grids workspace metadata live updates stopped", error);
      },
    });
    metadataProvider.connect();

    onCleanup(() => {
      if (metadataRefreshTimer) clearTimeout(metadataRefreshTimer);
      metadataProvider?.dispose();
      metadataProvider = null;
      disposeDashboardRecordProviders();
    });
  });

  createEffect(() => {
    const tableIds = dashboardRecordTableIds(state());
    const route = state().route;
    const dashboardId = route.kind === "dashboard" ? route.dashboard.id : undefined;
    const key = dashboardId ? `${dashboardId}:${tableIds.join(":")}` : tableIds.join(":");
    if (key === dashboardRecordProviderKey) return;

    disposeDashboardRecordProviders();
    dashboardRecordProviderKey = key;
    if (tableIds.length === 0) return;

    const providers = new Map<string, ReturnType<typeof createGridsRecordEventsProvider>>();
    for (const tableId of tableIds) {
      const provider = createGridsRecordEventsProvider({
        tableId,
        dashboardId,
        onReady: scheduleDashboardRecordRefresh,
        onEvent: (_event, cursor) => {
          dashboardRecordPendingCursors.set(tableId, cursor);
          scheduleDashboardRecordRefresh();
        },
        onRevoked: () => {
          void applyWorkspaceHref(currentWorkspaceHref()).catch(() => window.location.reload());
        },
        onFatal: (error) => {
          console.warn("Grids dashboard live updates stopped", error);
        },
      });
      providers.set(tableId, provider);
      provider.connect();
    }
    dashboardRecordProviders = providers;
  });

  return { refreshDashboardRecords: runDashboardRecordRefresh, refreshActiveDashboardRoute };
};
