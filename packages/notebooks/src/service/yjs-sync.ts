import { topic } from "@valentinkolb/sync";
import * as Y from "yjs";
import { notebooksYjs } from "../lib/yjs";

export const TOPIC_PREFIX = "cloud:notebooks:yjs";
export const TOPIC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const NODE_ID = crypto.randomUUID();

/**
 * Yjs realtime event shape — internal data produced and consumed by our own
 * code; no runtime validation needed (generics give us type safety).
 */
export type YjsTopicEvent = {
  kind: "sync" | "awareness";
  payload: string;
  originNodeId: string;
  originPeerId: string | null;
};

const STREAM_CURSOR_REGEX = new RegExp(notebooksYjs.streamCursorPattern);

export const createYjsTopic = (noteId: string) =>
  topic<YjsTopicEvent>({
    id: noteId,
    prefix: TOPIC_PREFIX,
    retentionMs: TOPIC_RETENTION_MS,
  });

export const toBase64 = (data: Uint8Array): string => Buffer.from(data).toString("base64");
export const fromBase64 = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, "base64"));

export const parseStreamCursor = (cursor: string | null | undefined): { ms: number; seq: number } | null => {
  if (!cursor) return null;
  if (!STREAM_CURSOR_REGEX.test(cursor)) return null;
  const [msValue, seqValue] = cursor.split("-");
  if (!msValue || !seqValue) return null;
  return {
    ms: Number.parseInt(msValue, 10),
    seq: Number.parseInt(seqValue, 10),
  };
};

export const compareStreamCursor = (left: string, right: string): number => {
  const l = parseStreamCursor(left);
  const r = parseStreamCursor(right);
  if (!l || !r) throw new Error(`Invalid stream cursor comparison: "${left}" vs "${right}"`);
  if (l.ms !== r.ms) return l.ms - r.ms;
  return l.seq - r.seq;
};

export const maxStreamCursor = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return compareStreamCursor(a, b) >= 0 ? a : b;
};

export const applyYjsTopicEvent = (doc: Y.Doc, event: { cursor: string; data: YjsTopicEvent }, noteId: string): void => {
  if (event.data.kind !== "sync") return;
  try {
    Y.applyUpdate(doc, fromBase64(event.data.payload), `replay:${event.cursor}`);
  } catch (error) {
    throw new Error(
      `Malformed sync event for note ${noteId} at cursor ${event.cursor}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const replayYjsTopicToCursor = async (config: {
  noteId: string;
  after: string;
  targetCursor: string;
  doc: Y.Doc;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<void> => {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort("replay-timeout"), config.timeoutMs ?? 5_000);
  const onAbort = () => abort.abort("caller-aborted");
  config.signal?.addEventListener("abort", onAbort, { once: true });

  let reachedTarget = false;
  let passedTarget = false;
  try {
    const noteTopic = createYjsTopic(config.noteId);
    for await (const event of noteTopic.live({
      after: config.after,
      signal: abort.signal,
      timeoutMs: 1_000,
    })) {
      const comparison = compareStreamCursor(event.cursor, config.targetCursor);
      if (comparison > 0) {
        passedTarget = true;
        break;
      }
      applyYjsTopicEvent(config.doc, event, config.noteId);
      if (comparison === 0) {
        reachedTarget = true;
        break;
      }
    }
  } finally {
    clearTimeout(timeout);
    config.signal?.removeEventListener("abort", onAbort);
  }

  if (!reachedTarget && !passedTarget) {
    throw new Error(`Target cursor "${config.targetCursor}" was not reached during replay`);
  }
};
