import { afterEach, describe, expect, test } from "bun:test";
import { createGridsMetadataEventsProvider } from "./grids-metadata-events-provider";

const BASE_ID = "85232148-725f-47af-999a-8379a83ef5f2";
const OTHER_BASE_ID = "95232148-725f-47af-999a-8379a83ef5f2";

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

const metadataEvent = (overrides: Partial<{ baseId: string; type: string; cursor: string }> = {}) => ({
  type: "grids.metadata.event",
  payload: {
    baseId: overrides.baseId ?? BASE_ID,
    cursor: overrides.cursor ?? "8-1",
    event: {
      v: 1,
      type: overrides.type ?? "table.updated",
      baseId: overrides.baseId ?? BASE_ID,
      resource: { kind: "table", id: "table-1", tableId: "table-1" },
      actorId: null,
      occurredAt: "2026-05-31T00:00:00.000Z",
    },
  },
});

describe("createGridsMetadataEventsProvider", () => {
  test("subscribes by base and resumes from the last applied cursor", () => {
    installFakeBrowser();
    const provider = createGridsMetadataEventsProvider({ baseId: BASE_ID });

    provider.connect();
    FakeWebSocket.instances[0]!.open();
    const firstSubscribe = JSON.parse(FakeWebSocket.instances[0]!.sent.at(-1) ?? "{}") as { payload?: { baseId?: unknown } };
    expect(firstSubscribe.payload?.baseId).toBe(BASE_ID);
    expect(lastSubscribeCursor(FakeWebSocket.instances[0]!)).toBe(null);

    FakeWebSocket.instances[0]!.message(metadataEvent());
    FakeWebSocket.instances[0]!.close(1006);
    FakeWebSocket.instances[1]!.open();
    expect(lastSubscribeCursor(FakeWebSocket.instances[1]!)).toBe(null);

    provider.markApplied("8-1");
    FakeWebSocket.instances[1]!.close(1006);
    FakeWebSocket.instances[2]!.open();
    expect(lastSubscribeCursor(FakeWebSocket.instances[2]!)).toBe("8-1");

    provider.dispose();
  });

  test("filters unrelated base events", () => {
    installFakeBrowser();
    const cursors: Array<string | null> = [];
    const provider = createGridsMetadataEventsProvider({
      baseId: BASE_ID,
      onEvent: (cursor) => cursors.push(cursor),
    });

    provider.connect();
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.message(metadataEvent({ baseId: OTHER_BASE_ID, cursor: "8-2" }));
    FakeWebSocket.instances[0]!.message(metadataEvent({ cursor: "8-3" }));

    expect(cursors).toEqual(["8-3"]);
    provider.dispose();
  });

  test("stops after revoked access", () => {
    installFakeBrowser();
    const revoked: string[] = [];
    const provider = createGridsMetadataEventsProvider({
      baseId: BASE_ID,
      onRevoked: (error) => revoked.push(error.code),
    });

    provider.connect();
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.message({
      type: "grids.metadata.revoked",
      payload: { code: "access_denied", message: "Access was revoked.", baseId: BASE_ID },
    });
    FakeWebSocket.instances[0]!.close(1008, "access_denied");

    expect(revoked).toEqual(["access_denied"]);
    expect(FakeWebSocket.instances).toHaveLength(1);
    provider.dispose();
  });
});
