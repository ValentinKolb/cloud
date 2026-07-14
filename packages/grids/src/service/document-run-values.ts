import { Buffer } from "node:buffer";
import { z } from "zod";
import type { DocumentRun } from "../contracts";

const FILENAME_MAX_CHARS = 255;

export const normalizeDocumentTags = (tags: readonly string[] | null | undefined): string[] =>
  [...new Set((tags ?? []).map((tag) => tag.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 20);

export const safePdfFilename = (value: string, fallback: string): string => {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[/:*?"<>|\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
  const withFallback = cleaned || fallback;
  const withExtension = /\.pdf$/i.test(withFallback) ? withFallback : `${withFallback}.pdf`;
  if (withExtension.length <= FILENAME_MAX_CHARS) return withExtension;
  return `${withExtension.slice(0, FILENAME_MAX_CHARS - 4).replace(/\.+$/, "")}.pdf`;
};

const DocumentRunCursorSchema = z.object({
  generatedAt: z.string().datetime(),
  id: z.string().uuid(),
});

type DocumentRunCursor = z.infer<typeof DocumentRunCursorSchema>;

const encodeCursorPart = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const decodeCursorPart = (value: string): string => {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
};

export const encodeDocumentRunCursor = (run: Pick<DocumentRun, "generatedAt" | "id">): string =>
  encodeCursorPart(JSON.stringify({ generatedAt: run.generatedAt, id: run.id } satisfies DocumentRunCursor));

export const decodeDocumentRunCursor = (cursor: string | null | undefined): DocumentRunCursor | null => {
  if (!cursor) return null;
  try {
    const parsed = DocumentRunCursorSchema.safeParse(JSON.parse(decodeCursorPart(cursor)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
