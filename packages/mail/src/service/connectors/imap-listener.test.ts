import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ImapFlow, MailboxObject } from "imapflow";
import { BoundedAsyncQueue, openImapChangeListener } from "./imap-listener";

class FakeImapClient extends EventEmitter {
  readonly capabilities = new Map<string, boolean>();
  readonly enabled = new Set<string>();
  usable = true;
  closed = false;
  logoutCalls = 0;
  errorHandlersDuringLogout = 0;
  idleCalls = 0;
  idleResults: (boolean | undefined)[] = [];
  #resolveIdle: ((value: boolean) => void) | null = null;
  mailboxOpenOptions: Record<string, unknown> | undefined;
  mailbox: MailboxObject = {
    path: "INBOX",
    delimiter: "/",
    flags: new Set(),
    uidValidity: 7n,
    uidNext: 12,
    exists: 11,
  };

  constructor(capabilities: string[]) {
    super();
    for (const capability of capabilities) {
      this.capabilities.set(capability, true);
      this.enabled.add(capability);
    }
    if (capabilities.includes("QRESYNC")) {
      this.mailbox = Object.assign(this.mailbox, { qresync: true });
    }
  }

  async mailboxOpen(_path: string, options?: Record<string, unknown>): Promise<MailboxObject> {
    this.mailboxOpenOptions = options;
    return this.mailbox;
  }

  async idle(): Promise<boolean | undefined> {
    this.idleCalls += 1;
    if (this.idleResults.length > 0) return this.idleResults.shift();
    return new Promise<boolean>((resolve) => {
      this.#resolveIdle = resolve;
    });
  }

  async logout(): Promise<void> {
    this.logoutCalls += 1;
    this.errorHandlersDuringLogout = this.listenerCount("error");
    this.usable = false;
    this.closed = true;
    this.#resolveIdle?.(false);
    this.#resolveIdle = null;
  }

  close(): void {
    this.usable = false;
    this.closed = true;
    this.#resolveIdle?.(false);
    this.#resolveIdle = null;
  }
}

const request = {
  folderPath: "INBOX",
  uidValidity: "7",
  highestModseq: "42",
  maxPendingHints: 8,
} as const;

describe("IMAP push listener", () => {
  test("requests QRESYNC and emits typed folder hints", async () => {
    const client = new FakeImapClient(["IDLE", "QRESYNC", "CONDSTORE"]);
    const listener = await openImapChangeListener(client as unknown as ImapFlow, request);
    expect(listener.mode).toBe("qresync");
    expect(client.mailboxOpenOptions).toMatchObject({
      readOnly: true,
      uidValidity: 7n,
      changedSince: 42n,
    });

    client.emit("exists", { path: "INBOX", count: 12, prevCount: 11 });
    client.emit("flags", { path: "INBOX", seq: 1, uid: 4, modseq: 43n, flags: new Set(["\\Seen"]) });
    client.emit("expunge", { path: "INBOX", uid: 3, vanished: true });

    const iterator = listener.hints[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "folder_changed", cause: "exists", folderPath: "INBOX", uid: null, modseq: null },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "folder_changed", cause: "flags", folderPath: "INBOX", uid: 4, modseq: "43" },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "folder_changed", cause: "vanished", folderPath: "INBOX", uid: 3, modseq: null },
    });
    await listener.close();
    expect(client.logoutCalls).toBe(1);
  });

  test("falls back to polling without IDLE and reports UIDVALIDITY changes", async () => {
    const client = new FakeImapClient([]);
    client.mailbox = { ...client.mailbox, uidValidity: 9n };
    const listener = await openImapChangeListener(client as unknown as ImapFlow, request);
    expect(listener.mode).toBe("poll");
    const hint = await listener.hints[Symbol.asyncIterator]().next();
    expect(hint).toEqual({
      done: false,
      value: {
        type: "folder_changed",
        cause: "uidvalidity_changed",
        folderPath: "INBOX",
        uid: null,
        modseq: null,
      },
    });
    await listener.close();
  });

  test("re-enters IDLE after a successful cycle", async () => {
    const client = new FakeImapClient(["IDLE"]);
    client.idleResults.push(undefined);
    const listener = await openImapChangeListener(client as unknown as ImapFlow, request);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(client.idleCalls).toBe(2);
    await listener.close();
  });

  test("fails bounded queues closed with a single overflow marker", async () => {
    const queue = new BoundedAsyncQueue<number>(2);
    expect(queue.push(1)).toBe(true);
    expect(queue.push(2)).toBe(true);
    expect(queue.push(3)).toBe(false);
    queue.replaceAndClose(99);
    await expect(queue.next()).resolves.toEqual({ done: false, value: 99 });
    await expect(queue.next()).resolves.toEqual({ done: true, value: undefined });
  });

  test("shares close work and retains transport error handling through logout", async () => {
    const client = new FakeImapClient(["IDLE"]);
    const listener = await openImapChangeListener(client as unknown as ImapFlow, request);
    const first = listener.close();
    const second = listener.close();
    expect(first).toBe(second);
    await first;
    expect(client.logoutCalls).toBe(1);
    expect(client.errorHandlersDuringLogout).toBe(1);
    expect(client.listenerCount("error")).toBe(0);
    expect(client.listenerCount("close")).toBe(0);
  });
});
