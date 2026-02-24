import { sql } from "bun";
import type { PaginationParams } from "@valentinkolb/cloud-contracts/shared";
import { getSync } from "@valentinkolb/cloud-core/services/settings";
import { registerSettings, registerGroupLabel } from "@valentinkolb/cloud-core/services/settings/defaults";

// ── Settings Registration ──────────────────────────────────────────────

registerGroupLabel("logs", "Logging");
registerSettings([
  {
    key: "logs.retention_days",
    type: "number",
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
  metadata: row.metadata,
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
    level?: string;
    search?: string;
  },
): Promise<{ entries: LogEntry[]; total: number }> => {
  const { offset, perPage } = pagination;
  const { source, level, search } = options ?? {};

  const searchPattern = search ? `%${search}%` : null;
  const filterSource = source && source !== "all" ? source : null;
  const filterLevel = level && level !== "all" ? level : null;

  // Build WHERE conditions dynamically via a single query with optional filters
  const countRows = await sql`
    SELECT COUNT(*)::int as count
    FROM logging.entries
    WHERE
      (${filterSource}::text IS NULL OR source = ${filterSource})
      AND (${filterLevel}::text IS NULL OR level = ${filterLevel})
      AND (${searchPattern}::text IS NULL OR message ILIKE ${searchPattern} OR metadata::text ILIKE ${searchPattern})
  `;

  const dataRows = await sql`
    SELECT id, level, source, message, metadata, created_at
    FROM logging.entries
    WHERE
      (${filterSource}::text IS NULL OR source = ${filterSource})
      AND (${filterLevel}::text IS NULL OR level = ${filterLevel})
      AND (${searchPattern}::text IS NULL OR message ILIKE ${searchPattern} OR metadata::text ILIKE ${searchPattern})
    ORDER BY created_at DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;

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

/** Run cleanup once per day, deleting logs older than LOG_RETENTION_DAYS. */
const AUTO_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24h
let autoCleanupInitialTimeout: ReturnType<typeof setTimeout> | undefined;
let autoCleanupInterval: ReturnType<typeof setInterval> | undefined;

/**
 * Starts periodic log cleanup using the configured retention window.
 */
export const startAutoCleanup = (): void => {
  stopAutoCleanup();

  const runCleanup = async () => {
    const days = getSync<number>("logs.retention_days") ?? 30;
    try {
      const { deleted } = await cleanup(days);
      if (deleted > 0) {
        logger("logging").info("Auto-cleanup complete", {
          deleted,
          retentionDays: days,
        });
      }
    } catch (err) {
      console.error("[logging] Auto-cleanup failed:", err instanceof Error ? err.message : String(err));
    }
  };

  // Run once on startup (delayed 30s to not block boot)
  autoCleanupInitialTimeout = setTimeout(runCleanup, 30_000);
  // Then every 24h
  autoCleanupInterval = setInterval(runCleanup, AUTO_CLEANUP_INTERVAL);
};

/**
 * Stops scheduled log cleanup tasks.
 */
export const stopAutoCleanup = (): void => {
  if (autoCleanupInitialTimeout) {
    clearTimeout(autoCleanupInitialTimeout);
    autoCleanupInitialTimeout = undefined;
  }

  if (autoCleanupInterval) {
    clearInterval(autoCleanupInterval);
    autoCleanupInterval = undefined;
  }
};

/** Admin service object for querying/managing logs. */
export const logging = {
  list,
  getSources,
  cleanup,
};
