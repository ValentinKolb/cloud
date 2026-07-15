import { describe, expect, mock, test } from "bun:test";
import { invokeWorkflowScannerRequest, type WorkflowScannerTransport, workflowScannerResponseKind } from "./workflow-scanner-request";

const accepted = () => new Response(null, { status: 200 });

describe("workflow scanner requests", () => {
  test("passes stable operation and revision data through dashboard retries", async () => {
    const invokeDashboard = mock(async (_input: Parameters<WorkflowScannerTransport["invokeDashboard"]>[0]) => accepted());
    const transport: WorkflowScannerTransport = {
      invokeDashboard,
      invokeLauncher: mock(async (_input: Parameters<WorkflowScannerTransport["invokeLauncher"]>[0]) => accepted()),
    };
    const target = { launcherId: "launcher-1", dashboardId: "dashboard-1", dashboardWidgetId: "widget-1" };
    const request = { operationId: "scan-1", expectedRevision: 7, code: "asset-42" };

    await invokeWorkflowScannerRequest(transport, target, request);
    await invokeWorkflowScannerRequest(transport, target, request);

    expect(invokeDashboard).toHaveBeenCalledTimes(2);
    expect(invokeDashboard.mock.calls.map(([input]) => input)).toEqual([
      {
        param: { dashboardId: "dashboard-1", widgetId: "widget-1" },
        json: request,
      },
      {
        param: { dashboardId: "dashboard-1", widgetId: "widget-1" },
        json: request,
      },
    ]);
  });

  test("maps standalone scans to the launcher request contract", async () => {
    const invokeLauncher = mock(async (_input: Parameters<WorkflowScannerTransport["invokeLauncher"]>[0]) => accepted());
    const transport: WorkflowScannerTransport = {
      invokeDashboard: mock(async (_input: Parameters<WorkflowScannerTransport["invokeDashboard"]>[0]) => accepted()),
      invokeLauncher,
    };

    await invokeWorkflowScannerRequest(
      transport,
      { launcherId: "launcher-1" },
      { operationId: "scan-2", expectedRevision: 3, code: "asset-99" },
    );

    expect(invokeLauncher).toHaveBeenCalledWith({
      param: { launcherId: "launcher-1" },
      json: {
        operationId: "scan-2",
        mode: "execute",
        expectedRevision: 3,
        inputs: {},
        scannedText: "asset-99",
      },
    });
  });

  test("classifies revision conflicts as scanner-pausing responses", () => {
    expect(workflowScannerResponseKind({ ok: false, status: 409 })).toBe("revision-conflict");
    expect(workflowScannerResponseKind({ ok: false, status: 503 })).toBe("failed");
    expect(workflowScannerResponseKind({ ok: true, status: 200 })).toBe("accepted");
  });
});
