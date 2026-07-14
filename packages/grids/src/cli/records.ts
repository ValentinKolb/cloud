import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { arg, command, confirmFlag, flag } from "@valentinkolb/cloud/cli";
import type { CreateRecordSnapshotResponse, GridRecord, RecordSnapshot, RecordSnapshotListResponse, TableQueryResult } from "../contracts";
import {
  type GridFile,
  type GridFileListResponse,
  gridFileRows,
  normalizeRecordImportBody,
  type RecordAuditResponse,
  recordRows,
  snapshotRows,
} from "./records-support";
import { baseFlag, listFields, resolveBaseFromCommand, resolveField, resolveTable, tableArgs, tableFlag } from "./resources";
import {
  applyDefined,
  JSON_BODY_INPUT,
  jsonRequest,
  type MessageResponse,
  printJsonOrMessage,
  printJsonOrTable,
  queryString,
  readApi,
  readJsonInput,
  requireRestArg,
  writeApiFile,
} from "./runtime";
import { printRecordShape, recordShapeForFields } from "./schema-support";

type RecordListBodyFlags = {
  source?: string;
  cursor?: string;
  limit?: number;
  q?: string;
  includeDeleted?: boolean;
  deletedOnly?: boolean;
};

export const composeRecordListBody = (query: Record<string, unknown>, flags: RecordListBodyFlags): Record<string, unknown> => {
  if (flags.source) {
    return { source: flags.source, query: Object.keys(query).length > 0 ? query : undefined, cursor: flags.cursor };
  }
  return {
    query: applyDefined(
      { ...query },
      {
        limit: flags.limit ?? (query.limit === undefined ? 100 : undefined),
        search: flags.q ? { q: flags.q } : undefined,
        includeDeleted: flags.includeDeleted ? true : undefined,
        deletedOnly: flags.deletedOnly ? true : undefined,
      },
    ),
    cursor: flags.cursor,
  };
};

type RecordExportBodyFlags = {
  format?: "csv" | "json";
  delimiter?: string;
  markdown?: "raw" | "html";
  limit?: number;
  q?: string;
  includeDeleted?: boolean;
  deletedOnly?: boolean;
};

const exportDelimiter = (value: string | undefined): string | undefined =>
  value === "comma" ? "," : value === "semicolon" ? ";" : value === "tab" ? "\t" : value === "pipe" ? "|" : value;

export const composeRecordExportBody = (suppliedBody: Record<string, unknown>, flags: RecordExportBodyFlags): Record<string, unknown> => {
  const body = { ...suppliedBody };
  const delimiter = exportDelimiter(flags.delimiter);
  const existingCsv = body.csv && typeof body.csv === "object" && !Array.isArray(body.csv) ? (body.csv as Record<string, unknown>) : {};
  applyDefined(body, {
    format: flags.format ?? (body.format === undefined ? "csv" : undefined),
    markdown: flags.markdown,
    csv: delimiter ? { ...existingCsv, delimiter } : undefined,
  });
  if (flags.q || flags.limit || flags.includeDeleted || flags.deletedOnly) {
    const existingQuery =
      body.query && typeof body.query === "object" && !Array.isArray(body.query) ? (body.query as Record<string, unknown>) : {};
    body.query = applyDefined(
      { ...existingQuery },
      {
        limit: flags.limit,
        search: flags.q ? { q: flags.q } : undefined,
        includeDeleted: flags.includeDeleted ? true : undefined,
        deletedOnly: flags.deletedOnly ? true : undefined,
      },
    );
  }
  return body;
};

export const recordCommands = [
  command("records shape", {
    summary: "Show the JSON payload shape for records in a table",
    description:
      "The create/update payload is a plain JSON object keyed by field UUID. This command resolves the table and lists writable fields with examples.",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag },
    examples: ["cld grids records shape Bookshop Authors", "cld grids records shape --base Bookshop --table Authors --json"],
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      printRecordShape(ctx, recordShapeForFields(table, await listFields(ctx, table.id)));
    },
  }),
  command("records list", {
    summary: "List records in a table",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      q: flag.string({ aliases: ["query"], description: "Free-text record search" }),
      source: flag.string({ description: "GQL source for the table query" }),
      queryBody: flag.input({ name: "query-body", fileName: "query-body-file", valueLabel: "json" }),
      cursor: flag.string({ description: "Pagination cursor" }),
      limit: flag.int({ min: 1, max: 10_000, description: "Row limit (default: 100)" }),
      includeDeleted: flag.boolean({ name: "include-deleted", description: "Include deleted records" }),
      deletedOnly: flag.boolean({ name: "deleted-only", description: "Only deleted records" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const query = (await readJsonInput<Record<string, unknown>>(flags.queryBody, "record query JSON", false)) ?? {};
      const body = composeRecordListBody(query, flags);
      const payload = await readApi<TableQueryResult>(ctx, `/tables/${encodeURIComponent(table.id)}/query`, jsonRequest("POST", body));
      const items = payload.items ?? [];
      printJsonOrTable(ctx, payload, recordRows(items), [
        { key: "id", label: "SHORT" },
        { key: "recordId", label: "ID" },
        { key: "version", label: "VERSION" },
        { key: "updatedAt", label: "UPDATED" },
      ]);
      if (ctx.options.output !== "json" && payload.nextCursor) ctx.print(`next cursor: ${payload.nextCursor}`);
    },
  }),
  command("records query", {
    summary: "Run a structured table query",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      body: JSON_BODY_INPUT,
      cursor: flag.string({ description: "Pagination cursor" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "table query JSON", true)) ?? {};
      if (flags.cursor) body.cursor = flags.cursor;
      const payload = await readApi<TableQueryResult>(ctx, `/tables/${encodeURIComponent(table.id)}/query`, jsonRequest("POST", body));
      if (ctx.options.output === "json") ctx.json(payload);
      else printJsonOrTable(ctx, payload, recordRows(payload.items ?? []), [{ key: "recordId", label: "ID" }]);
    },
  }),
  command("records get", {
    summary: "Show a record",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, record: flag.string({ description: "Record UUID" }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? (flags.record ? 0 : 1) : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const recordId = flags.record ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "record");
      const record = await readApi<GridRecord>(ctx, `/records/${encodeURIComponent(table.id)}/${encodeURIComponent(recordId)}`);
      if (ctx.options.output === "json") ctx.json(record);
      else {
        ctx.print(`${record.id} v${record.version}`);
        ctx.print(JSON.stringify(record.data, null, 2));
      }
    },
  }),
  command("records create", {
    summary: "Create a record",
    description: "Pass a JSON object keyed by field UUID. Run `cld grids records shape <base> <table>` first for the exact writable keys.",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, body: JSON_BODY_INPUT },
    examples: [
      "cld grids records shape Bookshop Authors --json",
      'cld grids records create Bookshop Authors --body \'{"<field-uuid>":"Octavia Butler"}\'',
      "cld grids records create Bookshop Orders --body-file record.json",
    ],
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const body = await readJsonInput<Record<string, unknown>>(flags.body, "record JSON", true);
      const record = await readApi<GridRecord>(ctx, `/records/by-table/${encodeURIComponent(table.id)}`, jsonRequest("POST", body));
      printJsonOrMessage(ctx, record, `Created record ${record.id}.`);
    },
  }),
  command("records import", {
    summary: "Import records atomically from JSON",
    description:
      'Pass a JSON array, or {"items":[...]}, where each item is a record payload keyed by field UUID. The backend creates all records in one transaction.',
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, body: JSON_BODY_INPUT },
    examples: [
      "cld grids records shape Bookshop Authors --json",
      "cld grids records import Bookshop Authors --body-file records.json",
      "cat records.json | cld grids records import --base Bookshop --table Authors --stdin",
    ],
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const body = normalizeRecordImportBody(await readJsonInput<unknown>(flags.body, "record import JSON", true));
      const payload = await readApi<{ items: GridRecord[] }>(
        ctx,
        `/records/by-table/${encodeURIComponent(table.id)}/import`,
        jsonRequest("POST", body),
      );
      printJsonOrTable(ctx, payload, recordRows(payload.items), [
        { key: "id", label: "SHORT" },
        { key: "recordId", label: "ID" },
        { key: "version", label: "VERSION" },
        { key: "updatedAt", label: "UPDATED" },
      ]);
    },
  }),
  command("records export", {
    summary: "Export records to CSV or JSON",
    description:
      "Exports through the backend export endpoint. Pass --body/--body-file for full ExportBody control, or use --format with the default table query.",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      body: JSON_BODY_INPUT,
      format: flag.enum(["csv", "json"] as const, { description: "Export format (default: csv)" }),
      delimiter: flag.string({ description: "CSV delimiter: comma, semicolon, tab, pipe, or the literal delimiter" }),
      markdown: flag.enum(["raw", "html"] as const, { description: "Markdown export mode for long text fields" }),
      q: flag.string({ aliases: ["query"], description: "Free-text record search" }),
      limit: flag.int({ min: 1, max: 10_000, description: "Maximum exported rows" }),
      includeDeleted: flag.boolean({ name: "include-deleted", description: "Include deleted records" }),
      deletedOnly: flag.boolean({ name: "deleted-only", description: "Only deleted records" }),
      out: flag.string({ description: "Output file path" }),
    },
    examples: [
      "cld grids records export Bookshop Authors --format csv --out authors.csv",
      "cld grids records export Bookshop Authors --format json --limit 1000 --out authors.json",
      "cld grids records export --base Bookshop --table Authors --body-file export.json --out authors.csv",
    ],
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const body = composeRecordExportBody(
        (await readJsonInput<Record<string, unknown>>(flags.body, "record export JSON", false)) ?? {},
        flags,
      );
      await writeApiFile(ctx, `/records/by-table/${encodeURIComponent(table.id)}/export`, jsonRequest("POST", body), flags.out);
    },
  }),
  command("records update", {
    summary: "Update a record",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      record: flag.string({ description: "Record UUID" }),
      body: JSON_BODY_INPUT,
      ifVersion: flag.int({ name: "if-version", min: 0, description: "Optimistic version guard" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? (flags.record ? 0 : 1) : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const recordId = flags.record ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "record");
      const body = await readJsonInput<Record<string, unknown>>(flags.body, "record update JSON", true);
      const record = await readApi<GridRecord>(
        ctx,
        `/records/${encodeURIComponent(table.id)}/${encodeURIComponent(recordId)}`,
        jsonRequest("PATCH", body, flags.ifVersion !== undefined ? { "If-Match": String(flags.ifVersion) } : {}),
      );
      printJsonOrMessage(ctx, record, `Updated record ${record.id}.`);
    },
  }),
  command("records delete", {
    summary: "Delete a record",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, record: flag.string({ description: "Record UUID" }), yes: confirmFlag("Delete this record") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? (flags.record ? 0 : 1) : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const recordId = flags.record ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "record");
      await readApi<MessageResponse>(
        ctx,
        `/records/${encodeURIComponent(table.id)}/${encodeURIComponent(recordId)}`,
        jsonRequest("DELETE"),
      );
      printJsonOrMessage(ctx, { deleted: recordId }, `Deleted record ${recordId}.`);
    },
  }),
  command("records restore", {
    summary: "Restore a deleted record",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, record: flag.string({ description: "Record UUID" }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? (flags.record ? 0 : 1) : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const recordId = flags.record ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "record");
      await readApi<MessageResponse>(
        ctx,
        `/records/${encodeURIComponent(table.id)}/${encodeURIComponent(recordId)}/restore`,
        jsonRequest("POST"),
      );
      printJsonOrMessage(ctx, { restored: recordId }, `Restored record ${recordId}.`);
    },
  }),
  command("records audit", {
    summary: "Show record audit entries",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, record: flag.string({ description: "Record UUID" }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? (flags.record ? 0 : 1) : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const recordId = flags.record ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "record");
      const payload = await readApi<RecordAuditResponse>(
        ctx,
        `/records/${encodeURIComponent(table.id)}/${encodeURIComponent(recordId)}/audit`,
      );
      if (ctx.options.output === "json") ctx.json(payload);
      else ctx.table(payload.items as Record<string, unknown>[], []);
    },
  }),
  command("records files list", {
    summary: "List files stored in one record file field",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      record: flag.string({ description: "Record UUID" }),
      field: flag.string({ description: "File field id, short id, or exact name" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table && flags.record && flags.field ? 0 : 3);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const recordId = flags.record ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "record");
      const fieldRef = flags.field ?? requireRestArg(flags.table ? rest.slice(1) : rest.slice(2), 0, "field");
      const field = await resolveField(ctx, table.id, fieldRef);
      const payload = await readApi<GridFileListResponse>(
        ctx,
        `/records/${encodeURIComponent(table.id)}/${encodeURIComponent(recordId)}/files/${encodeURIComponent(field.id)}`,
      );
      printJsonOrTable(ctx, payload, gridFileRows(payload.items), [
        { key: "filename", label: "FILE" },
        { key: "mimeType", label: "MIME" },
        { key: "sizeBytes", label: "BYTES" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("records files upload", {
    summary: "Upload a local file into one record file field",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      record: flag.string({ description: "Record UUID" }),
      field: flag.string({ description: "File field id, short id, or exact name" }),
      file: flag.string({ description: "Local file path" }),
      filename: flag.string({ description: "Stored filename override" }),
      mimeType: flag.string({ name: "mime-type", description: "MIME type override" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table && flags.record && flags.field ? 0 : 3);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const recordId = flags.record ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "record");
      const fieldRef = flags.field ?? requireRestArg(flags.table ? rest.slice(1) : rest.slice(2), 0, "field");
      const filePath = flags.file ?? requireRestArg(flags.table ? rest.slice(2) : rest.slice(3), 0, "file");
      const field = await resolveField(ctx, table.id, fieldRef);
      const bytes = await readFile(filePath);
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: flags.mimeType ?? "application/octet-stream" }), flags.filename ?? basename(filePath));
      const file = await readApi<GridFile>(
        ctx,
        `/records/${encodeURIComponent(table.id)}/${encodeURIComponent(recordId)}/files/${encodeURIComponent(field.id)}`,
        { method: "POST", body: form },
      );
      printJsonOrMessage(ctx, file, `Uploaded ${file.filename} (${file.id}).`);
    },
  }),
  command("records files download", {
    summary: "Download one file-field blob",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      record: flag.string({ description: "Record UUID" }),
      field: flag.string({ description: "File field id, short id, or exact name" }),
      file: flag.string({ description: "File UUID" }),
      inline: flag.boolean({ description: "Request inline disposition" }),
      out: flag.string({ description: "Output file path" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table && flags.record && flags.field && flags.file ? 0 : 4);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const recordId = flags.record ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "record");
      const fieldRef = flags.field ?? requireRestArg(flags.table ? rest.slice(1) : rest.slice(2), 0, "field");
      const fileId = flags.file ?? requireRestArg(flags.table ? rest.slice(2) : rest.slice(3), 0, "file");
      const field = await resolveField(ctx, table.id, fieldRef);
      await writeApiFile(
        ctx,
        `/records/${encodeURIComponent(table.id)}/${encodeURIComponent(recordId)}/files/${encodeURIComponent(field.id)}/${encodeURIComponent(fileId)}/content${queryString({ inline: flags.inline ? true : undefined })}`,
        undefined,
        flags.out,
      );
    },
  }),
  command("records files delete", {
    summary: "Delete one file-field blob",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      record: flag.string({ description: "Record UUID" }),
      field: flag.string({ description: "File field id, short id, or exact name" }),
      file: flag.string({ description: "File UUID" }),
      yes: confirmFlag("Delete this record file"),
    },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table && flags.record && flags.field && flags.file ? 0 : 4);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const recordId = flags.record ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "record");
      const fieldRef = flags.field ?? requireRestArg(flags.table ? rest.slice(1) : rest.slice(2), 0, "field");
      const fileId = flags.file ?? requireRestArg(flags.table ? rest.slice(2) : rest.slice(3), 0, "file");
      const field = await resolveField(ctx, table.id, fieldRef);
      await readApi<MessageResponse>(
        ctx,
        `/records/${encodeURIComponent(table.id)}/${encodeURIComponent(recordId)}/files/${encodeURIComponent(field.id)}/${encodeURIComponent(fileId)}`,
        jsonRequest("DELETE"),
      );
      printJsonOrMessage(ctx, { deleted: fileId }, `Deleted file ${fileId}.`);
    },
  }),
];

export const snapshotCommands = [
  command("snapshots list", {
    summary: "List manual recursive snapshots for one record",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, record: flag.string({ description: "Record UUID" }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table && flags.record ? 0 : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const recordId = flags.record ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "record");
      const payload = await readApi<RecordSnapshotListResponse>(
        ctx,
        `/documents/snapshots/by-record/${encodeURIComponent(table.id)}/${encodeURIComponent(recordId)}`,
      );
      printJsonOrTable(ctx, payload, snapshotRows(payload.items), [
        { key: "id", label: "ID" },
        { key: "recordId", label: "RECORD" },
        { key: "createdAt", label: "CREATED" },
        { key: "createdBy", label: "BY" },
      ]);
    },
  }),
  command("snapshots create", {
    summary: "Create a manual recursive record snapshot",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, record: flag.string({ description: "Record UUID" }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table && flags.record ? 0 : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const recordId = flags.record ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "record");
      const payload = await readApi<CreateRecordSnapshotResponse>(
        ctx,
        `/documents/snapshots/by-record/${encodeURIComponent(table.id)}/${encodeURIComponent(recordId)}`,
        jsonRequest("POST"),
      );
      printJsonOrMessage(ctx, payload, `Created snapshot ${payload.snapshot.id}.`);
    },
  }),
  command("snapshots get", {
    summary: "Show one record snapshot",
    args: { snapshot: arg.required({ description: "Snapshot UUID" }) },
    async run({ ctx, args }) {
      const snapshot = await readApi<RecordSnapshot>(ctx, `/documents/snapshots/${encodeURIComponent(args.snapshot)}`);
      if (ctx.options.output === "json") ctx.json(snapshot);
      else {
        ctx.print(`${snapshot.id}`);
        ctx.print(`record: ${snapshot.recordId}`);
        ctx.print(`created: ${snapshot.createdAt}`);
        ctx.print(JSON.stringify({ root: snapshot.root, graph: snapshot.graph }, null, 2));
      }
    },
  }),
];
