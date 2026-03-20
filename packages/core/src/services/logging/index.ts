import { sql } from "bun";
import type { PaginationParams } from "@valentinkolb/cloud-contracts/shared";
import { registerSettings, registerGroupLabel } from "@valentinkolb/cloud-core/services/settings/defaults";
import { escapeLikePattern, parsePgJsonRecord, toPgTextArray } from "@valentinkolb/cloud-core/services/postgres";

// ── Settings Registration ──────────────────────────────────────────────

registerGroupLabel("logs", "Logging");
registerSettings([
  {
    key: "logs.retention_days",
    kind: "number",
    default: 30,
    description: "Automatically delete log entries older than this many days",
    group: "logs",
  },
]);

// ==========================
// Types
// ==========================

type LogLevel = "debug" | "info" | "warn" | "error";

type WriteParams = {
  level: LogLevel;
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
};

type Logger = {
  debug: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

export type LogEntry = {
  id: number;
  level: LogLevel;
  source: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type DbLogRow = {
  id: number;
  level: string;
  source: string;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

// ==========================
// Helpers
// ==========================

/**
 * Maps one logging row to the public log entry shape.
 */
const mapRow = (row: DbLogRow): LogEntry => ({
  id: row.id,
  level: row.level as LogLevel,
  source: row.source,
  message: row.message,
  metadata: parsePgJsonRecord(row.metadata),
  createdAt: row.created_at,
});

// ==========================
// Core: Write + Logger
// ==========================

/** Fire-and-forget write — mirrors to console, then inserts to DB async. */
function write(params: WriteParams): void {
  const prefix = `[${params.source}]`;
  const consoleFn = params.level === "error" ? console.error : params.level === "warn" ? console.warn : console.log;
  consoleFn(prefix, params.message, ...(params.metadata ? [params.metadata] : []));

  sql`
    INSERT INTO logging.entries (level, source, message, metadata)
    VALUES (
      ${params.level},
      ${params.source},
      ${params.message},
      ${params.metadata ? JSON.stringify(params.metadata) : null}::jsonb
    )
  `.catch((err: Error) => console.error("[logging] DB write failed:", err.message));
}

/**
 * Stateless logger factory. Creates an object with .debug/.info/.warn/.error methods
 * bound to the given source. Can be called inline or cached — no state is held.
 *
 * @example
 * // Inline
 * logger("yjs").info("Document loaded", { noteId });
 *
 * // Cached
 * const log = logger("weather");
 * log.error("API error", { status: 500 });
 */
export function logger(source: string): Logger {
  return {
    debug: (msg, meta) => write({ level: "debug", source, message: msg, metadata: meta }),
    info: (msg, meta) => write({ level: "info", source, message: msg, metadata: meta }),
    warn: (msg, meta) => write({ level: "warn", source, message: msg, metadata: meta }),
    error: (msg, meta) => write({ level: "error", source, message: msg, metadata: meta }),
  };
}

// ==========================
// Admin: List / Sources / Cleanup
// ==========================

/** List log entries with pagination and optional filters. */
const list = async (
  pagination: PaginationParams,
  options?: {
    source?: string;
    sources?: string[];
    level?: string;
    search?: string;
  },
): Promise<{ entries: LogEntry[]; total: number }> => {
  const { offset, perPage } = pagination;
  const { source, sources, level, search } = options ?? {};

  const searchPattern = search ? `%${escapeLikePattern(search)}%` : null;
  const filterSource = source && source !== "all" ? source : null;
  const filterSources =
    !filterSource && Array.isArray(sources) && sources.length > 0 ? [...new Set(sources.map((value) => value.trim()).filter(Boolean))] : null;
  const filterSourcesLiteral = filterSources ? toPgTextArray(filterSources) : null;
  const filterLevel = level && level !== "all" ? level : null;
  const hasSourceList = !!filterSources && filterSources.length > 0;

  let countRows: Array<{ count: number }> = [];
  let dataRows: DbLogRow[] = [];

  if (filterSource) {
    countRows = await sql`
      SELECT COUNT(*)::int as count
      FROM logging.entries
      WHERE source = ${filterSource}
        AND (${filterLevel}::text IS NULL OR level = ${filterLevel})
        AND (${searchPattern}::text IS NULL OR message ILIKE ${searchPattern} ESCAPE '\' OR metadata::text ILIKE ${searchPattern} ESCAPE '\')
    `;

    dataRows = await sql`
      SELECT id, level, source, message, metadata, created_at
      FROM logging.entries
      WHERE source = ${filterSource}
        AND (${filterLevel}::text IS NULL OR level = ${filterLevel})
        AND (${searchPattern}::text IS NULL OR message ILIKE ${searchPattern} ESCAPE '\' OR metadata::text ILIKE ${searchPattern} ESCAPE '\')
      ORDER BY created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `;
  } else if (hasSourceList) {
    countRows = await sql`
      SELECT COUNT(*)::int as count
      FROM logging.entries
      WHERE source = ANY(${filterSourcesLiteral}::text[])
        AND (${filterLevel}::text IS NULL OR level = ${filterLevel})
        AND (${searchPattern}::text IS NULL OR message ILIKE ${searchPattern} ESCAPE '\' OR metadata::text ILIKE ${searchPattern} ESCAPE '\')
    `;

    dataRows = await sql`
      SELECT id, level, source, message, metadata, created_at
      FROM logging.entries
      WHERE source = ANY(${filterSourcesLiteral}::text[])
        AND (${filterLevel}::text IS NULL OR level = ${filterLevel})
        AND (${searchPattern}::text IS NULL OR message ILIKE ${searchPattern} ESCAPE '\' OR metadata::text ILIKE ${searchPattern} ESCAPE '\')
      ORDER BY created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `;
  } else {
    countRows = await sql`
      SELECT COUNT(*)::int as count
      FROM logging.entries
      WHERE (${filterLevel}::text IS NULL OR level = ${filterLevel})
        AND (${searchPattern}::text IS NULL OR message ILIKE ${searchPattern} ESCAPE '\' OR metadata::text ILIKE ${searchPattern} ESCAPE '\')
    `;

    dataRows = await sql`
      SELECT id, level, source, message, metadata, created_at
      FROM logging.entries
      WHERE (${filterLevel}::text IS NULL OR level = ${filterLevel})
        AND (${searchPattern}::text IS NULL OR message ILIKE ${searchPattern} ESCAPE '\' OR metadata::text ILIKE ${searchPattern} ESCAPE '\')
      ORDER BY created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `;
  }

  return {
    entries: dataRows.map((row: DbLogRow) => mapRow(row)),
    total: countRows[0]?.count ?? 0,
  };
};

/** Get all unique source names (for filter dropdown). */
const getSources = async (): Promise<string[]> => {
  const rows = await sql`
    SELECT DISTINCT source FROM logging.entries ORDER BY source
  `;
  return rows.map((row: { source: string }) => row.source);
};

/** Delete log entries older than the given number of days. */
const cleanup = async (olderThanDays: number): Promise<{ deleted: number }> => {
  const rows = await sql`
    DELETE FROM logging.entries
    WHERE created_at < now() - ${olderThanDays + " days"}::interval
  `;
  return { deleted: rows.count };
};

/** Admin service object for querying/managing logs. */
export const logging = {
  list,
  getSources,
  cleanup,
};
