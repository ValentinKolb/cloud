import { describe, expect, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import type { MiddlewareHandler } from "hono";
import { createWorkspaceApi } from "./workspace";

const tableId = "22222222-2222-4222-8222-222222222222";
const recordId = "33333333-3333-4333-8333-333333333333";
const runId = "55555555-5555-4555-8555-555555555555";
const workflowId = "66666666-6666-4666-8666-666666666666";
const baseId = "44444444-4444-4444-8444-444444444444";
const viewId = "77777777-7777-4777-8777-777777777777";
const user: User = {
  id: "11111111-1111-4111-8111-111111111111",
  uid: "workspace-user",
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Workspace",
  sn: "User",
  displayName: "Workspace User",
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

const authenticated: MiddlewareHandler<AuthContext> = async (c, next) => {
  c.set("actor", { kind: "user", user });
  c.set("accessSubject", { type: "user", userId: user.id });
  c.set("user", user);
  await next();
};

describe("Grids workspace record detail", () => {
  const detail = {
    recordId,
    filesByField: {},
    documentRuns: [],
    snapshots: [],
    auditEntries: [],
    combinedOrigin: null,
  };

  test("does not load record data when table access is denied", async () => {
    let recordCalls = 0;
    const app = createWorkspaceApi({
      requireAuthenticated: authenticated,
      getTable: async () => ({ id: tableId, baseId }) as never,
      gate: async () => ({ ok: false }) as never,
      getRecord: async () => {
        recordCalls += 1;
        return {} as never;
      },
    });

    const response = await app.request(`/record-detail?tableId=${tableId}&recordId=${recordId}`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Record not found" });
    expect(recordCalls).toBe(0);
  });

  test("returns one composed detail payload for a readable record", async () => {
    const app = createWorkspaceApi({
      requireAuthenticated: authenticated,
      getTable: async () => ({ id: tableId, baseId }) as never,
      gate: async () => ({ ok: true, value: "read" }) as never,
      getRecord: async () => ({ id: recordId }) as never,
      listFields: async () => [],
      loadRecordDetail: async () => detail,
    });

    const response = await app.request(`/record-detail?tableId=${tableId}&recordId=${recordId}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
  });

  test("limits view-only Combined details to records returned by the exact saved view", async () => {
    let detailScope: string | undefined;
    const app = createWorkspaceApi({
      requireAuthenticated: authenticated,
      getTable: async () => ({ id: tableId, baseId, kind: "federated" }) as never,
      gate: async () => ({ ok: false }) as never,
      getView: async () => ({ id: viewId, tableId, ownerUserId: null, source: "from table Combined limit 1" }) as never,
      resolve: async () => ({ level: "read", grants: [] }) as never,
      compileView: async () => ({ ok: true, source: "", query: { limit: 1 } }) as never,
      executeView: async () =>
        ({
          ok: true,
          mode: "rows",
          columns: [],
          rows: [{ recordId, values: {} }],
          limit: 1,
          page: { size: 1, start: 0, returned: 1, nextCursor: null },
        }) as never,
      listFields: async () => [],
      loadRecordDetail: async (params) => {
        detailScope = params.scope;
        return detail;
      },
    });

    const response = await app.request(`/record-detail?tableId=${tableId}&recordId=${recordId}&viewId=${viewId}`);

    expect(response.status).toBe(200);
    expect(detailScope).toBe("history");
  });

  test("does not expose a Combined record outside a limited saved view", async () => {
    let detailCalls = 0;
    const app = createWorkspaceApi({
      requireAuthenticated: authenticated,
      getTable: async () => ({ id: tableId, baseId, kind: "federated" }) as never,
      gate: async () => ({ ok: false }) as never,
      getView: async () => ({ id: viewId, tableId, ownerUserId: null, source: "from table Combined limit 1" }) as never,
      resolve: async () => ({ level: "read", grants: [] }) as never,
      compileView: async () => ({ ok: true, source: "", query: { limit: 1 } }) as never,
      executeView: async () =>
        ({
          ok: true,
          mode: "rows",
          columns: [],
          rows: [{ recordId: "88888888-8888-4888-8888-888888888888", values: {} }],
          limit: 1,
          page: { size: 1, start: 0, returned: 1, nextCursor: null },
        }) as never,
      loadRecordDetail: async () => {
        detailCalls += 1;
        return detail;
      },
    });

    const response = await app.request(`/record-detail?tableId=${tableId}&recordId=${recordId}&viewId=${viewId}`);

    expect(response.status).toBe(404);
    expect(detailCalls).toBe(0);
  });

  test("does not let URL trash state expand a view-only Combined query", async () => {
    let executedRecordId: string | undefined;
    const app = createWorkspaceApi({
      requireAuthenticated: authenticated,
      getTable: async () => ({ id: tableId, baseId, kind: "federated" }) as never,
      gate: async () => ({ ok: false }) as never,
      getView: async () => ({ id: viewId, tableId, ownerUserId: null, source: "from table Combined" }) as never,
      resolve: async () => ({ level: "read", grants: [] }) as never,
      compileView: async () => ({ ok: true, source: "", query: {} }) as never,
      executeView: async (_context, _baseId, _viewId, options) => {
        executedRecordId = options?.recordId;
        return {
          ok: true,
          mode: "rows",
          columns: [],
          rows: [{ recordId, values: {} }],
          limit: 1,
          page: { size: 1, start: 0, returned: 1, nextCursor: null },
        } as never;
      },
      listFields: async () => [],
      loadRecordDetail: async () => detail,
    });

    const response = await app.request(`/record-detail?tableId=${tableId}&recordId=${recordId}&viewId=${viewId}&deletedOnly=true`);

    expect(response.status).toBe(200);
    expect(executedRecordId).toBe(recordId);
  });

  test("projects view-only Combined history to the saved view's output fields", async () => {
    const visibleField = { id: "88888888-8888-4888-8888-888888888888" };
    const hiddenField = { id: "99999999-9999-4999-8999-999999999999" };
    let detailFieldIds: string[] = [];
    const app = createWorkspaceApi({
      requireAuthenticated: authenticated,
      getTable: async () => ({ id: tableId, baseId, kind: "federated" }) as never,
      gate: async () => ({ ok: false }) as never,
      getView: async () => ({ id: viewId, tableId, ownerUserId: null, source: "from table Combined" }) as never,
      resolve: async () => ({ level: "read", grants: [] }) as never,
      compileView: async () =>
        ({
          ok: true,
          source: "",
          query: { columns: [{ kind: "field", fieldId: visibleField.id }] },
        }) as never,
      executeView: async () =>
        ({
          ok: true,
          mode: "rows",
          columns: [],
          rows: [{ recordId, values: {} }],
          limit: 1,
          page: { size: 1, start: 0, returned: 1, nextCursor: null },
        }) as never,
      listFields: async () => [visibleField, hiddenField] as never,
      loadRecordDetail: async (params) => {
        detailFieldIds = params.fields.map((field) => field.id);
        return detail;
      },
    });

    const response = await app.request(`/record-detail?tableId=${tableId}&recordId=${recordId}&viewId=${viewId}`);

    expect(response.status).toBe(200);
    expect(detailFieldIds).toEqual([visibleField.id]);
  });
});

describe("Grids workspace workflow run detail", () => {
  const run = { id: runId, baseId, workflowId } as never;

  test("does not load run details when workflow access is denied", async () => {
    let detailCalls = 0;
    const app = createWorkspaceApi({
      requireAuthenticated: authenticated,
      getWorkflowRun: async () => run,
      gate: async () => ({ ok: false }) as never,
      loadWorkflowDetail: async () => {
        detailCalls += 1;
        return {} as never;
      },
    });

    const response = await app.request(`/workflow-run-detail?runId=${runId}`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Workflow run not found" });
    expect(detailCalls).toBe(0);
  });

  test("returns one composed payload for a readable workflow run", async () => {
    const detail = { run, steps: [], documents: { items: [], total: 0, hasMore: false, nextOffset: null } };
    const app = createWorkspaceApi({
      requireAuthenticated: authenticated,
      getWorkflowRun: async () => run,
      gate: async () => ({ ok: true, value: "read" }) as never,
      loadWorkflowDetail: async () => detail as never,
    });

    const response = await app.request(`/workflow-run-detail?runId=${runId}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
  });
});
