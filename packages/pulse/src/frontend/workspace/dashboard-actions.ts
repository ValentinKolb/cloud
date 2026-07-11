import type {
  PulseDashboard,
  PulseDashboardConfig,
  PulseDashboardDslCompileResult,
} from "../../contracts";
import { jsonFetch } from "../http";

export const compileDashboardDslText = (baseId: string, text: string): Promise<PulseDashboardDslCompileResult> =>
  jsonFetch<PulseDashboardDslCompileResult>("/api/pulse/dashboard-dsl/compile", {
    method: "POST",
    body: JSON.stringify({ baseId, text }),
  });

export const dashboardDslCompileError = (error: unknown): PulseDashboardDslCompileResult => ({
  ok: false,
  diagnostics: [{ severity: "error", message: error instanceof Error ? error.message : "Could not compile dashboard", line: 1, column: 1 }],
  config: null,
});

export const savePulseDashboardConfig = (dashboard: PulseDashboard, config: PulseDashboardConfig): Promise<PulseDashboard> =>
  jsonFetch<PulseDashboard>(`/api/pulse/dashboards/${dashboard.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: dashboard.name, config }),
  });

export const createPublicDashboardToken = (dashboardId: string): Promise<{ dashboard: PulseDashboard; token: string }> =>
  jsonFetch<{ dashboard: PulseDashboard; token: string }>(`/api/pulse/dashboards/${dashboardId}/public-token`, {
    method: "POST",
    body: "{}",
  });

export const deletePublicDashboardToken = (dashboardId: string): Promise<PulseDashboard> =>
  jsonFetch<PulseDashboard>(`/api/pulse/dashboards/${dashboardId}/public-token`, { method: "DELETE" });
