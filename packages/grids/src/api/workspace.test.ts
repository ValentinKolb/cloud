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
    const detail = {
      recordId,
      filesByField: {},
      documentRuns: [],
      snapshots: [],
      auditEntries: [],
    };
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
    const detail = { run, steps: [], documents: { items: [], total: 0, hasMore: false } };
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
