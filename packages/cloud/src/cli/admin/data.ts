/**
 * Storage diagnostics for Postgres and Redis.
 */
import { command, flag } from "../index";
import { apiGet, formatBytes, printJsonOrTable, truncate } from "./shared";

export type DiagnosticWarning = {
  title: string;
  detail: string;
  tone: "amber" | "red";
};

export type PostgresDiagnostics = {
  available: boolean;
  error: string | null;
  schemas: number;
  tables: number;
  totalBytes: number;
  installedExtensions: number;
  availableExtensions: number;
  tableRows: {
    schema: string;
    name: string;
    estimatedRows: number;
    deadRows: number;
    totalBytes: number;
    tableBytes: number;
    indexBytes: number;
    warnings: string[];
  }[];
  extensionRows: {
    name: string;
    installed: boolean;
    installedVersion: string | null;
    defaultVersion: string | null;
    comment: string | null;
  }[];
  warnings: DiagnosticWarning[];
};

export type RedisDiagnostics = {
  available: boolean;
  error: string | null;
  dbSize: number;
  sampledKeys: number;
  scanComplete: boolean;
  keyspace: { database: string; keys: number; expires: number; avgTtlMs: number }[];
  prefixes: { depth: number; prefix: string; count: number; share: number }[];
  warnings: DiagnosticWarning[];
};

export const schemaRows = (tables: PostgresDiagnostics["tableRows"]) => {
  const schemas = new Map<string, { schema: string; tables: number; rows: number; totalBytes: number; warnings: number }>();
  for (const table of tables) {
    const current = schemas.get(table.schema) ?? { schema: table.schema, tables: 0, rows: 0, totalBytes: 0, warnings: 0 };
    current.tables += 1;
    current.rows += table.estimatedRows;
    current.totalBytes += table.totalBytes;
    current.warnings += table.warnings.length;
    schemas.set(table.schema, current);
  }
  return [...schemas.values()]
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .map((schema) => ({ ...schema, total: formatBytes(schema.totalBytes) }));
};

export const dataCommands = [
  command("postgres summary", {
    summary: "Show Postgres diagnostic summary",
    run: async ({ ctx }) => {
      const data = await apiGet<PostgresDiagnostics>(ctx, "/api/gateway/data/postgres");
      const rows = [
        {
          available: data.available,
          schemas: data.schemas,
          tables: data.tables,
          storage: formatBytes(data.totalBytes),
          extensions: `${data.installedExtensions}/${data.availableExtensions}`,
          warnings: data.warnings.length,
          error: data.error ?? "",
        },
      ];
      printJsonOrTable(ctx, data, rows, [
        { key: "available" },
        { key: "schemas" },
        { key: "tables" },
        { key: "storage" },
        { key: "extensions" },
        { key: "warnings" },
        { key: "error" },
      ]);
    },
  }),
  command("postgres tables", {
    summary: "List Postgres tables",
    flags: {
      schema: flag.string({ description: "Schema filter" }),
      search: flag.string({ aliases: ["q"], description: "Search schema, table, or warning" }),
      sort: flag.enum(["size", "rows", "name", "dead"], { default: "size", description: "Sort order" }),
    },
    run: async ({ ctx, flags }) => {
      const data = await apiGet<PostgresDiagnostics>(ctx, "/api/gateway/data/postgres");
      const needle = flags.search?.toLowerCase();
      const tables = data.tableRows
        .filter((table) => !flags.schema || table.schema === flags.schema)
        .filter((table) => {
          if (!needle) return true;
          return `${table.schema}.${table.name} ${table.warnings.join(" ")}`.toLowerCase().includes(needle);
        })
        .sort((a, b) => {
          if (flags.sort === "rows") return b.estimatedRows - a.estimatedRows;
          if (flags.sort === "dead") return b.deadRows - a.deadRows;
          if (flags.sort === "name") return `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`);
          return b.totalBytes - a.totalBytes;
        });
      const rows = tables.map((table) => ({
        table: `${table.schema}.${table.name}`,
        rows: table.estimatedRows,
        total: formatBytes(table.totalBytes),
        heap: formatBytes(table.tableBytes),
        indexes: formatBytes(table.indexBytes),
        deadRows: table.deadRows,
        warnings: table.warnings.join(", "),
      }));
      printJsonOrTable(ctx, { ...data, tableRows: tables }, rows, [
        { key: "table" },
        { key: "rows" },
        { key: "total" },
        { key: "heap" },
        { key: "indexes" },
        { key: "deadRows" },
        { key: "warnings" },
      ]);
    },
  }),
  command("postgres schemas", {
    summary: "List Postgres schemas with aggregate table size",
    run: async ({ ctx }) => {
      const data = await apiGet<PostgresDiagnostics>(ctx, "/api/gateway/data/postgres");
      const rows = schemaRows(data.tableRows);
      printJsonOrTable(ctx, { items: rows }, rows, [
        { key: "schema" },
        { key: "tables" },
        { key: "rows" },
        { key: "total" },
        { key: "warnings" },
      ]);
    },
  }),
  command("postgres extensions", {
    summary: "List available Postgres extensions",
    flags: {
      installed: flag.boolean({ description: "Only installed extensions" }),
      search: flag.string({ aliases: ["q"], description: "Search extensions" }),
    },
    run: async ({ ctx, flags }) => {
      const data = await apiGet<PostgresDiagnostics>(ctx, "/api/gateway/data/postgres");
      const needle = flags.search?.toLowerCase();
      const rows = data.extensionRows
        .filter((extension) => !flags.installed || extension.installed)
        .filter((extension) => {
          if (!needle) return true;
          return `${extension.name} ${extension.comment ?? ""}`.toLowerCase().includes(needle);
        })
        .map((extension) => ({
          name: extension.name,
          installed: extension.installed,
          installedVersion: extension.installedVersion ?? "",
          defaultVersion: extension.defaultVersion ?? "",
          description: truncate(extension.comment, 80),
        }));
      printJsonOrTable(ctx, { items: rows }, rows, [
        { key: "name" },
        { key: "installed" },
        { key: "installedVersion" },
        { key: "defaultVersion" },
        { key: "description" },
      ]);
    },
  }),
  command("redis summary", {
    summary: "Show Redis diagnostic summary",
    run: async ({ ctx }) => {
      const data = await apiGet<RedisDiagnostics>(ctx, "/api/gateway/data/redis");
      const expiring = data.keyspace.reduce((sum, row) => sum + row.expires, 0);
      const rows = [
        {
          available: data.available,
          keys: data.dbSize,
          expiring,
          sampled: data.sampledKeys,
          scanComplete: data.scanComplete,
          warnings: data.warnings.length,
          error: data.error ?? "",
        },
      ];
      printJsonOrTable(ctx, data, rows, [
        { key: "available" },
        { key: "keys" },
        { key: "expiring" },
        { key: "sampled" },
        { key: "scanComplete" },
        { key: "warnings" },
        { key: "error" },
      ]);
    },
  }),
  command("redis prefixes", {
    summary: "List sampled Redis prefixes",
    flags: {
      depth: flag.int({ default: 3, min: 1, max: 3, description: "Prefix depth" }),
      search: flag.string({ aliases: ["q"], description: "Search prefixes" }),
    },
    run: async ({ ctx, flags }) => {
      const data = await apiGet<RedisDiagnostics>(ctx, "/api/gateway/data/redis");
      const needle = flags.search?.toLowerCase();
      const rows = data.prefixes
        .filter((prefix) => prefix.depth === flags.depth)
        .filter((prefix) => !needle || prefix.prefix.toLowerCase().includes(needle))
        .map((prefix) => ({
          prefix: prefix.prefix,
          depth: prefix.depth,
          count: prefix.count,
          share: `${(prefix.share * 100).toFixed(1)}%`,
        }));
      printJsonOrTable(ctx, { items: rows, sampledKeys: data.sampledKeys, scanComplete: data.scanComplete }, rows, [
        { key: "prefix" },
        { key: "depth" },
        { key: "count" },
        { key: "share" },
      ]);
    },
  }),
];
