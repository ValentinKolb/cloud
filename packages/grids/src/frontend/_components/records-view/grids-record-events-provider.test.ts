import { afterEach, describe, expect, test } from "bun:test";
import { createGridsRecordEventsProvider } from "./grids-record-events-provider";

const TABLE_ID = "011d8753-3ef9-4ebe-b7ed-fab4bb08c8e1";
const OTHER_TABLE_ID = "111d8753-3ef9-4ebe-b7ed-fab4bb08c8e1";
const DASHBOARD_ID = "222d8753-3ef9-4ebe-b7ed-fab4bb08c8e1";

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

const lastSubscribeCursor = (socket: FakeWebSocket): unknown => {
  const payload = JSON.parse(socket.sent.at(-1) ?? "{}") as { payload?: { fromCursor?: unknown } };
  return payload.payload?.fromCursor;
};

const recordEvent = (overrides: Partial<{ tableId: string; type: string; recordId: string; cursor: string }> = {}) => ({
  type: "grids.records.event",
  payload: {
    tableId: overrides.tableId ?? TABLE_ID,
    cursor: overrides.cursor ?? "7-1",
    event: {
      v: 1,
      type: overrides.type ?? "record.created",
      baseId: "base-1",
      tableId: overrides.tableId ?? TABLE_ID,
      recordId: overrides.recordId ?? "record-1",
      version: 1,
      changedFieldIds: [],
      actorId: null,
      occurredAt: "2026-05-29T00:00:00.000Z",
    },
  },
});

describe("createGridsRecordEventsProvider", () => {
  test("resubscribes only from the last applied cursor", () => {
    installFakeBrowser();
    const provider = createGridsRecordEventsProvider({ tableId: TABLE_ID });

    provider.connect();
    FakeWebSocket.instances[0]!.open();
    expect(lastSubscribeCursor(FakeWebSocket.instances[0]!)).toBe(null);

    FakeWebSocket.instances[0]!.message(recordEvent());

    FakeWebSocket.instances[0]!.close(1006);
    FakeWebSocket.instances[1]!.open();
    expect(lastSubscribeCursor(FakeWebSocket.instances[1]!)).toBe(null);

    provider.markApplied("7-1");
    FakeWebSocket.instances[1]!.close(1006);
    FakeWebSocket.instances[2]!.open();
    expect(lastSubscribeCursor(FakeWebSocket.instances[2]!)).toBe("7-1");

    provider.dispose();
  });

  test("does not reconnect after terminal websocket closes", () => {
    installFakeBrowser();
    const fatal: string[] = [];
    const provider = createGridsRecordEventsProvider({
      tableId: TABLE_ID,
      onFatal: (error) => fatal.push(error.code),
    });

    provider.connect();
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.close(1008, "access_denied");

    expect(fatal).toEqual(["access_denied"]);
    expect(FakeWebSocket.instances).toHaveLength(1);

    provider.dispose();
  });

  test("reconnects after transient stream failures", () => {
    installFakeBrowser();
    const fatal: string[] = [];
    const provider = createGridsRecordEventsProvider({
      tableId: TABLE_ID,
      onFatal: (error) => fatal.push(error.code),
    });

    provider.connect();
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.message({
      type: "grids.records.error",
      payload: { code: "stream_failed", message: "Record event stream failed", tableId: TABLE_ID },
    });
    FakeWebSocket.instances[0]!.close(1012, "stream_failed");
    FakeWebSocket.instances[1]!.open();

    expect(fatal).toEqual([]);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(lastSubscribeCursor(FakeWebSocket.instances[1]!)).toBe(null);

    provider.dispose();
  });

  test("reconnects transient closes and keeps subscribed table", () => {
    installFakeBrowser();
    const provider = createGridsRecordEventsProvider({ tableId: TABLE_ID });

    provider.connect();
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.close(1006);
    FakeWebSocket.instances[1]!.open();

    const payload = JSON.parse(FakeWebSocket.instances[1]!.sent.at(-1) ?? "{}") as { payload?: { tableId?: unknown; fromCursor?: unknown } };
    expect(payload.payload?.tableId).toBe(TABLE_ID);
    expect(payload.payload?.fromCursor).toBe(null);

    provider.dispose();
  });

  test("includes dashboard scope when subscribing for dashboard widgets", () => {
    installFakeBrowser();
    const provider = createGridsRecordEventsProvider({ tableId: TABLE_ID, dashboardId: DASHBOARD_ID });

    provider.connect();
    FakeWebSocket.instances[0]!.open();

    const payload = JSON.parse(FakeWebSocket.instances[0]!.sent.at(-1) ?? "{}") as { payload?: { tableId?: unknown; dashboardId?: unknown } };
    expect(payload.payload?.tableId).toBe(TABLE_ID);
    expect(payload.payload?.dashboardId).toBe(DASHBOARD_ID);

    provider.dispose();
  });

  test("accepts coarse dashboard record invalidations without record payload", () => {
    installFakeBrowser();
    const seen: Array<{ event: unknown; cursor: string | null }> = [];
    const provider = createGridsRecordEventsProvider({
      tableId: TABLE_ID,
      dashboardId: DASHBOARD_ID,
      onEvent: (event, cursor) => seen.push({ event, cursor }),
    });

    provider.connect();
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.message({
      type: "grids.records.event",
      payload: { tableId: TABLE_ID, cursor: "8-1" },
    });
    FakeWebSocket.instances[0]!.message({
      type: "grids.records.event",
      payload: { tableId: OTHER_TABLE_ID, cursor: "8-2" },
    });

    expect(seen).toEqual([{ event: null, cursor: "8-1" }]);

    provider.dispose();
  });

  test("filters unrelated table and malformed events", () => {
    installFakeBrowser();
    const seen: string[] = [];
    const provider = createGridsRecordEventsProvider({
      tableId: TABLE_ID,
      onEvent: (event) => {
        if (event) seen.push(event.recordId);
      },
    });

    provider.connect();
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.message(recordEvent({ tableId: OTHER_TABLE_ID, recordId: "other" }));
    FakeWebSocket.instances[0]!.message(recordEvent({ type: "automation.run", recordId: "bad-type" }));
    FakeWebSocket.instances[0]!.message(recordEvent({ recordId: "visible" }));

    expect(seen).toEqual(["visible"]);

    provider.dispose();
  });

  test("surfaces revoked access without reconnecting", () => {
    installFakeBrowser();
    const revoked: string[] = [];
    const provider = createGridsRecordEventsProvider({
      tableId: TABLE_ID,
      onRevoked: (error) => revoked.push(error.code),
    });

    provider.connect();
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.message({
      type: "grids.records.revoked",
      payload: { code: "access_denied", message: "Access was revoked.", tableId: TABLE_ID },
    });
    FakeWebSocket.instances[0]!.close(1008, "access_denied");

    expect(revoked).toEqual(["access_denied"]);
    expect(FakeWebSocket.instances).toHaveLength(1);

    provider.dispose();
  });
});
