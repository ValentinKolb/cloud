import { sql } from "bun";

/** Per-file and per-conversation caps — read once per operation from settings by the caller layer if needed. */
export const AI_FILES_MAX_FILE_BYTES_DEFAULT = 50 * 1024 * 1024;
export const AI_FILES_MAX_CONVERSATION_BYTES_DEFAULT = 250 * 1024 * 1024;

export type AiFileStat = {
  path: string;
  size: number;
  mediaType: string;
  updatedAt: string;
};

type FileRow = {
  path: string;
  size: number;
  media_type: string;
  updated_at: Date | string;
};

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

const toStat = (row: FileRow): AiFileStat => ({
  path: row.path,
  size: Number(row.size),
  mediaType: row.media_type,
  updatedAt: iso(row.updated_at),
});

/** Normalize a VFS path: absolute, no `.`/`..` segments, no trailing slash. */
export const normalizeAiFilePath = (path: string): string | null => {
  if (!path.startsWith("/")) return null;
  const segments: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;
    if (part.includes("\0")) return null;
    segments.push(part);
  }
  if (segments.length === 0) return null;
  return `/${segments.join("/")}`;
};

const MEDIA_TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  xml: "application/xml",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  ts: "text/typescript",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  zip: "application/zip",
  ics: "text/calendar",
};

export const guessAiMediaType = (path: string): string => {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MEDIA_TYPES[ext] ?? "application/octet-stream";
};

/**
 * Conversation-scoped file storage backing the bash tool's VFS. Every
 * operation goes straight to Postgres — no rehydration, horizontal-safe,
 * crash-safe. Reads support byte slices (bytea STORAGE EXTERNAL) so big
 * files never load fully.
 */
export const aiFileStore = {
  async list(input: { conversationId: string; prefix?: string }): Promise<AiFileStat[]> {
    const prefix = input.prefix ?? "/";
    const pattern = `${prefix.endsWith("/") ? prefix : `${prefix}/`}%`;
    const rows = await sql<FileRow[]>`
      SELECT path, size, media_type, updated_at
      FROM ai.files
      WHERE conversation_id = ${input.conversationId}
        AND (path LIKE ${pattern} OR path = ${prefix})
      ORDER BY path ASC
    `;
    return rows.map(toStat);
  },

  async stat(input: { conversationId: string; path: string }): Promise<AiFileStat | null> {
    const rows = await sql<FileRow[]>`
      SELECT path, size, media_type, updated_at
      FROM ai.files
      WHERE conversation_id = ${input.conversationId} AND path = ${input.path}
    `;
    return rows[0] ? toStat(rows[0]) : null;
  },

  /** Byte slice without loading the whole value (substring on EXTERNAL bytea reads only needed chunks). */
  async readSlice(input: { conversationId: string; path: string; offset: number; length: number }): Promise<Uint8Array | null> {
    const offset = Math.max(0, Math.floor(input.offset));
    const length = Math.max(0, Math.floor(input.length));
    const rows = await sql<{ chunk: Uint8Array }[]>`
      SELECT substring(bytes FROM ${offset + 1} FOR ${length}) AS chunk
      FROM ai.files
      WHERE conversation_id = ${input.conversationId} AND path = ${input.path}
    `;
    if (!rows[0]) return null;
    return new Uint8Array(rows[0].chunk ?? []);
  },

  async readAll(input: { conversationId: string; path: string }): Promise<Uint8Array | null> {
    const rows = await sql<{ bytes: Uint8Array }[]>`
      SELECT bytes FROM ai.files
      WHERE conversation_id = ${input.conversationId} AND path = ${input.path}
    `;
    if (!rows[0]) return null;
    return new Uint8Array(rows[0].bytes ?? []);
  },

  /**
   * Upsert one file. Enforces the per-file and per-conversation caps —
   * here in the store so no command or tool can bypass them.
   */
  async write(input: {
    conversationId: string;
    path: string;
    bytes: Uint8Array;
    mediaType?: string;
    maxFileBytes?: number;
    maxConversationBytes?: number;
  }): Promise<void> {
    const maxFile = input.maxFileBytes ?? AI_FILES_MAX_FILE_BYTES_DEFAULT;
    const maxConversation = input.maxConversationBytes ?? AI_FILES_MAX_CONVERSATION_BYTES_DEFAULT;
    if (input.bytes.byteLength > maxFile) {
      throw new Error(`File exceeds the per-file limit of ${Math.floor(maxFile / (1024 * 1024))} MB.`);
    }

    const totals = await sql<{ total: number | string }[]>`
      SELECT COALESCE(SUM(size), 0) AS total
      FROM ai.files
      WHERE conversation_id = ${input.conversationId} AND path <> ${input.path}
    `;
    const otherBytes = Number(totals[0]?.total ?? 0);
    if (otherBytes + input.bytes.byteLength > maxConversation) {
      throw new Error(`Conversation storage limit of ${Math.floor(maxConversation / (1024 * 1024))} MB exceeded.`);
    }

    await sql`
      INSERT INTO ai.files (conversation_id, path, bytes, media_type, size, updated_at)
      VALUES (${input.conversationId}, ${input.path}, ${input.bytes}, ${input.mediaType ?? "application/octet-stream"}, ${input.bytes.byteLength}, now())
      ON CONFLICT (conversation_id, path) DO UPDATE SET
        bytes = EXCLUDED.bytes,
        media_type = EXCLUDED.media_type,
        size = EXCLUDED.size,
        updated_at = now()
    `;
  },

  async append(input: {
    conversationId: string;
    path: string;
    bytes: Uint8Array;
    maxFileBytes?: number;
    maxConversationBytes?: number;
  }): Promise<void> {
    const existing = await this.readAll({ conversationId: input.conversationId, path: input.path });
    const merged = existing ? new Uint8Array([...existing, ...input.bytes]) : input.bytes;
    await this.write({
      conversationId: input.conversationId,
      path: input.path,
      bytes: merged,
      maxFileBytes: input.maxFileBytes,
      maxConversationBytes: input.maxConversationBytes,
    });
  },

  async remove(input: { conversationId: string; path: string; recursive?: boolean }): Promise<number> {
    if (input.recursive) {
      const pattern = `${input.path.endsWith("/") ? input.path : `${input.path}/`}%`;
      const rows = await sql<{ id: string }[]>`
        DELETE FROM ai.files
        WHERE conversation_id = ${input.conversationId} AND (path = ${input.path} OR path LIKE ${pattern})
        RETURNING id
      `;
      return rows.length;
    }
    const rows = await sql<{ id: string }[]>`
      DELETE FROM ai.files
      WHERE conversation_id = ${input.conversationId} AND path = ${input.path}
      RETURNING id
    `;
    return rows.length;
  },

  async rename(input: { conversationId: string; from: string; to: string }): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`
      UPDATE ai.files SET path = ${input.to}, updated_at = now()
      WHERE conversation_id = ${input.conversationId} AND path = ${input.from}
      RETURNING id
    `;
    return rows.length > 0;
  },

  /** Copy every file into another conversation (fork). */
  async copyToConversation(input: { sourceConversationId: string; targetConversationId: string }): Promise<number> {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO ai.files (conversation_id, path, bytes, media_type, size)
      SELECT ${input.targetConversationId}, path, bytes, media_type, size
      FROM ai.files
      WHERE conversation_id = ${input.sourceConversationId}
      ON CONFLICT (conversation_id, path) DO NOTHING
      RETURNING id
    `;
    return rows.length;
  },

  async totalBytes(conversationId: string): Promise<number> {
    const rows = await sql<{ total: number | string }[]>`
      SELECT COALESCE(SUM(size), 0) AS total FROM ai.files WHERE conversation_id = ${conversationId}
    `;
    return Number(rows[0]?.total ?? 0);
  },
};
