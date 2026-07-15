import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CloudCliContext, CloudCliFlags } from "@valentinkolb/cloud/cli";
import gridsCli from "./cli";
import { accessCommands } from "./cli/access";
import { baseCrudCommands } from "./cli/bases";
import { documentCommands, documentTemplateCommands } from "./cli/documents";
import { dashboardCommands, formCommands } from "./cli/forms-dashboards";
import { recordCommands, snapshotCommands } from "./cli/records";
import { fieldCommands, tableCommands } from "./cli/schema";
import { formulaCommands, gqlCommands, viewCommands } from "./cli/views-gql";
import { emailTemplateCommands, workflowCommands, workflowEmailCommands, workflowRunCommands } from "./cli/workflows";
import { WORKFLOW_REVISION_HEADER } from "./workflows/contracts";

const commandGroups = [
  baseCrudCommands,
  accessCommands,
  gqlCommands,
  formulaCommands,
  tableCommands,
  fieldCommands,
  recordCommands,
  viewCommands,
  formCommands,
  dashboardCommands,
  documentTemplateCommands,
  documentCommands,
  snapshotCommands,
  emailTemplateCommands,
  workflowCommands,
  workflowRunCommands,
  workflowEmailCommands,
] as const;

type FetchCall = {
  path: string;
  init?: RequestInit;
};

const baseId = "11111111-1111-4111-8111-111111111111";
const tableId = "22222222-2222-4222-8222-222222222222";
const fieldId = "33333333-3333-4333-8333-333333333333";
const recordId = "44444444-4444-4444-8444-444444444444";
const viewId = "55555555-5555-4555-8555-555555555555";
const documentTemplateId = "66666666-6666-4666-8666-666666666666";
const emailTemplateId = "77777777-7777-4777-8777-777777777777";
const workflowId = "88888888-8888-4888-8888-888888888888";
const runId = "99999999-9999-4999-8999-999999999999";
const formId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const dashboardId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const snapshotId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const documentRunId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const documentLinkId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const fileId = "12121212-1212-4212-8212-121212121212";
const accessId = "23232323-2323-4232-8232-232323232323";

const jsonResponse = (value: unknown, status = 200) => Response.json(value, { status });

const createContext = (
  args: string[],
  flags: CloudCliFlags = {},
  responses: Response[] = [],
  options: { output?: "text" | "json"; defaultBase?: string } = {},
) => {
  const calls: FetchCall[] = [];
  const lines: string[] = [];
  const jsonValues: unknown[] = [];
  const tables: unknown[][] = [];
  const defaults: Record<string, string | undefined> = { "grids.base": options.defaultBase };
  const ctx: CloudCliContext = {
    args,
    flags,
    options: { profile: "test", server: "http://cloud.test", token: "token", output: options.output ?? "text" },
    getDefault: async (key) => defaults[key],
    setDefault: async (key, value) => {
      defaults[key] = value;
    },
    createApiClient: (() => {
      throw new Error("not needed");
    }) as CloudCliContext["createApiClient"],
    fetch: async (path, init) => {
      calls.push({ path, init });
      const response = responses.shift();
      if (!response) throw new Error(`Unexpected fetch: ${path}`);
      return response;
    },
    readJson: async (response) => {
      const text = await response.text();
      const value = text ? JSON.parse(text) : null;
      if (!response.ok) throw new Error(typeof value?.message === "string" ? value.message : response.statusText);
      return value;
    },
    print: (value = "") => lines.push(value),
    write: (value) => lines.push(value),
    error: (value) => lines.push(value),
    json: (value) => jsonValues.push(value),
    jsonLine: (value) => jsonValues.push(value),
    table: (rows) => tables.push(rows),
  };
  return { ctx, calls, defaults, lines, jsonValues, tables };
};

const base = {
  id: baseId,
  shortId: "bk001",
  name: "Bookshop",
  description: "Books and authors",
  documentProfile: {},
  createdBy: null,
  defaultDashboardId: null,
  deletedAt: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const table = {
  id: tableId,
  shortId: "auth1",
  baseId,
  name: "Authors",
  description: null,
  icon: "ti ti-table",
  columns: [],
  displayConfig: { mode: "table" },
  position: 0,
  disableDirectInsert: false,
  deletedAt: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const field = {
  id: fieldId,
  shortId: "name1",
  tableId,
  name: "Name",
  description: null,
  icon: "ti ti-text",
  type: "text",
  config: {},
  position: 0,
  required: false,
  presentable: true,
  hideInTable: false,
  defaultValue: null,
  indexed: false,
  uniqueConstraint: false,
  deletedAt: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const record = {
  id: recordId,
  tableId,
  data: { [fieldId]: "Ursula K. Le Guin" },
  version: 1,
  deletedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const view = {
  id: viewId,
  shortId: "view1",
  tableId,
  name: "Recent authors",
  description: null,
  icon: "ti ti-table-star",
  source: "from table Authors",
  ui: {},
  ownerUserId: null,
  position: 0,
  deletedAt: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const form = {
  id: formId,
  shortId: "frm01",
  tableId,
  name: "Author intake",
  config: { fields: [{ kind: "user_input", fieldId }] },
  publicToken: null,
  isActive: true,
  ownerUserId: null,
  position: 0,
  isDefault: false,
  deletedAt: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const dashboard = {
  id: dashboardId,
  shortId: "dash1",
  baseId,
  name: "Overview",
  description: null,
  icon: "ti ti-layout-dashboard",
  config: { rows: [] },
  ownerUserId: null,
  position: 0,
  deletedAt: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const documentTemplate = {
  id: documentTemplateId,
  shortId: "doc01",
  tableId,
  name: "Invoice",
  description: null,
  source: "from table Authors\nselect Name\nlimit 1",
  html: "<p>{{ record.id }}</p>",
  headerHtml: null,
  footerHtml: null,
  pageCss: null,
  numberTemplate: "{{ template.shortId }}-{{ run.shortId }}",
  filenameTemplate: "{{ document.number }}.pdf",
  enabled: true,
  position: 0,
  createdBy: null,
  updatedBy: null,
  deletedAt: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const emailTemplate = {
  id: emailTemplateId,
  shortId: "mail1",
  baseId,
  name: "Reminder",
  description: null,
  subject: "Reminder",
  html: "<p>Hello</p>",
  enabled: true,
  position: 0,
  createdBy: null,
  updatedBy: null,
  deletedAt: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const workflow = {
  id: workflowId,
  shortId: "wf001",
  baseId,
  name: "Send reminder",
  description: null,
  source: "steps:\n  - setVariable:\n      name: ok\n      value: true",
  plan: {
    schemaVersion: 1,
    languageId: "grids",
    languageVersion: 1,
    sourceHash: "source",
    manifestHash: "manifest",
    catalogHash: "catalog",
    inputs: [],
    triggers: [],
    steps: [],
    bindings: {},
  },
  diagnostics: [],
  enabled: true,
  position: 0,
  revision: 1,
  recordEventActiveSince: null,
  ownerUserId: null,
  deletedAt: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const workflowRun = {
  id: runId,
  workflowId,
  launcherId: null,
  baseId,
  workflowRevision: 1,
  mode: "execute",
  channel: "api",
  actorUserId: null,
  serviceAccountId: null,
  inputs: {},
  status: "succeeded",
  result: null,
  error: null,
  resultMessage: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  startedAt: "2026-07-07T00:00:00.000Z",
  finishedAt: "2026-07-07T00:00:01.000Z",
};

const documentRun = {
  id: documentRunId,
  shortId: "run01",
  templateId: documentTemplateId,
  workflowRunId: null,
  snapshotId,
  baseId,
  tableId,
  recordId,
  documentNumber: "INV-20260707-0001",
  filename: "invoice.pdf",
  tags: ["invoice"],
  generatedBy: null,
  generatedAt: "2026-07-07T00:00:00.000Z",
};

const documentLink = {
  id: documentLinkId,
  documentRunId,
  baseId,
  tableId,
  recordId,
  comment: "Customer download",
  createdBy: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  expiresAt: "2026-08-06T00:00:00.000Z",
  revokedAt: null,
  revokedBy: null,
  lastAccessedAt: null,
  accessCount: 0,
};

const recordSnapshot = {
  id: snapshotId,
  baseId,
  tableId,
  recordId,
  root: { record },
  graph: { records: [record] },
  createdBy: null,
  createdAt: "2026-07-07T00:00:00.000Z",
};

const gridFile = {
  id: fileId,
  recordId,
  fieldId,
  position: 0,
  filename: "cover.txt",
  mimeType: "text/plain",
  sizeBytes: 5,
  sha256: "abc123",
  createdBy: null,
  createdAt: "2026-07-07T00:00:00.000Z",
};

const accessEntry = {
  id: accessId,
  principal: { type: "user" as const, userId: "abababab-abab-4aba-8bab-abababababab" },
  permission: "read" as const,
  displayName: "Ada Lovelace",
  createdAt: "2026-07-07T00:00:00.000Z",
};

describe("grids CLI", () => {
  test("registers every command exported by its domain modules", async () => {
    const commands = commandGroups.flat();
    const paths = commands.map((item) => item.path.join(" "));

    expect(commands).toHaveLength(126);
    expect(new Set(paths).size).toBe(paths.length);

    for (const path of paths) {
      const { ctx, lines } = createContext([...path.split(" "), "help"]);
      expect(await gridsCli.run(ctx)).toBe(0);
      expect(lines[0]).toStartWith(`cld grids ${path}`);
    }
  });

  test("sets and reads the default base by short id", async () => {
    const { ctx, calls, defaults, lines } = createContext(["use", "bk001"], {}, [
      jsonResponse({ items: [base], total: 1, limit: 500, offset: 0 }),
    ]);

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual(["/api/grids/bases?q=bk001&limit=500&offset=0"]);
    expect(defaults["grids.base"]).toBe("bk001");
    expect(lines).toEqual(["Using Grids base Bookshop (bk001)."]);
  });

  test("executes GQL against the selected base", async () => {
    const query = "from table Authors select Name limit 1";
    const { ctx, calls, tables } = createContext(
      ["gql", "run"],
      { query },
      [
        jsonResponse({ items: [base], total: 1, limit: 500, offset: 0 }),
        jsonResponse({
          ok: true,
          mode: "rows",
          columns: [{ key: "Name", label: "Name", type: "text", sqlType: "text" }],
          rows: [{ recordId, tableId, values: { Name: "Ursula K. Le Guin" } }],
          limit: 100,
          truncated: false,
        }),
      ],
      { defaultBase: "bk001" },
    );

    const exitCode = await gridsCli.run(ctx);

    expect(exitCode).toBe(0);
    expect(calls.map((call) => call.path)).toEqual([
      "/api/grids/bases?q=bk001&limit=500&offset=0",
      `/api/grids/gql/by-base/${baseId}/execute`,
    ]);
    expect(calls[1]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ query });
    expect(tables[0]).toEqual([{ recordId, Name: "Ursula K. Le Guin" }]);
  });

  test("creates schema objects through resolved base and table references", async () => {
    const { ctx, calls, lines } = createContext(
      ["fields", "create", baseId, "Authors"],
      { name: "Birth year", type: "number", config: "{}" },
      [jsonResponse(base), jsonResponse([table]), jsonResponse({ ...field, name: "Birth year", type: "number", config: {} }, 201)],
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/fields/by-table/${tableId}`,
    ]);
    expect(calls[2]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2]?.init?.body))).toMatchObject({ name: "Birth year", type: "number", config: {} });
    expect(lines).toEqual(["Created field Birth year (name1)."]);
  });

  test("lists field type references for agents", async () => {
    const { ctx, tables } = createContext(["fields", "types"]);

    await gridsCli.run(ctx);

    expect(tables[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", category: "value", writable: "yes" }),
        expect.objectContaining({ type: "relation", category: "link", writable: "yes" }),
        expect.objectContaining({ type: "formula", category: "computed", writable: "no" }),
      ]),
    );
  });

  test("shows one field type reference as JSON", async () => {
    const { ctx, jsonValues } = createContext(["fields", "type", "select"], {}, [], { output: "json" });

    await gridsCli.run(ctx);

    expect(jsonValues[0]).toMatchObject({
      type: "select",
      category: "value",
      recordWritable: true,
      recordValue: '["open"]',
    });
  });

  test("prints record payload shape from live table fields", async () => {
    const selectField = {
      ...field,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      shortId: "country",
      name: "Country",
      type: "select",
      config: { options: [{ id: "uk", label: "United Kingdom" }] },
      required: true,
    };
    const formulaField = {
      ...field,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      shortId: "len01",
      name: "Name length",
      type: "formula",
      config: { expression: "LEN(Name)" },
    };
    const { ctx, calls, jsonValues } = createContext(
      ["records", "shape", baseId, "Authors"],
      {},
      [jsonResponse(base), jsonResponse([table]), jsonResponse([field, selectField, formulaField])],
      { output: "json" },
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/fields/by-table/${tableId}`,
    ]);
    expect(jsonValues[0]).toMatchObject({
      table: { id: tableId, name: "Authors" },
      payload: "Record create/update bodies are plain JSON objects keyed by field UUID.",
      example: { [fieldId]: "Text value", [selectField.id]: ["uk"] },
      writableFields: expect.arrayContaining([
        expect.objectContaining({ id: fieldId, name: "Name", type: "text" }),
        expect.objectContaining({ id: selectField.id, name: "Country", type: "select", required: true, exampleValue: ["uk"] }),
      ]),
      readOnlyFields: [expect.objectContaining({ id: formulaField.id, name: "Name length", type: "formula" })],
    });
  });

  test("creates records with raw JSON payloads", async () => {
    const { ctx, calls, lines } = createContext(
      ["records", "create", baseId, "Authors"],
      { body: JSON.stringify({ [fieldId]: "Octavia Butler" }) },
      [jsonResponse(base), jsonResponse([table]), jsonResponse({ ...record, data: { [fieldId]: "Octavia Butler" } }, 201)],
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/records/by-table/${tableId}`,
    ]);
    expect(calls[2]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ [fieldId]: "Octavia Butler" });
    expect(lines).toEqual([`Created record ${recordId}.`]);
  });

  test("imports records atomically through the backend import endpoint", async () => {
    const body = [{ [fieldId]: "Octavia Butler" }];
    const { ctx, calls, tables } = createContext(["records", "import", baseId, "Authors"], { body: JSON.stringify(body) }, [
      jsonResponse(base),
      jsonResponse([table]),
      jsonResponse({ items: [{ ...record, data: body[0] }] }, 201),
    ]);

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/records/by-table/${tableId}/import`,
    ]);
    expect(calls[2]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ items: body });
    expect(tables[0]?.[0]).toMatchObject({ recordId, [fieldId]: "Octavia Butler" });
  });

  test("exports records to a requested output file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grids-cli-export-"));
    const out = join(dir, "authors.json");
    try {
      const { ctx, calls, lines } = createContext(["records", "export", baseId, "Authors"], { format: "json", limit: "50", out }, [
        jsonResponse(base),
        jsonResponse([table]),
        new Response("[]", { headers: { "Content-Type": "application/json" } }),
      ]);

      await gridsCli.run(ctx);

      expect(calls.map((call) => call.path)).toEqual([
        `/api/grids/bases/${baseId}`,
        `/api/grids/tables/by-base/${baseId}`,
        `/api/grids/records/by-table/${tableId}/export`,
      ]);
      expect(calls[2]?.init?.method).toBe("POST");
      expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ format: "json", query: { limit: 50 } });
      expect(lines).toEqual([`Wrote ${out}.`]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("manages record file-field blobs", async () => {
    const {
      ctx: listCtx,
      calls: listCalls,
      tables,
    } = createContext(["records", "files", "list", baseId, "Authors", recordId, "Name"], {}, [
      jsonResponse(base),
      jsonResponse([table]),
      jsonResponse([field]),
      jsonResponse({ items: [gridFile] }),
    ]);

    await gridsCli.run(listCtx);

    expect(listCalls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/fields/by-table/${tableId}`,
      `/api/grids/records/${tableId}/${recordId}/files/${fieldId}`,
    ]);
    expect(tables[0]?.[0]).toMatchObject({ id: fileId, filename: "cover.txt", mimeType: "text/plain" });

    const dir = await mkdtemp(join(tmpdir(), "grids-cli-file-"));
    const source = join(dir, "cover.txt");
    const out = join(dir, "cover-copy.txt");
    await writeFile(source, "hello");
    try {
      const {
        ctx: uploadCtx,
        calls: uploadCalls,
        lines: uploadLines,
      } = createContext(["records", "files", "upload", baseId, "Authors", recordId, "Name", source], {}, [
        jsonResponse(base),
        jsonResponse([table]),
        jsonResponse([field]),
        jsonResponse(gridFile, 201),
      ]);

      await gridsCli.run(uploadCtx);

      expect(uploadCalls.map((call) => call.path)).toEqual([
        `/api/grids/bases/${baseId}`,
        `/api/grids/tables/by-base/${baseId}`,
        `/api/grids/fields/by-table/${tableId}`,
        `/api/grids/records/${tableId}/${recordId}/files/${fieldId}`,
      ]);
      expect(uploadCalls[3]?.init?.method).toBe("POST");
      const form = uploadCalls[3]?.init?.body as FormData;
      const file = form.get("file") as File;
      expect(file.name).toBe("cover.txt");
      expect(await file.text()).toBe("hello");
      expect(uploadLines).toEqual([`Uploaded cover.txt (${fileId}).`]);

      const {
        ctx: downloadCtx,
        calls: downloadCalls,
        lines: downloadLines,
      } = createContext(["records", "files", "download", baseId, "Authors", recordId, "Name", fileId], { out }, [
        jsonResponse(base),
        jsonResponse([table]),
        jsonResponse([field]),
        new Response("hello"),
      ]);

      await gridsCli.run(downloadCtx);

      expect(downloadCalls.map((call) => call.path)).toEqual([
        `/api/grids/bases/${baseId}`,
        `/api/grids/tables/by-base/${baseId}`,
        `/api/grids/fields/by-table/${tableId}`,
        `/api/grids/records/${tableId}/${recordId}/files/${fieldId}/${fileId}/content`,
      ]);
      expect(await readFile(out, "utf8")).toBe("hello");
      expect(downloadLines).toEqual([`Wrote ${out}.`]);

      const {
        ctx: deleteCtx,
        calls: deleteCalls,
        lines: deleteLines,
      } = createContext(["records", "files", "delete", baseId, "Authors", recordId, "Name", fileId], { yes: true }, [
        jsonResponse(base),
        jsonResponse([table]),
        jsonResponse([field]),
        new Response(null, { status: 204 }),
      ]);

      await gridsCli.run(deleteCtx);

      expect(deleteCalls.map((call) => call.path)).toEqual([
        `/api/grids/bases/${baseId}`,
        `/api/grids/tables/by-base/${baseId}`,
        `/api/grids/fields/by-table/${tableId}`,
        `/api/grids/records/${tableId}/${recordId}/files/${fieldId}/${fileId}`,
      ]);
      expect(deleteCalls[3]?.init?.method).toBe("DELETE");
      expect(deleteLines).toEqual([`Deleted file ${fileId}.`]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("record create help points agents to the shape command", async () => {
    const { ctx, lines } = createContext(["records", "create", "help"]);

    await gridsCli.run(ctx);

    expect(lines[0]).toContain("cld grids records shape Bookshop Authors --json");
    expect(lines[0]).toContain("Pass a JSON object keyed by field UUID.");
  });

  test("prints agent-ready references for GQL, formulas, templates, and workflows", async () => {
    const gql = createContext(["gql", "reference"], {}, [], { output: "json" });
    const formulas = createContext(["formulas", "reference"], {}, [], { output: "json" });
    const documents = createContext(["document-templates", "reference"], {}, [], { output: "json" });
    const email = createContext(["email-templates", "reference"], {}, [], { output: "json" });
    const workflows = createContext(["workflows", "reference"], {}, [], { output: "json" });

    await gridsCli.run(gql.ctx);
    await gridsCli.run(formulas.ctx);
    await gridsCli.run(documents.ctx);
    await gridsCli.run(email.ctx);
    await gridsCli.run(workflows.ctx);

    expect(gql.jsonValues[0]).toMatchObject({ clauses: expect.arrayContaining(["from table <table-ref> [as alias]"]) });
    expect(formulas.jsonValues[0]).toMatchObject({
      functions: expect.arrayContaining([expect.objectContaining({ name: "LEN", signature: "LEN(text)" })]),
    });
    expect(documents.jsonValues[0]).toMatchObject({
      liquidData: expect.arrayContaining(["record.id", "document.number", "business.legalName"]),
    });
    expect(email.jsonValues[0]).toMatchObject({
      fields: expect.objectContaining({ html: "Liquid HTML email body. There is no plain-text fallback field." }),
    });
    const workflowReference = structuredClone(workflows.jsonValues[0]);
    expect(workflowReference).toMatchObject({
      language: expect.objectContaining({
        limits: expect.objectContaining({ maxSteps: 1_000, maxLoopItems: 10_000 }),
        inputs: expect.arrayContaining([expect.objectContaining({ kind: "record", config: expect.any(Object) })]),
        triggers: expect.arrayContaining([expect.objectContaining({ kind: "schedule", config: expect.any(Object) })]),
        actions: expect.arrayContaining([
          expect.objectContaining({ kind: "httpRequest", effect: "ambiguous-external", dryRun: "validate" }),
        ]),
      }),
      values: expect.objectContaining({
        dynamic: expect.stringContaining("${{ inputs.name }}"),
        dedicatedReferences: expect.stringContaining("record: inputs.item"),
      }),
      example: expect.stringContaining("value: ${{ now() }}"),
    });
    expect((email.jsonValues[0] as { example: { step: string } }).example.step).toContain("email: ${{ inputs.email }}");
  });

  test("checks formulas through the backend compiler", async () => {
    const { ctx, calls, tables } = createContext(["formulas", "check", baseId, "Authors"], { expression: "LEN(Name)" }, [
      jsonResponse(base),
      jsonResponse([table]),
      jsonResponse({
        ok: true,
        diagnostics: [],
        fields: [field],
        rows: [{ recordId, values: { [fieldId]: "Ursula K. Le Guin" }, result: 18 }],
      }),
    ]);

    const exitCode = await gridsCli.run(ctx);

    expect(exitCode).toBe(0);
    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/formulas/by-table/${tableId}/check`,
    ]);
    expect(calls[2]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ expression: "LEN(Name)" });
    expect(tables[0]).toEqual([{ recordId, result: "18" }]);
  });

  test("creates GQL-backed views", async () => {
    const { ctx, calls, lines } = createContext(
      ["views", "create", baseId, "Authors"],
      { name: "Recent authors", source: "from table Authors" },
      [jsonResponse(base), jsonResponse([table]), jsonResponse(view, 201)],
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/views/by-table/${tableId}`,
    ]);
    expect(calls[2]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      name: "Recent authors",
      source: "from table Authors",
    });
    expect(lines).toEqual(["Created view Recent authors (view1)."]);
  });

  test("exposes forms and dashboards in top-level help", async () => {
    const { ctx, lines } = createContext(["help"]);

    await gridsCli.run(ctx);

    expect(lines[0]).toContain("access");
    expect(lines[0]).toContain("formulas");
    expect(lines[0]).toContain("forms");
    expect(lines[0]).toContain("dashboards");
    expect(lines[0]).toContain("documents");
    expect(lines[0]).toContain("snapshots");
  });

  test("sets direct resource access through resolved Grids resources", async () => {
    const { ctx, calls, lines } = createContext(
      ["access", "set", "table", baseId, "Authors"],
      { user: accessEntry.principal.userId, permission: "write" },
      [jsonResponse(base), jsonResponse([table]), jsonResponse([accessEntry]), new Response(null, { status: 204 })],
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/access/by-table/${tableId}`,
      `/api/grids/access/${accessId}`,
    ]);
    expect(calls[3]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({ permission: "write" });
    expect(lines).toEqual([`Updated ${accessId} to write.`]);
  });

  test("grants direct access to document templates", async () => {
    const { ctx, calls, lines } = createContext(
      ["access", "grant", "document-template", baseId, "Authors", "Invoice"],
      { group: "abababab-abab-4aba-8bab-abababababab", permission: "read" },
      [jsonResponse(base), jsonResponse([table]), jsonResponse([documentTemplate]), jsonResponse({ accessId }, 201)],
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/documents/templates/by-table/${tableId}/full`,
      `/api/grids/access/by-document-template/${documentTemplateId}`,
    ]);
    expect(calls[3]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({
      principal: { type: "group", groupId: "abababab-abab-4aba-8bab-abababababab" },
      permission: "read",
    });
    expect(lines).toEqual(["Granted read on Invoice (doc01)."]);
  });

  test("creates custom forms for resolved tables", async () => {
    const { ctx, calls, lines } = createContext(
      ["forms", "create", baseId, "Authors"],
      { name: "Author intake", config: JSON.stringify(form.config), public: true },
      [jsonResponse(base), jsonResponse([table]), jsonResponse({ ...form, publicToken: "pub_test" }, 201)],
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/forms/by-table/${tableId}`,
    ]);
    expect(calls[2]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      name: "Author intake",
      config: form.config,
      isPublic: true,
    });
    expect(lines).toEqual(["Created form Author intake (frm01)."]);
  });

  test("submits forms through resolved table-scoped names", async () => {
    const { ctx, calls, lines } = createContext(
      ["forms", "submit", baseId, "Authors", "Author intake"],
      { body: JSON.stringify({ [fieldId]: "N. K. Jemisin" }) },
      [jsonResponse(base), jsonResponse([table]), jsonResponse([form]), jsonResponse({ recordId }, 201)],
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/forms/by-table/${tableId}`,
      `/api/grids/forms/${formId}/submit`,
    ]);
    expect(calls[3]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({ [fieldId]: "N. K. Jemisin" });
    expect(lines).toEqual([`Created record ${recordId}.`]);
  });

  test("rejects form UUIDs outside the selected base", async () => {
    const foreignForm = { ...form, tableId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
    const { ctx } = createContext(["forms", "get", baseId], { form: formId }, [
      jsonResponse(base),
      jsonResponse(foreignForm),
      jsonResponse([table]),
    ]);

    await expect(gridsCli.run(ctx)).rejects.toThrow("Form does not belong to the selected base.");
  });

  test("creates dashboards for resolved bases", async () => {
    const { ctx, calls, lines } = createContext(
      ["dashboards", "create", baseId],
      { name: "Overview", config: JSON.stringify({ rows: [] }), shared: true },
      [jsonResponse(base), jsonResponse(dashboard, 201)],
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([`/api/grids/bases/${baseId}`, `/api/grids/dashboards/by-base/${baseId}`]);
    expect(calls[1]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ name: "Overview", config: { rows: [] }, shared: true });
    expect(lines).toEqual(["Created dashboard Overview (dash1)."]);
  });

  test("runs dashboard workflow-button widgets", async () => {
    const { ctx, calls, lines } = createContext(["dashboards", "widgets", "run", baseId, "Overview", "widget-1"], {}, [
      jsonResponse(base),
      jsonResponse([dashboard]),
      jsonResponse(workflowRun),
    ]);

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/dashboards/by-base/${baseId}`,
      `/api/grids/dashboards/${dashboardId}/widgets/widget-1/run`,
    ]);
    expect(calls[2]?.init?.method).toBe("POST");
    expect(lines).toEqual([`Queued workflow run ${runId} (succeeded).`]);
  });

  test("scans dashboard workflow-button widgets", async () => {
    const { ctx, calls, lines } = createContext(
      ["dashboards", "widgets", "scan", baseId, "Overview", "scanner-1"],
      { code: "gsc_opaque" },
      [jsonResponse(base), jsonResponse([dashboard]), jsonResponse({ ...workflowRun, channel: "scanner" })],
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/dashboards/by-base/${baseId}`,
      `/api/grids/dashboards/${dashboardId}/widgets/scanner-1/scan`,
    ]);
    expect(calls[2]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ code: "gsc_opaque" });
    expect(lines).toEqual([`Queued scanner workflow run ${runId} (succeeded).`]);
  });

  test("rejects dashboard UUIDs outside the selected base", async () => {
    const foreignDashboard = { ...dashboard, baseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
    const { ctx } = createContext(["dashboards", "get", baseId, dashboardId], {}, [jsonResponse(base), jsonResponse(foreignDashboard)]);

    await expect(gridsCli.run(ctx)).rejects.toThrow("Dashboard does not belong to the selected base.");
  });

  test("creates document templates for resolved tables", async () => {
    const { ctx, calls, lines } = createContext(
      ["document-templates", "create", baseId, "Authors"],
      { name: "Invoice", source: documentTemplate.source, html: documentTemplate.html },
      [jsonResponse(base), jsonResponse([table]), jsonResponse(documentTemplate, 201)],
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/documents/templates/by-table/${tableId}`,
    ]);
    expect(calls[2]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2]?.init?.body))).toMatchObject({
      name: "Invoice",
      source: documentTemplate.source,
      html: documentTemplate.html,
    });
    expect(lines).toEqual(["Created document template Invoice (doc01)."]);
  });

  test("resolves document template names through table-scoped admin lists", async () => {
    const { ctx, calls, jsonValues } = createContext(
      ["document-templates", "get", baseId, "Authors", "Invoice"],
      {},
      [jsonResponse(base), jsonResponse([table]), jsonResponse([documentTemplate])],
      { output: "json" },
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/documents/templates/by-table/${tableId}/full`,
    ]);
    expect(jsonValues).toEqual([documentTemplate]);
  });

  test("generates stored documents from document templates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grids-cli-document-"));
    const out = join(dir, "invoice.pdf");
    try {
      const { ctx, calls, lines } = createContext(
        ["documents", "generate", baseId, "Authors", "Invoice"],
        { record: recordId, tag: ["invoice"], out },
        [jsonResponse(base), jsonResponse([table]), jsonResponse([documentTemplate]), new Response("PDF")],
      );

      await gridsCli.run(ctx);

      expect(calls.map((call) => call.path)).toEqual([
        `/api/grids/bases/${baseId}`,
        `/api/grids/tables/by-base/${baseId}`,
        `/api/grids/documents/templates/by-table/${tableId}/full`,
        `/api/grids/documents/templates/${documentTemplateId}/generate`,
      ]);
      expect(calls[3]?.init?.method).toBe("POST");
      expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({ recordId, tags: ["invoice"] });
      expect(lines).toEqual([`Wrote ${out}.`]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("previews unsaved document template drafts as data", async () => {
    const { ctx, calls, jsonValues } = createContext(
      ["document-templates", "preview-draft-data", baseId, "Authors"],
      { record: recordId, source: documentTemplate.source, html: documentTemplate.html },
      [
        jsonResponse(base),
        jsonResponse([table]),
        jsonResponse({ html: "<p>Rendered</p>", data: { record: { id: recordId } }, columns: [], rows: [] }),
      ],
      { output: "json" },
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/documents/templates/by-table/${tableId}/preview-data-draft`,
    ]);
    expect(calls[2]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2]?.init?.body))).toMatchObject({
      recordId,
      source: documentTemplate.source,
      html: documentTemplate.html,
    });
    expect(jsonValues[0]).toMatchObject({ html: "<p>Rendered</p>" });
  });

  test("previews saved document template drafts as PDFs with override output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grids-cli-draft-pdf-"));
    const out = join(dir, "draft.pdf");
    try {
      const { ctx, calls, lines } = createContext(
        ["document-templates", "preview-draft-pdf", baseId, "Authors", "Invoice"],
        { record: recordId, out, html: "<p>{{ record.id }}</p>" },
        [jsonResponse(base), jsonResponse([table]), jsonResponse([documentTemplate]), new Response("PDF")],
      );

      await gridsCli.run(ctx);

      expect(calls.map((call) => call.path)).toEqual([
        `/api/grids/bases/${baseId}`,
        `/api/grids/tables/by-base/${baseId}`,
        `/api/grids/documents/templates/by-table/${tableId}/full`,
        `/api/grids/documents/templates/${documentTemplateId}/preview-draft`,
      ]);
      expect(calls[3]?.init?.method).toBe("POST");
      expect(JSON.parse(String(calls[3]?.init?.body))).toMatchObject({
        recordId,
        source: documentTemplate.source,
        html: "<p>{{ record.id }}</p>",
        numberTemplate: documentTemplate.numberTemplate,
        filenameTemplate: documentTemplate.filenameTemplate,
      });
      expect(await readFile(out, "utf8")).toBe("PDF");
      expect(lines).toEqual([`Wrote ${out}.`]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("lists and updates generated document runs", async () => {
    const {
      ctx: listCtx,
      calls: listCalls,
      tables,
    } = createContext(["documents", "list", baseId, "Authors", "Invoice"], { tag: ["invoice"], limit: "25" }, [
      jsonResponse(base),
      jsonResponse([table]),
      jsonResponse([documentTemplate]),
      jsonResponse({ items: [documentRun], limit: 25 }),
    ]);

    await gridsCli.run(listCtx);

    expect(listCalls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/documents/templates/by-table/${tableId}/full`,
      `/api/grids/documents/runs/by-template/${documentTemplateId}?tags=invoice&limit=25`,
    ]);
    expect(tables[0]?.[0]).toMatchObject({ shortId: "run01", filename: "invoice.pdf" });

    const {
      ctx: updateCtx,
      calls: updateCalls,
      lines,
    } = createContext(["documents", "update", documentRunId], { filename: "invoice-final.pdf", tag: ["final"] }, [
      jsonResponse({ ...documentRun, filename: "invoice-final.pdf", tags: ["final"] }),
    ]);

    await gridsCli.run(updateCtx);

    expect(updateCalls.map((call) => call.path)).toEqual([`/api/grids/documents/runs/${documentRunId}`]);
    expect(updateCalls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(updateCalls[0]?.init?.body))).toEqual({ filename: "invoice-final.pdf", tags: ["final"] });
    expect(lines).toEqual(["Updated document invoice-final.pdf."]);
  });

  test("creates public links for generated documents", async () => {
    const { ctx, calls, lines } = createContext(
      ["documents", "links", "create", documentRunId],
      { "expires-in": "7d", comment: "Customer download" },
      [jsonResponse({ link: documentLink, url: "https://cloud.test/d/doc-token" }, 201)],
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([`/api/grids/documents/runs/${documentRunId}/links`]);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ expiresIn: "7d", comment: "Customer download" });
    expect(lines).toEqual(["https://cloud.test/d/doc-token"]);
  });

  test("creates, lists, and reads manual record snapshots", async () => {
    const {
      ctx: createCtx,
      calls: createCalls,
      lines: createLines,
    } = createContext(["snapshots", "create", baseId, "Authors", recordId], {}, [
      jsonResponse(base),
      jsonResponse([table]),
      jsonResponse({ snapshot: recordSnapshot }, 201),
    ]);

    await gridsCli.run(createCtx);

    expect(createCalls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/documents/snapshots/by-record/${tableId}/${recordId}`,
    ]);
    expect(createCalls[2]?.init?.method).toBe("POST");
    expect(createLines).toEqual([`Created snapshot ${snapshotId}.`]);

    const {
      ctx: listCtx,
      calls: listCalls,
      tables,
    } = createContext(["snapshots", "list", baseId, "Authors", recordId], {}, [
      jsonResponse(base),
      jsonResponse([table]),
      jsonResponse({ items: [recordSnapshot] }),
    ]);

    await gridsCli.run(listCtx);

    expect(listCalls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/tables/by-base/${baseId}`,
      `/api/grids/documents/snapshots/by-record/${tableId}/${recordId}`,
    ]);
    expect(tables[0]?.[0]).toMatchObject({ id: snapshotId, recordId, tableId });

    const {
      ctx: getCtx,
      calls: getCalls,
      jsonValues,
    } = createContext(["snapshots", "get", snapshotId], {}, [jsonResponse(recordSnapshot)], {
      output: "json",
    });

    await gridsCli.run(getCtx);

    expect(getCalls.map((call) => call.path)).toEqual([`/api/grids/documents/snapshots/${snapshotId}`]);
    expect(jsonValues).toEqual([recordSnapshot]);
  });

  test("rejects document template UUIDs outside the selected table", async () => {
    const wrongTableTemplate = { ...documentTemplate, tableId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    const { ctx } = createContext(["document-templates", "get", baseId, "Authors", documentTemplateId], {}, [
      jsonResponse(base),
      jsonResponse([table]),
      jsonResponse(wrongTableTemplate),
    ]);

    await expect(gridsCli.run(ctx)).rejects.toThrow("Document template does not belong to the selected table.");
  });

  test("creates workflow email templates", async () => {
    const { ctx, calls, lines } = createContext(
      ["email-templates", "create", baseId],
      { name: "Reminder", subject: "Reminder", html: "<p>Hello</p>" },
      [jsonResponse(base), jsonResponse(emailTemplate, 201)],
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([`/api/grids/bases/${baseId}`, `/api/grids/email-templates/by-base/${baseId}`]);
    expect(calls[1]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({ name: "Reminder", subject: "Reminder", html: "<p>Hello</p>" });
    expect(lines).toEqual(["Created email template Reminder (mail1)."]);
  });

  test("rejects email template UUIDs outside the selected base", async () => {
    const foreignTemplate = { ...emailTemplate, baseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    const { ctx } = createContext(["email-templates", "get", baseId, emailTemplateId], {}, [
      jsonResponse(base),
      jsonResponse(foreignTemplate),
    ]);

    await expect(gridsCli.run(ctx)).rejects.toThrow("Email template does not belong to the selected base.");
  });

  test("validates workflow YAML through the backend", async () => {
    const { ctx, calls, lines } = createContext(["workflows", "validate", baseId], { source: workflow.source }, [
      jsonResponse(base),
      jsonResponse({ ok: true, plan: workflow.plan }),
    ]);

    const exitCode = await gridsCli.run(ctx);

    expect(exitCode).toBe(0);
    expect(calls.map((call) => call.path)).toEqual([`/api/grids/bases/${baseId}`, `/api/grids/workflows/by-base/${baseId}/validate`]);
    expect(calls[1]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ source: workflow.source });
    expect(lines).toEqual(["Workflow YAML is valid."]);
  });

  test("uses -f as workflow YAML file for workflow create", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grids-cli-workflow-"));
    const sourceFile = join(dir, "workflow.yml");
    await writeFile(sourceFile, workflow.source);
    try {
      const { ctx, calls, lines } = createContext(["workflows", "create", baseId], { name: "Send reminder", f: sourceFile }, [
        jsonResponse(base),
        jsonResponse(workflow, 201),
      ]);

      await gridsCli.run(ctx);

      expect(calls.map((call) => call.path)).toEqual([`/api/grids/bases/${baseId}`, `/api/grids/workflows/by-base/${baseId}`]);
      expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({ name: "Send reminder", source: workflow.source });
      expect(lines).toEqual(["Created workflow Send reminder (wf001)."]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("sends the resolved workflow revision when updating", async () => {
    const updated = { ...workflow, name: "Updated reminder", revision: workflow.revision + 1 };
    const { ctx, calls, lines } = createContext(["workflows", "update", baseId, workflow.shortId], { name: updated.name }, [
      jsonResponse(base),
      jsonResponse([workflow]),
      jsonResponse(updated),
    ]);

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/workflows/by-base/${baseId}`,
      `/api/grids/workflows/${workflowId}`,
    ]);
    expect(new Headers(calls[2]?.init?.headers).get(WORKFLOW_REVISION_HEADER)).toBe(String(workflow.revision));
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ name: updated.name });
    expect(lines).toEqual(["Updated workflow Updated reminder (wf001)."]);
  });

  test("rejects workflow UUIDs outside the selected base", async () => {
    const foreignWorkflow = { ...workflow, baseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    const { ctx } = createContext(["workflows", "get", baseId, workflowId], {}, [jsonResponse(base), jsonResponse(foreignWorkflow)]);

    await expect(gridsCli.run(ctx)).rejects.toThrow("Workflow does not belong to the selected base.");
  });

  test("invokes workflows with JSON inputs", async () => {
    const { ctx, calls, lines } = createContext(
      ["workflows", "invoke", baseId, "Send reminder"],
      { inputs: JSON.stringify({ recordId }), "idempotency-key": "reminder-1" },
      [
        jsonResponse(base),
        jsonResponse([workflow]),
        jsonResponse({ runId, workflowId, revision: 1, mode: "execute", channel: "api", created: true, status: "queued" }),
      ],
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/workflows/by-base/${baseId}`,
      `/api/grids/workflows/${workflowId}/invoke/cli`,
    ]);
    expect(calls[2]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ mode: "execute", inputs: { recordId }, idempotencyKey: "reminder-1" });
    expect(lines).toEqual([`Created workflow run ${runId} (queued).`]);
  });

  test("manually invokes scheduled workflows through the same CLI endpoint", async () => {
    const scheduledWorkflow = {
      ...workflow,
      source: 'triggers:\n  schedule:\n    cron: "0 8 * * *"\nsteps:\n  - setVariable:\n      name: ok\n      value: true',
    };
    const { ctx, calls, lines } = createContext(
      ["workflows", "invoke", baseId, "Send reminder"],
      { "idempotency-key": "scheduled-manual-1" },
      [
        jsonResponse(base),
        jsonResponse([scheduledWorkflow]),
        jsonResponse({ runId, workflowId, revision: 1, mode: "execute", channel: "api", created: true, status: "queued" }),
      ],
    );

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      `/api/grids/bases/${baseId}`,
      `/api/grids/workflows/by-base/${baseId}`,
      `/api/grids/workflows/${workflowId}/invoke/cli`,
    ]);
    expect(calls[2]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ mode: "execute", inputs: {}, idempotencyKey: "scheduled-manual-1" });
    expect(lines).toEqual([`Created workflow run ${runId} (queued).`]);
  });

  test("lists workflow run steps", async () => {
    const step = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      runId,
      key: "steps.0",
      sourcePath: ["steps", 0],
      iterationPath: [],
      kind: "action",
      action: "setVariable",
      mode: "execute",
      status: "succeeded",
      outcome: { state: "completed", output: { ok: true } },
      executionGeneration: 1,
      startedAt: "2026-07-07T00:00:00.000Z",
      finishedAt: "2026-07-07T00:00:01.000Z",
    };
    const { ctx, calls, tables } = createContext(["workflow-runs", "steps", runId], {}, [jsonResponse({ items: [step] })]);

    await gridsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([`/api/grids/workflows/runs/${runId}/steps`]);
    expect(tables[0]).toEqual([
      {
        key: "steps.0",
        path: "steps.0",
        iteration: "",
        kind: "action",
        action: "setVariable",
        status: "succeeded",
        generation: 1,
        outcome: '{"state":"completed","output":{"ok":true}}',
      },
    ]);
  });

  test("requires confirmation before deleting workflow email templates", async () => {
    const { ctx } = createContext(["email-templates", "delete", baseId, "Reminder"], {}, []);

    await expect(gridsCli.run(ctx)).rejects.toThrow("Pass --yes to delete.");
  });
});
