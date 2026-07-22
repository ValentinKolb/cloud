import { sql } from "bun";

export type DiagnosticWarning = {
  area: "postgres" | "redis";
  tone: "amber" | "red";
  title: string;
  detail: string;
};

export type PostgresTableDiagnostic = {
  schema: string;
  name: string;
  estimatedRows: number;
  deadRows: number;
  seqScans: number;
  indexScans: number;
  tableBytes: number;
  indexBytes: number;
  totalBytes: number;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
  warnings: string[];
};

export type PostgresSchemaDiagnostic = {
  schema: string;
  tables: number;
  estimatedRows: number;
  totalBytes: number;
};

export type PostgresExtensionDiagnostic = {
  name: string;
  defaultVersion: string | null;
  installedVersion: string | null;
  installed: boolean;
  comment: string | null;
};

export type PostgresDiagnostics = {
  available: boolean;
  error: string | null;
  schemas: number;
  tables: number;
  totalBytes: number;
  installedExtensions: number;
  availableExtensions: number;
  runtime: {
    maxConnections: number;
    connections: number;
    activeConnections: number;
    idleInTransaction: number;
    waitingLocks: number;
    oldestWaitingQuerySeconds: number;
    oldestTransactionSeconds: number;
    oldestIdleTransactionSeconds: number;
    oldestQuerySeconds: number;
    deadlocks: number;
  };
  tableRows: PostgresTableDiagnostic[];
  schemaRows: PostgresSchemaDiagnostic[];
  extensionRows: PostgresExtensionDiagnostic[];
  warnings: DiagnosticWarning[];
};

export type RedisKeyspaceDb = {
  database: string;
  keys: number;
  expires: number;
  avgTtlMs: number;
};

export type RedisPrefixDiagnostic = {
  depth: number;
  prefix: string;
  count: number;
  share: number;
};

export type RedisDiagnostics = {
  available: boolean;
  error: string | null;
  dbSize: number;
  sampledKeys: number;
  scanComplete: boolean;
  keyspace: RedisKeyspaceDb[];
  prefixes: RedisPrefixDiagnostic[];
  warnings: DiagnosticWarning[];
};

export type DataDiagnostics = {
  postgres: PostgresDiagnostics;
  redis: RedisDiagnostics;
};

const MAX_REDIS_SAMPLE_KEYS = 10_000;
const REDIS_SCAN_BATCH = 1_000;
const LARGE_TABLE_BYTES = 100 * 1024 * 1024;

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const emptyPostgres = (message: string): PostgresDiagnostics => ({
  available: false,
  error: message,
  schemas: 0,
  tables: 0,
  totalBytes: 0,
  installedExtensions: 0,
  availableExtensions: 0,
  runtime: {
    maxConnections: 0,
    connections: 0,
    activeConnections: 0,
    idleInTransaction: 0,
    waitingLocks: 0,
    oldestWaitingQuerySeconds: 0,
    oldestTransactionSeconds: 0,
    oldestIdleTransactionSeconds: 0,
    oldestQuerySeconds: 0,
    deadlocks: 0,
  },
  tableRows: [],
  schemaRows: [],
  extensionRows: [],
  warnings: [
    {
      area: "postgres",
      tone: "red",
      title: "Postgres diagnostics unavailable",
      detail: message,
    },
  ],
});

const emptyRedis = (message: string): RedisDiagnostics => ({
  available: false,
  error: message,
  dbSize: 0,
  sampledKeys: 0,
  scanComplete: false,
  keyspace: [],
  prefixes: [],
  warnings: [
    {
      area: "redis",
      tone: "red",
      title: "Redis diagnostics unavailable",
      detail: message,
    },
  ],
});

const tableWarnings = (table: Omit<PostgresTableDiagnostic, "warnings">): string[] => {
  const warnings: string[] = [];
  const analyzed = table.lastAnalyze || table.lastAutoanalyze;
  if (table.totalBytes >= LARGE_TABLE_BYTES) warnings.push("large table");
  if (table.estimatedRows > 1_000 && !analyzed) warnings.push("no analyze timestamp");
  if (table.deadRows > 1_000 && table.deadRows > table.estimatedRows * 0.2) warnings.push("many dead rows");
  return warnings;
};

const collectPostgres = async (): Promise<PostgresDiagnostics> => {
  const [overview, tableRows, extensionRows] = await Promise.all([
    sql<
      {
        schemas: number;
        tables: number;
        total_bytes: number | string | bigint | null;
        max_connections: number | string;
        connections: number | string;
        active_connections: number | string;
        idle_in_transaction: number | string;
        waiting_locks: number | string;
        oldest_waiting_query_seconds: number | string | null;
        oldest_transaction_seconds: number | string | null;
        oldest_idle_transaction_seconds: number | string | null;
        oldest_query_seconds: number | string | null;
        deadlocks: number | string;
      }[]
    >`
      SELECT
        (SELECT COUNT(*)::int FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema') AS schemas,
        (SELECT COUNT(*)::int FROM pg_stat_user_tables) AS tables,
        (SELECT COALESCE(SUM(pg_total_relation_size(relid)), 0)::bigint FROM pg_stat_user_tables) AS total_bytes,
        current_setting('max_connections')::int AS max_connections,
        (SELECT count(*)::int FROM pg_stat_activity WHERE backend_type = 'client backend') AS connections,
        (SELECT count(*)::int FROM pg_stat_activity WHERE backend_type = 'client backend' AND state = 'active') AS active_connections,
        (SELECT count(*)::int FROM pg_stat_activity WHERE backend_type = 'client backend' AND state = 'idle in transaction') AS idle_in_transaction,
        (SELECT count(*)::int FROM pg_stat_activity WHERE backend_type = 'client backend' AND wait_event_type = 'Lock') AS waiting_locks,
        (SELECT COALESCE(max(EXTRACT(EPOCH FROM (now() - query_start))), 0)::float
          FROM pg_stat_activity
          WHERE backend_type = 'client backend' AND wait_event_type = 'Lock' AND query_start IS NOT NULL) AS oldest_waiting_query_seconds,
        (SELECT COALESCE(max(EXTRACT(EPOCH FROM (now() - xact_start))), 0)::float
          FROM pg_stat_activity
          WHERE backend_type = 'client backend' AND xact_start IS NOT NULL AND pid <> pg_backend_pid()) AS oldest_transaction_seconds,
        (SELECT COALESCE(max(EXTRACT(EPOCH FROM (now() - xact_start))), 0)::float
          FROM pg_stat_activity
          WHERE backend_type = 'client backend' AND state = 'idle in transaction' AND xact_start IS NOT NULL) AS oldest_idle_transaction_seconds,
        (SELECT COALESCE(max(EXTRACT(EPOCH FROM (now() - query_start))), 0)::float
          FROM pg_stat_activity
          WHERE backend_type = 'client backend' AND state = 'active' AND query_start IS NOT NULL AND pid <> pg_backend_pid()) AS oldest_query_seconds,
        (SELECT COALESCE(sum(deadlocks), 0)::bigint FROM pg_stat_database) AS deadlocks
    `,
    sql<
      {
        schemaname: string;
        relname: string;
        estimated_rows: number | string | bigint;
        dead_rows: number | string | bigint;
        seq_scans: number | string | bigint;
        index_scans: number | string | bigint;
        table_bytes: number | string | bigint;
        index_bytes: number | string | bigint;
        total_bytes: number | string | bigint;
        last_vacuum: string | null;
        last_autovacuum: string | null;
        last_analyze: string | null;
        last_autoanalyze: string | null;
      }[]
    >`
      SELECT
        schemaname,
        relname,
        COALESCE(n_live_tup, 0)::bigint AS estimated_rows,
        COALESCE(n_dead_tup, 0)::bigint AS dead_rows,
        COALESCE(seq_scan, 0)::bigint AS seq_scans,
        COALESCE(idx_scan, 0)::bigint AS index_scans,
        pg_relation_size(relid)::bigint AS table_bytes,
        pg_indexes_size(relid)::bigint AS index_bytes,
        pg_total_relation_size(relid)::bigint AS total_bytes,
        last_vacuum::text,
        last_autovacuum::text,
        last_analyze::text,
        last_autoanalyze::text
      FROM pg_stat_user_tables
      ORDER BY schemaname ASC, relname ASC
    `,
    sql<
      {
        name: string;
        default_version: string | null;
        installed_version: string | null;
        comment: string | null;
      }[]
    >`
      SELECT name, default_version, installed_version, comment
      FROM pg_available_extensions
      ORDER BY installed_version IS NULL, name ASC
    `,
  ]);

  const tables = tableRows.map((row) => {
    const base = {
      schema: row.schemaname,
      name: row.relname,
      estimatedRows: toNumber(row.estimated_rows),
      deadRows: toNumber(row.dead_rows),
      seqScans: toNumber(row.seq_scans),
      indexScans: toNumber(row.index_scans),
      tableBytes: toNumber(row.table_bytes),
      indexBytes: toNumber(row.index_bytes),
      totalBytes: toNumber(row.total_bytes),
      lastVacuum: row.last_vacuum,
      lastAutovacuum: row.last_autovacuum,
      lastAnalyze: row.last_analyze,
      lastAutoanalyze: row.last_autoanalyze,
    };
    return { ...base, warnings: tableWarnings(base) };
  });

  const schemaMap = new Map<string, PostgresSchemaDiagnostic>();
  for (const table of tables) {
    const current = schemaMap.get(table.schema) ?? { schema: table.schema, tables: 0, estimatedRows: 0, totalBytes: 0 };
    current.tables += 1;
    current.estimatedRows += table.estimatedRows;
    current.totalBytes += table.totalBytes;
    schemaMap.set(table.schema, current);
  }

  const extensions = extensionRows.map((row) => ({
    name: row.name,
    defaultVersion: row.default_version,
    installedVersion: row.installed_version,
    installed: row.installed_version !== null,
    comment: row.comment,
  }));

  const warnings: DiagnosticWarning[] = [];
  const runtime = {
    maxConnections: toNumber(overview[0]?.max_connections),
    connections: toNumber(overview[0]?.connections),
    activeConnections: toNumber(overview[0]?.active_connections),
    idleInTransaction: toNumber(overview[0]?.idle_in_transaction),
    waitingLocks: toNumber(overview[0]?.waiting_locks),
    oldestWaitingQuerySeconds: toNumber(overview[0]?.oldest_waiting_query_seconds),
    oldestTransactionSeconds: toNumber(overview[0]?.oldest_transaction_seconds),
    oldestIdleTransactionSeconds: toNumber(overview[0]?.oldest_idle_transaction_seconds),
    oldestQuerySeconds: toNumber(overview[0]?.oldest_query_seconds),
    deadlocks: toNumber(overview[0]?.deadlocks),
  };
  const connectionShare = runtime.maxConnections > 0 ? runtime.connections / runtime.maxConnections : 0;
  if (connectionShare >= 0.8) {
    warnings.push({
      area: "postgres",
      tone: connectionShare >= 0.95 ? "red" : "amber",
      title: "Postgres connection pressure",
      detail: `${runtime.connections} of ${runtime.maxConnections} connections are in use.`,
    });
  }
  if (runtime.waitingLocks > 0) {
    warnings.push({
      area: "postgres",
      tone: runtime.oldestWaitingQuerySeconds >= 30 ? "red" : "amber",
      title: "Queries waiting on locks",
      detail: `${runtime.waitingLocks} connection${runtime.waitingLocks === 1 ? " is" : "s are"} waiting; the oldest waiting query has run for ${Math.round(runtime.oldestWaitingQuerySeconds)}s.`,
    });
  }
  if (runtime.idleInTransaction > 0 && runtime.oldestIdleTransactionSeconds >= 60) {
    warnings.push({
      area: "postgres",
      tone: "amber",
      title: "Long-lived transactions",
      detail: `${runtime.idleInTransaction} connection${runtime.idleInTransaction === 1 ? " is" : "s are"} idle in transaction; oldest is ${Math.round(runtime.oldestIdleTransactionSeconds)}s.`,
    });
  }
  const largeTables = tables.filter((table) => table.totalBytes >= LARGE_TABLE_BYTES).length;
  const staleAnalyze = tables.filter((table) => table.estimatedRows > 1_000 && !table.lastAnalyze && !table.lastAutoanalyze).length;
  const deadRows = tables.filter((table) => table.deadRows > 1_000 && table.deadRows > table.estimatedRows * 0.2).length;
  if (largeTables > 0) {
    warnings.push({
      area: "postgres",
      tone: "amber",
      title: "Large Postgres tables",
      detail: `${largeTables} table${largeTables === 1 ? "" : "s"} exceed 100 MB.`,
    });
  }
  if (staleAnalyze > 0) {
    warnings.push({
      area: "postgres",
      tone: "amber",
      title: "Missing analyze timestamps",
      detail: `${staleAnalyze} table${staleAnalyze === 1 ? "" : "s"} with estimated rows have no analyze timestamp.`,
    });
  }
  if (deadRows > 0) {
    warnings.push({
      area: "postgres",
      tone: "amber",
      title: "Dead row pressure",
      detail: `${deadRows} table${deadRows === 1 ? "" : "s"} have dead rows above 20% of estimated live rows.`,
    });
  }

  return {
    available: true,
    error: null,
    schemas: toNumber(overview[0]?.schemas),
    tables: toNumber(overview[0]?.tables),
    totalBytes: toNumber(overview[0]?.total_bytes),
    installedExtensions: extensions.filter((extension) => extension.installed).length,
    availableExtensions: extensions.length,
    runtime,
    tableRows: tables,
    schemaRows: [...schemaMap.values()].sort((a, b) => b.totalBytes - a.totalBytes),
    extensionRows: extensions,
    warnings,
  };
};

const parseRedisKeyspace = (info: string): RedisKeyspaceDb[] => {
  const rows: RedisKeyspaceDb[] = [];
  for (const line of info.split(/\r?\n/)) {
    const match = /^(db\d+):keys=(\d+),expires=(\d+),avg_ttl=(\d+)/.exec(line.trim());
    if (!match) continue;
    rows.push({
      database: match[1] ?? "db0",
      keys: Number(match[2] ?? 0),
      expires: Number(match[3] ?? 0),
      avgTtlMs: Number(match[4] ?? 0),
    });
  }
  return rows;
};

const prefixForDepth = (key: string, depth: number): string => {
  const parts = key.split(":").filter(Boolean);
  if (parts.length === 0) return key.slice(0, 80) || "(empty)";
  return parts.slice(0, Math.min(depth, parts.length)).join(":");
};

const buildPrefixes = (keys: string[]): RedisPrefixDiagnostic[] => {
  const rows: RedisPrefixDiagnostic[] = [];
  for (const depth of [1, 2, 3]) {
    const counts = new Map<string, number>();
    for (const key of keys) {
      const prefix = prefixForDepth(key, depth);
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
    for (const [prefix, count] of counts) {
      rows.push({
        depth,
        prefix,
        count,
        share: keys.length > 0 ? count / keys.length : 0,
      });
    }
  }
  return rows.sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix));
};

const collectRedis = async (): Promise<RedisDiagnostics> => {
  const redis = Bun.redis;
  const [dbSizeRaw, keyspaceInfoRaw] = await Promise.all([redis.send("DBSIZE", []), redis.send("INFO", ["keyspace"])]);
  const dbSize = toNumber(dbSizeRaw);
  const keyspace = parseRedisKeyspace(String(keyspaceInfoRaw ?? ""));

  const sampledKeys: string[] = [];
  let cursor = "0";
  let scanComplete = false;
  for (let scans = 0; scans < 200 && sampledKeys.length < MAX_REDIS_SAMPLE_KEYS; scans += 1) {
    const result = await redis.send("SCAN", [cursor, "COUNT", String(REDIS_SCAN_BATCH)]);
    if (!Array.isArray(result)) break;
    cursor = String(result[0] ?? "0");
    const keys = Array.isArray(result[1]) ? result[1] : [];
    for (const key of keys) {
      if (sampledKeys.length >= MAX_REDIS_SAMPLE_KEYS) break;
      sampledKeys.push(String(key));
    }
    if (cursor === "0") {
      scanComplete = true;
      break;
    }
  }

  const prefixes = buildPrefixes(sampledKeys);
  const expiringKeys = keyspace.reduce((sum, row) => sum + row.expires, 0);
  const knownKeys = keyspace.reduce((sum, row) => sum + row.keys, 0);
  const nonExpiring = Math.max(0, knownKeys - expiringKeys);
  const dominantPrefix = prefixes.find((row) => row.depth === 3 && row.share >= 0.8);

  const warnings: DiagnosticWarning[] = [];
  if (nonExpiring > 0 && knownKeys > 0 && nonExpiring / knownKeys > 0.1) {
    warnings.push({
      area: "redis",
      tone: "amber",
      title: "Redis keys without expiry",
      detail: `${nonExpiring.toLocaleString("de-DE")} of ${knownKeys.toLocaleString("de-DE")} keys have no expiry in INFO keyspace.`,
    });
  }
  if (dominantPrefix) {
    warnings.push({
      area: "redis",
      tone: "amber",
      title: "Dominant Redis prefix",
      detail: `${dominantPrefix.prefix} represents ${(dominantPrefix.share * 100).toFixed(1)}% of the sampled keys.`,
    });
  }
  if (!scanComplete && dbSize > sampledKeys.length) {
    warnings.push({
      area: "redis",
      tone: "amber",
      title: "Redis prefix data is sampled",
      detail: `${sampledKeys.length.toLocaleString("de-DE")} of ${dbSize.toLocaleString("de-DE")} keys were sampled.`,
    });
  }

  return {
    available: true,
    error: null,
    dbSize,
    sampledKeys: sampledKeys.length,
    scanComplete,
    keyspace,
    prefixes,
    warnings,
  };
};

export const getPostgresDiagnostics = async (): Promise<PostgresDiagnostics> =>
  collectPostgres().catch((error) => emptyPostgres(errorMessage(error)));

export const getRedisDiagnostics = async (): Promise<RedisDiagnostics> => collectRedis().catch((error) => emptyRedis(errorMessage(error)));

export const getDataDiagnostics = async (): Promise<DataDiagnostics> => {
  const [postgres, redis] = await Promise.all([getPostgresDiagnostics(), getRedisDiagnostics()]);
  return { postgres, redis };
};
