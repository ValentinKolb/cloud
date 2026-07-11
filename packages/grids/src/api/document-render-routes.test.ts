import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext, PermissionLevel } from "@valentinkolb/cloud/server";
import { Hono, type MiddlewareHandler } from "hono";
import { generateSpecs } from "hono-openapi";

const baseId = "11111111-1111-4111-8111-111111111111";
const tableId = "22222222-2222-4222-8222-222222222222";
const templateId = "33333333-3333-4333-8333-333333333333";
const recordId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";
const snapshotId = "66666666-6666-4666-8666-666666666666";
const runId = "77777777-7777-4777-8777-777777777777";

const user: User = {
  id: userId,
  uid: "document-render-user",
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Document",
  sn: "Render",
  displayName: "Document Render",
  mail: null,
  avatarHash: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: [],
  manages: [],
  managesGroupIds: [],
  ipa: null,
};

const table = { id: tableId, shortId: "TBL01", baseId, name: "Invoices" };
const template = {
  id: templateId,
  shortId: "DOC01",
  tableId,
  name: "Invoice July",
  description: null,
  source: `from table {${tableId}}`,
  html: "<p>{{ record.id }}</p>",
  headerHtml: null,
  footerHtml: null,
  pageCss: null,
  numberTemplate: "{{ template.shortId }}-{{ run.shortId }}",
  filenameTemplate: "{{ document.number }}.pdf",
  enabled: true,
  position: 0,
  createdBy: userId,
  updatedBy: userId,
  deletedAt: null,
  createdAt: "2026-07-11T08:00:00.000Z",
  updatedAt: "2026-07-11T08:00:00.000Z",
};
const disabledTemplate = { ...template, enabled: false };
const record = { id: recordId, values: { total: 42 } };
const liveData = { record, total: 42 };
const enrichedData = { ...liveData, document: { number: "draft" } };
const snapshot = {
  id: snapshotId,
  baseId,
  tableId,
  recordId,
  root: record,
  graph: {},
  createdBy: userId,
  createdAt: "2026-07-11T08:00:00.000Z",
};
const run = {
  id: runId,
  shortId: "RUN01",
  templateId,
  workflowRunId: null,
  snapshotId,
  baseId,
  tableId,
  recordId,
  documentNumber: "DOC-001",
  filename: "Invoice July.pdf",
  tags: ["finance"],
  templateSnapshot: template,
  renderData: { ...liveData, snapshot },
  generatedBy: userId,
  generatedAt: "2026-07-11T08:00:00.000Z",
};
const pdfBytes = new Uint8Array([37, 80, 68, 70]);
const dateConfig = { timeZone: "UTC", locale: "en", firstDayOfWeek: 1 };

const forbiddenResponse = {
  message: "You do not have permission to access this resource.",
  code: "FORBIDDEN",
};

let baseLevel: PermissionLevel = "admin";
let tableLevel: PermissionLevel = "admin";
let templateLevel: PermissionLevel = "admin";
let currentTable: typeof table | null = table;
let currentTemplate: typeof template | null = template;
let currentRecord: typeof record | null = record;
let liveResult:
  | { ok: true; data: { source: string; columns: unknown[]; rows: unknown[]; data: typeof liveData } }
  | {
      ok: false;
      error: { message: string; status: 400 | 404 | 500 };
    };
let metadataResult: { ok: true; data: { data: typeof enrichedData } } | { ok: false; error: { message: string; status: 400 | 500 } };
let htmlResult: { ok: true; data: string } | { ok: false; error: { message: string; status: 400 | 500 } };
let previewPdfResult:
  | { ok: true; pdf: { pdf: Uint8Array } }
  | { ok: false; error: { message: string; phase: "html" | "pdf"; code: string; status: 400 | 500 | 502 } };
let snapshotResult: { ok: true; data: typeof snapshot } | { ok: false; error: { message: string; status: 400 | 500 } };
let runResult: { ok: true; data: typeof run } | { ok: false; error: { message: string; status: 400 | 500 } };
let runPdfResult: { ok: true; data: { pdf: Uint8Array } } | { ok: false; error: { message: string; status: 400 | 500 | 502 } };
let permissionChecks: PermissionLevel[] = [];
let liveInputs: unknown[] = [];
let metadataInputs: unknown[] = [];
let htmlInputs: unknown[][] = [];
let previewPdfInputs: unknown[][] = [];
let snapshotInput: unknown;
let createRunInput: unknown;
let runPdfInput: unknown;
let callOrder: string[] = [];

mock.module("../service", () => ({
  gridsService: {
    table: {
      get: async (id: string) => (id === tableId ? currentTable : null),
    },
    record: {
      get: async (requestedTableId: string, requestedRecordId: string) =>
        requestedTableId === tableId && requestedRecordId === recordId ? currentRecord : null,
    },
    document: {
      getTemplate: async (id: string) => (id === templateId ? currentTemplate : null),
      buildTemplateAppData: async () => ({ name: "Grids" }),
      buildLiveRenderData: async (input: unknown) => {
        callOrder.push("live-data");
        liveInputs.push(input);
        return liveResult;
      },
      buildDocumentRunRenderData: async (input: unknown) => {
        callOrder.push("metadata");
        metadataInputs.push(input);
        return metadataResult;
      },
      renderHtml: async (...input: unknown[]) => {
        callOrder.push("html");
        htmlInputs.push(input);
        return htmlResult;
      },
      renderPdfPreview: async (...input: unknown[]) => {
        callOrder.push("preview-pdf");
        previewPdfInputs.push(input);
        return previewPdfResult;
      },
      createRecordSnapshot: async (input: unknown) => {
        callOrder.push("snapshot");
        snapshotInput = input;
        return snapshotResult;
      },
      createRun: async (input: unknown) => {
        callOrder.push("run");
        createRunInput = input;
        return runResult;
      },
      renderRunPdf: async (input: unknown) => {
        callOrder.push("run-pdf");
        runPdfInput = input;
        return runPdfResult;
      },
    },
    permission: {
      loadGrants: async () => [],
      resolve: (_grants: unknown, target: Record<string, unknown>) => {
        if ("documentTemplateId" in target) return templateLevel;
        if ("tableId" in target) return tableLevel;
        return baseLevel;
      },
      hasAtLeast: (actual: PermissionLevel, expected: PermissionLevel) => {
        permissionChecks.push(expected);
        const rank = { none: 0, read: 1, write: 2, admin: 3 };
        return rank[actual] >= rank[expected];
      },
    },
  },
}));

const { createDocumentsApi } = await import("./documents");

const authenticated: MiddlewareHandler<AuthContext> = async (c, next) => {
  c.set("actor", { kind: "user", user });
  c.set("accessSubject", { type: "user", userId: user.id });
  c.set("user", user);
  await next();
};
const denyAuthentication: MiddlewareHandler<AuthContext> = async (c) => c.json({ message: "Authentication required" }, 401);

const app = () => new Hono<AuthContext>().route("/documents", createDocumentsApi({ requireAuthenticated: authenticated }));
const deniedApp = () => new Hono<AuthContext>().route("/documents", createDocumentsApi({ requireAuthenticated: denyAuthentication }));
const path = (suffix: string) => `/documents${suffix}`;
const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const draftBody = {
  source: ` from table {${tableId}} `,
  html: " <p>Draft</p> ",
  headerHtml: " <header>Draft</header> ",
  recordId,
};
const recordBody = { recordId, filename: " Custom invoice.pdf ", tags: ["finance", "july"] };

const uuidOpenApiSchema = {
  type: "string",
  format: "uuid",
  pattern:
    "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
};
const draftRequestSchema = {
  type: "object",
  properties: {
    source: { type: "string", minLength: 1, maxLength: 20_000 },
    html: { type: "string", minLength: 1, maxLength: 200_000 },
    headerHtml: { anyOf: [{ type: "string", maxLength: 50_000 }, { type: "null" }] },
    footerHtml: { anyOf: [{ type: "string", maxLength: 50_000 }, { type: "null" }] },
    pageCss: { anyOf: [{ type: "string", maxLength: 50_000 }, { type: "null" }] },
    numberTemplate: { type: "string", minLength: 1, maxLength: 5_000 },
    filenameTemplate: { type: "string", minLength: 1, maxLength: 5_000 },
    recordId: uuidOpenApiSchema,
  },
  required: ["source", "html", "recordId"],
};
const recordRequestSchema = {
  type: "object",
  properties: {
    recordId: uuidOpenApiSchema,
    filename: { type: "string", minLength: 1, maxLength: 255 },
    tags: {
      default: [],
      maxItems: 20,
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 40 },
    },
  },
  required: ["recordId"],
};
const previewResponseSchema = {
  type: "object",
  properties: {
    html: { type: "string" },
    source: { type: "string" },
    data: { type: "object", propertyNames: { type: "string" }, additionalProperties: {} },
  },
  required: ["html", "source", "data"],
};
const errorResponseSchema = {
  type: "object",
  properties: { message: { type: "string" }, code: { type: "string" } },
  required: ["message"],
};
const jsonSchemaResponse = (description: string, schema: unknown) => ({
  description,
  content: { "application/json": { schema } },
});
const forbiddenOpenApiResponse = jsonSchemaResponse("Forbidden", errorResponseSchema);

const renderRoutes = [
  ["/templates/by-table/{tableId}/preview-draft", draftRequestSchema, { description: "Draft PDF preview" }],
  [
    "/templates/by-table/{tableId}/preview-data-draft",
    draftRequestSchema,
    jsonSchemaResponse("Draft document preview data", previewResponseSchema),
  ],
  ["/templates/{templateId}/preview-draft", draftRequestSchema, { description: "Draft PDF preview" }],
  [
    "/templates/{templateId}/preview-data-draft",
    draftRequestSchema,
    jsonSchemaResponse("Draft document preview data", previewResponseSchema),
  ],
  ["/templates/{templateId}/preview", recordRequestSchema, jsonSchemaResponse("Rendered HTML preview", previewResponseSchema)],
  ["/templates/{templateId}/preview-pdf", recordRequestSchema, { description: "PDF preview" }],
  ["/templates/{templateId}/generate", recordRequestSchema, { description: "Generated PDF" }],
] as const;

const requestRoutes = [
  [`/templates/by-table/${tableId}/preview-draft`, draftBody],
  [`/templates/by-table/${tableId}/preview-data-draft`, draftBody],
  [`/templates/${templateId}/preview-draft`, draftBody],
  [`/templates/${templateId}/preview-data-draft`, draftBody],
  [`/templates/${templateId}/preview`, recordBody],
  [`/templates/${templateId}/preview-pdf`, recordBody],
  [`/templates/${templateId}/generate`, recordBody],
] as const;

const expectForbidden = async (response: Response) => {
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual(forbiddenResponse);
};

const expectPdf = async (response: Response, disposition: string, extraHeaders: Record<string, string> = {}) => {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("content-disposition")).toBe(disposition);
  expect(response.headers.get("cache-control")).toBe("no-store");
  for (const [name, value] of Object.entries(extraHeaders)) expect(response.headers.get(name)).toBe(value);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdfBytes);
};

describe("document render routes", () => {
  beforeEach(() => {
    baseLevel = "admin";
    tableLevel = "admin";
    templateLevel = "admin";
    currentTable = table;
    currentTemplate = template;
    currentRecord = record;
    liveResult = { ok: true, data: { source: "compiled source", columns: [], rows: [record], data: liveData } };
    metadataResult = { ok: true, data: { data: enrichedData } };
    htmlResult = { ok: true, data: "<p>Rendered invoice</p>" };
    previewPdfResult = { ok: true, pdf: { pdf: pdfBytes } };
    snapshotResult = { ok: true, data: snapshot };
    runResult = { ok: true, data: run };
    runPdfResult = { ok: true, data: { pdf: pdfBytes } };
    permissionChecks = [];
    liveInputs = [];
    metadataInputs = [];
    htmlInputs = [];
    previewPdfInputs = [];
    snapshotInput = undefined;
    createRunInput = undefined;
    runPdfInput = undefined;
    callOrder = [];
  });

  test("publishes all render operations in the generated OpenAPI spec", async () => {
    const spec = await generateSpecs(app());
    const paths = spec.paths as Record<
      string,
      Record<string, { requestBody?: { content?: Record<string, { schema?: unknown }> }; responses?: Record<string, unknown> }>
    >;

    for (const [suffix, requestSchema, successResponse] of renderRoutes) {
      const operation = paths[`/documents${suffix}`]?.post;
      expect(operation?.requestBody?.content?.["application/json"]?.schema).toEqual(requestSchema);
      expect(operation?.responses?.["200"]).toEqual(successResponse);
      expect(operation?.responses?.["403"]).toEqual(forbiddenOpenApiResponse);
    }
  });

  for (const [suffix, body] of requestRoutes) {
    test(`parent auth protects POST ${suffix}`, async () => {
      const response = await deniedApp().request(path(suffix), postJson(body));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ message: "Authentication required" });
    });
  }

  for (const [suffix, body] of requestRoutes.slice(0, 2)) {
    test(`POST ${suffix} returns the exact table 404 contract`, async () => {
      currentTable = null;
      const response = await app().request(path(suffix), postJson(body));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Table not found", phase: "data" });
    });
  }

  for (const [suffix, body] of requestRoutes.slice(2)) {
    test(`POST ${suffix} returns the exact template 404 contract`, async () => {
      currentTemplate = null;
      const response = await app().request(path(suffix), postJson(body));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(
        suffix.endsWith("preview-draft") || suffix.endsWith("preview-data-draft")
          ? { message: "Document template not found", phase: "data" }
          : { message: "Document template not found" },
      );
    });
  }

  for (const [suffix, body] of requestRoutes.slice(0, 2)) {
    test(`POST ${suffix} requires base table admin`, async () => {
      tableLevel = "write";
      await expectForbidden(await app().request(path(suffix), postJson(body)));
    });
  }

  for (const [suffix, body] of requestRoutes.slice(2, 5)) {
    test(`POST ${suffix} requires saved template admin`, async () => {
      templateLevel = "write";
      await expectForbidden(await app().request(path(suffix), postJson(body)));
    });
  }

  test("saved PDF preview requires template write", async () => {
    templateLevel = "read";
    await expectForbidden(await app().request(path(`/templates/${templateId}/preview-pdf`), postJson(recordBody)));
  });

  test("generate requires template write", async () => {
    templateLevel = "read";
    await expectForbidden(await app().request(path(`/templates/${templateId}/generate`), postJson(recordBody)));
    expect(callOrder).toEqual([]);
  });

  test("renders a by-table draft PDF with base table admin and inline preview headers", async () => {
    const response = await app().request(path(`/templates/by-table/${tableId}/preview-draft`), postJson(draftBody));

    await expectPdf(response, `inline; filename="preview.pdf"; filename*=UTF-8''preview.pdf`);
    expect(callOrder).toEqual(["live-data", "metadata", "preview-pdf"]);
    expect(previewPdfInputs[0]).toEqual([
      {
        id: undefined,
        shortId: undefined,
        name: undefined,
        source: `from table {${tableId}}`,
        html: "<p>Draft</p>",
        headerHtml: "<header>Draft</header>",
        footerHtml: null,
        pageCss: null,
        numberTemplate: undefined,
        filenameTemplate: undefined,
      },
      enrichedData,
      "preview.html",
    ]);
  });

  test("renders by-table draft preview data with the live source and enriched data", async () => {
    const response = await app().request(path(`/templates/by-table/${tableId}/preview-data-draft`), postJson(draftBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ html: "<p>Rendered invoice</p>", source: "compiled source", data: enrichedData });
    expect(callOrder).toEqual(["live-data", "metadata", "html"]);
  });

  test("renders a saved-template draft PDF with template admin and saved metadata defaults", async () => {
    const response = await app().request(path(`/templates/${templateId}/preview-draft`), postJson(draftBody));

    await expectPdf(response, `inline; filename="preview.pdf"; filename*=UTF-8''preview.pdf`);
    expect(previewPdfInputs[0]).toEqual([
      expect.objectContaining({
        id: templateId,
        shortId: template.shortId,
        name: template.name,
        numberTemplate: template.numberTemplate,
        filenameTemplate: template.filenameTemplate,
      }),
      enrichedData,
      "preview.html",
    ]);
  });

  test("renders saved-template draft preview data with template admin", async () => {
    const response = await app().request(path(`/templates/${templateId}/preview-data-draft`), postJson(draftBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ html: "<p>Rendered invoice</p>", source: "compiled source", data: enrichedData });
    expect(htmlInputs[0]?.[0]).toEqual(
      expect.objectContaining({ id: templateId, source: `from table {${tableId}}`, html: "<p>Draft</p>" }),
    );
  });

  test("renders a saved HTML preview with live date data and template admin", async () => {
    const response = await app().request(path(`/templates/${templateId}/preview`), postJson(recordBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ html: "<p>Rendered invoice</p>", source: "compiled source", data: enrichedData });
    expect(liveInputs[0]).toEqual(expect.objectContaining({ template, table, record, dateConfig, generatedAt: expect.any(Date) }));
    expect(metadataInputs[0]).toEqual(
      expect.objectContaining({ template, renderData: liveData, dateConfig, generatedAt: expect.any(Date) }),
    );
  });

  test("renders a saved PDF preview with template write and exact inline headers", async () => {
    templateLevel = "write";
    const response = await app().request(path(`/templates/${templateId}/preview-pdf`), postJson(recordBody));

    await expectPdf(response, `inline; filename="Invoice July.pdf"; filename*=UTF-8''Invoice%20July.pdf`);
    expect(previewPdfInputs[0]).toEqual([template, enrichedData, "DOC01-preview.html"]);
  });

  test("requires base admin for a disabled saved PDF preview after template write", async () => {
    currentTemplate = disabledTemplate;
    templateLevel = "write";
    baseLevel = "write";

    await expectForbidden(await app().request(path(`/templates/${templateId}/preview-pdf`), postJson(recordBody)));
    expect(callOrder).toEqual([]);

    baseLevel = "admin";
    const response = await app().request(path(`/templates/${templateId}/preview-pdf`), postJson(recordBody));
    expect(response.status).toBe(200);
  });

  test("rejects disabled generation with 400 before permissions or side effects", async () => {
    currentTemplate = disabledTemplate;
    templateLevel = "none";
    const response = await app().request(path(`/templates/${templateId}/generate`), postJson(recordBody));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Document template is disabled" });
    expect(permissionChecks).toEqual([]);
    expect(callOrder).toEqual([]);
  });

  test("generates in live-data, snapshot, run, PDF order with actor inputs and exact download headers", async () => {
    templateLevel = "write";
    const response = await app().request(path(`/templates/${templateId}/generate`), postJson(recordBody));

    await expectPdf(response, `attachment; filename="Invoice July.pdf"; filename*=UTF-8''Invoice%20July.pdf`, {
      "x-grids-document-run-id": runId,
      "x-grids-document-number": run.documentNumber,
      "x-grids-document-filename": "Invoice%20July.pdf",
    });
    expect(callOrder).toEqual(["live-data", "snapshot", "run", "run-pdf"]);
    expect(snapshotInput).toEqual({ baseId, tableId, recordId, actorId: userId, dateConfig });
    expect(createRunInput).toEqual({
      template,
      snapshot,
      renderData: { ...liveData, snapshot },
      actorId: userId,
      generatedAt: expect.any(Date),
      dateConfig,
      filename: "Custom invoice.pdf",
      tags: ["finance", "july"],
    });
    expect(runPdfInput).toBe(run);
  });

  for (const [suffix, body, failureStatus, expectedStatus, expectedBody] of [
    [`/templates/by-table/${tableId}/preview-draft`, draftBody, 400, 400, { message: "Live render data failed", phase: "source" }],
    [`/templates/by-table/${tableId}/preview-data-draft`, draftBody, 400, 400, { message: "Live render data failed", phase: "source" }],
    [`/templates/${templateId}/preview-draft`, draftBody, 400, 400, { message: "Live render data failed", phase: "source" }],
    [`/templates/${templateId}/preview-data-draft`, draftBody, 400, 400, { message: "Live render data failed", phase: "source" }],
    [`/templates/${templateId}/preview`, recordBody, 500, 500, { message: "Live render data failed" }],
    [`/templates/${templateId}/preview-pdf`, recordBody, 500, 500, { message: "Live render data failed" }],
    [`/templates/${templateId}/generate`, recordBody, 500, 500, { message: "Live render data failed" }],
  ] as const) {
    test(`POST ${suffix} stops after a liveRenderData failure`, async () => {
      liveResult = { ok: false, error: { message: "Live render data failed", status: failureStatus } };

      const response = await app().request(path(suffix), postJson(body));

      expect(response.status).toBe(expectedStatus);
      expect(await response.json()).toEqual(expectedBody);
      expect(callOrder).toEqual(["live-data"]);
    });
  }

  for (const [suffix, body] of [
    [`/templates/by-table/${tableId}/preview-draft`, draftBody],
    [`/templates/by-table/${tableId}/preview-data-draft`, draftBody],
    [`/templates/${templateId}/preview-draft`, draftBody],
    [`/templates/${templateId}/preview-data-draft`, draftBody],
    [`/templates/${templateId}/preview`, recordBody],
    [`/templates/${templateId}/preview-pdf`, recordBody],
  ] as const) {
    test(`POST ${suffix} stops after an addDraftDocumentMetadata failure`, async () => {
      metadataResult = { ok: false, error: { message: "Document metadata failed", status: 500 } };

      const response = await app().request(path(suffix), postJson(body));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ message: "Document metadata failed", phase: "document" });
      expect(callOrder).toEqual(["live-data", "metadata"]);
    });
  }

  test("generate stops after a snapshot failure", async () => {
    snapshotResult = { ok: false, error: { message: "Snapshot failed", status: 500 } };

    const response = await app().request(path(`/templates/${templateId}/generate`), postJson(recordBody));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Snapshot failed" });
    expect(callOrder).toEqual(["live-data", "snapshot"]);
  });

  test("generate stops after a createRun failure", async () => {
    runResult = { ok: false, error: { message: "Run creation failed", status: 500 } };

    const response = await app().request(path(`/templates/${templateId}/generate`), postJson(recordBody));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Run creation failed" });
    expect(callOrder).toEqual(["live-data", "snapshot", "run"]);
  });

  for (const [suffix, body, status, expectedBody] of [
    [`/templates/by-table/${tableId}/preview-data-draft`, draftBody, 400, { message: "HTML render failed", phase: "html" }],
    [`/templates/${templateId}/preview-data-draft`, draftBody, 500, { message: "HTML render failed", phase: "html" }],
    [`/templates/${templateId}/preview`, recordBody, 500, { message: "HTML render failed" }],
  ] as const) {
    test(`POST ${suffix} returns the exact HTML render failure`, async () => {
      htmlResult = { ok: false, error: { message: "HTML render failed", status } };

      const response = await app().request(path(suffix), postJson(body));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(expectedBody);
      expect(callOrder).toEqual(["live-data", "metadata", "html"]);
    });
  }

  for (const [suffix, body] of [
    [`/templates/by-table/${tableId}/preview-draft`, draftBody],
    [`/templates/${templateId}/preview-draft`, draftBody],
    [`/templates/${templateId}/preview-pdf`, recordBody],
  ] as const) {
    for (const [serviceStatus, expectedStatus] of [
      [400, 400],
      [502, 502],
      [500, 500],
    ] as const) {
      test(`POST ${suffix} maps PDF status ${serviceStatus} to ${expectedStatus}`, async () => {
        previewPdfResult = {
          ok: false,
          error: { message: "PDF render failed", phase: "pdf", code: "PDF_FAILED", status: serviceStatus },
        };

        const response = await app().request(path(suffix), postJson(body));

        expect(response.status).toBe(expectedStatus);
        expect(await response.json()).toEqual({ message: "PDF render failed", phase: "pdf", code: "PDF_FAILED" });
        expect(callOrder).toEqual(["live-data", "metadata", "preview-pdf"]);
      });
    }
  }

  for (const status of [400, 502, 500] as const) {
    test(`generate preserves run PDF status ${status} and stops`, async () => {
      runPdfResult = { ok: false, error: { message: "Stored PDF render failed", status } };

      const response = await app().request(path(`/templates/${templateId}/generate`), postJson(recordBody));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ message: "Stored PDF render failed" });
      expect(callOrder).toEqual(["live-data", "snapshot", "run", "run-pdf"]);
    });
  }
});
