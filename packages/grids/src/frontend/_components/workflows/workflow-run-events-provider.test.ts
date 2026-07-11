import { afterEach, describe, expect, test } from "bun:test";
import { createWorkflowRunEventsProvider } from "./workflow-run-events-provider";

const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKFLOW_ID = "22222222-2222-4222-8222-222222222222";
const DASHBOARD_ID = "33333333-3333-4333-8333-333333333333";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  open() {
    this.onopen?.({} as Event);
  }

  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }

  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

const originalWindow = globalThis.window;
const originalWebSocket = globalThis.WebSocket;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

const installFakeBrowser = () => {
  FakeWebSocket.instances = [];
  (globalThis as unknown as { window: unknown }).window = { location: { origin: "http://localhost:3000" } };
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
    fn();
    return 1;
  }) as typeof setTimeout;
  (globalThis as unknown as { clearTimeout: unknown }).clearTimeout = (() => undefined) as typeof clearTimeout;
};

afterEach(() => {
  FakeWebSocket.instances = [];
  (globalThis as unknown as { window: unknown }).window = originalWindow;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
});

const runEvent = (workflowId = WORKFLOW_ID, cursor = "7-1") => ({
  type: "grids.workflow-runs.event",
  payload: {
    cursor,
    event: {
      v: 1,
      baseId: "44444444-4444-4444-8444-444444444444",
      workflowId,
      run: {
        id: "55555555-5555-4555-8555-555555555555",
        workflowId,
        baseId: "44444444-4444-4444-8444-444444444444",
        actorUserId: null,
        serviceAccountId: null,
        triggerKind: "scanner",
        triggerInput: {},
        resolvedInput: {},
        status: "succeeded",
        error: null,
        resultMessage: "Returned",
        createdAt: "2026-07-11T00:00:00.000Z",
        startedAt: "2026-07-11T00:00:00.100Z",
        finishedAt: "2026-07-11T00:00:00.200Z",
      },
      steps: [],
      scope: { kind: "workflow" },
    },
  },
});

describe("workflow run events provider", () => {
  test("subscribes with workflow and dashboard scope", () => {
    installFakeBrowser();
    const provider = createWorkflowRunEventsProvider({
      workflowId: WORKFLOW_ID,
      dashboardId: DASHBOARD_ID,
      dashboardWidgetId: "scanner-1",
    });

    provider.connect();
    FakeWebSocket.instances[0]!.open();

    expect(JSON.parse(FakeWebSocket.instances[0]!.sent[0] ?? "{}")).toEqual({
      type: "grids.workflow-runs.subscribe",
      payload: {
        workflowId: WORKFLOW_ID,
        dashboardId: DASHBOARD_ID,
        dashboardWidgetId: "scanner-1",
        fromCursor: null,
      },
    });
    provider.dispose();
  });

  test("accepts only scoped events and resumes from the last cursor", () => {
    installFakeBrowser();
    const received: string[] = [];
    const provider = createWorkflowRunEventsProvider({
      workflowId: WORKFLOW_ID,
      onEvent: (event) => received.push(event.run.id),
    });
    provider.connect();
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.message(runEvent(OTHER_WORKFLOW_ID));
    FakeWebSocket.instances[0]!.message(runEvent());
    FakeWebSocket.instances[0]!.close(1006);
    FakeWebSocket.instances[1]!.open();

    expect(received).toEqual(["55555555-5555-4555-8555-555555555555"]);
    const subscribe = JSON.parse(FakeWebSocket.instances[1]!.sent[0] ?? "{}") as { payload?: { fromCursor?: unknown } };
    expect(subscribe.payload?.fromCursor).toBe("7-1");
    provider.dispose();
  });

  test("treats permission closes as terminal", () => {
    installFakeBrowser();
    const fatal: string[] = [];
    const provider = createWorkflowRunEventsProvider({ workflowId: WORKFLOW_ID, onFatal: (error) => fatal.push(error.code) });
    provider.connect();
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.close(1008, "access_denied");

    expect(fatal).toEqual(["access_denied"]);
    expect(FakeWebSocket.instances).toHaveLength(1);
    provider.dispose();
  });
});
