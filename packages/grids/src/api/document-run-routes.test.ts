import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext, PermissionLevel } from "@valentinkolb/cloud/server";
import { Hono, type MiddlewareHandler } from "hono";
import { generateSpecs } from "hono-openapi";

const baseId = "11111111-1111-4111-8111-111111111111";
const tableId = "22222222-2222-4222-8222-222222222222";
const templateId = "33333333-3333-4333-8333-333333333333";
const otherTemplateId = "44444444-4444-4444-8444-444444444444";
const recordId = "55555555-5555-4555-8555-555555555555";
const runId = "66666666-6666-4666-8666-666666666666";
const snapshotId = "77777777-7777-4777-8777-777777777777";
const userId = "88888888-8888-4888-8888-888888888888";

const user: User = {
  id: userId,
  uid: "document-run-user",
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Document",
  sn: "Run",
  displayName: "Document Run",
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

const table = { id: tableId, baseId };
const template = { id: templateId, tableId };
type RunFixture = {
  id: string;
  shortId: string;
  templateId: string | null;
  workflowRunId: string | null;
  snapshotId: string;
  baseId: string;
  tableId: string;
  recordId: string;
  documentNumber: string;
  filename: string;
  tags: string[];
  templateSnapshot: { html: string };
  renderData: { snapshot: { root: { id: string } } };
  generatedBy: string;
  generatedAt: string;
};

const run: RunFixture = {
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
  templateSnapshot: { html: "<p>Stored</p>" },
  renderData: { snapshot: { root: { id: recordId } } },
  generatedBy: userId,
  generatedAt: "2026-07-11T08:00:00.000Z",
};
const otherTemplateRun: RunFixture = { ...run, id: "99999999-9999-4999-8999-999999999999", templateId: otherTemplateId };

const summarizeRun = (row: RunFixture) => ({
  id: row.id,
  shortId: row.shortId,
  templateId: row.templateId,
  workflowRunId: row.workflowRunId,
  snapshotId: row.snapshotId,
  baseId: row.baseId,
  tableId: row.tableId,
  recordId: row.recordId,
  documentNumber: row.documentNumber,
  filename: row.filename,
  tags: row.tags,
  generatedBy: row.generatedBy,
  generatedAt: row.generatedAt,
});

const forbiddenResponse = {
  message: "You do not have permission to access this resource.",
  code: "FORBIDDEN",
};

let templateLevel: PermissionLevel = "read";
let tableLevel: PermissionLevel = "read";
let currentTemplate: typeof template | null = template;
let currentTable: typeof table | null = table;
let currentRun: RunFixture | null = run;
let listTemplateInput: unknown;
let browseTemplateInput: unknown;
let updateInput: unknown;
let renderedRun: unknown;
let renderRunResult: { ok: true; data: { pdf: Uint8Array } } | { ok: false; error: { message: string; status: 400 | 500 | 502 } };

mock.module("../service", () => ({
  gridsService: {
    table: {
      get: async (id: string) => (id === tableId ? currentTable : null),
    },
    document: {
      getTemplate: async (id: string) => (id === templateId ? currentTemplate : null),
      listRunsForTemplate: async (input: unknown) => {
        listTemplateInput = input;
        return {
          items: [run],
          total: 3,
          limit: 2,
          offset: 1,
          hasMore: true,
          nextOffset: 3,
          nextCursor: "next-list-cursor",
        };
      },
      browseRunsForTemplate: async (input: unknown) => {
        browseTemplateInput = input;
        return {
          path: ["2026", "07"],
          folders: [{ kind: "month", key: "08", label: "August", path: ["2026", "08"], count: 2 }],
          items: [run],
          total: 3,
          limit: 2,
          hasMore: true,
          nextCursor: "next-browse-cursor",
        };
      },
      listRunsForRecord: async () => [run, otherTemplateRun],
      getRun: async (id: string) => (id === runId ? currentRun : null),
      updateRunMetadata: async (id: string, input: unknown) => {
        updateInput = { id, input };
        return { ok: true, data: { ...run, ...(input as object) } };
      },
      renderRunPdf: async (input: unknown) => {
        renderedRun = input;
        return renderRunResult;
      },
      summarizeRun,
    },
    permission: {
      loadGrants: async () => [],
      resolve: (_grants: unknown, target: Record<string, unknown>) => ("documentTemplateId" in target ? templateLevel : tableLevel),
      hasAtLeast: (actual: PermissionLevel, expected: PermissionLevel) => {
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

const app = () => new Hono<AuthContext>().route("/documents", createDocumentsApi({ requireAuthenticated: authenticated }));
const denyAuthentication: MiddlewareHandler<AuthContext> = async (c) => c.json({ message: "Authentication required" }, 401);
const deniedApp = () => new Hono<AuthContext>().route("/documents", createDocumentsApi({ requireAuthenticated: denyAuthentication }));
const path = (suffix: string) => `/documents${suffix}`;
const patchJson = (body: unknown): RequestInit => ({
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const expectForbidden = async (response: Response) => {
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual(forbiddenResponse);
};

describe("document run routes", () => {
  beforeEach(() => {
    templateLevel = "read";
    tableLevel = "read";
    currentTemplate = template;
    currentTable = table;
    currentRun = run;
    listTemplateInput = undefined;
    browseTemplateInput = undefined;
    updateInput = undefined;
    renderedRun = undefined;
    renderRunResult = { ok: true, data: { pdf: new Uint8Array([37, 80, 68, 70]) } };
  });

  test("publishes every run operation in the generated OpenAPI spec", async () => {
    const spec = await generateSpecs(app());
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    for (const [method, operationPath] of [
      ["get", "/documents/runs/by-template/{templateId}"],
      ["get", "/documents/runs/by-template/{templateId}/browse"],
      ["get", "/documents/runs/by-template/{templateId}/{recordId}"],
      ["get", "/documents/runs/by-record/{tableId}/{recordId}"],
      ["patch", "/documents/runs/{runId}"],
      ["get", "/documents/runs/{runId}/download"],
    ] as const) {
      expect(paths[operationPath]?.[method]).toBeDefined();
    }
  });

  for (const [method, suffix] of [
    ["GET", `/runs/by-template/${templateId}`],
    ["GET", `/runs/by-template/${templateId}/browse`],
    ["GET", `/runs/by-template/${templateId}/${recordId}`],
    ["GET", `/runs/by-record/${tableId}/${recordId}`],
    ["PATCH", `/runs/${runId}`],
    ["GET", `/runs/${runId}/download`],
  ] as const) {
    test(`parent auth protects ${method} ${suffix}`, async () => {
      const response = await deniedApp().request(path(suffix), { method });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ message: "Authentication required" });
    });
  }

  describe("GET /runs/by-template/:templateId", () => {
    test("returns the exact 404 contract", async () => {
      currentTemplate = null;
      const response = await app().request(path(`/runs/by-template/${templateId}`));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Document template not found" });
    });

    test("requires template read permission", async () => {
      templateLevel = "none";
      await expectForbidden(await app().request(path(`/runs/by-template/${templateId}`)));
    });

    test("forwards pagination and maps summaries", async () => {
      const response = await app().request(
        path(`/runs/by-template/${templateId}?q=invoice&tags=finance%2Cpaid&limit=2&offset=1&cursor=list-cursor`),
      );

      expect(response.status).toBe(200);
      expect(listTemplateInput).toEqual({
        templateId,
        q: "invoice",
        tags: ["finance", "paid"],
        limit: 2,
        offset: 1,
        cursor: "list-cursor",
      });
      expect(await response.json()).toEqual({
        items: [summarizeRun(run)],
        total: 3,
        limit: 2,
        offset: 1,
        hasMore: true,
        nextOffset: 3,
        nextCursor: "next-list-cursor",
      });
    });

    test("forwards stable list defaults", async () => {
      const response = await app().request(path(`/runs/by-template/${templateId}`));

      expect(response.status).toBe(200);
      expect(listTemplateInput).toEqual({
        templateId,
        q: "",
        tags: [],
        limit: 200,
        offset: 0,
        cursor: null,
      });
    });
  });

  describe("GET /runs/by-template/:templateId/browse", () => {
    test("returns the exact 404 contract", async () => {
      currentTemplate = null;
      const response = await app().request(path(`/runs/by-template/${templateId}/browse`));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Document template not found" });
    });

    test("requires template read permission", async () => {
      templateLevel = "none";
      await expectForbidden(await app().request(path(`/runs/by-template/${templateId}/browse`)));
    });

    test("keeps the specific route ahead of the record route and forwards browse query", async () => {
      const response = await app().request(
        path(
          `/runs/by-template/${templateId}/browse?q=invoice&tags=finance%2Cpaid&limit=2&cursor=browse-cursor&path=2026%2F07&mode=folders`,
        ),
        { headers: { cookie: "cloud.timezone=Europe%2FBerlin" } },
      );

      expect(response.status).toBe(200);
      expect(browseTemplateInput).toEqual({
        templateId,
        q: "invoice",
        tags: ["finance", "paid"],
        limit: 2,
        cursor: "browse-cursor",
        path: ["2026", "07"],
        mode: "folders",
        timeZone: "Europe/Berlin",
      });
      expect(await response.json()).toEqual({
        path: ["2026", "07"],
        folders: [{ kind: "month", key: "08", label: "August", path: ["2026", "08"], count: 2 }],
        items: [summarizeRun(run)],
        total: 3,
        limit: 2,
        hasMore: true,
        nextCursor: "next-browse-cursor",
      });
    });

    test("forwards stable browse defaults", async () => {
      const response = await app().request(path(`/runs/by-template/${templateId}/browse`));

      expect(response.status).toBe(200);
      expect(browseTemplateInput).toEqual({
        templateId,
        q: "",
        tags: [],
        limit: 200,
        cursor: null,
        path: [],
        mode: "list",
        timeZone: "UTC",
      });
    });
  });

  describe("GET /runs/by-template/:templateId/:recordId", () => {
    test("returns the exact 404 contract", async () => {
      const response = await app().request(path(`/runs/by-template/${templateId}/not-a-record-id`));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Record not found" });
    });

    test("requires template read permission", async () => {
      templateLevel = "none";
      await expectForbidden(await app().request(path(`/runs/by-template/${templateId}/${recordId}`)));
    });

    test("returns only summaries for the selected template", async () => {
      const response = await app().request(path(`/runs/by-template/${templateId}/${recordId}`));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ items: [summarizeRun(run)] });
    });
  });

  describe("GET /runs/by-record/:tableId/:recordId", () => {
    test("returns the exact 404 contract", async () => {
      currentTable = null;
      const response = await app().request(path(`/runs/by-record/${tableId}/${recordId}`));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Table not found" });
    });

    test("requires table read permission", async () => {
      tableLevel = "none";
      await expectForbidden(await app().request(path(`/runs/by-record/${tableId}/${recordId}`)));
    });

    test("returns all run summaries for the record", async () => {
      const response = await app().request(path(`/runs/by-record/${tableId}/${recordId}`));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ items: [summarizeRun(run), summarizeRun(otherTemplateRun)] });
    });
  });

  describe("PATCH /runs/:runId", () => {
    test("returns the exact 404 contract", async () => {
      currentRun = null;
      const response = await app().request(path(`/runs/${runId}`), patchJson({ tags: [] }));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Document run not found" });
    });

    test("requires template write permission", async () => {
      templateLevel = "read";
      await expectForbidden(await app().request(path(`/runs/${runId}`), patchJson({ tags: ["paid"] })));
      expect(updateInput).toBeUndefined();
    });

    test("updates metadata and returns the mapped summary", async () => {
      templateLevel = "write";
      const response = await app().request(path(`/runs/${runId}`), patchJson({ filename: " Updated.pdf ", tags: ["paid"] }));

      expect(response.status).toBe(200);
      expect(updateInput).toEqual({ id: runId, input: { filename: "Updated.pdf", tags: ["paid"] } });
      expect(await response.json()).toEqual(summarizeRun({ ...run, filename: "Updated.pdf", tags: ["paid"] }));
    });

    test("uses table write permission for a template-less run", async () => {
      currentRun = { ...run, templateId: null };
      tableLevel = "read";
      await expectForbidden(await app().request(path(`/runs/${runId}`), patchJson({ tags: ["paid"] })));
      expect(updateInput).toBeUndefined();

      tableLevel = "write";
      const response = await app().request(path(`/runs/${runId}`), patchJson({ tags: ["paid"] }));
      expect(response.status).toBe(200);
      expect(updateInput).toEqual({ id: runId, input: { tags: ["paid"] } });
    });
  });

  describe("GET /runs/:runId/download", () => {
    test("returns the exact 404 contract", async () => {
      currentRun = null;
      const response = await app().request(path(`/runs/${runId}/download`));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Document run not found" });
    });

    test("requires template read permission", async () => {
      templateLevel = "none";
      await expectForbidden(await app().request(path(`/runs/${runId}/download`)));
      expect(renderedRun).toBeUndefined();
    });

    test("renders the stored run and returns PDF headers", async () => {
      const response = await app().request(path(`/runs/${runId}/download`));

      expect(response.status).toBe(200);
      expect(renderedRun).toBe(run);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toBe(
        `attachment; filename="Invoice July.pdf"; filename*=UTF-8''Invoice%20July.pdf`,
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-grids-document-run-id")).toBe(runId);
      expect(response.headers.get("x-grids-document-number")).toBe("DOC-001");
      expect(response.headers.get("x-grids-document-filename")).toBe("Invoice%20July.pdf");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    });

    test("uses table read permission for a template-less run", async () => {
      const tableRun = { ...run, templateId: null };
      currentRun = tableRun;
      tableLevel = "none";
      await expectForbidden(await app().request(path(`/runs/${runId}/download`)));
      expect(renderedRun).toBeUndefined();

      tableLevel = "read";
      const response = await app().request(path(`/runs/${runId}/download`));
      expect(response.status).toBe(200);
      expect(renderedRun).toBe(tableRun);
    });

    test("forwards PDF render failures without download headers", async () => {
      renderRunResult = { ok: false, error: { message: "Gotenberg unavailable", status: 502 } };

      const response = await app().request(path(`/runs/${runId}/download`));

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ message: "Gotenberg unavailable" });
      expect(response.headers.get("content-disposition")).toBeNull();
      expect(response.headers.get("x-grids-document-run-id")).toBeNull();
    });
  });
});
