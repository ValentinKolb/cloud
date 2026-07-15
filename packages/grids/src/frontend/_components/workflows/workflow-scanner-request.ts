export type WorkflowScannerRequest = {
  operationId: string;
  expectedRevision: number;
  code: string;
};

export type WorkflowScannerRequestTarget = {
  launcherId: string;
  dashboardId?: string | null;
  dashboardWidgetId?: string | null;
};

type DashboardRequestInput = {
  param: { dashboardId: string; widgetId: string };
  json: WorkflowScannerRequest;
};

type LauncherRequestInput = {
  param: { launcherId: string };
  json: {
    operationId: string;
    mode: "execute";
    expectedRevision: number;
    inputs: Record<string, never>;
    scannedText: string;
  };
};

export type WorkflowScannerTransport = {
  invokeDashboard: (input: DashboardRequestInput) => Promise<Response>;
  invokeLauncher: (input: LauncherRequestInput) => Promise<Response>;
};

export const invokeWorkflowScannerRequest = (
  transport: WorkflowScannerTransport,
  target: WorkflowScannerRequestTarget,
  request: WorkflowScannerRequest,
): Promise<Response> => {
  if (target.dashboardId && target.dashboardWidgetId) {
    return transport.invokeDashboard({
      param: { dashboardId: target.dashboardId, widgetId: target.dashboardWidgetId },
      json: request,
    });
  }
  return transport.invokeLauncher({
    param: { launcherId: target.launcherId },
    json: {
      operationId: request.operationId,
      mode: "execute",
      expectedRevision: request.expectedRevision,
      inputs: {},
      scannedText: request.code,
    },
  });
};

export const workflowScannerResponseKind = (response: Pick<Response, "ok" | "status">): "accepted" | "revision-conflict" | "failed" =>
  response.ok ? "accepted" : response.status === 409 ? "revision-conflict" : "failed";
