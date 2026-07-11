import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  arg,
  type CliInputFlagValue,
  type CloudCliContext,
  command,
  confirmFlag,
  defineCliCommands,
  flag,
  listAccessPrincipalEntities,
  paginationFlags,
  printAccessEntries,
  readCliInput,
  resolveAccessPrincipal,
} from "@valentinkolb/cloud/cli";
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";
import type {
  Base,
  CreateDocumentLinkResponse,
  CreateRecordSnapshotResponse,
  Dashboard,
  DocumentLink,
  DocumentLinkListResponse,
  DocumentPreviewResponse,
  DocumentRunBrowseResponse,
  DocumentRunSummary,
  DocumentRunSummaryList,
  DocumentTemplate,
  DocumentTemplateSummary,
  DslQueryAutocompleteResponse,
  DslQueryCompileViewResponse,
  DslQueryExecuteResponse,
  EmailTemplate,
  Field,
  GridRecord,
  RecordSnapshot,
  RecordSnapshotListResponse,
  Table,
  TableQueryResult,
  View,
  Workflow,
  WorkflowAutocompleteResponse,
  WorkflowEmailDelivery,
  WorkflowRun,
  WorkflowStepRun,
} from "./contracts";
import {
  COMPUTED_FIELD_TYPES,
  EXTERNAL_FIELD_TYPES,
  fieldTypeRegistry,
  LINK_FIELD_TYPES,
  RECORD_WRITABLE_FIELD_TYPES,
  SERVER_GENERATED_FIELD_TYPES,
  SYSTEM_FIELD_TYPES,
  VALUE_FIELD_TYPES,
} from "./field-types";
import { GRID_FORMULA_FUNCTIONS } from "./formula/function-catalog";

type BasePage = { items: Base[]; total: number; limit: number; offset: number };
type MessageResponse = { message?: string };
type FieldDependentsResponse = { dependents: unknown[]; hasBlocking: boolean };
type RecordAuditResponse = { items: unknown[] };
type Form = {
  id: string;
  shortId: string;
  tableId: string;
  name: string;
  config: unknown;
  publicToken: string | null;
  isActive: boolean;
  ownerUserId: string | null;
  position: number;
  isDefault: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type WorkflowRunListResponse = { items: WorkflowRun[]; nextCursor?: string | null };
type WorkflowStepRunListResponse = { items: WorkflowStepRun[] };
type WorkflowEmailDeliveryListResponse = { items: WorkflowEmailDelivery[]; nextCursor?: string | null };
type GridFile = {
  id: string;
  recordId: string;
  fieldId: string;
  position: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdBy: string | null;
  createdAt: string;
};
type GridFileListResponse = { items: GridFile[] };
type FormulaPreviewResponse = {
  ok: boolean;
  diagnostics: Array<{ severity: "error" | "info"; message: string }>;
  fields: Array<{ id: string; shortId: string; name: string; type: string }>;
  rows: Array<{ recordId: string; values: Record<string, unknown>; result: unknown }>;
};
type WorkflowValidateResponse =
  | { ok: true; definition: unknown }
  | { ok: false; diagnostics: Array<{ message: string; path?: Array<string | number>; line?: number; column?: number }> };

const GRIDS_BASE_DEFAULT_KEY = "grids.base";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSION_LEVELS = ["none", "read", "write", "admin"] as const satisfies readonly PermissionLevel[];
const ACCESS_RESOURCE_TYPES = ["base", "table", "view", "form", "dashboard", "document-template", "workflow"] as const;
type AccessResourceType = (typeof ACCESS_RESOURCE_TYPES)[number];
type AccessPermission = (typeof PERMISSION_LEVELS)[number];
type AccessResource = {
  type: AccessResourceType;
  id: string;
  label: string;
  allowed: readonly AccessPermission[];
};

const JSON_BODY_INPUT = flag.input({
  name: "body",
  fileName: "body-file",
  fileAliases: ["f"],
  stdinName: "stdin",
  valueLabel: "json",
});

const JSON_BODY_NAMED_INPUT = flag.input({
  name: "body",
  fileName: "body-file",
  stdinName: false,
  valueLabel: "json",
});

const GQL_INPUT = flag.input({
  name: "query",
  fileName: "query-file",
  fileAliases: ["f"],
  stdinName: "stdin",
  valueLabel: "gql",
});

const FORMULA_INPUT = flag.input({
  name: "expression",
  fileName: "expression-file",
  fileAliases: ["f"],
  stdinName: "stdin",
  valueLabel: "formula",
});

const WORKFLOW_SOURCE_INPUT = flag.input({
  name: "source",
  fileName: "source-file",
  fileAliases: ["f"],
  stdinName: "stdin",
  valueLabel: "yaml",
});

const WORKFLOW_TRIGGER_INPUT = flag.input({
  name: "input",
  fileName: "input-file",
  fileAliases: ["f"],
  stdinName: "stdin",
  valueLabel: "json",
});

const WORKFLOW_BULK_QUERY_INPUT = flag.input({
  name: "query",
  fileName: "query-file",
  fileAliases: ["qf"],
  stdinName: false,
  valueLabel: "json",
});

const baseFlag = {
  base: flag.string({ description: "Grids base id, short id, or exact name" }),
};

const tableFlag = {
  table: flag.string({ description: "Table id, short id, or exact name" }),
};

const viewFlag = {
  view: flag.string({ description: "View id, short id, or exact name" }),
};

const formFlag = {
  form: flag.string({ description: "Form id, short id, or exact name" }),
};

const dashboardFlag = {
  dashboard: flag.string({ description: "Dashboard id, short id, or exact name" }),
};

const documentTemplateFlag = {
  template: flag.string({ description: "Document template id, short id, or exact name" }),
};

const emailTemplateFlag = {
  template: flag.string({ description: "Email template id, short id, or exact name" }),
};

const workflowFlag = {
  workflow: flag.string({ description: "Workflow id, short id, or exact name" }),
};

const baseArgs = {
  args: arg.rest({ valueLabel: "base-or-args", description: "Optional leading base followed by command arguments." }),
};

const tableArgs = {
  args: arg.rest({ valueLabel: "base-table-args", description: "Optional leading base, then table and command arguments." }),
};

const queryString = (params: Record<string, string | number | boolean | null | undefined>): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
};

const jsonRequest = (method: string, body?: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const readApi = async <T>(ctx: CloudCliContext, path: string, init?: RequestInit): Promise<T> =>
  ctx.readJson<T>(await ctx.fetch(`/api/grids${path}`, init));

const readApiText = async (ctx: CloudCliContext, path: string): Promise<string> => {
  const response = await ctx.fetch(`/api/grids${path}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.text();
};

const writeApiFile = async (ctx: CloudCliContext, path: string, init: RequestInit | undefined, out: string | undefined) => {
  if (!out) throw new Error("Missing output path. Pass --out <file>.");
  const response = await ctx.fetch(`/api/grids${path}`, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  await writeFile(out, new Uint8Array(await response.arrayBuffer()));
  if (ctx.options.output === "json") ctx.json({ path: out });
  else ctx.print(`Wrote ${out}.`);
};

const printJsonOrTable = <TRow extends Record<string, unknown>>(
  ctx: CloudCliContext,
  value: unknown,
  rows: TRow[],
  columns: Parameters<CloudCliContext["table"]>[1],
) => {
  if (ctx.options.output === "json") ctx.json(value);
  else ctx.table(rows, columns);
};

const printJsonOrMessage = (ctx: CloudCliContext, value: unknown, message: string) => {
  if (ctx.options.output === "json") ctx.json(value);
  else ctx.print(message);
};

type FieldTypeReference = {
  type: string;
  kind: string;
  category: string;
  recordWritable: boolean;
  config: string;
  recordValue: string;
  notes: string;
};

type FieldReferenceDetails = Omit<FieldTypeReference, "type" | "kind" | "category" | "recordWritable">;

const EMPTY_CONFIG = "{}";

const FIELD_TYPE_DETAILS: Record<string, FieldReferenceDetails> = {
  text: {
    config: '{ "minLength": 1, "maxLength": 200, "regex": "^[A-Z]", "multiline": false }',
    recordValue: '"Ada Lovelace"',
    notes: "Single-line text by default. Empty string becomes null unless the field is required.",
  },
  longtext: {
    config: '{ "markdown": true, "maxLength": 5000 }',
    recordValue: '"Long text with line breaks"',
    notes: "Multiline text. Whitespace is preserved.",
  },
  number: {
    config: '{ "min": 0, "max": 1000, "decimalPlaces": 2, "unit": "EUR", "unitPosition": "suffix" }',
    recordValue: '"42.50"',
    notes: "Accepts strings or numbers and stores a canonical decimal string.",
  },
  boolean: {
    config: EMPTY_CONFIG,
    recordValue: "true",
    notes: 'Accepts booleans and common API encodings like "true", "false", 1, and 0.',
  },
  date: {
    config: '{ "includeTime": false, "min": "2026-01-01", "max": "2026-12-31" }',
    recordValue: '"2026-07-07"',
    notes: "Date-only fields use YYYY-MM-DD. With includeTime=true, send a timezone-aware ISO date-time.",
  },
  select: {
    config: '{ "multiple": false, "options": [{ "id": "open", "label": "Open", "color": "blue" }] }',
    recordValue: '["open"]',
    notes: "Record values are arrays of option ids. Single select still uses an array with at most one id.",
  },
  percent: {
    config: '{ "range": "percent", "decimals": 2 }',
    recordValue: "42.5",
    notes: 'range "percent" accepts 0..100. range "fraction" accepts 0..1.',
  },
  duration: {
    config: '{ "unit": "seconds" }',
    recordValue: '"01:30:00"',
    notes: "Stores integer seconds. Accepts seconds, MM:SS, or HH:MM:SS.",
  },
  json: {
    config: EMPTY_CONFIG,
    recordValue: '{ "any": "json" }',
    notes: "Stores arbitrary JSON. Nested JSON paths are opaque to filter/sort.",
  },
  relation: {
    config: '{ "targetTableId": "<table-uuid>", "cardinality": "multiple" }',
    recordValue: '["<record-uuid>"]',
    notes: "Links records by UUID. Use a single UUID string for single-cardinality fields if preferred.",
  },
  id: {
    config: '{ "strategy": "date_sequence", "prefix": "INV-", "padding": 5, "period": "year" }',
    recordValue: "(server generated)",
    notes: "Generated on record create. Do not send id fields in record payloads.",
  },
  formula: {
    config: '{ "expression": "LEN(Name)" }',
    recordValue: "(computed)",
    notes: "Read-only computed field. Uses the Grids formula engine.",
  },
  lookup: {
    config: '{ "relationFieldId": "<field-uuid>", "targetFieldId": "<field-uuid>" }',
    recordValue: "(computed)",
    notes: "Read-only projection through a relation field.",
  },
  rollup: {
    config: '{ "relationFieldId": "<field-uuid>", "targetFieldId": "<field-uuid>", "agg": "sum" }',
    recordValue: "(computed)",
    notes: "Read-only relation aggregate. agg is one of count, sum, avg, min, max.",
  },
  created_at: {
    config: EMPTY_CONFIG,
    recordValue: "(system)",
    notes: "System timestamp projected from the record row.",
  },
  created_by: {
    config: EMPTY_CONFIG,
    recordValue: "(system)",
    notes: "System user reference projected from the record row.",
  },
  updated_at: {
    config: EMPTY_CONFIG,
    recordValue: "(system)",
    notes: "System timestamp projected from the record row.",
  },
  updated_by: {
    config: EMPTY_CONFIG,
    recordValue: "(system)",
    notes: "System user reference projected from the record row.",
  },
  file: {
    config: '{ "maxFiles": 10, "accept": ["image/png", "application/pdf"] }',
    recordValue: "(external file API)",
    notes: "File bytes are not written through records create/update. Use the dedicated file API/UI.",
  },
};

const fieldTypeCategory = (type: string): string => {
  if (type in VALUE_FIELD_TYPES) return "value";
  if (type in LINK_FIELD_TYPES) return "link";
  if (type in SERVER_GENERATED_FIELD_TYPES) return "server-generated";
  if (type in COMPUTED_FIELD_TYPES) return "computed";
  if (type in SYSTEM_FIELD_TYPES) return "system";
  if (type in EXTERNAL_FIELD_TYPES) return "external";
  return "unknown";
};

const fieldTypeReferences = (): FieldTypeReference[] =>
  Object.keys(fieldTypeRegistry)
    .sort()
    .map((type) => {
      const definition = fieldTypeRegistry[type]!;
      const details = FIELD_TYPE_DETAILS[type] ?? {
        config: EMPTY_CONFIG,
        recordValue: "(unknown)",
        notes: "No CLI reference details are available for this field type.",
      };
      return {
        type,
        kind: definition.kind,
        category: fieldTypeCategory(type),
        recordWritable: type in RECORD_WRITABLE_FIELD_TYPES,
        ...details,
      };
    });

const fieldTypeReference = (type: string): FieldTypeReference => {
  const exact = fieldTypeReferences().find((item) => item.type === type);
  if (exact) return exact;
  const candidates = Object.keys(fieldTypeRegistry)
    .filter((item) => item.includes(type.toLowerCase()))
    .slice(0, 5)
    .join(", ");
  throw new Error(`Unknown field type "${type}".${candidates ? ` Candidates: ${candidates}.` : ""}`);
};

const printFieldTypeReference = (ctx: CloudCliContext, ref: FieldTypeReference) => {
  if (ctx.options.output === "json") {
    ctx.json(ref);
    return;
  }
  ctx.print(`${ref.type} (${ref.category})`);
  ctx.print(`kind: ${ref.kind}`);
  ctx.print(`record writable: ${ref.recordWritable ? "yes" : "no"}`);
  ctx.print(`config: ${ref.config}`);
  ctx.print(`record value: ${ref.recordValue}`);
  ctx.print(`notes: ${ref.notes}`);
};

const fieldTypeRows = (items: FieldTypeReference[]) =>
  items.map((item) => ({
    type: item.type,
    category: item.category,
    writable: item.recordWritable ? "yes" : "no",
    recordValue: item.recordValue,
    config: item.config,
  }));

const fieldConfig = (field: Field): Record<string, unknown> =>
  typeof field.config === "object" && field.config !== null && !Array.isArray(field.config)
    ? (field.config as Record<string, unknown>)
    : {};

const selectExampleValue = (field: Field): unknown => {
  const options = fieldConfig(field).options;
  if (!Array.isArray(options)) return ["<option-id>"];
  const first = options.find(
    (item): item is { id: string } => typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string",
  );
  return first ? [first.id] : ["<option-id>"];
};

const relationExampleValue = (field: Field): unknown => (fieldConfig(field).cardinality === "single" ? "<record-uuid>" : ["<record-uuid>"]);

const fieldExampleValue = (field: Field): unknown => {
  if (field.defaultValue !== null && field.defaultValue !== undefined) return field.defaultValue;
  switch (field.type) {
    case "text":
      return "Text value";
    case "longtext":
      return "Long text value";
    case "number":
      return "42";
    case "boolean":
      return true;
    case "date":
      return fieldConfig(field).includeTime ? "2026-07-07T12:00:00.000Z" : "2026-07-07";
    case "select":
      return selectExampleValue(field);
    case "percent":
      return 42.5;
    case "duration":
      return "01:30:00";
    case "json":
      return { value: true };
    case "relation":
      return relationExampleValue(field);
    default:
      return null;
  }
};

const recordShapeForFields = (table: Table, fields: Field[]) => {
  const alive = fields.filter((field) => !field.deletedAt);
  const writable = alive.filter((field) => field.type in RECORD_WRITABLE_FIELD_TYPES);
  const readOnly = alive.filter((field) => !(field.type in RECORD_WRITABLE_FIELD_TYPES));
  const example = Object.fromEntries(writable.map((field) => [field.id, fieldExampleValue(field)]));
  return {
    table: { id: table.id, shortId: table.shortId, name: table.name },
    payload: "Record create/update bodies are plain JSON objects keyed by field UUID.",
    example,
    writableFields: writable.map((field) => ({
      id: field.id,
      shortId: field.shortId,
      name: field.name,
      type: field.type,
      required: field.required,
      config: field.config,
      exampleValue: fieldExampleValue(field),
    })),
    readOnlyFields: readOnly.map((field) => ({
      id: field.id,
      shortId: field.shortId,
      name: field.name,
      type: field.type,
    })),
  };
};

const printRecordShape = (ctx: CloudCliContext, shape: ReturnType<typeof recordShapeForFields>) => {
  if (ctx.options.output === "json") {
    ctx.json(shape);
    return;
  }
  ctx.print(`Record payload for ${shape.table.name} (${shape.table.shortId})`);
  ctx.print("Use field UUID keys. Field names and short ids are only lookup aids.");
  ctx.print("");
  ctx.print("Example body:");
  ctx.print(JSON.stringify(shape.example, null, 2));
  ctx.print("");
  ctx.print("Writable fields:");
  ctx.table(
    shape.writableFields.map((field) => ({
      name: field.name,
      type: field.type,
      required: field.required ? "yes" : "no",
      key: field.id,
      example: displayValue(field.exampleValue),
    })),
    [
      { key: "name", label: "FIELD" },
      { key: "type", label: "TYPE" },
      { key: "required", label: "REQ" },
      { key: "key", label: "JSON KEY" },
      { key: "example", label: "EXAMPLE" },
    ],
  );
  if (shape.readOnlyFields.length > 0) {
    ctx.print("");
    ctx.print("Read-only fields:");
    ctx.table(
      shape.readOnlyFields.map((field) => ({ name: field.name, type: field.type, key: field.id })),
      [
        { key: "name", label: "FIELD" },
        { key: "type", label: "TYPE" },
        { key: "key", label: "ID" },
      ],
    );
  }
};

const GQL_REFERENCE = {
  clauses: [
    "from table <table-ref> [as alias]",
    "from view <view-ref> [as alias]",
    "select <field>, formula(<expr>) as alias",
    "join table <table-ref> as alias on <scope.field> = <alias.field>",
    "left join table <table-ref> as alias on <scope.field> = <alias.field>",
    "where <formula predicate>",
    "group by <field> [by day|week|month|quarter|year]",
    "aggregate count(*) as total, sum(<field>) as revenue",
    "having <formula predicate>",
    "sort <field-or-alias> [asc|desc] [nulls first|last]",
    "search '<text>' [in field1, field2]",
    "limit <1..10000>",
    "offset <0..10000>",
    "include deleted",
    "deleted only",
  ],
  refs: [
    "Use exact field/source names when unambiguous: Name",
    'Quote names with spaces: "Birth year"',
    "Use stable ids in braces when workflows must not break on rename: {field-uuid}",
    "Qualified refs use aliases: items.Name, author.Country",
  ],
  examples: [
    'from table Authors\nselect Name, "Birth year"\nsort "Birth year" desc\nlimit 100',
    "from table Books as books\ngroup by Published by year\naggregate count(*) as books, avg(Rating) as avgRating\nsort books desc",
    "from table Items\nsearch 'camera' in Name, Notes\nwhere Available = true\nlimit 50",
  ],
};

const FORMULA_REFERENCE = {
  syntax: [
    'Field refs: Name, "Birth year", or {field-uuid}.',
    "Text literals use quotes: 'camera'.",
    "Operators: +, -, *, /, %, =, !=, <, <=, >, >=, and, or, not.",
    "Functions are case-insensitive. Prefer uppercase in shared docs.",
    "Formula fields, GQL where/having, computed GQL columns, and template data checks use the same expression model.",
  ],
  functions: GRID_FORMULA_FUNCTIONS,
  examples: ["LEN(Name)", "IFEMPTY(Email, 'missing')", "DATEADD(TODAY(), 30, 'days')", "ROUND(Amount * 1.19, 2)"],
};

const DOCUMENT_TEMPLATE_REFERENCE = {
  fields: {
    name: "Template label shown in Grids.",
    source: "GQL source. Use {{ record.id }} in the where clause for per-record templates.",
    html: "Liquid HTML body rendered by Gotenberg.",
    headerHtml: "Optional Liquid HTML header.",
    footerHtml: "Optional Liquid HTML footer.",
    pageCss: "Optional CSS for @page, print layout, and shared document styles.",
    numberTemplate: "Liquid pattern for immutable document.number.",
    filenameTemplate: "Liquid pattern for the generated PDF filename.",
    enabled: "Disabled templates are hidden from normal generation flows.",
  },
  liquidData: [
    "record.id",
    "record.data.<field label or key>",
    "rows",
    "columns",
    "table.name",
    "template.name",
    "document.number",
    "run.shortId",
    "generatedAt",
    "app.name",
    "app.logo",
    "business.legalName",
  ],
  examples: [
    {
      source: 'from table Invoices\nwhere record.id = "{{ record.id }}"\nlimit 1',
      html: "<h1>Invoice {{ document.number }}</h1>\n<p>{{ record.data.Customer }}</p>",
      filenameTemplate: "invoice-{{ document.number }}.pdf",
    },
  ],
};

const EMAIL_TEMPLATE_REFERENCE = {
  fields: {
    name: "Template label shown in workflow email actions.",
    subject: "Liquid subject template.",
    html: "Liquid HTML email body. There is no plain-text fallback field.",
    enabled: "Disabled templates cannot be selected in normal workflow flows.",
  },
  liquidData: ["workflow.name", "run.id", "data.<key>", "app.name", "business.legalName", "date.iso"],
  workflowUse: "Use sendEmail with template, to, optional data, and optional saveAs.",
  example: {
    subject: "Loan reminder for {{ data.itemName }}",
    html: "<p>Hello {{ data.customerName }},</p><p>Please return {{ data.itemName }}.</p>",
    step: "sendEmail:\n  template: Reminder\n  to:\n    - email: ${{ inputs.email }}\n  data:\n    itemName: ${{ inputs.item.Name }}",
  },
};

const WORKFLOW_REFERENCE = {
  yaml: {
    topLevel: ["inputs", "triggers", "steps"],
    inputTypes: ["record", "recordList", "text", "number", "boolean", "date", "dateTime", "select"],
    triggers: ["form", "api", "scanner", "bulkSelection", "dashboardButton", "schedule", "recordEvent"],
    steps: [
      "setVariable",
      "updateRecord",
      "createRecord",
      "generateDocument",
      "createDocumentLink",
      "sendEmail",
      "httpRequest",
      "if/then/else",
      "switch/cases/default",
      "forEach/as/do",
      "succeed",
      "fail",
    ],
  },
  values: {
    literals: "Plain strings are literal values, including strings containing dots.",
    dynamic: "Use an exact ${{ inputs.name }}, ${{ savedValue }}, or ${{ now() }} expression for dynamic WorkflowValue strings.",
    messages: "succeed/fail messages may embed ${{ ... }} expressions inside literal text.",
    dedicatedReferences: "record, forEach, document, and exists are reference slots and stay raw (for example, record: inputs.item).",
    scope: "Inputs exist for the whole run; saved values exist after their step; forEach aliases exist only inside do.",
  },
  example:
    "inputs:\n  item:\n    type: record\n    table: Items\ntriggers:\n  api: {}\nsteps:\n  - setVariable:\n      name: ranAt\n      value: ${{ now() }}\n  - updateRecord:\n      record: inputs.item\n      set:\n        Status: Checked",
};

const printReference = (ctx: CloudCliContext, value: unknown, text: string) => {
  if (ctx.options.output === "json") ctx.json(value);
  else ctx.print(text);
};

const compactId = (value: string | null | undefined): string => (value ? value.slice(0, 8) : "-");
const displayValue = (value: unknown): string => {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

const requireRestArg = (args: string[], index: number, label: string): string => {
  const value = args[index];
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
};

const readTextInput = async (input: CliInputFlagValue, label: string, required = true): Promise<string | undefined> => {
  const text = await readCliInput(input, { label, required, trimFinalNewline: true });
  if (required && !text?.trim()) throw new Error(`Missing ${label}.`);
  return text;
};

const readJsonInput = async <T>(input: CliInputFlagValue, label: string, required = true): Promise<T | undefined> => {
  const text = await readTextInput(input, label, required);
  if (text === undefined || text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label}: ${message}`);
  }
};

const applyDefined = (target: Record<string, unknown>, patch: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) target[key] = value;
  }
  return target;
};

const exactMatch = <T>(
  items: T[],
  ref: string,
  fields: Array<(item: T) => string | null | undefined>,
  label: string,
  format: (item: T) => string,
): T => {
  const exact = items.filter((item) => fields.some((field) => field(item) === ref));
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new Error(`Ambiguous ${label} "${ref}". Use one of: ${exact.map(format).join(", ")}`);

  const folded = items.filter((item) => fields.some((field) => (field(item) ?? "").toLowerCase() === ref.toLowerCase()));
  if (folded.length === 1) return folded[0]!;
  if (folded.length > 1) throw new Error(`Ambiguous ${label} "${ref}". Use one of: ${folded.map(format).join(", ")}`);

  const candidates = items
    .filter((item) => fields.some((field) => (field(item) ?? "").toLowerCase().includes(ref.toLowerCase())))
    .slice(0, 5)
    .map(format)
    .join(", ");
  throw new Error(`Unknown ${label} "${ref}".${candidates ? ` Candidates: ${candidates}.` : ""}`);
};

const listBases = (ctx: CloudCliContext, params: { q?: string; limit?: number; offset?: number } = {}): Promise<BasePage> =>
  readApi<BasePage>(
    ctx,
    `/bases${queryString({
      q: params.q,
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
    })}`,
  );

const resolveBase = async (ctx: CloudCliContext, ref: string): Promise<Base> => {
  if (UUID_RE.test(ref)) return readApi<Base>(ctx, `/bases/${encodeURIComponent(ref)}`);
  const page = await listBases(ctx, { q: ref, limit: 500 });
  return exactMatch(
    page.items,
    ref,
    [(base) => base.id, (base) => base.shortId, (base) => base.name],
    "base",
    (base) => `${base.name} (${base.shortId})`,
  );
};

const requireDefaultBaseRef = async (ctx: CloudCliContext): Promise<string> => {
  const value = await ctx.getDefault(GRIDS_BASE_DEFAULT_KEY);
  if (!value) throw new Error("Missing Grids base. Pass --base <base> or run `cld grids use <base>`.");
  return value;
};

const baseRefFromArgs = async (
  ctx: CloudCliContext,
  args: string[],
  requiredTrailingArgs: number,
): Promise<{ baseRef: string; rest: string[] }> => {
  const flagged = typeof ctx.flags.base === "string" ? ctx.flags.base : undefined;
  if (flagged) return { baseRef: flagged, rest: args };
  if (args.length > requiredTrailingArgs) return { baseRef: requireRestArg(args, 0, "base"), rest: args.slice(1) };
  return { baseRef: await requireDefaultBaseRef(ctx), rest: args };
};

const resolveBaseFromCommand = async (
  ctx: CloudCliContext,
  args: string[],
  requiredTrailingArgs: number,
): Promise<{ base: Base; rest: string[] }> => {
  const { baseRef, rest } = await baseRefFromArgs(ctx, args, requiredTrailingArgs);
  return { base: await resolveBase(ctx, baseRef), rest };
};

const listTables = (ctx: CloudCliContext, baseId: string): Promise<Table[]> =>
  readApi<Table[]>(ctx, `/tables/by-base/${encodeURIComponent(baseId)}`);

const resolveTable = async (ctx: CloudCliContext, baseId: string, ref: string): Promise<Table> =>
  exactMatch(
    await listTables(ctx, baseId),
    ref,
    [(table) => table.id, (table) => table.shortId, (table) => table.name],
    "table",
    (table) => `${table.name} (${table.shortId})`,
  );

const resolveTableFromFlags = async (ctx: CloudCliContext, base: Base, ref: string | undefined): Promise<Table | null> =>
  ref ? resolveTable(ctx, base.id, ref) : null;

const listFields = (ctx: CloudCliContext, tableId: string): Promise<Field[]> =>
  readApi<Field[]>(ctx, `/fields/by-table/${encodeURIComponent(tableId)}`);

const resolveField = async (ctx: CloudCliContext, tableId: string, ref: string): Promise<Field> =>
  exactMatch(
    await listFields(ctx, tableId),
    ref,
    [(field) => field.id, (field) => field.shortId, (field) => field.name],
    "field",
    (field) => `${field.name} (${field.shortId})`,
  );

const listViews = (ctx: CloudCliContext, tableId: string): Promise<View[]> =>
  readApi<View[]>(ctx, `/views/by-table/${encodeURIComponent(tableId)}`);

const getViewById = (ctx: CloudCliContext, viewId: string): Promise<View> => readApi<View>(ctx, `/views/${encodeURIComponent(viewId)}`);

const resolveView = async (ctx: CloudCliContext, tableId: string, ref: string): Promise<View> =>
  exactMatch(
    await listViews(ctx, tableId),
    ref,
    [(view) => view.id, (view) => view.shortId, (view) => view.name],
    "view",
    (view) => `${view.name} (${view.shortId})`,
  );

const resolveOptionalView = async (ctx: CloudCliContext, table: Table | null, ref: string | undefined): Promise<View | null> => {
  if (!ref) return null;
  if (UUID_RE.test(ref)) return getViewById(ctx, ref);
  if (!table) throw new Error("Resolving a view by name or short id requires --table.");
  return resolveView(ctx, table.id, ref);
};

const listForms = (ctx: CloudCliContext, tableId: string): Promise<Form[]> =>
  readApi<Form[]>(ctx, `/forms/by-table/${encodeURIComponent(tableId)}`);

const getFormById = (ctx: CloudCliContext, formId: string): Promise<Form> => readApi<Form>(ctx, `/forms/${encodeURIComponent(formId)}`);

const assertFormScope = async (ctx: CloudCliContext, base: Base, table: Table | null, form: Form) => {
  if (table) {
    if (form.tableId !== table.id) throw new Error("Form does not belong to the selected table.");
    return;
  }
  const tables = await listTables(ctx, base.id);
  if (!tables.some((item) => item.id === form.tableId)) throw new Error("Form does not belong to the selected base.");
};

const resolveForm = async (ctx: CloudCliContext, base: Base, table: Table | null, ref: string): Promise<Form> => {
  if (UUID_RE.test(ref)) {
    const form = await getFormById(ctx, ref);
    await assertFormScope(ctx, base, table, form);
    return form;
  }
  if (!table) throw new Error("Resolving a form by name or short id requires --table.");
  return exactMatch(
    await listForms(ctx, table.id),
    ref,
    [(form) => form.id, (form) => form.shortId, (form) => form.name],
    "form",
    (form) => `${form.name} (${form.shortId || "default"})`,
  );
};

const listDashboards = (ctx: CloudCliContext, baseId: string): Promise<Dashboard[]> =>
  readApi<Dashboard[]>(ctx, `/dashboards/by-base/${encodeURIComponent(baseId)}`);

const resolveDashboard = async (ctx: CloudCliContext, baseId: string, ref: string): Promise<Dashboard> => {
  const dashboard = UUID_RE.test(ref)
    ? await readApi<Dashboard>(ctx, `/dashboards/${encodeURIComponent(ref)}`)
    : exactMatch(
        await listDashboards(ctx, baseId),
        ref,
        [(item) => item.id, (item) => item.shortId, (item) => item.name],
        "dashboard",
        (item) => `${item.name} (${item.shortId})`,
      );
  assertBaseScoped("Dashboard", baseId, dashboard.baseId);
  return dashboard;
};

const listDocumentTemplates = (
  ctx: CloudCliContext,
  tableId: string,
  options: { full?: boolean; min?: "read" | "write" | "admin" } = {},
): Promise<Array<DocumentTemplate | DocumentTemplateSummary>> =>
  options.full
    ? readApi<DocumentTemplate[]>(ctx, `/documents/templates/by-table/${encodeURIComponent(tableId)}/full`)
    : readApi<DocumentTemplateSummary[]>(
        ctx,
        `/documents/templates/by-table/${encodeURIComponent(tableId)}${queryString({ min: options.min ?? "read" })}`,
      );

const getDocumentTemplateById = (ctx: CloudCliContext, templateId: string): Promise<DocumentTemplate> =>
  readApi<DocumentTemplate>(ctx, `/documents/templates/${encodeURIComponent(templateId)}`);

const assertBaseScoped = (kind: string, expectedBaseId: string, actualBaseId: string) => {
  if (actualBaseId !== expectedBaseId) throw new Error(`${kind} does not belong to the selected base.`);
};

const assertDocumentTemplateScope = async (ctx: CloudCliContext, base: Base, table: Table | null, template: DocumentTemplate) => {
  if (table) {
    if (template.tableId !== table.id) throw new Error("Document template does not belong to the selected table.");
    return;
  }
  const tables = await listTables(ctx, base.id);
  if (!tables.some((item) => item.id === template.tableId)) throw new Error("Document template does not belong to the selected base.");
};

const resolveDocumentTemplate = async (ctx: CloudCliContext, base: Base, table: Table | null, ref: string): Promise<DocumentTemplate> => {
  if (UUID_RE.test(ref)) {
    const template = await getDocumentTemplateById(ctx, ref);
    await assertDocumentTemplateScope(ctx, base, table, template);
    return template;
  }
  if (!table) throw new Error("Resolving a document template by name or short id requires --table.");
  const summary = exactMatch(
    await listDocumentTemplates(ctx, table.id, { full: true }),
    ref,
    [(template) => template.id, (template) => template.shortId, (template) => template.name],
    "document template",
    (template) => `${template.name} (${template.shortId})`,
  );
  return summary as DocumentTemplate;
};

const listEmailTemplates = (ctx: CloudCliContext, baseId: string): Promise<EmailTemplate[]> =>
  readApi<EmailTemplate[]>(ctx, `/email-templates/by-base/${encodeURIComponent(baseId)}`);

const resolveEmailTemplate = async (ctx: CloudCliContext, baseId: string, ref: string): Promise<EmailTemplate> => {
  const template = UUID_RE.test(ref)
    ? await readApi<EmailTemplate>(ctx, `/email-templates/${encodeURIComponent(ref)}`)
    : exactMatch(
        await listEmailTemplates(ctx, baseId),
        ref,
        [(item) => item.id, (item) => item.shortId, (item) => item.name],
        "email template",
        (item) => `${item.name} (${item.shortId})`,
      );
  assertBaseScoped("Email template", baseId, template.baseId);
  return template;
};

const listWorkflows = (ctx: CloudCliContext, baseId: string): Promise<Workflow[]> =>
  readApi<Workflow[]>(ctx, `/workflows/by-base/${encodeURIComponent(baseId)}`);

const resolveWorkflow = async (ctx: CloudCliContext, baseId: string, ref: string): Promise<Workflow> => {
  const workflow = UUID_RE.test(ref)
    ? await readApi<Workflow>(ctx, `/workflows/${encodeURIComponent(ref)}`)
    : exactMatch(
        await listWorkflows(ctx, baseId),
        ref,
        [(item) => item.id, (item) => item.shortId, (item) => item.name],
        "workflow",
        (item) => `${item.name} (${item.shortId})`,
      );
  assertBaseScoped("Workflow", baseId, workflow.baseId);
  return workflow;
};

const baseRows = (items: Base[]) =>
  items.map((base) => ({
    shortId: base.shortId,
    name: base.name,
    description: base.description ?? "",
    updatedAt: base.updatedAt,
    id: base.id,
  }));

const tableRows = (items: Table[]) =>
  items.map((table) => ({
    shortId: table.shortId,
    name: table.name,
    fields: table.columns.length,
    updatedAt: table.updatedAt,
    id: table.id,
  }));

const fieldRows = (items: Field[]) =>
  items.map((field) => ({
    shortId: field.shortId,
    name: field.name,
    type: field.type,
    required: field.required ? "yes" : "no",
    presentable: field.presentable ? "yes" : "no",
    id: field.id,
  }));

const viewRows = (items: View[]) =>
  items.map((view) => ({
    shortId: view.shortId,
    name: view.name,
    scope: view.ownerUserId ? "personal" : "shared",
    updatedAt: view.updatedAt,
    id: view.id,
  }));

const formRows = (items: Form[]) =>
  items.map((form) => ({
    shortId: form.shortId || "default",
    name: form.name,
    active: form.isActive ? "yes" : "no",
    public: form.publicToken ? "yes" : "no",
    fields:
      typeof form.config === "object" && form.config !== null && Array.isArray((form.config as { fields?: unknown }).fields)
        ? (form.config as { fields: unknown[] }).fields.length
        : 0,
    updatedAt: form.updatedAt,
    id: form.id,
  }));

const dashboardRows = (items: Dashboard[]) =>
  items.map((dashboard) => ({
    shortId: dashboard.shortId,
    name: dashboard.name,
    scope: dashboard.ownerUserId ? "personal" : "shared",
    rows: dashboard.config.rows.length,
    updatedAt: dashboard.updatedAt,
    id: dashboard.id,
  }));

const documentTemplateRows = (items: Array<DocumentTemplate | DocumentTemplateSummary>) =>
  items.map((template) => ({
    shortId: template.shortId,
    name: template.name,
    enabled: template.enabled ? "yes" : "no",
    updatedAt: template.updatedAt,
    id: template.id,
  }));

const emailTemplateRows = (items: EmailTemplate[]) =>
  items.map((template) => ({
    shortId: template.shortId,
    name: template.name,
    enabled: template.enabled ? "yes" : "no",
    subject: template.subject,
    updatedAt: template.updatedAt,
    id: template.id,
  }));

const workflowRows = (items: Workflow[]) =>
  items.map((workflow) => ({
    shortId: workflow.shortId,
    name: workflow.name,
    enabled: workflow.enabled ? "yes" : "no",
    updatedAt: workflow.updatedAt,
    id: workflow.id,
  }));

const workflowRunRows = (items: WorkflowRun[]) =>
  items.map((run) => ({
    id: compactId(run.id),
    runId: run.id,
    workflowId: run.workflowId ?? "-",
    trigger: run.triggerKind,
    status: run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt ?? "-",
  }));

const workflowStepRows = (items: WorkflowStepRun[]) =>
  items.map((step) => ({
    index: step.stepIndex,
    path: step.stepPath,
    kind: step.kind,
    status: step.status,
    durationMs: step.durationMs ?? "-",
    error: step.error ?? "",
  }));

const workflowEmailRows = (items: WorkflowEmailDelivery[]) =>
  items.map((delivery) => ({
    id: compactId(delivery.id),
    workflowId: delivery.workflowId ?? "-",
    runId: delivery.workflowRunId ?? "-",
    status: delivery.status,
    subject: delivery.subject ?? "",
    recipients: delivery.recipients.map((recipient) => recipient.recipient).join(", "),
    createdAt: delivery.createdAt,
  }));

const documentRunRows = (items: DocumentRunSummary[]) =>
  items.map((run) => ({
    shortId: run.shortId,
    number: run.documentNumber,
    filename: run.filename,
    tags: run.tags.join(", "),
    generatedAt: run.generatedAt,
    id: run.id,
  }));

const documentFolderRows = (items: DocumentRunBrowseResponse["folders"]) =>
  items.map((folder) => ({
    kind: folder.kind,
    label: folder.label,
    count: folder.count,
    path: folder.path.join("/"),
  }));

const documentLinkRows = (items: DocumentLink[]) =>
  items.map((link) => ({
    id: link.id,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt ?? "-",
    accessCount: link.accessCount,
    comment: link.comment ?? "",
  }));

const gridFileRows = (items: GridFile[]) =>
  items.map((file) => ({
    id: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    position: file.position,
    createdAt: file.createdAt,
  }));

const snapshotRows = (items: RecordSnapshotListResponse["items"]) =>
  items.map((snapshot) => ({
    id: snapshot.id,
    recordId: snapshot.recordId,
    tableId: snapshot.tableId,
    createdBy: snapshot.createdBy ?? "",
    createdAt: snapshot.createdAt,
  }));

const recordRows = (items: GridRecord[]) =>
  items.map((record) => ({
    id: compactId(record.id),
    recordId: record.id,
    version: record.version,
    updatedAt: record.updatedAt,
    ...Object.fromEntries(Object.entries(record.data).map(([key, value]) => [key, displayValue(value)])),
  }));

const printDiagnostics = (ctx: CloudCliContext, diagnostics: Array<{ message: string; line?: number; column?: number }>) => {
  if (diagnostics.length === 0) {
    ctx.print("No diagnostics.");
    return;
  }
  for (const diagnostic of diagnostics) {
    const location = diagnostic.line && diagnostic.column ? `Line ${diagnostic.line}, col ${diagnostic.column}: ` : "";
    ctx.print(`${location}${diagnostic.message}`);
  }
};

const printGqlDiagnostics = (
  ctx: CloudCliContext,
  diagnostics: NonNullable<Extract<DslQueryExecuteResponse, { ok: false }>["diagnostics"]>,
) => {
  if (diagnostics.length === 0) {
    ctx.print("Query failed.");
    return;
  }
  printDiagnostics(ctx, diagnostics);
};

const printGqlResult = (ctx: CloudCliContext, payload: DslQueryExecuteResponse): number => {
  if (ctx.options.output === "json") {
    ctx.json(payload);
    return payload.ok ? 0 : 1;
  }
  if (!payload.ok) {
    printGqlDiagnostics(ctx, payload.diagnostics);
    return 1;
  }
  const rows = payload.rows.map((row) => {
    const values: Record<string, unknown> = {
      ...(row.recordId ? { recordId: row.recordId } : {}),
      ...row.values,
    };
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, displayValue(value)]));
  });
  if (rows.length === 0) {
    ctx.print("No rows.");
    return 0;
  }
  const columns: Parameters<CloudCliContext["table"]>[1] = [
    ...(payload.rows.some((row) => row.recordId) ? [{ key: "recordId", label: "RECORD" }] : []),
    ...payload.columns.map((column) => ({ key: column.key, label: column.label })),
  ];
  ctx.table(rows, columns);
  if (payload.truncated) ctx.print(`Truncated at ${payload.limit} rows.`);
  return 0;
};

const printAutocomplete = (ctx: CloudCliContext, payload: DslQueryAutocompleteResponse | WorkflowAutocompleteResponse) => {
  if (ctx.options.output === "json") {
    ctx.json(payload);
    return;
  }
  ctx.table(
    payload.items.map((item) => ({
      label: item.label,
      kind: item.kind,
      detail: item.detail ?? "",
      insertText: item.insertText,
    })),
    [
      { key: "label", label: "LABEL" },
      { key: "kind", label: "KIND" },
      { key: "detail", label: "DETAIL" },
      { key: "insertText", label: "INSERT" },
    ],
  );
  if (payload.diagnostics.length > 0) {
    ctx.print("");
    printDiagnostics(ctx, payload.diagnostics);
  }
};

const readGql = async (input: CliInputFlagValue): Promise<string> => {
  const query = await readTextInput(input, "GQL query", true);
  return query?.trim() ?? "";
};

const readDraftTemplateBody = async (
  flags: {
    body: CliInputFlagValue;
    record?: string;
    source: CliInputFlagValue;
    html: CliInputFlagValue;
    headerHtml: CliInputFlagValue;
    footerHtml: CliInputFlagValue;
    pageCss: CliInputFlagValue;
    numberTemplate?: string;
    filenameTemplate?: string;
  },
  template: DocumentTemplate | null,
) => {
  const body = (await readJsonInput<Record<string, unknown>>(flags.body, "document template draft JSON", false)) ?? {};
  const source = await readTextInput(flags.source, "draft GQL source", false);
  const html = await readTextInput(flags.html, "draft HTML", false);
  const headerHtml = await readTextInput(flags.headerHtml, "draft header HTML", false);
  const footerHtml = await readTextInput(flags.footerHtml, "draft footer HTML", false);
  const pageCss = await readTextInput(flags.pageCss, "draft page CSS", false);
  applyDefined(body, {
    source,
    html,
    headerHtml,
    footerHtml,
    pageCss,
    numberTemplate: flags.numberTemplate,
    filenameTemplate: flags.filenameTemplate,
    recordId: flags.record,
  });
  if (template) {
    applyDefined(body, {
      source: body.source ?? template.source,
      html: body.html ?? template.html,
      headerHtml: body.headerHtml ?? template.headerHtml,
      footerHtml: body.footerHtml ?? template.footerHtml,
      pageCss: body.pageCss ?? template.pageCss,
      numberTemplate: body.numberTemplate ?? template.numberTemplate,
      filenameTemplate: body.filenameTemplate ?? template.filenameTemplate,
    });
  }
  if (!body.recordId) throw new Error("Missing record id. Pass --record or --body JSON.");
  if (!body.source) throw new Error("Missing draft GQL source. Pass --source, --source-file, --body JSON, or a template argument.");
  if (!body.html) throw new Error("Missing draft HTML. Pass --html, --html-file, --body JSON, or a template argument.");
  return body;
};

const resolveDocumentTemplateFromCommand = async (
  ctx: CloudCliContext,
  args: string[],
  refs: { table?: string; template?: string },
): Promise<{ base: Base; table: Table | null; template: DocumentTemplate }> => {
  const { base, rest } = await resolveBaseFromCommand(ctx, args, refs.table || refs.template ? 0 : 2);
  const table = refs.table
    ? await resolveTable(ctx, base.id, refs.table)
    : rest.length >= 2
      ? await resolveTable(ctx, base.id, rest[0]!)
      : null;
  const templateRef = refs.template ?? (table ? rest[1] : rest[0]);
  if (!templateRef) throw new Error("Missing document template.");
  return { base, table, template: await resolveDocumentTemplate(ctx, base, table, templateRef) };
};

const resolveEmailTemplateFromCommand = async (
  ctx: CloudCliContext,
  args: string[],
  templateRef: string | undefined,
): Promise<{ base: Base; template: EmailTemplate }> => {
  const { base, rest } = await resolveBaseFromCommand(ctx, args, templateRef ? 0 : 1);
  const ref = templateRef ?? requireRestArg(rest, 0, "email template");
  return { base, template: await resolveEmailTemplate(ctx, base.id, ref) };
};

const resolveWorkflowFromCommand = async (
  ctx: CloudCliContext,
  args: string[],
  workflowRef: string | undefined,
): Promise<{ base: Base; workflow: Workflow }> => {
  const { base, rest } = await resolveBaseFromCommand(ctx, args, workflowRef ? 0 : 1);
  const ref = workflowRef ?? requireRestArg(rest, 0, "workflow");
  return { base, workflow: await resolveWorkflow(ctx, base.id, ref) };
};

const resolveFormFromCommand = async (
  ctx: CloudCliContext,
  args: string[],
  refs: { table?: string; form?: string },
): Promise<{ base: Base; table: Table | null; form: Form }> => {
  const { base, rest } = await resolveBaseFromCommand(ctx, args, refs.table || refs.form ? 0 : 2);
  const table = refs.table
    ? await resolveTable(ctx, base.id, refs.table)
    : rest.length >= 2
      ? await resolveTable(ctx, base.id, rest[0]!)
      : null;
  const formRef = refs.form ?? (table ? rest[1] : rest[0]);
  if (!formRef) throw new Error("Missing form.");
  return { base, table, form: await resolveForm(ctx, base, table, formRef) };
};

const resolveDashboardFromCommand = async (
  ctx: CloudCliContext,
  args: string[],
  dashboardRef: string | undefined,
): Promise<{ base: Base; dashboard: Dashboard }> => {
  const { base, rest } = await resolveBaseFromCommand(ctx, args, dashboardRef ? 0 : 1);
  const ref = dashboardRef ?? requireRestArg(rest, 0, "dashboard");
  return { base, dashboard: await resolveDashboard(ctx, base.id, ref) };
};

const accessPermissionsForResource = (type: AccessResourceType): readonly AccessPermission[] => {
  switch (type) {
    case "base":
      return ["read", "write", "admin", "none"];
    case "table":
      return ["read", "write", "none"];
    case "view":
      return ["read", "admin", "none"];
    case "form":
      return ["write", "none"];
    case "dashboard":
      return ["read", "none"];
    case "document-template":
    case "workflow":
      return ["read", "write", "admin", "none"];
  }
};

const assertAccessPermission = (resource: AccessResource, permission: AccessPermission) => {
  if (!resource.allowed.includes(permission)) {
    throw new Error(`${resource.type} grants only accept: ${resource.allowed.join(", ")}.`);
  }
};

const accessApiResourceType = (type: AccessResourceType): string => (type === "document-template" ? "document-template" : type);

const resolveAccessResource = async (ctx: CloudCliContext, args: string[]): Promise<AccessResource> => {
  const type = requireRestArg(args, 0, "resource type") as AccessResourceType;
  if (!(ACCESS_RESOURCE_TYPES as readonly string[]).includes(type)) {
    throw new Error(`Resource type must be one of: ${ACCESS_RESOURCE_TYPES.join(", ")}.`);
  }
  const rest = args.slice(1);
  if (type === "base") {
    const base = await resolveBase(ctx, requireRestArg(rest, 0, "base"));
    return { type, id: base.id, label: `${base.name} (${base.shortId})`, allowed: accessPermissionsForResource(type) };
  }
  if (type === "table") {
    const { base, rest: tableRest } = await resolveBaseFromCommand(ctx, rest, 1);
    const table = await resolveTable(ctx, base.id, requireRestArg(tableRest, 0, "table"));
    return { type, id: table.id, label: `${table.name} (${table.shortId})`, allowed: accessPermissionsForResource(type) };
  }
  if (type === "view") {
    const { base, rest: viewRest } = await resolveBaseFromCommand(ctx, rest, 2);
    const table = await resolveTable(ctx, base.id, requireRestArg(viewRest, 0, "table"));
    const view = await resolveView(ctx, table.id, requireRestArg(viewRest, 1, "view"));
    return { type, id: view.id, label: `${view.name} (${view.shortId})`, allowed: accessPermissionsForResource(type) };
  }
  if (type === "form") {
    const { form } = await resolveFormFromCommand(ctx, rest, {});
    return { type, id: form.id, label: `${form.name} (${form.shortId || "default"})`, allowed: accessPermissionsForResource(type) };
  }
  if (type === "dashboard") {
    const { dashboard } = await resolveDashboardFromCommand(ctx, rest, undefined);
    return { type, id: dashboard.id, label: `${dashboard.name} (${dashboard.shortId})`, allowed: accessPermissionsForResource(type) };
  }
  if (type === "document-template") {
    const { template } = await resolveDocumentTemplateFromCommand(ctx, rest, {});
    return { type, id: template.id, label: `${template.name} (${template.shortId})`, allowed: accessPermissionsForResource(type) };
  }
  const { workflow } = await resolveWorkflowFromCommand(ctx, rest, undefined);
  return { type, id: workflow.id, label: `${workflow.name} (${workflow.shortId})`, allowed: accessPermissionsForResource(type) };
};

const accessResourcePath = (resource: AccessResource): string =>
  `/access/by-${accessApiResourceType(resource.type)}/${encodeURIComponent(resource.id)}`;

const principalKey = (principal: Principal): string => {
  switch (principal.type) {
    case "user":
      return `user:${principal.userId}`;
    case "group":
      return `group:${principal.groupId}`;
    case "service_account":
      return `service_account:${principal.serviceAccountId}`;
    case "authenticated":
      return "authenticated";
    case "public":
      return "public";
  }
};

const resolvePrincipalForAccess = (ctx: CloudCliContext, flags: Record<string, unknown>): Promise<Principal> =>
  resolveAccessPrincipal(ctx, flags, { allowPublic: true, allowServiceAccounts: true });

const normalizeRecordImportBody = (input: unknown): { items: Record<string, unknown>[] } => {
  const items = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as { items?: unknown }).items)
      ? (input as { items: unknown[] }).items
      : null;
  if (!items) throw new Error("Record import JSON must be an array or an object with an items array.");
  if (items.length === 0) throw new Error("Record import JSON must contain at least one item.");
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Each imported record must be a JSON object keyed by field UUID.");
    }
  }
  return { items: items as Record<string, unknown>[] };
};

const writeOrPrint = async (ctx: CloudCliContext, text: string, out: string | undefined) => {
  if (out) {
    await writeFile(out, text);
    if (ctx.options.output === "json") ctx.json({ path: out });
    else ctx.print(`Wrote ${out}.`);
    return;
  }
  ctx.print(text);
};

const accessCommands = [
  command("access reference", {
    summary: "Show Grids resource access levels",
    description: "Direct grants are resource-specific. Inherited effective access is resolved by the backend at use time.",
    examples: ["cld grids access reference", "cld grids access reference --json"],
    async run({ ctx }) {
      const reference = {
        resourceTypes: ACCESS_RESOURCE_TYPES.map((type) => ({ type, permissions: accessPermissionsForResource(type) })),
        principalFlags: [
          "--user <id|uid|email|display name>",
          "--group <id|name>",
          "--service-account <id|name>",
          "--authenticated",
          "--public",
        ],
        examples: [
          "cld grids access list table Bookshop Authors",
          "cld grids access set document-template Bookshop Invoices Invoice --user ada@example.test --permission write",
          "cld grids access revoke workflow Bookshop 'Send reminder' --user ada@example.test --yes",
        ],
      };
      printReference(
        ctx,
        reference,
        [
          "Grids access",
          "",
          "Direct grants attach to one Grids resource. The backend still enforces inherited and effective access when a command runs.",
          "",
          "Resources:",
          ...reference.resourceTypes.map((item) => `  ${item.type}: ${item.permissions.join(", ")}`),
          "",
          "Principals:",
          ...reference.principalFlags.map((item) => `  ${item}`),
          "",
          "Examples:",
          ...reference.examples.map((item) => `  ${item}`),
        ].join("\n"),
      );
    },
  }),
  command("access list", {
    summary: "List direct grants for a Grids resource",
    args: {
      args: arg.rest({
        valueLabel: "resource-type refs",
        description: "Resource type followed by refs, e.g. table Bookshop Authors or document-template Bookshop Invoices Invoice.",
      }),
    },
    flags: {
      includeServiceAccounts: flag.boolean({
        name: "include-service-accounts",
        description: "Include service-account grants in text output.",
      }),
    },
    async run({ ctx, args, flags }) {
      const resource = await resolveAccessResource(ctx, args.args);
      const entries = await readApi<AccessEntry[]>(ctx, accessResourcePath(resource));
      printAccessEntries(ctx, entries, {
        includeServiceAccounts: flags.includeServiceAccounts,
        jsonValue: { resource, entries },
      });
    },
  }),
  command("access grant", {
    summary: "Create a direct Grids resource grant",
    args: {
      args: arg.rest({ valueLabel: "resource-type refs", description: "Resource type followed by resource refs." }),
    },
    flags: {
      user: flag.string({ description: "User id, uid, email, or exact display name" }),
      group: flag.string({ description: "Group id or exact name" }),
      serviceAccount: flag.string({ name: "service-account", description: "Service account id or exact name" }),
      authenticated: flag.boolean({ description: "Signed-in users" }),
      public: flag.boolean({ description: "Anyone with the link, including anonymous users" }),
      permission: flag.enum(PERMISSION_LEVELS, { required: true, description: "Permission to grant" }),
    },
    async run({ ctx, args, flags }) {
      const resource = await resolveAccessResource(ctx, args.args);
      const permission = flags.permission as AccessPermission;
      assertAccessPermission(resource, permission);
      const principal = await resolvePrincipalForAccess(ctx, flags);
      const created = await readApi<{ accessId: string }>(
        ctx,
        accessResourcePath(resource),
        jsonRequest("POST", { principal, permission }),
      );
      printJsonOrMessage(ctx, { resource, principal, permission, ...created }, `Granted ${permission} on ${resource.label}.`);
    },
  }),
  command("access set", {
    summary: "Create or update a direct Grids resource grant",
    description:
      "With --access-id this patches that grant. Otherwise the CLI resolves the principal and updates or creates its direct grant.",
    args: {
      args: arg.rest({ valueLabel: "resource-type refs", description: "Resource type followed by resource refs." }),
    },
    flags: {
      user: flag.string({ description: "User id, uid, email, or exact display name" }),
      group: flag.string({ description: "Group id or exact name" }),
      serviceAccount: flag.string({ name: "service-account", description: "Service account id or exact name" }),
      authenticated: flag.boolean({ description: "Signed-in users" }),
      public: flag.boolean({ description: "Anyone with the link, including anonymous users" }),
      accessId: flag.string({ name: "access-id", description: "Direct access entry id from access list" }),
      permission: flag.enum(PERMISSION_LEVELS, { required: true, description: "Permission to set" }),
    },
    async run({ ctx, args, flags }) {
      const resource = await resolveAccessResource(ctx, args.args);
      const permission = flags.permission as AccessPermission;
      assertAccessPermission(resource, permission);
      if (flags.accessId) {
        await readApi<MessageResponse>(ctx, `/access/${encodeURIComponent(flags.accessId)}`, jsonRequest("PATCH", { permission }));
        printJsonOrMessage(
          ctx,
          { resource, accessId: flags.accessId, permission, action: "updated" },
          `Updated ${flags.accessId} to ${permission}.`,
        );
        return;
      }
      const principal = await resolvePrincipalForAccess(ctx, flags);
      const entries = await readApi<AccessEntry[]>(ctx, accessResourcePath(resource));
      const existing = entries.find((entry) => principalKey(entry.principal) === principalKey(principal));
      if (existing) {
        await readApi<MessageResponse>(ctx, `/access/${encodeURIComponent(existing.id)}`, jsonRequest("PATCH", { permission }));
        printJsonOrMessage(
          ctx,
          { resource, accessId: existing.id, permission, action: "updated" },
          `Updated ${existing.id} to ${permission}.`,
        );
        return;
      }
      const created = await readApi<{ accessId: string }>(
        ctx,
        accessResourcePath(resource),
        jsonRequest("POST", { principal, permission }),
      );
      printJsonOrMessage(
        ctx,
        { resource, principal, permission, ...created, action: "created" },
        `Granted ${permission} on ${resource.label}.`,
      );
    },
  }),
  command("access revoke", {
    summary: "Revoke a direct Grids resource grant",
    args: {
      args: arg.rest({ valueLabel: "resource-type refs", description: "Resource type followed by resource refs." }),
    },
    flags: {
      user: flag.string({ description: "User id, uid, email, or exact display name" }),
      group: flag.string({ description: "Group id or exact name" }),
      serviceAccount: flag.string({ name: "service-account", description: "Service account id or exact name" }),
      authenticated: flag.boolean({ description: "Signed-in users" }),
      public: flag.boolean({ description: "Anyone with the link, including anonymous users" }),
      accessId: flag.string({ name: "access-id", description: "Direct access entry id from access list" }),
      yes: confirmFlag("Confirm access revocation"),
    },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to revoke access.");
      const resource = await resolveAccessResource(ctx, args.args);
      let accessId = flags.accessId;
      if (!accessId) {
        const principal = await resolvePrincipalForAccess(ctx, flags);
        const entries = await readApi<AccessEntry[]>(ctx, accessResourcePath(resource));
        const existing = entries.find((entry) => principalKey(entry.principal) === principalKey(principal));
        if (!existing) throw new Error("No direct grant for that principal.");
        accessId = existing.id;
      }
      await readApi<MessageResponse>(ctx, `/access/${encodeURIComponent(accessId)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { resource, accessId, action: "revoked" }, `Revoked ${accessId} on ${resource.label}.`);
    },
  }),
  command("access search-principals", {
    summary: "Search users, groups, and service accounts for grants",
    args: { query: arg.required({ description: "Search text; exact names are safest for grant/set commands." }) },
    flags: {
      kind: flag.stringList({
        separator: ",",
        default: ["user", "group", "service_account"],
        description: "Comma-separated kinds: user, group, service_account",
      }),
      ...paginationFlags({ defaultPerPage: 20, maxPerPage: 100 }),
    },
    async run({ ctx, args, flags }) {
      const allowed = new Set(["user", "group", "service_account"]);
      const kinds = flags.kind.filter((kind): kind is "user" | "group" | "service_account" => allowed.has(kind));
      if (kinds.length !== flags.kind.length) throw new Error("--kind must contain only: user, group, service_account.");
      const payload = await listAccessPrincipalEntities(ctx, {
        search: args.query,
        kinds,
        page: flags.page,
        perPage: flags.perPage,
      });
      if (ctx.options.output === "json") {
        ctx.json(payload);
        return;
      }
      ctx.table(
        payload.items.map((item) => {
          if (item.kind === "user") {
            return { kind: "user", name: item.user.displayName, handle: item.user.uid, detail: item.user.mail ?? "", id: item.user.id };
          }
          if (item.kind === "group") {
            return {
              kind: "group",
              name: item.group.name,
              handle: item.group.provider,
              detail: item.group.description ?? "",
              id: item.group.id,
            };
          }
          return {
            kind: "service_account",
            name: item.serviceAccount.name,
            handle: item.serviceAccount.kind,
            detail: item.serviceAccount.appId ?? "",
            id: item.serviceAccount.id,
          };
        }),
        [
          { key: "kind", label: "KIND" },
          { key: "name", label: "NAME" },
          { key: "handle", label: "HANDLE" },
          { key: "id", label: "ID" },
        ],
      );
    },
  }),
];

const baseCrudCommands = [
  command("list", {
    summary: "List Grids bases",
    flags: {
      q: flag.string({ aliases: ["query"], description: "Search bases" }),
      ...paginationFlags({ defaultPerPage: 100, maxPerPage: 500 }),
    },
    async run({ ctx, flags }) {
      const perPage = flags.perPage ?? 100;
      const page = flags.page ?? 1;
      const payload = await listBases(ctx, { q: flags.q, limit: perPage, offset: (page - 1) * perPage });
      printJsonOrTable(ctx, payload, baseRows(payload.items), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "description", label: "DESCRIPTION" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("use", {
    summary: "Set the default Grids base",
    args: { base: arg.required({ description: "Base id, short id, or exact name" }) },
    async run({ ctx, args }) {
      const base = await resolveBase(ctx, args.base);
      await ctx.setDefault(GRIDS_BASE_DEFAULT_KEY, base.shortId);
      printJsonOrMessage(ctx, { base, defaultBase: base.shortId }, `Using Grids base ${base.name} (${base.shortId}).`);
    },
  }),
  command("current", {
    summary: "Show the default Grids base",
    async run({ ctx }) {
      const base = await resolveBase(ctx, await requireDefaultBaseRef(ctx));
      printJsonOrMessage(ctx, { base, defaultBase: base.shortId }, `${base.name} (${base.shortId})`);
    },
  }),
  command("bases list", {
    summary: "List Grids bases",
    flags: {
      q: flag.string({ aliases: ["query"], description: "Search bases" }),
      ...paginationFlags({ defaultPerPage: 100, maxPerPage: 500 }),
    },
    async run({ ctx, flags }) {
      const perPage = flags.perPage ?? 100;
      const page = flags.page ?? 1;
      const payload = await listBases(ctx, { q: flags.q, limit: perPage, offset: (page - 1) * perPage });
      printJsonOrTable(ctx, payload, baseRows(payload.items), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "description", label: "DESCRIPTION" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("bases get", {
    summary: "Show a Grids base",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      if (ctx.options.output === "json") ctx.json(base);
      else {
        ctx.print(`${base.name} (${base.shortId})`);
        if (base.description) ctx.print(base.description);
        ctx.print(`id: ${base.id}`);
        ctx.print(`updated: ${base.updatedAt}`);
      }
    },
  }),
  command("bases create", {
    summary: "Create a Grids base",
    args: { name: arg.required({ description: "Base name" }) },
    flags: {
      description: flag.string({ description: "Base description" }),
      use: flag.boolean({ description: "Use the new base as default" }),
    },
    async run({ ctx, args, flags }) {
      const base = await readApi<Base>(ctx, "/bases", jsonRequest("POST", { name: args.name, description: flags.description ?? null }));
      if (flags.use) await ctx.setDefault(GRIDS_BASE_DEFAULT_KEY, base.shortId);
      printJsonOrMessage(ctx, base, `Created ${base.name} (${base.shortId}).${flags.use ? " Using it as default." : ""}`);
    },
  }),
  command("bases update", {
    summary: "Update a Grids base",
    args: baseArgs,
    flags: {
      ...baseFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Base name" }),
      description: flag.string({ description: "Base description" }),
      defaultDashboard: flag.string({ name: "default-dashboard", description: "Default dashboard id or null" }),
    },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "base update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        defaultDashboardId: flags.defaultDashboard === "null" ? null : flags.defaultDashboard,
      });
      const updated = await readApi<Base>(ctx, `/bases/${encodeURIComponent(base.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("bases delete", {
    summary: "Delete a Grids base",
    args: baseArgs,
    flags: { ...baseFlag, yes: confirmFlag("Delete this Grids base") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      await readApi<MessageResponse>(ctx, `/bases/${encodeURIComponent(base.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: base.id }, `Deleted ${base.name} (${base.shortId}).`);
    },
  }),
  command("bases restore", {
    summary: "Restore a deleted Grids base",
    args: { base: arg.required({ description: "Base UUID" }) },
    async run({ ctx, args }) {
      const restored = await readApi<Base>(ctx, `/bases/${encodeURIComponent(args.base)}/restore`, jsonRequest("POST"));
      printJsonOrMessage(ctx, restored, `Restored ${restored.name} (${restored.shortId}).`);
    },
  }),
];

const tableCommands = [
  command("tables list", {
    summary: "List tables in a base",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const tables = await listTables(ctx, base.id);
      printJsonOrTable(ctx, tables, tableRows(tables), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "fields", label: "FIELDS" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("tables get", {
    summary: "Show a table",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      if (ctx.options.output === "json") ctx.json(table);
      else {
        ctx.print(`${table.name} (${table.shortId})`);
        if (table.description) ctx.print(table.description);
        ctx.print(`id: ${table.id}`);
        ctx.print(`fields: ${table.columns.length}`);
      }
    },
  }),
  command("tables create", {
    summary: "Create a table",
    args: baseArgs,
    flags: {
      ...baseFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Table name" }),
      description: flag.string({ description: "Table description" }),
      icon: flag.string({ description: "Table icon class" }),
    },
    examples: [
      "cld grids tables create Bookshop --name Authors --description 'People who wrote books'",
      'cld grids tables create --base Bookshop --body \'{"name":"Orders","icon":"ti ti-shopping-cart"}\'',
    ],
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "table JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        icon: flags.icon ?? (body.icon === undefined ? "ti ti-table" : undefined),
      });
      if (!body.name) throw new Error("Missing table name. Pass --name or --body JSON.");
      const table = await readApi<Table>(ctx, `/tables/by-base/${encodeURIComponent(base.id)}`, jsonRequest("POST", body));
      printJsonOrMessage(ctx, table, `Created table ${table.name} (${table.shortId}).`);
    },
  }),
  command("tables update", {
    summary: "Update a table",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Table name" }),
      description: flag.string({ description: "Table description" }),
      icon: flag.string({ description: "Table icon class" }),
      disableDirectInsert: flag.boolean({ name: "disable-direct-insert", description: "Disable direct record insertion" }),
      enableDirectInsert: flag.boolean({ name: "enable-direct-insert", description: "Enable direct record insertion" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "table update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        icon: flags.icon,
        disableDirectInsert: flags.disableDirectInsert ? true : flags.enableDirectInsert ? false : undefined,
      });
      const updated = await readApi<Table>(ctx, `/tables/${encodeURIComponent(table.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated table ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("tables delete", {
    summary: "Delete a table",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, yes: confirmFlag("Delete this table") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      await readApi<MessageResponse>(ctx, `/tables/${encodeURIComponent(table.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: table.id }, `Deleted table ${table.name} (${table.shortId}).`);
    },
  }),
  command("tables restore", {
    summary: "Restore a deleted table by UUID",
    args: { table: arg.required({ description: "Table UUID" }) },
    async run({ ctx, args }) {
      const table = await readApi<Table>(ctx, `/tables/${encodeURIComponent(args.table)}/restore`, jsonRequest("POST"));
      printJsonOrMessage(ctx, table, `Restored table ${table.name} (${table.shortId}).`);
    },
  }),
];

const fieldCommands = [
  command("fields types", {
    summary: "List all Grids field types and their record payload shape",
    description: "Use this before creating fields or writing record JSON. Machine-readable output is available with --json.",
    async run({ ctx }) {
      const refs = fieldTypeReferences();
      printJsonOrTable(ctx, refs, fieldTypeRows(refs), [
        { key: "type", label: "TYPE" },
        { key: "category", label: "CATEGORY" },
        { key: "writable", label: "RECORD" },
        { key: "recordValue", label: "VALUE" },
        { key: "config", label: "CONFIG" },
      ]);
    },
  }),
  command("fields type", {
    summary: "Show one field type reference",
    args: { type: arg.required({ description: "Field type, for example text, number, relation, formula" }) },
    examples: ["cld grids fields type select", "cld grids fields type relation --json"],
    async run({ ctx, args }) {
      printFieldTypeReference(ctx, fieldTypeReference(args.type));
    },
  }),
  command("fields list", {
    summary: "List fields in a table",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const fields = await listFields(ctx, table.id);
      printJsonOrTable(ctx, fields, fieldRows(fields), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "type", label: "TYPE" },
        { key: "required", label: "REQ" },
        { key: "presentable", label: "LABEL" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("fields get", {
    summary: "Show a field",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, field: flag.string({ description: "Field id, short id, or exact name" }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? (flags.field ? 0 : 1) : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const fieldRef = flags.field ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "field");
      const field = await resolveField(ctx, table.id, fieldRef);
      if (ctx.options.output === "json") ctx.json(field);
      else {
        ctx.print(`${field.name} (${field.shortId})`);
        ctx.print(`type: ${field.type}`);
        ctx.print(`id: ${field.id}`);
      }
    },
  }),
  command("fields create", {
    summary: "Create a field",
    description: "Run `cld grids fields types` or `cld grids fields type <type>` to inspect valid field types and config JSON.",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Field name" }),
      type: flag.string({ description: "Field type" }),
      description: flag.string({ description: "Field description" }),
      config: flag.string({ description: "Field config JSON object" }),
      required: flag.boolean({ description: "Mark field required" }),
      presentable: flag.boolean({ description: "Use field as record label" }),
      hideInTable: flag.boolean({ name: "hide-in-table", description: "Hide field in table views" }),
    },
    examples: [
      'cld grids fields create Bookshop Authors --name Email --type text --config \'{"regex":"^[^@]+@[^@]+$"}\'',
      'cld grids fields create Bookshop Orders --name Customer --type relation --config \'{"targetTableId":"<table-uuid>","cardinality":"single"}\'',
      "cld grids fields create Bookshop Orders --body-file field.json",
    ],
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "field JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        type: flags.type,
        description: flags.description,
        config: flags.config ? JSON.parse(flags.config) : undefined,
        required: flags.required ? true : undefined,
        presentable: flags.presentable ? true : undefined,
        hideInTable: flags.hideInTable ? true : undefined,
      });
      if (!body.name) throw new Error("Missing field name. Pass --name or --body JSON.");
      if (!body.type) throw new Error("Missing field type. Pass --type or --body JSON.");
      const field = await readApi<Field>(ctx, `/fields/by-table/${encodeURIComponent(table.id)}`, jsonRequest("POST", body));
      printJsonOrMessage(ctx, field, `Created field ${field.name} (${field.shortId}).`);
    },
  }),
  command("fields update", {
    summary: "Update a field",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      field: flag.string({ description: "Field id, short id, or exact name" }),
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Field name" }),
      description: flag.string({ description: "Field description" }),
      config: flag.string({ description: "Field config JSON object" }),
      required: flag.boolean({ description: "Mark field required" }),
      optional: flag.boolean({ description: "Mark field optional" }),
      presentable: flag.boolean({ description: "Use field as record label" }),
      notPresentable: flag.boolean({ name: "not-presentable", description: "Do not use field as record label" }),
      hideInTable: flag.boolean({ name: "hide-in-table", description: "Hide field in table views" }),
      showInTable: flag.boolean({ name: "show-in-table", description: "Show field in table views" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? (flags.field ? 0 : 1) : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const field = await resolveField(ctx, table.id, flags.field ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "field"));
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "field update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        config: flags.config ? JSON.parse(flags.config) : undefined,
        required: flags.required ? true : flags.optional ? false : undefined,
        presentable: flags.presentable ? true : flags.notPresentable ? false : undefined,
        hideInTable: flags.hideInTable ? true : flags.showInTable ? false : undefined,
      });
      const updated = await readApi<Field>(ctx, `/fields/${encodeURIComponent(field.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated field ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("fields delete", {
    summary: "Delete a field",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      field: flag.string({ description: "Field id, short id, or exact name" }),
      yes: confirmFlag("Delete this field"),
    },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? (flags.field ? 0 : 1) : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const field = await resolveField(ctx, table.id, flags.field ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "field"));
      await readApi<MessageResponse>(ctx, `/fields/${encodeURIComponent(field.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: field.id }, `Deleted field ${field.name} (${field.shortId}).`);
    },
  }),
  command("fields restore", {
    summary: "Restore a deleted field by UUID",
    args: { field: arg.required({ description: "Field UUID" }) },
    async run({ ctx, args }) {
      const field = await readApi<Field>(ctx, `/fields/${encodeURIComponent(args.field)}/restore`, jsonRequest("POST"));
      printJsonOrMessage(ctx, field, `Restored field ${field.name} (${field.shortId}).`);
    },
  }),
  command("fields dependents", {
    summary: "Show field dependents",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, field: flag.string({ description: "Field id, short id, or exact name" }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? (flags.field ? 0 : 1) : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const field = await resolveField(ctx, table.id, flags.field ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "field"));
      const payload = await readApi<FieldDependentsResponse>(ctx, `/fields/${encodeURIComponent(field.id)}/dependents`);
      if (ctx.options.output === "json") ctx.json(payload);
      else {
        ctx.print(payload.hasBlocking ? "Blocking dependents found." : "No blocking dependents.");
        ctx.table(payload.dependents as Record<string, unknown>[], []);
      }
    },
  }),
  command("fields reorder", {
    summary: "Reorder fields in a table",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      fieldIds: flag.stringList({ name: "field-ids", description: "Comma-separated field ids in desired order" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      if (flags.fieldIds.length === 0) throw new Error("Pass --field-ids.");
      await readApi<MessageResponse>(
        ctx,
        `/fields/by-table/${encodeURIComponent(table.id)}/reorder`,
        jsonRequest("POST", { fieldIds: flags.fieldIds }),
      );
      printJsonOrMessage(ctx, { reordered: flags.fieldIds }, `Reordered ${flags.fieldIds.length} fields.`);
    },
  }),
];

const recordCommands = [
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
      limit: flag.int({ min: 1, max: 10_000, default: 100, description: "Row limit" }),
      includeDeleted: flag.boolean({ name: "include-deleted", description: "Include deleted records" }),
      deletedOnly: flag.boolean({ name: "deleted-only", description: "Only deleted records" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const query = (await readJsonInput<Record<string, unknown>>(flags.queryBody, "record query JSON", false)) ?? {};
      const body = flags.source
        ? { source: flags.source, query: Object.keys(query).length > 0 ? query : undefined, cursor: flags.cursor }
        : {
            query: applyDefined(query, {
              limit: flags.limit,
              search: flags.q ? { q: flags.q } : undefined,
              includeDeleted: flags.includeDeleted ? true : undefined,
              deletedOnly: flags.deletedOnly ? true : undefined,
            }),
            cursor: flags.cursor,
          };
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
      format: flag.enum(["csv", "json"] as const, { default: "csv", description: "Export format" }),
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
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "record export JSON", false)) ?? {};
      const delimiter =
        flags.delimiter === "comma"
          ? ","
          : flags.delimiter === "semicolon"
            ? ";"
            : flags.delimiter === "tab"
              ? "\t"
              : flags.delimiter === "pipe"
                ? "|"
                : flags.delimiter;
      applyDefined(body, {
        format: flags.format,
        markdown: flags.markdown,
        csv: delimiter ? { delimiter } : undefined,
      });
      if (flags.q || flags.limit || flags.includeDeleted || flags.deletedOnly) {
        body.query = applyDefined((body.query as Record<string, unknown> | undefined) ?? {}, {
          limit: flags.limit,
          search: flags.q ? { q: flags.q } : undefined,
          includeDeleted: flags.includeDeleted ? true : undefined,
          deletedOnly: flags.deletedOnly ? true : undefined,
        });
      }
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

const viewCommands = [
  command("views list", {
    summary: "List views for a table",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const views = await listViews(ctx, table.id);
      printJsonOrTable(ctx, views, viewRows(views), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "scope", label: "SCOPE" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("views get", {
    summary: "Show a view",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, ...viewFlag },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table || flags.view ? 0 : 2);
      const table = flags.table
        ? await resolveTable(ctx, base.id, flags.table)
        : rest.length >= 2
          ? await resolveTable(ctx, base.id, rest[0]!)
          : null;
      const view = flags.view
        ? await resolveOptionalView(ctx, table, flags.view)
        : await resolveOptionalView(ctx, table, table ? rest[1] : rest[0]);
      if (!view) throw new Error("Missing view.");
      if (ctx.options.output === "json") ctx.json(view);
      else {
        ctx.print(`${view.name} (${view.shortId})`);
        ctx.print(`scope: ${view.ownerUserId ? "personal" : "shared"}`);
        ctx.print(`id: ${view.id}`);
        ctx.print("");
        ctx.print(view.source);
      }
    },
  }),
  command("views create", {
    summary: "Create a view",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "View name" }),
      description: flag.string({ description: "View description" }),
      icon: flag.string({ description: "View icon class" }),
      source: flag.string({ description: "GQL source" }),
      shared: flag.boolean({ description: "Create a shared view" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "view JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        icon: flags.icon,
        source: flags.source,
        shared: flags.shared ? true : undefined,
      });
      if (!body.name) throw new Error("Missing view name. Pass --name or --body JSON.");
      const view = await readApi<View>(ctx, `/views/by-table/${encodeURIComponent(table.id)}`, jsonRequest("POST", body));
      printJsonOrMessage(ctx, view, `Created view ${view.name} (${view.shortId}).`);
    },
  }),
  command("views update", {
    summary: "Update a view",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...viewFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "View name" }),
      description: flag.string({ description: "View description" }),
      source: flag.string({ description: "GQL source" }),
      shared: flag.boolean({ description: "Make the view shared" }),
      personal: flag.boolean({ description: "Make the view personal" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table || flags.view ? 0 : 2);
      const table = flags.table
        ? await resolveTable(ctx, base.id, flags.table)
        : rest.length >= 2
          ? await resolveTable(ctx, base.id, rest[0]!)
          : null;
      const view = flags.view
        ? await resolveOptionalView(ctx, table, flags.view)
        : await resolveOptionalView(ctx, table, table ? rest[1] : rest[0]);
      if (!view) throw new Error("Missing view.");
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "view update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        source: flags.source,
        shared: flags.shared ? true : flags.personal ? false : undefined,
      });
      const updated = await readApi<View>(ctx, `/views/${encodeURIComponent(view.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated view ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("views delete", {
    summary: "Delete a view",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, ...viewFlag, yes: confirmFlag("Delete this view") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table || flags.view ? 0 : 2);
      const table = flags.table
        ? await resolveTable(ctx, base.id, flags.table)
        : rest.length >= 2
          ? await resolveTable(ctx, base.id, rest[0]!)
          : null;
      const view = flags.view
        ? await resolveOptionalView(ctx, table, flags.view)
        : await resolveOptionalView(ctx, table, table ? rest[1] : rest[0]);
      if (!view) throw new Error("Missing view.");
      await readApi<MessageResponse>(ctx, `/views/${encodeURIComponent(view.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: view.id }, `Deleted view ${view.name} (${view.shortId}).`);
    },
  }),
  command("views restore", {
    summary: "Restore a deleted view by UUID",
    args: { view: arg.required({ description: "View UUID" }) },
    async run({ ctx, args }) {
      const view = await readApi<View>(ctx, `/views/${encodeURIComponent(args.view)}/restore`, jsonRequest("POST"));
      printJsonOrMessage(ctx, view, `Restored view ${view.name} (${view.shortId}).`);
    },
  }),
];

const formCommands = [
  command("forms list", {
    summary: "List custom forms for a table",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const forms = await listForms(ctx, table.id);
      printJsonOrTable(ctx, forms, formRows(forms), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "active", label: "ACTIVE" },
        { key: "public", label: "PUBLIC" },
        { key: "fields", label: "FIELDS" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("forms default", {
    summary: "Show the virtual default form for a table",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const form = await readApi<Form>(ctx, `/forms/by-table/${encodeURIComponent(table.id)}/default`);
      if (ctx.options.output === "json") ctx.json(form);
      else {
        ctx.print(`${form.name} (${form.shortId || "default"})`);
        ctx.print(`active: ${form.isActive ? "yes" : "no"}`);
        ctx.print(`id: ${form.id}`);
      }
    },
  }),
  command("forms get", {
    summary: "Show a form",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, ...formFlag },
    async run({ ctx, args, flags }) {
      const { form } = await resolveFormFromCommand(ctx, args.args, flags);
      if (ctx.options.output === "json") ctx.json(form);
      else {
        ctx.print(`${form.name} (${form.shortId || "default"})`);
        ctx.print(`active: ${form.isActive ? "yes" : "no"}`);
        ctx.print(`public: ${form.publicToken ? "yes" : "no"}`);
        ctx.print(`id: ${form.id}`);
      }
    },
  }),
  command("forms create", {
    summary: "Create a custom form",
    description:
      "Form config fields use field UUIDs. Run `cld grids fields list <base> <table>` and `cld grids records shape <base> <table>` first.",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Form name" }),
      config: flag.string({ description: "Form config JSON object" }),
      public: flag.boolean({ description: "Create with a public submit token" }),
      private: flag.boolean({ description: "Create without a public submit token" }),
    },
    examples: [
      'cld grids forms create Bookshop Orders --name \'Checkout\' --config \'{"fields":[{"kind":"user_input","fieldId":"<field-uuid>"}]}\'',
      "cld grids forms create --base Bookshop --table Orders --body-file form.json",
    ],
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "form JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        config: flags.config ? JSON.parse(flags.config) : undefined,
        isPublic: flags.public ? true : flags.private ? false : undefined,
      });
      if (!body.name) throw new Error("Missing form name. Pass --name or --body JSON.");
      const form = await readApi<Form>(ctx, `/forms/by-table/${encodeURIComponent(table.id)}`, jsonRequest("POST", body));
      printJsonOrMessage(ctx, form, `Created form ${form.name} (${form.shortId}).`);
    },
  }),
  command("forms update", {
    summary: "Update a form",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...formFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Form name" }),
      config: flag.string({ description: "Form config JSON object" }),
      public: flag.boolean({ description: "Ensure the form has a public submit token" }),
      private: flag.boolean({ description: "Remove the public submit token" }),
      active: flag.boolean({ description: "Activate the form" }),
      inactive: flag.boolean({ description: "Deactivate the form" }),
      position: flag.int({ min: 0, description: "Form position" }),
    },
    async run({ ctx, args, flags }) {
      const { form } = await resolveFormFromCommand(ctx, args.args, flags);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "form update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        config: flags.config ? JSON.parse(flags.config) : undefined,
        isPublic: flags.public ? true : flags.private ? false : undefined,
        isActive: flags.active ? true : flags.inactive ? false : undefined,
        position: flags.position,
      });
      const updated = await readApi<Form>(ctx, `/forms/${encodeURIComponent(form.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated form ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("forms delete", {
    summary: "Delete a form",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, ...formFlag, yes: confirmFlag("Delete this form") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { form } = await resolveFormFromCommand(ctx, args.args, flags);
      await readApi<MessageResponse>(ctx, `/forms/${encodeURIComponent(form.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: form.id }, `Deleted form ${form.name} (${form.shortId}).`);
    },
  }),
  command("forms restore", {
    summary: "Restore a deleted form by UUID",
    args: { form: arg.required({ description: "Form UUID" }) },
    async run({ ctx, args }) {
      const form = await readApi<Form>(ctx, `/forms/${encodeURIComponent(args.form)}/restore`, jsonRequest("POST"));
      printJsonOrMessage(ctx, form, `Restored form ${form.name} (${form.shortId}).`);
    },
  }),
  command("forms submit", {
    summary: "Submit a form",
    description: "Pass the same JSON payload the form UI submits. User-input keys are field UUIDs.",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, ...formFlag, body: JSON_BODY_INPUT },
    examples: [
      'cld grids forms submit Bookshop Orders Checkout --body \'{"<field-uuid>":"Ada"}\'',
      "cld grids forms submit --base Bookshop --table Orders --form Checkout --body-file submission.json",
    ],
    async run({ ctx, args, flags }) {
      const { form } = await resolveFormFromCommand(ctx, args.args, flags);
      const body = await readJsonInput<Record<string, unknown>>(flags.body, "form submission JSON", true);
      const result = await readApi<{ recordId: string }>(ctx, `/forms/${encodeURIComponent(form.id)}/submit`, jsonRequest("POST", body));
      printJsonOrMessage(ctx, result, `Created record ${result.recordId}.`);
    },
  }),
];

const dashboardCommands = [
  command("dashboards list", {
    summary: "List dashboards visible on a base",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const dashboards = await listDashboards(ctx, base.id);
      printJsonOrTable(ctx, dashboards, dashboardRows(dashboards), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "scope", label: "SCOPE" },
        { key: "rows", label: "ROWS" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("dashboards get", {
    summary: "Show a dashboard",
    args: baseArgs,
    flags: { ...baseFlag, ...dashboardFlag },
    async run({ ctx, args, flags }) {
      const { dashboard } = await resolveDashboardFromCommand(ctx, args.args, flags.dashboard);
      if (ctx.options.output === "json") ctx.json(dashboard);
      else {
        ctx.print(`${dashboard.name} (${dashboard.shortId})`);
        if (dashboard.description) ctx.print(dashboard.description);
        ctx.print(`scope: ${dashboard.ownerUserId ? "personal" : "shared"}`);
        ctx.print(`rows: ${dashboard.config.rows.length}`);
        ctx.print(`id: ${dashboard.id}`);
      }
    },
  }),
  command("dashboards create", {
    summary: "Create a dashboard",
    description:
      "Dashboard config is a { rows: [...] } object. Widgets reference saved views, forms, workflows, tables, dashboards, or URLs by UUID.",
    args: baseArgs,
    flags: {
      ...baseFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Dashboard name" }),
      description: flag.string({ description: "Dashboard description" }),
      icon: flag.string({ description: "Dashboard icon class" }),
      config: flag.string({ description: "Dashboard config JSON object" }),
      shared: flag.boolean({ description: "Create a shared dashboard" }),
      personal: flag.boolean({ description: "Create a personal dashboard" }),
    },
    examples: [
      "cld grids dashboards create Bookshop --name Overview --shared --config '{\"rows\":[]}'",
      "cld grids dashboards create --base Bookshop --body-file dashboard.json",
    ],
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "dashboard JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        icon: flags.icon,
        config: flags.config ? JSON.parse(flags.config) : undefined,
        shared: flags.shared ? true : flags.personal ? false : undefined,
      });
      if (!body.name) throw new Error("Missing dashboard name. Pass --name or --body JSON.");
      const dashboard = await readApi<Dashboard>(ctx, `/dashboards/by-base/${encodeURIComponent(base.id)}`, jsonRequest("POST", body));
      printJsonOrMessage(ctx, dashboard, `Created dashboard ${dashboard.name} (${dashboard.shortId}).`);
    },
  }),
  command("dashboards update", {
    summary: "Update a dashboard",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...dashboardFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Dashboard name" }),
      description: flag.string({ description: "Dashboard description" }),
      icon: flag.string({ description: "Dashboard icon class" }),
      config: flag.string({ description: "Dashboard config JSON object" }),
      shared: flag.boolean({ description: "Make the dashboard shared" }),
      personal: flag.boolean({ description: "Make the dashboard personal" }),
      position: flag.int({ min: 0, description: "Dashboard position" }),
    },
    async run({ ctx, args, flags }) {
      const { dashboard } = await resolveDashboardFromCommand(ctx, args.args, flags.dashboard);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "dashboard update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        icon: flags.icon,
        config: flags.config ? JSON.parse(flags.config) : undefined,
        shared: flags.shared ? true : flags.personal ? false : undefined,
        position: flags.position,
      });
      const updated = await readApi<Dashboard>(ctx, `/dashboards/${encodeURIComponent(dashboard.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated dashboard ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("dashboards delete", {
    summary: "Delete a dashboard",
    args: baseArgs,
    flags: { ...baseFlag, ...dashboardFlag, yes: confirmFlag("Delete this dashboard") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { dashboard } = await resolveDashboardFromCommand(ctx, args.args, flags.dashboard);
      await readApi<MessageResponse>(ctx, `/dashboards/${encodeURIComponent(dashboard.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: dashboard.id }, `Deleted dashboard ${dashboard.name} (${dashboard.shortId}).`);
    },
  }),
  command("dashboards restore", {
    summary: "Restore a deleted dashboard by UUID",
    args: { dashboard: arg.required({ description: "Dashboard UUID" }) },
    async run({ ctx, args }) {
      const dashboard = await readApi<Dashboard>(ctx, `/dashboards/${encodeURIComponent(args.dashboard)}/restore`, jsonRequest("POST"));
      printJsonOrMessage(ctx, dashboard, `Restored dashboard ${dashboard.name} (${dashboard.shortId}).`);
    },
  }),
  command("dashboards widgets resolve", {
    summary: "Resolve one dashboard widget",
    args: baseArgs,
    flags: { ...baseFlag, ...dashboardFlag, body: JSON_BODY_INPUT },
    examples: [
      "cld grids dashboards widgets resolve Bookshop Overview --body-file widget.json",
      'cld grids dashboards widgets resolve --base Bookshop --dashboard Overview --body \'{"id":"w1","kind":"markdown","markdown":"Hello"}\'',
    ],
    async run({ ctx, args, flags }) {
      const { dashboard } = await resolveDashboardFromCommand(ctx, args.args, flags.dashboard);
      const body = await readJsonInput<Record<string, unknown>>(flags.body, "dashboard widget JSON", true);
      const resolved = await readApi<unknown>(
        ctx,
        `/dashboards/${encodeURIComponent(dashboard.id)}/widgets/resolve`,
        jsonRequest("POST", body),
      );
      if (ctx.options.output === "json") ctx.json(resolved);
      else ctx.print(JSON.stringify(resolved, null, 2));
    },
  }),
  command("dashboards widgets run", {
    summary: "Run a dashboard workflow-button widget",
    args: {
      args: arg.rest({ valueLabel: "base-dashboard-widget", description: "Optional base, then dashboard and widget id." }),
    },
    flags: { ...baseFlag, ...dashboardFlag, widget: flag.string({ description: "Dashboard widget id" }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.dashboard && flags.widget ? 0 : 2);
      const dashboard = await resolveDashboard(ctx, base.id, flags.dashboard ?? requireRestArg(rest, 0, "dashboard"));
      const widgetId = flags.widget ?? requireRestArg(flags.dashboard ? rest : rest.slice(1), 0, "widget");
      const run = await readApi<WorkflowRun>(
        ctx,
        `/dashboards/${encodeURIComponent(dashboard.id)}/widgets/${encodeURIComponent(widgetId)}/run`,
        jsonRequest("POST"),
      );
      printJsonOrMessage(ctx, run, `Queued workflow run ${run.id} (${run.status}).`);
    },
  }),
];

const documentTemplateCommands = [
  command("document-templates reference", {
    summary: "Show document template fields, Liquid data, and examples",
    description: "Use this before creating or updating document templates from an agent.",
    examples: ["cld grids document-templates reference", "cld grids document-templates reference --json"],
    async run({ ctx }) {
      printReference(
        ctx,
        DOCUMENT_TEMPLATE_REFERENCE,
        [
          "Document templates",
          "",
          "Create PDFs from a GQL source plus Liquid HTML/CSS. Per-record templates usually filter with:",
          '  where record.id = "{{ record.id }}"',
          "",
          "Fields:",
          ...Object.entries(DOCUMENT_TEMPLATE_REFERENCE.fields).map(([key, value]) => `  ${key}: ${value}`),
          "",
          "Liquid data:",
          ...DOCUMENT_TEMPLATE_REFERENCE.liquidData.map((item) => `  ${item}`),
          "",
          "Example source:",
          `  ${DOCUMENT_TEMPLATE_REFERENCE.examples[0]!.source.replace(/\n/g, "\n  ")}`,
        ].join("\n"),
      );
    },
  }),
  command("document-templates list", {
    summary: "List document templates for a table",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      min: flag.enum(["read", "write", "admin"] as const, { default: "read", description: "Minimum effective permission" }),
      full: flag.boolean({ description: "Return full templates; requires table admin access" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const templates = await listDocumentTemplates(ctx, table.id, { full: flags.full, min: flags.min });
      printJsonOrTable(ctx, templates, documentTemplateRows(templates), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "enabled", label: "ENABLED" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("document-templates get", {
    summary: "Show a document template",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, ...documentTemplateFlag },
    async run({ ctx, args, flags }) {
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      if (ctx.options.output === "json") ctx.json(template);
      else {
        ctx.print(`${template.name} (${template.shortId})`);
        if (template.description) ctx.print(template.description);
        ctx.print(`enabled: ${template.enabled ? "yes" : "no"}`);
        ctx.print(`id: ${template.id}`);
        ctx.print("");
        ctx.print(template.source);
      }
    },
  }),
  command("document-templates create", {
    summary: "Create a document template",
    description: "Run `cld grids document-templates reference` for Liquid variables, GQL source shape, and filename/number patterns.",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Template name" }),
      description: flag.string({ description: "Template description" }),
      source: flag.string({ description: "GQL source" }),
      html: flag.string({ description: "Liquid HTML body" }),
      headerHtml: flag.string({ name: "header-html", description: "Liquid header HTML" }),
      footerHtml: flag.string({ name: "footer-html", description: "Liquid footer HTML" }),
      pageCss: flag.string({ name: "page-css", description: "Page CSS" }),
      numberTemplate: flag.string({ name: "number-template", description: "Liquid document number pattern" }),
      filenameTemplate: flag.string({ name: "filename-template", description: "Liquid filename pattern" }),
      enabled: flag.boolean({ description: "Enable the template" }),
      disabled: flag.boolean({ description: "Create the template disabled" }),
    },
    examples: [
      "cld grids document-templates create Bookshop Invoices --name Invoice --source 'from table Invoices' --html '<h1>{{ document.number }}</h1>'",
      "cld grids document-templates create --base Bookshop --table Labels --body-file label-template.json",
    ],
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "document template JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        source: flags.source,
        html: flags.html,
        headerHtml: flags.headerHtml,
        footerHtml: flags.footerHtml,
        pageCss: flags.pageCss,
        numberTemplate: flags.numberTemplate,
        filenameTemplate: flags.filenameTemplate,
        enabled: flags.enabled ? true : flags.disabled ? false : undefined,
      });
      if (!body.name) throw new Error("Missing document template name. Pass --name or --body JSON.");
      if (!body.source) throw new Error("Missing document template source. Pass --source or --body JSON.");
      if (!body.html) throw new Error("Missing document template HTML. Pass --html or --body JSON.");
      const template = await readApi<DocumentTemplate>(
        ctx,
        `/documents/templates/by-table/${encodeURIComponent(table.id)}`,
        jsonRequest("POST", body),
      );
      printJsonOrMessage(ctx, template, `Created document template ${template.name} (${template.shortId}).`);
    },
  }),
  command("document-templates update", {
    summary: "Update a document template",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Template name" }),
      description: flag.string({ description: "Template description" }),
      source: flag.string({ description: "GQL source" }),
      html: flag.string({ description: "Liquid HTML body" }),
      headerHtml: flag.string({ name: "header-html", description: "Liquid header HTML" }),
      footerHtml: flag.string({ name: "footer-html", description: "Liquid footer HTML" }),
      pageCss: flag.string({ name: "page-css", description: "Page CSS" }),
      numberTemplate: flag.string({ name: "number-template", description: "Liquid document number pattern" }),
      filenameTemplate: flag.string({ name: "filename-template", description: "Liquid filename pattern" }),
      enabled: flag.boolean({ description: "Enable the template" }),
      disabled: flag.boolean({ description: "Disable the template" }),
      position: flag.int({ min: 0, description: "Template position" }),
    },
    async run({ ctx, args, flags }) {
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "document template update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        source: flags.source,
        html: flags.html,
        headerHtml: flags.headerHtml,
        footerHtml: flags.footerHtml,
        pageCss: flags.pageCss,
        numberTemplate: flags.numberTemplate,
        filenameTemplate: flags.filenameTemplate,
        enabled: flags.enabled ? true : flags.disabled ? false : undefined,
        position: flags.position,
      });
      const updated = await readApi<DocumentTemplate>(
        ctx,
        `/documents/templates/${encodeURIComponent(template.id)}`,
        jsonRequest("PATCH", body),
      );
      printJsonOrMessage(ctx, updated, `Updated document template ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("document-templates delete", {
    summary: "Delete a document template",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, ...documentTemplateFlag, yes: confirmFlag("Delete this document template") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      await readApi<MessageResponse>(ctx, `/documents/templates/${encodeURIComponent(template.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: template.id }, `Deleted document template ${template.name} (${template.shortId}).`);
    },
  }),
  command("document-templates preview-data", {
    summary: "Render document template preview data for one record",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      body: JSON_BODY_INPUT,
      record: flag.string({ description: "Record UUID" }),
    },
    async run({ ctx, args, flags }) {
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "document preview JSON", false)) ?? {};
      applyDefined(body, { recordId: flags.record });
      if (!body.recordId) throw new Error("Missing record id. Pass --record or --body JSON.");
      const preview = await readApi<DocumentPreviewResponse>(
        ctx,
        `/documents/templates/${encodeURIComponent(template.id)}/preview`,
        jsonRequest("POST", body),
      );
      if (ctx.options.output === "json") ctx.json(preview);
      else ctx.print(preview.html);
    },
  }),
  command("document-templates preview-pdf", {
    summary: "Render document template PDF preview for one record",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      body: JSON_BODY_INPUT,
      record: flag.string({ description: "Record UUID" }),
      out: flag.string({ description: "Output PDF path" }),
    },
    async run({ ctx, args, flags }) {
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "document preview JSON", false)) ?? {};
      applyDefined(body, { recordId: flags.record });
      if (!body.recordId) throw new Error("Missing record id. Pass --record or --body JSON.");
      await writeApiFile(ctx, `/documents/templates/${encodeURIComponent(template.id)}/preview-pdf`, jsonRequest("POST", body), flags.out);
    },
  }),
  command("document-templates preview-draft-data", {
    summary: "Render unsaved document template draft data for one record",
    description:
      "Pass a table and draft body, or also pass a saved template to use its source/html/header/footer/page CSS defaults before applying overrides.",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      body: JSON_BODY_INPUT,
      record: flag.string({ description: "Preview record UUID" }),
      source: flag.input({ name: "source", fileName: "source-file", valueLabel: "gql" }),
      html: flag.input({ name: "html", fileName: "html-file", valueLabel: "html" }),
      headerHtml: flag.input({ name: "header-html", fileName: "header-html-file", valueLabel: "html" }),
      footerHtml: flag.input({ name: "footer-html", fileName: "footer-html-file", valueLabel: "html" }),
      pageCss: flag.input({ name: "page-css", fileName: "page-css-file", valueLabel: "css" }),
      numberTemplate: flag.string({ name: "number-template", description: "Liquid document number pattern" }),
      filenameTemplate: flag.string({ name: "filename-template", description: "Liquid filename pattern" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const templateRef = flags.template ?? (flags.table ? rest[0] : rest[1]);
      const template = templateRef ? await resolveDocumentTemplate(ctx, base, table, templateRef) : null;
      const body = await readDraftTemplateBody(flags, template);
      const endpoint = template
        ? `/documents/templates/${encodeURIComponent(template.id)}/preview-data-draft`
        : `/documents/templates/by-table/${encodeURIComponent(table.id)}/preview-data-draft`;
      const preview = await readApi<DocumentPreviewResponse>(ctx, endpoint, jsonRequest("POST", body));
      if (ctx.options.output === "json") ctx.json(preview);
      else ctx.print(preview.html);
    },
  }),
  command("document-templates preview-draft-pdf", {
    summary: "Render an unsaved document template draft PDF for one record",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      body: JSON_BODY_INPUT,
      record: flag.string({ description: "Preview record UUID" }),
      source: flag.input({ name: "source", fileName: "source-file", valueLabel: "gql" }),
      html: flag.input({ name: "html", fileName: "html-file", valueLabel: "html" }),
      headerHtml: flag.input({ name: "header-html", fileName: "header-html-file", valueLabel: "html" }),
      footerHtml: flag.input({ name: "footer-html", fileName: "footer-html-file", valueLabel: "html" }),
      pageCss: flag.input({ name: "page-css", fileName: "page-css-file", valueLabel: "css" }),
      numberTemplate: flag.string({ name: "number-template", description: "Liquid document number pattern" }),
      filenameTemplate: flag.string({ name: "filename-template", description: "Liquid filename pattern" }),
      out: flag.string({ description: "Output PDF path" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const templateRef = flags.template ?? (flags.table ? rest[0] : rest[1]);
      const template = templateRef ? await resolveDocumentTemplate(ctx, base, table, templateRef) : null;
      const body = await readDraftTemplateBody(flags, template);
      const endpoint = template
        ? `/documents/templates/${encodeURIComponent(template.id)}/preview-draft`
        : `/documents/templates/by-table/${encodeURIComponent(table.id)}/preview-draft`;
      await writeApiFile(ctx, endpoint, jsonRequest("POST", body), flags.out);
    },
  }),
];

const documentCommands = [
  command("documents list", {
    summary: "List generated documents for a document template",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      q: flag.string({ aliases: ["query"], description: "Search generated document filename, number, or tags" }),
      tag: flag.stringList({ description: "Tag filter. Repeatable." }),
      cursor: flag.string({ description: "Pagination cursor" }),
      limit: flag.int({ min: 1, max: 500, description: "Maximum documents" }),
      offset: flag.int({ min: 0, description: "Offset for offset-based pages" }),
    },
    async run({ ctx, args, flags }) {
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      const payload = await readApi<DocumentRunSummaryList>(
        ctx,
        `/documents/runs/by-template/${encodeURIComponent(template.id)}${queryString({
          q: flags.q,
          tags: flags.tag.join(","),
          cursor: flags.cursor,
          limit: flags.limit,
          offset: flags.offset,
        })}`,
      );
      printJsonOrTable(ctx, payload, documentRunRows(payload.items), [
        { key: "shortId", label: "SHORT" },
        { key: "number", label: "NUMBER" },
        { key: "filename", label: "FILENAME" },
        { key: "tags", label: "TAGS" },
        { key: "generatedAt", label: "GENERATED" },
        { key: "id", label: "ID" },
      ]);
      if (ctx.options.output !== "json" && payload.nextCursor) ctx.print(`next cursor: ${payload.nextCursor}`);
    },
  }),
  command("documents browse", {
    summary: "Browse generated documents as list rows or year/month folders",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      mode: flag.enum(["list", "folders"] as const, { default: "folders", description: "Browse mode" }),
      path: flag.string({ description: "Folder path such as 2026/07" }),
      q: flag.string({ aliases: ["query"], description: "Search generated document filename, number, or tags" }),
      tag: flag.stringList({ description: "Tag filter. Repeatable." }),
      cursor: flag.string({ description: "Pagination cursor" }),
      limit: flag.int({ min: 1, max: 500, description: "Maximum documents or folders" }),
    },
    async run({ ctx, args, flags }) {
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      const payload = await readApi<DocumentRunBrowseResponse>(
        ctx,
        `/documents/runs/by-template/${encodeURIComponent(template.id)}/browse${queryString({
          mode: flags.mode,
          path: flags.path,
          q: flags.q,
          tags: flags.tag.join(","),
          cursor: flags.cursor,
          limit: flags.limit,
        })}`,
      );
      if (ctx.options.output === "json") {
        ctx.json(payload);
        return;
      }
      if (payload.folders.length > 0) {
        ctx.table(documentFolderRows(payload.folders), [
          { key: "kind", label: "KIND" },
          { key: "label", label: "FOLDER" },
          { key: "count", label: "COUNT" },
          { key: "path", label: "PATH" },
        ]);
      }
      if (payload.items.length > 0) {
        ctx.table(documentRunRows(payload.items), [
          { key: "shortId", label: "SHORT" },
          { key: "number", label: "NUMBER" },
          { key: "filename", label: "FILENAME" },
          { key: "tags", label: "TAGS" },
          { key: "generatedAt", label: "GENERATED" },
          { key: "id", label: "ID" },
        ]);
      }
      if (payload.folders.length === 0 && payload.items.length === 0) ctx.print("No documents.");
      if (payload.nextCursor) ctx.print(`next cursor: ${payload.nextCursor}`);
    },
  }),
  command("documents by-record", {
    summary: "List generated documents for one record",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, record: flag.string({ description: "Record UUID" }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table && flags.record ? 0 : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const recordId = flags.record ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "record");
      const payload = await readApi<DocumentRunSummaryList>(
        ctx,
        `/documents/runs/by-record/${encodeURIComponent(table.id)}/${encodeURIComponent(recordId)}`,
      );
      printJsonOrTable(ctx, payload, documentRunRows(payload.items), [
        { key: "shortId", label: "SHORT" },
        { key: "number", label: "NUMBER" },
        { key: "filename", label: "FILENAME" },
        { key: "tags", label: "TAGS" },
        { key: "generatedAt", label: "GENERATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("documents generate", {
    summary: "Generate and store a PDF document run",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      body: JSON_BODY_INPUT,
      record: flag.string({ description: "Record UUID" }),
      filename: flag.string({ description: "Optional generated filename override" }),
      tag: flag.stringList({ description: "Generated document tag. Repeatable." }),
      out: flag.string({ description: "Output PDF path" }),
    },
    examples: [
      "cld grids documents generate Bookshop Invoices Invoice --record <record-uuid> --out invoice.pdf",
      'cld grids documents generate --base Bookshop --table Labels --template ItemLabel --body \'{"recordId":"...","tags":["printed"]}\' --out label.pdf',
    ],
    async run({ ctx, args, flags }) {
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "document generation JSON", false)) ?? {};
      applyDefined(body, {
        recordId: flags.record,
        filename: flags.filename,
        tags: flags.tag.length > 0 ? flags.tag : undefined,
      });
      if (!body.recordId) throw new Error("Missing record id. Pass --record or --body JSON.");
      await writeApiFile(ctx, `/documents/templates/${encodeURIComponent(template.id)}/generate`, jsonRequest("POST", body), flags.out);
    },
  }),
  command("documents update", {
    summary: "Update generated document metadata",
    args: { run: arg.required({ description: "Generated document run UUID" }) },
    flags: {
      body: JSON_BODY_INPUT,
      filename: flag.string({ description: "Generated filename" }),
      tag: flag.stringList({ description: "Replace tags. Repeatable." }),
    },
    async run({ ctx, args, flags }) {
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "document metadata JSON", false)) ?? {};
      applyDefined(body, {
        filename: flags.filename,
        tags: flags.tag.length > 0 ? flags.tag : undefined,
      });
      const updated = await readApi<DocumentRunSummary>(ctx, `/documents/runs/${encodeURIComponent(args.run)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated document ${updated.filename}.`);
    },
  }),
  command("documents download", {
    summary: "Download a generated document PDF from its stored snapshot",
    args: { run: arg.required({ description: "Generated document run UUID" }) },
    flags: { out: flag.string({ description: "Output PDF path" }) },
    async run({ ctx, args, flags }) {
      await writeApiFile(ctx, `/documents/runs/${encodeURIComponent(args.run)}/download`, undefined, flags.out);
    },
  }),
  command("documents links list", {
    summary: "List public links for a generated document",
    args: { run: arg.required({ description: "Generated document run UUID" }) },
    async run({ ctx, args }) {
      const payload = await readApi<DocumentLinkListResponse>(ctx, `/documents/runs/${encodeURIComponent(args.run)}/links`);
      printJsonOrTable(ctx, payload, documentLinkRows(payload.items), [
        { key: "id", label: "ID" },
        { key: "expiresAt", label: "EXPIRES" },
        { key: "revokedAt", label: "REVOKED" },
        { key: "accessCount", label: "HITS" },
        { key: "comment", label: "COMMENT" },
      ]);
    },
  }),
  command("documents links create", {
    summary: "Create an expiring public link for a generated document",
    args: { run: arg.required({ description: "Generated document run UUID" }) },
    flags: {
      expiresIn: flag.enum(["1d", "7d", "30d", "90d"] as const, {
        name: "expires-in",
        default: "30d",
        description: "Public link lifetime",
      }),
      comment: flag.string({ description: "Optional link comment" }),
    },
    async run({ ctx, args, flags }) {
      const payload = await readApi<CreateDocumentLinkResponse>(
        ctx,
        `/documents/runs/${encodeURIComponent(args.run)}/links`,
        jsonRequest("POST", { expiresIn: flags.expiresIn, comment: flags.comment }),
      );
      if (ctx.options.output === "json") ctx.json(payload);
      else ctx.print(payload.url);
    },
  }),
  command("documents links revoke", {
    summary: "Revoke a public document link",
    args: { link: arg.required({ description: "Document link UUID" }) },
    async run({ ctx, args }) {
      const link = await readApi<DocumentLink>(ctx, `/documents/links/${encodeURIComponent(args.link)}/revoke`, jsonRequest("POST"));
      printJsonOrMessage(ctx, link, `Revoked document link ${link.id}.`);
    },
  }),
];

const snapshotCommands = [
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

const formulaCommands = [
  command("formulas reference", {
    summary: "Show Grids formula syntax and function reference",
    description: "Formula fields, GQL predicates, computed columns, and parts of document/workflow authoring use this expression model.",
    examples: ["cld grids formulas reference", "cld grids formulas reference --json"],
    async run({ ctx }) {
      printReference(
        ctx,
        FORMULA_REFERENCE,
        [
          "Grids formulas",
          "",
          "Syntax:",
          ...FORMULA_REFERENCE.syntax.map((item) => `  ${item}`),
          "",
          "Common examples:",
          ...FORMULA_REFERENCE.examples.map((item) => `  ${item}`),
          "",
          "Functions:",
          ...GRID_FORMULA_FUNCTIONS.map((fn) => `  ${fn.signature} -> ${fn.returnType}: ${fn.description}`),
        ].join("\n"),
      );
    },
  }),
  command("formulas check", {
    summary: "Validate a formula and preview latest table records",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      expression: FORMULA_INPUT,
      currentField: flag.string({ name: "current-field", description: "Current formula field id, short id, or exact name" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const expression = await readTextInput(flags.expression, "formula expression", true);
      const currentField = flags.currentField ? await resolveField(ctx, table.id, flags.currentField) : null;
      const payload = await readApi<FormulaPreviewResponse>(
        ctx,
        `/formulas/by-table/${encodeURIComponent(table.id)}/check`,
        jsonRequest("POST", applyDefined({ expression }, { currentFieldId: currentField?.id })),
      );
      if (ctx.options.output === "json") {
        ctx.json(payload);
        return payload.ok ? 0 : 1;
      }
      if (payload.diagnostics.length > 0) {
        for (const diagnostic of payload.diagnostics) ctx.print(`${diagnostic.severity}: ${diagnostic.message}`);
        ctx.print("");
      }
      if (payload.rows.length > 0) {
        ctx.table(
          payload.rows.map((row) => ({ recordId: row.recordId, result: displayValue(row.result) })),
          [
            { key: "recordId", label: "RECORD" },
            { key: "result", label: "RESULT" },
          ],
        );
      } else {
        ctx.print(payload.ok ? "Formula is valid." : "Formula has errors.");
      }
      return payload.ok ? 0 : 1;
    },
  }),
];

const emailTemplateCommands = [
  command("email-templates reference", {
    summary: "Show workflow email template fields, Liquid data, and examples",
    description: "Use this before creating workflow email templates from an agent.",
    examples: ["cld grids email-templates reference", "cld grids email-templates reference --json"],
    async run({ ctx }) {
      printReference(
        ctx,
        EMAIL_TEMPLATE_REFERENCE,
        [
          "Workflow email templates",
          "",
          "Email templates have Liquid subject and HTML body fields. There is no plain-text fallback field.",
          "",
          "Fields:",
          ...Object.entries(EMAIL_TEMPLATE_REFERENCE.fields).map(([key, value]) => `  ${key}: ${value}`),
          "",
          "Liquid data:",
          ...EMAIL_TEMPLATE_REFERENCE.liquidData.map((item) => `  ${item}`),
          "",
          "Workflow step:",
          `  ${EMAIL_TEMPLATE_REFERENCE.example.step.replace(/\n/g, "\n  ")}`,
        ].join("\n"),
      );
    },
  }),
  command("email-templates list", {
    summary: "List workflow email templates for a base",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const templates = await listEmailTemplates(ctx, base.id);
      printJsonOrTable(ctx, templates, emailTemplateRows(templates), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "enabled", label: "ENABLED" },
        { key: "subject", label: "SUBJECT" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("email-templates get", {
    summary: "Show a workflow email template",
    args: baseArgs,
    flags: { ...baseFlag, ...emailTemplateFlag },
    async run({ ctx, args, flags }) {
      const { template } = await resolveEmailTemplateFromCommand(ctx, args.args, flags.template);
      if (ctx.options.output === "json") ctx.json(template);
      else {
        ctx.print(`${template.name} (${template.shortId})`);
        if (template.description) ctx.print(template.description);
        ctx.print(`subject: ${template.subject}`);
        ctx.print(`enabled: ${template.enabled ? "yes" : "no"}`);
        ctx.print(`id: ${template.id}`);
        ctx.print("");
        ctx.print(template.html);
      }
    },
  }),
  command("email-templates create", {
    summary: "Create a workflow email template",
    description: "Run `cld grids email-templates reference` for available fields, Liquid data, and a sendEmail workflow example.",
    args: baseArgs,
    flags: {
      ...baseFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Template name" }),
      description: flag.string({ description: "Template description" }),
      subject: flag.string({ description: "Email subject Liquid template" }),
      html: flag.string({ description: "Email HTML Liquid template" }),
      enabled: flag.boolean({ description: "Enable the template" }),
      disabled: flag.boolean({ description: "Create the template disabled" }),
      position: flag.int({ min: 0, description: "Template position" }),
    },
    examples: [
      "cld grids email-templates create Bookshop --name Reminder --subject 'Reminder: {{ data.itemName }}' --html '<p>{{ data.itemName }}</p>'",
      "cld grids email-templates create --base Bookshop --body-file email-template.json",
    ],
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "email template JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        subject: flags.subject,
        html: flags.html,
        enabled: flags.enabled ? true : flags.disabled ? false : undefined,
        position: flags.position,
      });
      if (!body.name) throw new Error("Missing email template name. Pass --name or --body JSON.");
      if (!body.subject) throw new Error("Missing email template subject. Pass --subject or --body JSON.");
      if (!body.html) throw new Error("Missing email template HTML. Pass --html or --body JSON.");
      const template = await readApi<EmailTemplate>(
        ctx,
        `/email-templates/by-base/${encodeURIComponent(base.id)}`,
        jsonRequest("POST", body),
      );
      printJsonOrMessage(ctx, template, `Created email template ${template.name} (${template.shortId}).`);
    },
  }),
  command("email-templates update", {
    summary: "Update a workflow email template",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...emailTemplateFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Template name" }),
      description: flag.string({ description: "Template description" }),
      subject: flag.string({ description: "Email subject Liquid template" }),
      html: flag.string({ description: "Email HTML Liquid template" }),
      enabled: flag.boolean({ description: "Enable the template" }),
      disabled: flag.boolean({ description: "Disable the template" }),
      position: flag.int({ min: 0, description: "Template position" }),
    },
    async run({ ctx, args, flags }) {
      const { template } = await resolveEmailTemplateFromCommand(ctx, args.args, flags.template);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "email template update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        subject: flags.subject,
        html: flags.html,
        enabled: flags.enabled ? true : flags.disabled ? false : undefined,
        position: flags.position,
      });
      const updated = await readApi<EmailTemplate>(ctx, `/email-templates/${encodeURIComponent(template.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated email template ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("email-templates delete", {
    summary: "Delete a workflow email template",
    args: baseArgs,
    flags: { ...baseFlag, ...emailTemplateFlag, yes: confirmFlag("Delete this email template") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { template } = await resolveEmailTemplateFromCommand(ctx, args.args, flags.template);
      await readApi<MessageResponse>(ctx, `/email-templates/${encodeURIComponent(template.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: template.id }, `Deleted email template ${template.name} (${template.shortId}).`);
    },
  }),
];

const workflowCommands = [
  command("workflows reference", {
    summary: "Show workflow YAML structure, triggers, steps, and examples",
    description: "Use this before creating or updating workflows from an agent.",
    examples: ["cld grids workflows reference", "cld grids workflows reference --json"],
    async run({ ctx }) {
      printReference(
        ctx,
        WORKFLOW_REFERENCE,
        [
          "Workflows",
          "",
          "Workflow name and description are UI fields. YAML only defines inputs, triggers, and steps.",
          "",
          "Top-level keys:",
          ...WORKFLOW_REFERENCE.yaml.topLevel.map((item) => `  ${item}`),
          "",
          "Input types:",
          `  ${WORKFLOW_REFERENCE.yaml.inputTypes.join(", ")}`,
          "",
          "Triggers:",
          `  ${WORKFLOW_REFERENCE.yaml.triggers.join(", ")}`,
          "",
          "Steps:",
          ...WORKFLOW_REFERENCE.yaml.steps.map((item) => `  ${item}`),
          "",
          "Example:",
          `  ${WORKFLOW_REFERENCE.example.replace(/\n/g, "\n  ")}`,
        ].join("\n"),
      );
    },
  }),
  command("workflows list", {
    summary: "List workflows visible on a base",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const workflows = await listWorkflows(ctx, base.id);
      printJsonOrTable(ctx, workflows, workflowRows(workflows), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "enabled", label: "ENABLED" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("workflows get", {
    summary: "Show a workflow",
    args: baseArgs,
    flags: { ...baseFlag, ...workflowFlag },
    async run({ ctx, args, flags }) {
      const { workflow } = await resolveWorkflowFromCommand(ctx, args.args, flags.workflow);
      if (ctx.options.output === "json") ctx.json(workflow);
      else {
        ctx.print(`${workflow.name} (${workflow.shortId})`);
        if (workflow.description) ctx.print(workflow.description);
        ctx.print(`enabled: ${workflow.enabled ? "yes" : "no"}`);
        ctx.print(`id: ${workflow.id}`);
        ctx.print("");
        ctx.print(workflow.source);
      }
    },
  }),
  command("workflows create", {
    summary: "Create a workflow",
    description: "Run `cld grids workflows reference` for YAML structure, triggers, steps, and examples.",
    args: baseArgs,
    flags: {
      ...baseFlag,
      body: JSON_BODY_NAMED_INPUT,
      name: flag.string({ description: "Workflow name" }),
      description: flag.string({ description: "Workflow description" }),
      source: WORKFLOW_SOURCE_INPUT,
      enabled: flag.boolean({ description: "Enable the workflow" }),
      disabled: flag.boolean({ description: "Create the workflow disabled" }),
      position: flag.int({ min: 0, description: "Workflow position" }),
    },
    examples: [
      "cld grids workflows validate Bookshop --source-file workflow.yml",
      "cld grids workflows create Bookshop --name 'Send reminders' --source-file workflow.yml --enabled",
      "cld grids workflows create --base Bookshop --body-file workflow.json",
    ],
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "workflow JSON", false)) ?? {};
      const source = await readTextInput(flags.source, "workflow YAML", false);
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        source,
        enabled: flags.enabled ? true : flags.disabled ? false : undefined,
        position: flags.position,
      });
      if (!body.name) throw new Error("Missing workflow name. Pass --name or --body JSON.");
      if (!body.source) throw new Error("Missing workflow YAML. Pass --source, --source-file, -f, --stdin, or --body JSON.");
      const workflow = await readApi<Workflow>(ctx, `/workflows/by-base/${encodeURIComponent(base.id)}`, jsonRequest("POST", body));
      printJsonOrMessage(ctx, workflow, `Created workflow ${workflow.name} (${workflow.shortId}).`);
    },
  }),
  command("workflows update", {
    summary: "Update a workflow",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...workflowFlag,
      body: JSON_BODY_NAMED_INPUT,
      name: flag.string({ description: "Workflow name" }),
      description: flag.string({ description: "Workflow description" }),
      source: WORKFLOW_SOURCE_INPUT,
      enabled: flag.boolean({ description: "Enable the workflow" }),
      disabled: flag.boolean({ description: "Disable the workflow" }),
      position: flag.int({ min: 0, description: "Workflow position" }),
    },
    async run({ ctx, args, flags }) {
      const { workflow } = await resolveWorkflowFromCommand(ctx, args.args, flags.workflow);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "workflow update JSON", false)) ?? {};
      const source = await readTextInput(flags.source, "workflow YAML", false);
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        source,
        enabled: flags.enabled ? true : flags.disabled ? false : undefined,
        position: flags.position,
      });
      const updated = await readApi<Workflow>(ctx, `/workflows/${encodeURIComponent(workflow.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated workflow ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("workflows delete", {
    summary: "Delete a workflow",
    args: baseArgs,
    flags: { ...baseFlag, ...workflowFlag, yes: confirmFlag("Delete this workflow") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { workflow } = await resolveWorkflowFromCommand(ctx, args.args, flags.workflow);
      await readApi<MessageResponse>(ctx, `/workflows/${encodeURIComponent(workflow.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: workflow.id }, `Deleted workflow ${workflow.name} (${workflow.shortId}).`);
    },
  }),
  command("workflows validate", {
    summary: "Validate workflow YAML",
    args: baseArgs,
    flags: { ...baseFlag, source: WORKFLOW_SOURCE_INPUT },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const source = await readTextInput(flags.source, "workflow YAML", true);
      const payload = await readApi<WorkflowValidateResponse>(
        ctx,
        `/workflows/by-base/${encodeURIComponent(base.id)}/validate`,
        jsonRequest("POST", { source }),
      );
      if (ctx.options.output === "json") {
        ctx.json(payload);
        return payload.ok ? 0 : 1;
      }
      if (!payload.ok) {
        printDiagnostics(ctx, payload.diagnostics);
        return 1;
      }
      ctx.print("Workflow YAML is valid.");
      return 0;
    },
  }),
  command("workflows autocomplete", {
    summary: "Return permission-safe workflow YAML autocomplete items",
    args: baseArgs,
    flags: {
      ...baseFlag,
      source: WORKFLOW_SOURCE_INPUT,
      caret: flag.int({ min: 0, max: 200_000, description: "UTF-16 caret offset" }),
    },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const source = await readTextInput(flags.source, "workflow YAML", true);
      printAutocomplete(
        ctx,
        await readApi<WorkflowAutocompleteResponse>(
          ctx,
          `/workflows/by-base/${encodeURIComponent(base.id)}/autocomplete`,
          jsonRequest("POST", { source, ...(flags.caret !== undefined ? { caret: flags.caret } : {}) }),
        ),
      );
    },
  }),
  command("workflows trigger", {
    summary: "Trigger a workflow manually",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...workflowFlag,
      mode: flag.enum(["api", "form", "dashboard-button", "bulk-selection", "scanner", "schedule"] as const, {
        default: "api",
        description: "Trigger mode",
      }),
      input: WORKFLOW_TRIGGER_INPUT,
      code: flag.string({ description: "Scanner code for scanner mode" }),
      recordId: flag.stringList({ name: "record-id", description: "Record UUID for bulk-selection. Repeatable." }),
      bulkInput: flag.string({ name: "bulk-input", description: "Workflow input name for bulk-selection" }),
      query: WORKFLOW_BULK_QUERY_INPUT,
    },
    examples: [
      "cld grids workflows trigger Bookshop 'Send reminders' --input '{\"email\":\"ada@example.test\"}'",
      "cld grids workflows trigger Bookshop 'Scan item' --mode scanner --code '<scan-code>'",
      "cld grids workflows trigger Bookshop 'Print labels' --mode bulk-selection --bulk-input items --record-id <record-uuid>",
      "cld grids workflows trigger Bookshop 'Nightly sync' --mode schedule",
    ],
    async run({ ctx, args, flags }) {
      const { workflow } = await resolveWorkflowFromCommand(ctx, args.args, flags.workflow);
      if (flags.mode === "schedule") {
        const response = await readApi<MessageResponse>(
          ctx,
          `/workflows/${encodeURIComponent(workflow.id)}/run/schedule`,
          jsonRequest("POST", {}),
        );
        printJsonOrMessage(ctx, response, response.message ?? "Scheduled workflow run requested.");
        return;
      }
      if (flags.mode === "scanner") {
        if (!flags.code) throw new Error("Missing scanner code. Pass --code.");
        const run = await readApi<WorkflowRun>(
          ctx,
          `/workflows/${encodeURIComponent(workflow.id)}/run/scanner`,
          jsonRequest("POST", { code: flags.code }),
        );
        printJsonOrMessage(ctx, run, `Queued workflow run ${run.id} (${run.status}).`);
        return;
      }
      if (flags.mode === "bulk-selection") {
        const query = await readJsonInput<Record<string, unknown>>(flags.query, "bulk record query JSON", false);
        const recordIds = flags.recordId.length > 0 ? flags.recordId : undefined;
        if ((recordIds === undefined) === (query === undefined)) throw new Error("Pass either --record-id or --query/--query-file.");
        const run = await readApi<WorkflowRun>(
          ctx,
          `/workflows/${encodeURIComponent(workflow.id)}/run/bulk-selection`,
          jsonRequest("POST", { input: flags.bulkInput, recordIds, query }),
        );
        printJsonOrMessage(ctx, run, `Queued workflow run ${run.id} (${run.status}).`);
        return;
      }
      const input = (await readJsonInput<Record<string, unknown>>(flags.input, "workflow input JSON", false)) ?? {};
      const endpoint = flags.mode === "dashboard-button" ? "dashboard-button" : flags.mode;
      const run = await readApi<WorkflowRun>(
        ctx,
        `/workflows/${encodeURIComponent(workflow.id)}/run/${endpoint}`,
        jsonRequest("POST", { input }),
      );
      printJsonOrMessage(ctx, run, `Queued workflow run ${run.id} (${run.status}).`);
    },
  }),
];

const workflowRunCommands = [
  command("workflow-runs list", {
    summary: "List workflow runs visible on a base",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...workflowFlag,
      status: flag.enum(["queued", "running", "succeeded", "failed", "canceled"] as const, { description: "Run status" }),
      cursor: flag.string({ description: "Pagination cursor" }),
      limit: flag.int({ min: 1, max: 200, description: "Maximum runs" }),
    },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const workflow = flags.workflow ? await resolveWorkflow(ctx, base.id, flags.workflow) : null;
      const payload = await readApi<WorkflowRunListResponse>(
        ctx,
        `/workflows/by-base/${encodeURIComponent(base.id)}/runs${queryString({
          workflowId: workflow?.id,
          status: flags.status,
          cursor: flags.cursor,
          limit: flags.limit,
        })}`,
      );
      printJsonOrTable(ctx, payload, workflowRunRows(payload.items), [
        { key: "id", label: "SHORT" },
        { key: "workflowId", label: "WORKFLOW" },
        { key: "trigger", label: "TRIGGER" },
        { key: "status", label: "STATUS" },
        { key: "createdAt", label: "CREATED" },
        { key: "runId", label: "ID" },
      ]);
      if (ctx.options.output !== "json" && payload.nextCursor) ctx.print(`next cursor: ${payload.nextCursor}`);
    },
  }),
  command("workflow-runs get", {
    summary: "Show a workflow run",
    args: { run: arg.required({ description: "Workflow run UUID" }) },
    async run({ ctx, args }) {
      const run = await readApi<WorkflowRun>(ctx, `/workflows/runs/${encodeURIComponent(args.run)}`);
      if (ctx.options.output === "json") ctx.json(run);
      else {
        ctx.print(`${run.id} (${run.status})`);
        ctx.print(`workflow: ${run.workflowId ?? "-"}`);
        ctx.print(`trigger: ${run.triggerKind}`);
        if (run.error) ctx.print(`error: ${run.error}`);
      }
    },
  }),
  command("workflow-runs steps", {
    summary: "List workflow run steps",
    args: { run: arg.required({ description: "Workflow run UUID" }) },
    async run({ ctx, args }) {
      const payload = await readApi<WorkflowStepRunListResponse>(ctx, `/workflows/runs/${encodeURIComponent(args.run)}/steps`);
      printJsonOrTable(ctx, payload, workflowStepRows(payload.items), [
        { key: "index", label: "#" },
        { key: "path", label: "PATH" },
        { key: "kind", label: "KIND" },
        { key: "status", label: "STATUS" },
        { key: "durationMs", label: "MS" },
        { key: "error", label: "ERROR" },
      ]);
    },
  }),
  command("workflow-runs documents", {
    summary: "List documents generated by a workflow run",
    args: { run: arg.required({ description: "Workflow run UUID" }) },
    flags: {
      limit: flag.int({ min: 1, max: 500, description: "Maximum documents" }),
      offset: flag.int({ min: 0, description: "Document offset" }),
    },
    async run({ ctx, args, flags }) {
      const payload = await readApi<DocumentRunSummaryList>(
        ctx,
        `/workflows/runs/${encodeURIComponent(args.run)}/documents${queryString({ limit: flags.limit, offset: flags.offset })}`,
      );
      printJsonOrTable(ctx, payload, documentRunRows(payload.items), [
        { key: "shortId", label: "SHORT" },
        { key: "number", label: "NUMBER" },
        { key: "filename", label: "FILENAME" },
        { key: "tags", label: "TAGS" },
        { key: "generatedAt", label: "GENERATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("workflow-runs download-documents", {
    summary: "Download all documents generated by a workflow run as one PDF",
    args: { run: arg.required({ description: "Workflow run UUID" }) },
    flags: { out: flag.string({ description: "Output PDF path" }) },
    async run({ ctx, args, flags }) {
      await writeApiFile(ctx, `/workflows/runs/${encodeURIComponent(args.run)}/documents/download`, undefined, flags.out);
    },
  }),
];

const workflowEmailCommands = [
  command("workflow-emails list", {
    summary: "List workflow email deliveries visible on a base",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...workflowFlag,
      cursor: flag.string({ description: "Pagination cursor" }),
      limit: flag.int({ min: 1, max: 200, description: "Maximum deliveries" }),
    },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const workflow = flags.workflow ? await resolveWorkflow(ctx, base.id, flags.workflow) : null;
      const payload = await readApi<WorkflowEmailDeliveryListResponse>(
        ctx,
        `/workflows/by-base/${encodeURIComponent(base.id)}/email-deliveries${queryString({
          workflowId: workflow?.id,
          cursor: flags.cursor,
          limit: flags.limit,
        })}`,
      );
      printJsonOrTable(ctx, payload, workflowEmailRows(payload.items), [
        { key: "id", label: "SHORT" },
        { key: "workflowId", label: "WORKFLOW" },
        { key: "runId", label: "RUN" },
        { key: "status", label: "STATUS" },
        { key: "subject", label: "SUBJECT" },
        { key: "recipients", label: "RECIPIENTS" },
        { key: "createdAt", label: "CREATED" },
      ]);
      if (ctx.options.output !== "json" && payload.nextCursor) ctx.print(`next cursor: ${payload.nextCursor}`);
    },
  }),
];

const gqlCommands = [
  command("gql reference", {
    summary: "Show Grids Query Language syntax, refs, and examples",
    description:
      "This is the compact CLI reference. For a permission-safe base-specific assistant bundle, use `cld grids gql skill` and `cld grids gql context`.",
    examples: ["cld grids gql reference", "cld grids gql reference --json"],
    async run({ ctx }) {
      printReference(
        ctx,
        GQL_REFERENCE,
        [
          "Grids Query Language",
          "",
          "GQL is a line-oriented query language compiled by the Grids backend. Each query starts with from table/view.",
          "",
          "Clauses:",
          ...GQL_REFERENCE.clauses.map((item) => `  ${item}`),
          "",
          "References:",
          ...GQL_REFERENCE.refs.map((item) => `  ${item}`),
          "",
          "Examples:",
          ...GQL_REFERENCE.examples.map((example) => `  ${example.replace(/\n/g, "\n  ")}`),
        ].join("\n"),
      );
    },
  }),
  command("gql run", {
    summary: "Execute a GQL query",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...viewFlag,
      query: GQL_INPUT,
      limit: flag.int({ min: 1, max: 10_000, description: "Maximum rows" }),
      cursor: flag.string({ description: "Pagination cursor" }),
    },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const table = await resolveTableFromFlags(ctx, base, flags.table);
      const view = await resolveOptionalView(ctx, table, flags.view);
      const body = {
        query: await readGql(flags.query),
        ...(flags.limit !== undefined ? { limit: flags.limit } : {}),
        ...(flags.cursor ? { cursor: flags.cursor } : {}),
        ...(table ? { currentTableId: table.id, currentSource: { kind: "table", tableId: table.id } } : {}),
        ...(view ? { currentTableId: view.tableId, currentSource: { kind: "view", viewId: view.id } } : {}),
      };
      return printGqlResult(
        ctx,
        await readApi<DslQueryExecuteResponse>(ctx, `/gql/by-base/${encodeURIComponent(base.id)}/execute`, jsonRequest("POST", body)),
      );
    },
  }),
  command("gql preview", {
    summary: "Preview a GQL query with a smaller row cap",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...viewFlag,
      query: GQL_INPUT,
      limit: flag.int({ min: 1, max: 500, description: "Maximum preview rows" }),
    },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const table = await resolveTableFromFlags(ctx, base, flags.table);
      const view = await resolveOptionalView(ctx, table, flags.view);
      const body = {
        query: await readGql(flags.query),
        ...(flags.limit !== undefined ? { limit: flags.limit } : {}),
        ...(table ? { currentTableId: table.id, currentSource: { kind: "table", tableId: table.id } } : {}),
        ...(view ? { currentTableId: view.tableId, currentSource: { kind: "view", viewId: view.id } } : {}),
      };
      return printGqlResult(
        ctx,
        await readApi<DslQueryExecuteResponse>(ctx, `/gql/by-base/${encodeURIComponent(base.id)}/preview`, jsonRequest("POST", body)),
      );
    },
  }),
  command("gql compile-view", {
    summary: "Compile and canonicalize a GQL source for a saved view",
    args: baseArgs,
    flags: { ...baseFlag, ...tableFlag, ...viewFlag, query: GQL_INPUT },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const table = await resolveTableFromFlags(ctx, base, flags.table);
      const view = await resolveOptionalView(ctx, table, flags.view);
      const body = {
        query: await readGql(flags.query),
        ...(table ? { currentTableId: table.id, currentSource: { kind: "table", tableId: table.id } } : {}),
        ...(view ? { currentTableId: view.tableId, currentSource: { kind: "view", viewId: view.id } } : {}),
      };
      const payload = await readApi<DslQueryCompileViewResponse>(
        ctx,
        `/gql/by-base/${encodeURIComponent(base.id)}/compile-view`,
        jsonRequest("POST", body),
      );
      if (ctx.options.output === "json") {
        ctx.json(payload);
        return payload.ok ? 0 : 1;
      }
      if (!payload.ok) {
        printGqlDiagnostics(ctx, payload.diagnostics);
        return 1;
      }
      ctx.print(payload.source);
      return 0;
    },
  }),
  command("gql autocomplete", {
    summary: "Return permission-safe GQL autocomplete items",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...viewFlag,
      query: GQL_INPUT,
      caret: flag.int({ min: 0, max: 20_000, description: "UTF-16 caret offset" }),
    },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const table = await resolveTableFromFlags(ctx, base, flags.table);
      const view = await resolveOptionalView(ctx, table, flags.view);
      const body = {
        query: await readGql(flags.query),
        ...(flags.caret !== undefined ? { caret: flags.caret } : {}),
        ...(table ? { currentTableId: table.id, currentSource: { kind: "table", tableId: table.id } } : {}),
        ...(view ? { currentTableId: view.tableId, currentSource: { kind: "view", viewId: view.id } } : {}),
      };
      printAutocomplete(
        ctx,
        await readApi<DslQueryAutocompleteResponse>(
          ctx,
          `/gql/by-base/${encodeURIComponent(base.id)}/autocomplete`,
          jsonRequest("POST", body),
        ),
      );
    },
  }),
  command("gql skill", {
    summary: "Download the Grids GQL assistant SKILL.md",
    args: baseArgs,
    flags: { ...baseFlag, out: flag.string({ description: "Write to file instead of stdout" }) },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      await writeOrPrint(ctx, await readApiText(ctx, `/gql/by-base/${encodeURIComponent(base.id)}/assistant/SKILL.md`), flags.out);
    },
  }),
  command("gql context", {
    summary: "Download permission-safe GQL schema context.md",
    args: baseArgs,
    flags: { ...baseFlag, out: flag.string({ description: "Write to file instead of stdout" }) },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      await writeOrPrint(ctx, await readApiText(ctx, `/gql/by-base/${encodeURIComponent(base.id)}/assistant/context.md`), flags.out);
    },
  }),
];

export default defineCliCommands({
  name: "grids",
  summary:
    "Manage Grids bases, schema, records, forms, dashboards, views, GQL, documents, templates, and workflows through the Grids HTTP API.",
  commands: [
    ...baseCrudCommands,
    ...accessCommands,
    ...gqlCommands,
    ...formulaCommands,
    ...tableCommands,
    ...fieldCommands,
    ...recordCommands,
    ...viewCommands,
    ...formCommands,
    ...dashboardCommands,
    ...documentTemplateCommands,
    ...documentCommands,
    ...snapshotCommands,
    ...emailTemplateCommands,
    ...workflowCommands,
    ...workflowRunCommands,
    ...workflowEmailCommands,
  ],
});
