import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import type { MiddlewareHandler } from "hono";
import { gridsService } from "../service";
import { createDocumentsApi } from "./documents";
import { permissionedWorkflowCatalog } from "./workflows";

const baseId = "11111111-1111-4111-8111-111111111111";
const tableId = "22222222-2222-4222-8222-222222222222";
const templateId = "33333333-3333-4333-8333-333333333333";
const fieldId = "44444444-4444-4444-8444-444444444444";
const recordId = "66666666-6666-4666-8666-666666666666";
const snapshotId = "77777777-7777-4777-8777-777777777777";

const user: User = {
  id: "55555555-5555-4555-8555-555555555555",
  uid: "template-only",
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Template",
  sn: "Only",
  displayName: "Template Only",
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
  kind: "stored" as const,
  name: "Hidden table",
  description: null,
  icon: null,
  columns: [],
  displayConfig: { mode: "table" as const },
  auditPolicy: {},
  position: 0,
  disableDirectInsert: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const template = {
  id: templateId,
  shortId: "LBL01",
  tableId,
  name: "Shipping label",
  description: "Printable label",
  source: `from table {${tableId}}`,
  html: "<p>{{ record.id }}</p>",
  headerHtml: null,
  footerHtml: null,
  pageCss: null,
  numberTemplate: "{{ template.shortId }}-{{ run.shortId }}",
  filenameTemplate: "{{ document.number }}.pdf",
  enabled: true,
  position: 0,
  createdBy: user.id,
  updatedBy: user.id,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const field = {
  id: fieldId,
  shortId: "FIELD",
  tableId,
  name: "Secret field",
  description: null,
  icon: null,
  type: "text",
  config: {},
  position: 0,
  required: false,
  presentable: false,
  hideInTable: false,
  defaultValue: null,
  indexed: false,
  uniqueConstraint: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const relationField = {
  ...field,
  id: "88888888-8888-4888-8888-888888888888",
  shortId: "REL01",
  name: "Related record",
  type: "relation",
  config: { targetTableId: tableId, cardinality: "single" },
};

let baseLevel: "none" | "read" = "read";
let fieldListCalls = 0;
let snapshotListCalls = 0;
let snapshotCreateCalls = 0;
let snapshotCreateInput: unknown;
let snapshotGetCalls = 0;
let snapshotFilterInput: unknown;

const snapshot = {
  id: snapshotId,
  baseId,
  tableId,
  recordId,
  root: { id: recordId },
  graph: {},
  createdBy: user.id,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const forbiddenResponse = {
  message: "You do not have permission to access this resource.",
  code: "FORBIDDEN",
};

const authenticated: MiddlewareHandler<AuthContext> = async (c, next) => {
  c.set("actor", { kind: "user", user });
  c.set("accessSubject", { type: "user", userId: user.id });
  c.set("user", user);
  await next();
};

const context = {
  get: (key: string) => {
    if (key === "actor") return { kind: "user", user };
    if (key === "accessSubject") return { type: "user", userId: user.id };
    return undefined;
  },
};

describe("document template permission surfaces", () => {
  beforeEach(() => {
    baseLevel = "read";
    fieldListCalls = 0;
    snapshotListCalls = 0;
    snapshotCreateCalls = 0;
    snapshotCreateInput = undefined;
    snapshotGetCalls = 0;
    snapshotFilterInput = undefined;

    spyOn(gridsService.table, "get").mockImplementation(async (id) => (id === tableId ? table : null) as never);
    spyOn(gridsService.record, "get").mockImplementation(async (requestedTableId, requestedRecordId) =>
      requestedTableId === tableId && requestedRecordId === recordId ? ({ id: recordId } as never) : null,
    );
    spyOn(gridsService.table, "listByBase").mockImplementation(async (id) => (id === baseId ? [table] : []) as never);
    spyOn(gridsService.field, "listByTable").mockImplementation(async () => {
      fieldListCalls += 1;
      return [field] as never;
    });
    spyOn(gridsService.document, "listTemplatesForTable").mockImplementation(async (id) => (id === tableId ? [template] : []) as never);
    spyOn(gridsService.document, "listSnapshotsForRecord").mockImplementation(async () => {
      snapshotListCalls += 1;
      return [snapshot] as never;
    });
    spyOn(gridsService.document, "createRecordSnapshot").mockImplementation(async (input) => {
      snapshotCreateCalls += 1;
      snapshotCreateInput = input;
      return { ok: true, data: snapshot } as never;
    });
    spyOn(gridsService.document, "getSnapshot").mockImplementation(async (id) => {
      snapshotGetCalls += 1;
      return (id === snapshotId ? snapshot : null) as never;
    });
    spyOn(gridsService.document, "filterSnapshotRelatedRecords").mockImplementation(async (input, resolveRecordAccess) => {
      snapshotFilterInput = { input, resolveRecordAccess };
      return input as never;
    });
    spyOn(gridsService.document, "summarizeTemplate").mockImplementation(((row: typeof template) => ({
      id: row.id,
      shortId: row.shortId,
      tableId: row.tableId,
      name: row.name,
      description: row.description,
      enabled: row.enabled,
      position: row.position,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })) as never);
    spyOn(gridsService.emailTemplate, "listForBase").mockImplementation(async () => []);
    spyOn(gridsService.permission, "loadBaseGrantsForSubject").mockImplementation(async () => []);
    spyOn(gridsService.permission, "resolve").mockImplementation(() => baseLevel);
  });

  afterEach(() => mock.restore());

  test("lists document templates with base read access", async () => {
    const app = createDocumentsApi({ requireAuthenticated: authenticated });

    const response = await app.request(`/templates/by-table/${tableId}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([
      {
        id: template.id,
        shortId: template.shortId,
        tableId: template.tableId,
        name: template.name,
        description: template.description,
        enabled: template.enabled,
        position: template.position,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      },
    ]);
  });

  test("keeps workflow autocomplete complete for a readable base", async () => {
    const catalog = await permissionedWorkflowCatalog(context as never, baseId, {
      listTablesByBase: async (id) => (id === baseId ? [table] : []),
      listTemplatesForTable: async (id) => (id === tableId ? [template] : []),
      listFieldsByTable: async () => {
        fieldListCalls += 1;
        return [field, relationField];
      },
      listEmailTemplatesForBase: async () => [],
    });

    expect([...catalog.tables.refs.values()].map((entry) => entry.name)).toContain(table.name);
    expect([...catalog.templates.refs.values()].map((entry) => entry.name)).toContain(template.name);
    expect(catalog.fieldsByTable.has(tableId)).toBe(true);
    expect(catalog.fieldsByTable.get(tableId)?.refs.get(relationField.name)?.relation).toEqual({
      targetTableId: tableId,
      cardinality: "single",
    });
    expect(fieldListCalls).toBe(1);
  });

  test("denies template listing without base read access", async () => {
    baseLevel = "none";
    const app = createDocumentsApi({ requireAuthenticated: authenticated });

    const response = await app.request(`/templates/by-table/${tableId}`);

    expect(response.status).toBe(403);
  });

  test("requires base read access to list standalone snapshots", async () => {
    baseLevel = "none";
    const app = createDocumentsApi({ requireAuthenticated: authenticated });

    const response = await app.request(`/snapshots/by-record/${tableId}/${recordId}`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(forbiddenResponse);
    expect(snapshotListCalls).toBe(0);
  });

  for (const method of ["GET", "POST"] as const) {
    test(`${method} snapshot by-record returns 404 for an invalid record id`, async () => {
      const app = createDocumentsApi({ requireAuthenticated: authenticated });

      const response = await app.request(`/snapshots/by-record/${tableId}/not-a-record-id`, { method });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Record not found" });
      expect(snapshotListCalls).toBe(0);
      expect(snapshotCreateCalls).toBe(0);
    });

    test(`${method} snapshot by-record returns 404 for an unknown table`, async () => {
      const app = createDocumentsApi({ requireAuthenticated: authenticated });
      const unknownTableId = "99999999-9999-4999-8999-999999999999";

      const response = await app.request(`/snapshots/by-record/${unknownTableId}/${recordId}`, { method });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Table not found" });
      expect(snapshotListCalls).toBe(0);
      expect(snapshotCreateCalls).toBe(0);
    });
  }

  test("lists standalone snapshots with base read access", async () => {
    const app = createDocumentsApi({ requireAuthenticated: authenticated });

    const response = await app.request(`/snapshots/by-record/${tableId}/${recordId}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [snapshot] });
    expect(snapshotListCalls).toBe(1);
  });

  test("requires base read access to create standalone snapshots", async () => {
    baseLevel = "none";
    const app = createDocumentsApi({ requireAuthenticated: authenticated });

    const response = await app.request(`/snapshots/by-record/${tableId}/${recordId}`, { method: "POST" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(forbiddenResponse);
    expect(snapshotCreateCalls).toBe(0);
  });

  test("creates standalone snapshots with base read access", async () => {
    const app = createDocumentsApi({ requireAuthenticated: authenticated });

    const response = await app.request(`/snapshots/by-record/${tableId}/${recordId}`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ snapshot });
    expect(snapshotCreateCalls).toBe(1);
    const { resolveRecordAccess, viewer, ...snapshotParams } = snapshotCreateInput as {
      baseId: string;
      tableId: string;
      recordId: string;
      actorId: string;
      dateConfig: { timeZone: string; locale: string; firstDayOfWeek: number };
      viewer: unknown;
      resolveRecordAccess: (target: { baseId: string; tableId: string }) => Promise<{ kind: "all" } | null>;
    };
    expect(snapshotParams).toEqual({
      baseId,
      tableId,
      recordId,
      actorId: user.id,
      dateConfig: { timeZone: "UTC", locale: "en", firstDayOfWeek: 1 },
    });
    expect(viewer).toMatchObject({ userId: user.id });
    expect(await resolveRecordAccess({ baseId, tableId })).toEqual({ kind: "all" });
    baseLevel = "none";
    expect(await resolveRecordAccess({ baseId, tableId })).toBeNull();
  });

  test("requires base read access to open a standalone snapshot", async () => {
    baseLevel = "none";
    const app = createDocumentsApi({ requireAuthenticated: authenticated });

    const response = await app.request(`/snapshots/${snapshotId}`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(forbiddenResponse);
  });

  test("opens standalone snapshots with base read access", async () => {
    const app = createDocumentsApi({ requireAuthenticated: authenticated });

    const response = await app.request(`/snapshots/${snapshotId}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(snapshot);
    expect(snapshotGetCalls).toBe(1);
    const filterInput = snapshotFilterInput as {
      input: typeof snapshot;
      resolveRecordAccess: (target: { baseId: string; tableId: string }) => Promise<{ kind: "all" } | null>;
    };
    expect(filterInput.input).toBe(snapshot);
    expect(await filterInput.resolveRecordAccess({ baseId, tableId })).toEqual({ kind: "all" });
    baseLevel = "none";
    expect(await filterInput.resolveRecordAccess({ baseId, tableId })).toBeNull();
  });

  test("returns 404 for an unknown standalone snapshot", async () => {
    const app = createDocumentsApi({ requireAuthenticated: authenticated });
    const unknownSnapshotId = "88888888-8888-4888-8888-888888888888";

    const response = await app.request(`/snapshots/${unknownSnapshotId}`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Record snapshot not found" });
    expect(snapshotGetCalls).toBe(1);
  });
});
