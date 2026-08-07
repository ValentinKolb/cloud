import { describe, expect, mock, test } from "bun:test";
import { invokeWorkflowScannerRequest, type WorkflowScannerTransport, workflowScannerResponseKind } from "./workflow-scanner-request";

const accepted = () => new Response(null, { status: 200 });

describe("workflow scanner requests", () => {
  test("maps standalone scans to the launcher request contract", async () => {
    const invokeLauncher = mock(async (_input: Parameters<WorkflowScannerTransport["invokeLauncher"]>[0]) => accepted());
    const transport: WorkflowScannerTransport = {
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
