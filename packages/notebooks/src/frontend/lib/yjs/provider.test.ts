import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { notebooksWorkspace } from "../../../lib/workspace-events";
import { createYjsProvider } from "./provider";

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(value: string) {
    this.sent.push(value);
  }

  close() {
    this.readyState = 3;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

const workspaceSubscriptions = (socket: FakeWebSocket) =>
  socket.sent
    .map((value) => JSON.parse(value) as { type: string; payload: { fromCursor?: string | null } })
    .filter((value) => value.type === notebooksWorkspace.wsType.subscribe);

let originalWebSocket: typeof WebSocket | undefined;

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  Object.assign(globalThis, { WebSocket: FakeWebSocket });
});

afterEach(() => {
  if (originalWebSocket) Object.assign(globalThis, { WebSocket: originalWebSocket });
  else Reflect.deleteProperty(globalThis, "WebSocket");
});

describe("Yjs provider workspace cursor coverage", () => {
  test("advances the workspace replay cursor only after async coverage", async () => {
    const doc = new Y.Doc();
    let release!: () => void;
    const coverage = new Promise<void>((resolve) => {
      release = resolve;
    });
    const confirmed: string[] = [];
    const provider = createYjsProvider({
      doc,
      awareness: new Awareness(doc),
      noteId: "note-id",
      appUrl: "http://localhost",
      workspace: {
        notebookId: "notebook-id",
        initialCursor: "1-0",
        onEvent: () => coverage,
        onCursorChange: (cursor) => confirmed.push(cursor),
      },
    });

    provider.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: notebooksWorkspace.wsType.ready, payload: { notebookId: "notebook-id" } });
    socket.message({
      type: notebooksWorkspace.wsType.event,
      payload: {
        notebookId: "notebook-id",
        cursor: "2-0",
        event: { v: 1, type: "workspace.invalidated", notebookId: "notebook-id", reason: "bulk", scopes: ["tree"] },
      },
    });

    socket.open();
    expect(workspaceSubscriptions(socket).at(-1)?.payload.fromCursor).toBe("1-0");
    release();
    await coverage;
    await Promise.resolve();
    expect(confirmed).toEqual(["2-0"]);
    socket.open();
    expect(workspaceSubscriptions(socket).at(-1)?.payload.fromCursor).toBe("2-0");
    provider.dispose();
  });

  test("processes workspace events in cursor order", async () => {
    const doc = new Y.Doc();
    let releaseFirst!: () => void;
    const firstCoverage = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const seen: string[] = [];
    const provider = createYjsProvider({
      doc,
      awareness: new Awareness(doc),
      noteId: "note-id",
      appUrl: "http://localhost",
      workspace: {
        notebookId: "notebook-id",
        onEvent: (_event, cursor) => {
          seen.push(cursor!);
          return cursor === "1-0" ? firstCoverage : Promise.resolve();
        },
      },
    });

    provider.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: notebooksWorkspace.wsType.ready, payload: { notebookId: "notebook-id" } });
    const payload = (cursor: string) => ({
      type: notebooksWorkspace.wsType.event,
      payload: {
        notebookId: "notebook-id",
        cursor,
        event: { v: 1, type: "workspace.invalidated", notebookId: "notebook-id", reason: "bulk", scopes: ["tree"] },
      },
    });
    socket.message(payload("1-0"));
    socket.message(payload("2-0"));
    await Promise.resolve();
    expect(seen).toEqual(["1-0"]);
    releaseFirst();
    await firstCoverage;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(["1-0", "2-0"]);
    provider.dispose();
  });

  test("closes the socket so an uncovered event is replayed", async () => {
    const doc = new Y.Doc();
    const provider = createYjsProvider({
      doc,
      awareness: new Awareness(doc),
      noteId: "note-id",
      appUrl: "http://localhost",
      workspace: {
        notebookId: "notebook-id",
        initialCursor: "1-0",
        onEvent: () => Promise.reject(new Error("refresh failed")),
      },
    });

    provider.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: notebooksWorkspace.wsType.ready, payload: { notebookId: "notebook-id" } });
    socket.message({
      type: notebooksWorkspace.wsType.event,
      payload: {
        notebookId: "notebook-id",
        cursor: "2-0",
        event: { v: 1, type: "workspace.invalidated", notebookId: "notebook-id", reason: "bulk", scopes: ["tree"] },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(socket.readyState).toBe(3);
    socket.open();
    expect(workspaceSubscriptions(socket).at(-1)?.payload.fromCursor).toBe("1-0");
    provider.dispose();
  });

  test("remains reconnectable after a recoverable workspace stream error", () => {
    const doc = new Y.Doc();
    const fatalErrors: string[] = [];
    const provider = createYjsProvider({
      doc,
      awareness: new Awareness(doc),
      noteId: "note-id",
      appUrl: "http://localhost",
      workspace: { notebookId: "notebook-id", onEvent: () => undefined },
      onFatal: (error) => fatalErrors.push(error.code),
    });

    provider.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: notebooksWorkspace.wsType.error, payload: { code: "INTERNAL_ERROR", message: "stream failed" } });

    expect(socket.readyState).toBe(3);
    expect(fatalErrors).toEqual([]);
    const subscriptionCount = workspaceSubscriptions(socket).length;
    socket.open();
    expect(workspaceSubscriptions(socket)).toHaveLength(subscriptionCount + 1);
    provider.dispose();
  });

  test("terminates after workspace access is revoked", () => {
    const doc = new Y.Doc();
    const fatalErrors: string[] = [];
    const provider = createYjsProvider({
      doc,
      awareness: new Awareness(doc),
      noteId: "note-id",
      appUrl: "http://localhost",
      workspace: { notebookId: "notebook-id", onEvent: () => undefined },
      onFatal: (error) => fatalErrors.push(error.code),
    });

    provider.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: notebooksWorkspace.wsType.revoked, payload: {} });

    expect(socket.readyState).toBe(3);
    expect(fatalErrors).toEqual(["ACCESS_REVOKED"]);
    provider.dispose();
  });
});
