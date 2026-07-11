import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext, PermissionLevel } from "@valentinkolb/cloud/server";
import { Hono, type MiddlewareHandler } from "hono";
import { generateSpecs } from "hono-openapi";

const baseId = "11111111-1111-4111-8111-111111111111";
const tableId = "22222222-2222-4222-8222-222222222222";
const templateId = "33333333-3333-4333-8333-333333333333";
const disabledTemplateId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";
const excludedRecordId = "66666666-6666-4666-8666-666666666666";
const lookupRecordId = "77777777-7777-4777-8777-777777777777";

const user: User = {
  id: userId,
  uid: "document-template-user",
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Document",
  sn: "Template",
  displayName: "Document Template",
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

const table = {
  id: tableId,
  shortId: "TBL01",
  baseId,
  name: "Hidden table",
  description: null,
  icon: null,
  columns: [],
  displayConfig: { mode: "table" as const },
  position: 0,
  disableDirectInsert: false,
  deletedAt: null,
  createdAt: "2026-07-11T08:00:00.000Z",
  updatedAt: "2026-07-11T08:00:00.000Z",
};

const template = {
  id: templateId,
  shortId: "DOC01",
  tableId,
  name: "Invoice",
  description: "Customer invoice",
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
const disabledTemplate = { ...template, id: disabledTemplateId, shortId: "DOC02", name: "Disabled", enabled: false, position: 1 };

const summary = (row: typeof template) => ({
  id: row.id,
  shortId: row.shortId,
  tableId: row.tableId,
  name: row.name,
  description: row.description,
  enabled: row.enabled,
  position: row.position,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const forbiddenResponse = {
  message: "You do not have permission to access this resource.",
  code: "FORBIDDEN",
};

let baseLevel: PermissionLevel = "admin";
let tableLevel: PermissionLevel = "read";
let templateLevel: PermissionLevel = "admin";
let currentTable: typeof table | null = table;
let currentTemplate: typeof template | null = template;
let tableGetInputs: string[] = [];
let templateGetInputs: string[] = [];
let listInputs: string[] = [];
let createInput: unknown;
let updateInput: unknown;
let removeInput: unknown;
let lookupInput: unknown;

mock.module("../service", () => ({
  gridsService: {
    table: {
      get: async (id: string) => {
        tableGetInputs.push(id);
        return id === tableId ? currentTable : null;
      },
    },
    document: {
      getTemplate: async (id: string) => {
        templateGetInputs.push(id);
        return id === templateId ? currentTemplate : null;
      },
      listTemplatesForTable: async (id: string) => {
        listInputs.push(id);
        return id === tableId ? [template, disabledTemplate] : [];
      },
      summarizeTemplate: summary,
      createTemplate: async (id: string, input: unknown, actorId: string | null) => {
        createInput = { tableId: id, input, actorId };
        return { ok: true, data: template };
      },
      updateTemplate: async (id: string, input: unknown, actorId: string | null) => {
        updateInput = { templateId: id, input, actorId };
        return { ok: true, data: { ...template, ...(input as object) } };
      },
      removeTemplate: async (id: string, actorId: string | null) => {
        removeInput = { templateId: id, actorId };
        return { ok: true, data: undefined };
      },
    },
    relations: {
      lookup: async (input: unknown) => {
        lookupInput = input;
        return { items: [{ id: lookupRecordId, label: "Invoice recipient" }] };
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
const jsonRequest = (method: "POST" | "PATCH", body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const createBody = {
  name: " Invoice ",
  description: "Customer invoice",
  source: ` from table {${tableId}} `,
  html: " <p>{{ record.id }}</p> ",
  enabled: true,
};
const updateBody = { name: " Updated invoice ", position: 2 };

const expectForbidden = async (response: Response) => {
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual(forbiddenResponse);
};

describe("document template routes", () => {
  beforeEach(() => {
    baseLevel = "admin";
    tableLevel = "read";
    templateLevel = "admin";
    currentTable = table;
    currentTemplate = template;
    tableGetInputs = [];
    templateGetInputs = [];
    listInputs = [];
    createInput = undefined;
    updateInput = undefined;
    removeInput = undefined;
    lookupInput = undefined;
  });

  test("publishes all template management operations in the generated OpenAPI spec", async () => {
    const spec = await generateSpecs(app());
    const paths = spec.paths as Record<string, Record<string, { summary?: string; responses?: Record<string, unknown> }>>;

    for (const [method, operationPath, routeSummary, statuses] of [
      ["get", "/documents/templates/by-table/{tableId}", "List document templates for a table", ["200", "403"]],
      ["get", "/documents/templates/by-table/{tableId}/full", "List full document templates for table admins", ["200", "403"]],
      ["post", "/documents/templates/by-table/{tableId}", "Create a document template", ["201", "403"]],
      ["get", "/documents/templates/{templateId}", "Get a document template", ["200", "403"]],
      ["patch", "/documents/templates/{templateId}", "Update a document template", ["200", "403"]],
      ["delete", "/documents/templates/{templateId}", "Delete a document template", ["204", "403"]],
      ["get", "/documents/templates/{templateId}/records/lookup", "Search records for a document template", ["200", "403"]],
    ] as const) {
      const operation = paths[operationPath]?.[method];
      expect(operation?.summary).toBe(routeSummary);
      expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([...statuses].sort());
    }
  });

  for (const [method, suffix, body] of [
    ["GET", `/templates/by-table/${tableId}`, undefined],
    ["GET", `/templates/by-table/${tableId}/full`, undefined],
    ["POST", `/templates/by-table/${tableId}`, createBody],
    ["GET", `/templates/${templateId}`, undefined],
    ["PATCH", `/templates/${templateId}`, updateBody],
    ["DELETE", `/templates/${templateId}`, undefined],
    ["GET", `/templates/${templateId}/records/lookup`, undefined],
  ] as const) {
    test(`parent auth protects ${method} ${suffix}`, async () => {
      const response = await deniedApp().request(
        path(suffix),
        body === undefined ? { method } : jsonRequest(method as "POST" | "PATCH", body),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ message: "Authentication required" });
    });
  }

  for (const [method, suffix, body] of [
    ["GET", `/templates/by-table/${tableId}`, undefined],
    ["GET", `/templates/by-table/${tableId}/full`, undefined],
    ["POST", `/templates/by-table/${tableId}`, createBody],
  ] as const) {
    test(`${method} ${suffix} returns the exact table 404 contract`, async () => {
      currentTable = null;
      const response = await app().request(path(suffix), body === undefined ? { method } : jsonRequest(method as "POST", body));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Table not found" });
    });
  }

  for (const [method, suffix, body] of [
    ["GET", `/templates/${templateId}`, undefined],
    ["PATCH", `/templates/${templateId}`, updateBody],
    ["DELETE", `/templates/${templateId}`, undefined],
    ["GET", `/templates/${templateId}/records/lookup`, undefined],
  ] as const) {
    test(`${method} ${suffix} returns the exact template 404 contract`, async () => {
      currentTemplate = null;
      const response = await app().request(path(suffix), body === undefined ? { method } : jsonRequest(method as "PATCH", body));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Document template not found" });
      expect(templateGetInputs).toEqual([templateId]);
    });
  }

  test("lists enabled template summaries through template-only read access", async () => {
    tableLevel = "none";
    templateLevel = "read";

    const response = await app().request(path(`/templates/by-table/${tableId}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([summary(template)]);
    expect(tableGetInputs).toEqual([tableId]);
    expect(listInputs).toEqual([tableId]);
  });

  test("forwards the requested minimum permission when listing summaries", async () => {
    tableLevel = "none";
    templateLevel = "read";

    await expectForbidden(await app().request(path(`/templates/by-table/${tableId}?min=write`)));
    expect(listInputs).toEqual([tableId]);
  });

  test("requires base admin and returns every full template", async () => {
    baseLevel = "write";
    templateLevel = "admin";
    await expectForbidden(await app().request(path(`/templates/by-table/${tableId}/full`)));

    baseLevel = "admin";
    const response = await app().request(path(`/templates/by-table/${tableId}/full`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([template, disabledTemplate]);
    expect(listInputs).toEqual([tableId]);
  });

  test("creates a template only with base admin and forwards input plus audit actor", async () => {
    baseLevel = "write";
    templateLevel = "admin";
    await expectForbidden(await app().request(path(`/templates/by-table/${tableId}`), jsonRequest("POST", createBody)));
    expect(createInput).toBeUndefined();

    baseLevel = "admin";
    const response = await app().request(path(`/templates/by-table/${tableId}`), jsonRequest("POST", createBody));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(template);
    expect(createInput).toEqual({
      tableId,
      input: {
        name: " Invoice ",
        description: "Customer invoice",
        source: `from table {${tableId}}`,
        html: "<p>{{ record.id }}</p>",
        enabled: true,
      },
      actorId: userId,
    });
  });

  test("gets a template with template admin access independent of table access", async () => {
    baseLevel = "none";
    tableLevel = "none";
    templateLevel = "read";
    await expectForbidden(await app().request(path(`/templates/${templateId}`)));

    templateLevel = "admin";
    const response = await app().request(path(`/templates/${templateId}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(template);
    expect(templateGetInputs).toEqual([templateId, templateId]);
    expect(tableGetInputs).toEqual([tableId, tableId]);
  });

  test("updates a template with template admin access and forwards input plus audit actor", async () => {
    templateLevel = "write";
    await expectForbidden(await app().request(path(`/templates/${templateId}`), jsonRequest("PATCH", updateBody)));
    expect(updateInput).toBeUndefined();

    templateLevel = "admin";
    const response = await app().request(path(`/templates/${templateId}`), jsonRequest("PATCH", updateBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...template, name: " Updated invoice ", position: 2 });
    expect(updateInput).toEqual({ templateId, input: updateBody, actorId: userId });
  });

  test("deletes a template with template admin access and forwards the audit actor", async () => {
    templateLevel = "write";
    await expectForbidden(await app().request(path(`/templates/${templateId}`), { method: "DELETE" }));
    expect(removeInput).toBeUndefined();

    templateLevel = "admin";
    const response = await app().request(path(`/templates/${templateId}`), { method: "DELETE" });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(removeInput).toEqual({ templateId, actorId: userId });
  });

  test("looks up records with template write access and forwards the normalized query", async () => {
    tableLevel = "none";
    templateLevel = "read";
    await expectForbidden(await app().request(path(`/templates/${templateId}/records/lookup?q=recipient`)));
    expect(lookupInput).toBeUndefined();

    templateLevel = "write";
    const response = await app().request(
      path(`/templates/${templateId}/records/lookup?q=recipient&limit=7&excludeIds=${excludedRecordId}`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{ id: lookupRecordId, label: "Invoice recipient" }] });
    expect(lookupInput).toEqual({ targetTableId: tableId, q: "recipient", limit: 7, excludeIds: [excludedRecordId] });
  });

  test("requires base admin to look up records through a disabled template", async () => {
    currentTemplate = disabledTemplate;
    templateLevel = "write";
    baseLevel = "write";

    await expectForbidden(await app().request(path(`/templates/${templateId}/records/lookup`)));
    expect(lookupInput).toBeUndefined();

    baseLevel = "admin";
    const response = await app().request(path(`/templates/${templateId}/records/lookup`));

    expect(response.status).toBe(200);
    expect(lookupInput).toEqual({ targetTableId: tableId, q: "", limit: 10, excludeIds: [] });
  });
});
