export type PlainMessageSegment = {
  kind: "content" | "quote";
  text: string;
};

export { type AttachmentPreviewKind, attachmentPreviewKind } from "../../attachment-preview-policy";

const QUOTED_LINE = /^\s*>/u;
const CID_SOURCE = /\bsrc=(["'])cid:([^"']+)\1/giu;
const REMOTE_IMAGE_ATTRIBUTE =
  /\bdata-mail-remote-image=(["'])([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\1/giu;

export const normalizeContentId = (value: string): string => value.trim().replace(/^<|>$/gu, "").toLowerCase();

export const referencedContentIds = (html: string): string[] => {
  const ids = new Set<string>();
  for (const match of html.matchAll(CID_SOURCE)) {
    const rawContentId = match[2];
    if (!rawContentId) continue;
    let decoded = rawContentId;
    try {
      decoded = decodeURIComponent(rawContentId);
    } catch {
      // Malformed percent escapes cannot match a normalized MIME Content-ID.
    }
    const normalized = normalizeContentId(decoded);
    if (normalized) ids.add(normalized);
  }
  return [...ids];
};

export const rewriteCidSources = (html: string, urls: ReadonlyMap<string, string>): string =>
  html.replace(CID_SOURCE, (source, quote: string, rawContentId: string) => {
    let decoded = rawContentId;
    try {
      decoded = decodeURIComponent(rawContentId);
    } catch {
      // Malformed percent escapes cannot match a normalized MIME Content-ID.
    }
    const url = urls.get(normalizeContentId(decoded));
    return url ? `src=${quote}${url}${quote}` : source;
  });

export const referencedRemoteImageIds = (html: string): string[] => {
  const ids = new Set<string>();
  for (const match of html.matchAll(REMOTE_IMAGE_ATTRIBUTE)) {
    const id = match[2]?.toLowerCase();
    if (id) ids.add(id);
  }
  return [...ids];
};

export const rewriteRemoteImageSources = (html: string, urls: ReadonlyMap<string, string>): string =>
  html.replace(REMOTE_IMAGE_ATTRIBUTE, (attribute, _quote: string, rawId: string) => {
    const url = urls.get(rawId.toLowerCase());
    return url ? `src="${url}" ${attribute}` : attribute;
  });

export const splitPlainMessageSegments = (value: string): PlainMessageSegment[] => {
  const lines = value.replace(/\r\n?/gu, "\n").split("\n");
  const nextNonEmptyIsQuoted = new Array<boolean>(lines.length).fill(false);
  let nextIsQuoted = false;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    nextNonEmptyIsQuoted[index] = nextIsQuoted;
    const line = lines[index] ?? "";
    if (line.trim()) nextIsQuoted = QUOTED_LINE.test(line);
  }
  const segments: PlainMessageSegment[] = [];
  let currentKind: PlainMessageSegment["kind"] | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (!currentKind || currentLines.length === 0) return;
    const text = currentLines.join("\n");
    if (text) segments.push({ kind: currentKind, text });
    currentLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const kind: PlainMessageSegment["kind"] =
      QUOTED_LINE.test(line) || (line.trim() === "" && currentKind === "quote" && nextNonEmptyIsQuoted[index]) ? "quote" : "content";
    if (kind !== currentKind) {
      flush();
      currentKind = kind;
    }
    currentLines.push(line);
  }
  flush();
  return segments;
};
