import { topic } from "@valentinkolb/sync";
import { z } from "zod";
import { notebooksYjs } from "../lib/yjs";

export const TOPIC_PREFIX = "cloud:notebooks:yjs";
export const TOPIC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const NODE_ID = process.env.CLOUD_NODE_ID?.trim() || process.env.HOSTNAME?.trim() || crypto.randomUUID();

export const YjsTopicEventSchema = z.object({
  kind: z.enum(["sync", "awareness"]),
  payload: z.string().min(1),
  originNodeId: z.string().min(1),
  originPeerId: z.string().nullable(),
});

export type YjsTopicEvent = z.infer<typeof YjsTopicEventSchema>;
const STREAM_CURSOR_REGEX = new RegExp(notebooksYjs.streamCursorPattern);

export const createYjsTopic = (noteId: string) =>
  topic({
    id: noteId,
    schema: YjsTopicEventSchema,
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
