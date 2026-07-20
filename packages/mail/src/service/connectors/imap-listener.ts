import type { ExistsEvent, ExpungeEvent, FlagsEvent, ImapFlow, MailboxObject, MailboxOpenOptions } from "imapflow";
import type { ConnectorChangeHint, ConnectorChangeListener, ConnectorChangeListenerRequest } from "./contract";

type QresyncMailboxOpenOptions = MailboxOpenOptions & {
  changedSince?: bigint;
  uidValidity?: bigint;
};

type ListenerClient = Pick<ImapFlow, "capabilities" | "enabled" | "mailboxOpen" | "close" | "logout" | "usable" | "on"> & {
  idle(): Promise<boolean | void>;
  off(event: "close", listener: () => void): ImapFlow;
  off(event: "error", listener: (error: Error) => void): ImapFlow;
  off(event: "exists", listener: (event: ExistsEvent) => void): ImapFlow;
  off(event: "expunge", listener: (event: ExpungeEvent) => void): ImapFlow;
  off(event: "flags", listener: (event: FlagsEvent) => void): ImapFlow;
};

type QueueWaiter<T> = {
  resolve(value: IteratorResult<T>): void;
};

export class BoundedAsyncQueue<T> implements AsyncIterable<T> {
  readonly #limit: number;
  readonly #values: T[] = [];
  readonly #waiters: QueueWaiter<T>[] = [];
  #closed = false;

  constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Queue limit must be a positive integer");
    this.#limit = limit;
  }

  push(value: T): boolean {
    if (this.#closed) return false;
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value });
      return true;
    }
    if (this.#values.length >= this.#limit) return false;
    this.#values.push(value);
    return true;
  }

  replaceAndClose(value: T): void {
    if (this.#closed) return;
    this.#values.length = 0;
    const waiter = this.#waiters.shift();
    if (waiter) waiter.resolve({ done: false, value });
    else this.#values.push(value);
    this.close();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#values.length > 0) return;
    for (const waiter of this.#waiters.splice(0)) waiter.resolve({ done: true, value: undefined });
  }

  async next(): Promise<IteratorResult<T>> {
    const value = this.#values.shift();
    if (value !== undefined) {
      if (this.#closed && this.#values.length === 0) {
        for (const waiter of this.#waiters.splice(0)) waiter.resolve({ done: true, value: undefined });
      }
      return { done: false, value };
    }
    if (this.#closed) return { done: true, value: undefined };
    return new Promise<IteratorResult<T>>((resolve) => this.#waiters.push({ resolve }));
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }
}

const hasCapability = (client: ListenerClient, name: string): boolean => client.capabilities.has(name) || client.enabled.has(name);

const parsePositiveBigInt = (value: string | null): bigint | null => {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

const openMailbox = async (
  client: ListenerClient,
  request: ConnectorChangeListenerRequest,
): Promise<{ mailbox: MailboxObject; qresync: boolean }> => {
  const uidValidity = parsePositiveBigInt(request.uidValidity);
  const highestModseq = parsePositiveBigInt(request.highestModseq);
  const qresync = Boolean(uidValidity && highestModseq && hasCapability(client, "QRESYNC"));
  const options: QresyncMailboxOpenOptions = {
    readOnly: true,
    ...(qresync ? { uidValidity: uidValidity!, changedSince: highestModseq! } : {}),
  };
  const mailbox = await (client.mailboxOpen as (path: string, options?: QresyncMailboxOpenOptions) => Promise<MailboxObject>)(
    request.folderPath,
    options,
  );
  return { mailbox, qresync };
};

export const openImapChangeListener = async (
  client: ListenerClient,
  request: ConnectorChangeListenerRequest,
): Promise<ConnectorChangeListener> => {
  const queue = new BoundedAsyncQueue<ConnectorChangeHint>(request.maxPendingHints);
  let closing = false;
  let closed = false;
  let idleTask: Promise<void> | null = null;
  let closeTask: Promise<void> | null = null;

  const closeSocket = (): void => {
    if (closed) return;
    closed = true;
    client.close();
  };
  const push = (hint: ConnectorChangeHint): void => {
    if (queue.push(hint)) return;
    queue.replaceAndClose({ type: "overflow", folderPath: request.folderPath });
    closeSocket();
  };
  const onExists = (event: ExistsEvent): void => {
    if (event.path !== request.folderPath) return;
    push({ type: "folder_changed", cause: "exists", folderPath: event.path, uid: null, modseq: null });
  };
  const onFlags = (event: FlagsEvent): void => {
    if (event.path !== request.folderPath) return;
    push({
      type: "folder_changed",
      cause: "flags",
      folderPath: event.path,
      uid: event.uid ?? null,
      modseq: event.modseq?.toString() ?? null,
    });
  };
  const onExpunge = (event: ExpungeEvent): void => {
    if (event.path !== request.folderPath) return;
    push({
      type: "folder_changed",
      cause: "vanished",
      folderPath: event.path,
      uid: event.uid ?? null,
      modseq: null,
    });
  };
  const onError = (): void => {
    if (!closing) push({ type: "disconnected", folderPath: request.folderPath, reason: "error" });
    queue.close();
    closeSocket();
  };
  const onClose = (): void => {
    closed = true;
    if (!closing) push({ type: "disconnected", folderPath: request.folderPath, reason: "closed" });
    queue.close();
  };

  client.on("exists", onExists);
  client.on("flags", onFlags);
  client.on("expunge", onExpunge);
  client.on("error", onError);
  client.on("close", onClose);

  try {
    const selected = await openMailbox(client, request);
    if (selected.mailbox.uidValidity.toString() !== request.uidValidity) {
      push({
        type: "folder_changed",
        cause: "uidvalidity_changed",
        folderPath: request.folderPath,
        uid: null,
        modseq: null,
      });
    }
    const idle = hasCapability(client, "IDLE");
    const qresyncApplied = (selected.mailbox as MailboxObject & { qresync?: boolean }).qresync === true;
    const mode = idle ? (selected.qresync && qresyncApplied ? "qresync" : "idle") : "poll";
    if (idle) {
      idleTask = (async () => {
        while (!closing && client.usable) {
          const completed = await client.idle();
          if (closing || !client.usable) return;
          if (completed === false) {
            throw Object.assign(new Error("IMAP IDLE cycle failed"), { code: "IMAP_IDLE_FAILED" });
          }
          // Avoid a tight retry loop if a broken server completes IDLE immediately.
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
      })().catch(onError);
    }
    return {
      mode,
      hints: queue,
      close: () => {
        if (closeTask) return closeTask;
        closing = true;
        client.off("exists", onExists);
        client.off("flags", onFlags);
        client.off("expunge", onExpunge);
        queue.close();
        closeTask = (async () => {
          try {
            if (!closed) {
              if (client.usable) await client.logout();
              else client.close();
            }
          } catch {
            client.close();
          } finally {
            closed = true;
            await idleTask?.catch(() => undefined);
            client.off("error", onError);
            client.off("close", onClose);
          }
        })();
        return closeTask;
      },
    };
  } catch (error) {
    closing = true;
    client.off("exists", onExists);
    client.off("flags", onFlags);
    client.off("expunge", onExpunge);
    client.off("error", onError);
    client.off("close", onClose);
    queue.close();
    closeSocket();
    throw error;
  }
};
