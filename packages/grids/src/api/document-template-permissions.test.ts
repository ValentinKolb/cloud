import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import type { MiddlewareHandler } from "hono";

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
  name: "Hidden table",
  description: null,
  icon: null,
  columns: [],
  displayConfig: { mode: "table" as const },
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

let baseLevel: "none" | "read" = "read";
let tableLevel: "none" | "read" = "none";
let templateLevel: "none" | "read" = "read";
let fieldListCalls = 0;
let snapshotListCalls = 0;
let snapshotCreateCalls = 0;

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

mock.module("../service", () => ({
  gridsService: {
    table: {
      get: async (id: string) => (id === tableId ? table : null),
      listByBase: async (id: string) => (id === baseId ? [table] : []),
    },
    field: {
      listByTable: async () => {
        fieldListCalls += 1;
        return [field];
      },
    },
    document: {
      listTemplatesForTable: async (id: string) => (id === tableId ? [template] : []),
      listSnapshotsForRecord: async () => {
        snapshotListCalls += 1;
        return [snapshot];
      },
      createRecordSnapshot: async () => {
        snapshotCreateCalls += 1;
        return { ok: true, data: snapshot };
      },
      getSnapshot: async (id: string) => (id === snapshotId ? snapshot : null),
      summarizeTemplate: (row: typeof template) => ({
        id: row.id,
        shortId: row.shortId,
        tableId: row.tableId,
        name: row.name,
        description: row.description,
        enabled: row.enabled,
        position: row.position,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
    },
    emailTemplate: {
      listForBase: async () => [],
    },
    permission: {
      loadGrants: async () => [],
      resolve: (_grants: unknown, target: Record<string, unknown>) => {
        if ("documentTemplateId" in target) return templateLevel;
        if ("tableId" in target) return tableLevel;
        return baseLevel;
      },
      hasAtLeast: (actual: "none" | "read", expected: "none" | "read" | "write" | "admin") => {
        const rank = { none: 0, read: 1, write: 2, admin: 3 };
        return rank[actual] >= rank[expected];
      },
    },
  },
}));

const { createDocumentsApi } = await import("./documents");
const { permissionedWorkflowCatalog } = await import("./workflows");

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
    tableLevel = "none";
    templateLevel = "read";
    fieldListCalls = 0;
    snapshotListCalls = 0;
    snapshotCreateCalls = 0;
  });

  test("lists readable document templates without table read access", async () => {
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

  test("keeps workflow autocomplete template-aware without leaking fields from hidden tables", async () => {
    const catalog = await permissionedWorkflowCatalog(context as never, baseId);

    expect([...catalog.tables.refs.values()].map((entry) => entry.name)).toContain(table.name);
    expect([...catalog.templates.refs.values()].map((entry) => entry.name)).toContain(template.name);
    expect(catalog.fieldsByTable.has(tableId)).toBe(false);
    expect(fieldListCalls).toBe(0);
  });

  test("denies table-scoped template listing when neither table nor template is readable", async () => {
    templateLevel = "none";
    const app = createDocumentsApi({ requireAuthenticated: authenticated });

    const response = await app.request(`/templates/by-table/${tableId}`);

    expect(response.status).toBe(403);
  });

  test("requires table read access to list standalone snapshots", async () => {
    const app = createDocumentsApi({ requireAuthenticated: authenticated });

    const response = await app.request(`/snapshots/by-record/${tableId}/${recordId}`);

    expect(response.status).toBe(403);
    expect(snapshotListCalls).toBe(0);
  });

  test("requires table read access to create standalone snapshots", async () => {
    const app = createDocumentsApi({ requireAuthenticated: authenticated });

    const response = await app.request(`/snapshots/by-record/${tableId}/${recordId}`, { method: "POST" });

    expect(response.status).toBe(403);
    expect(snapshotCreateCalls).toBe(0);
  });

  test("requires table read access to open a standalone snapshot", async () => {
    const app = createDocumentsApi({ requireAuthenticated: authenticated });

    const response = await app.request(`/snapshots/${snapshotId}`);

    expect(response.status).toBe(403);
  });
});
