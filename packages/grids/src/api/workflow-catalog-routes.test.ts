import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext, PermissionLevel } from "@valentinkolb/cloud/server";
import { fail, ok } from "@valentinkolb/stdlib";
import { Hono, type MiddlewareHandler } from "hono";
import { generateSpecs } from "hono-openapi";
import { type GridsWorkflow, WORKFLOW_REVISION_HEADER } from "../workflows/contracts";

const baseId = "11111111-1111-4111-8111-111111111111";
const workflowId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

const user: User = {
  id: userId,
  uid: "workflow-editor",
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Workflow",
  sn: "Editor",
  displayName: "Workflow Editor",
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

const workflow: GridsWorkflow = {
  id: workflowId,
  shortId: "wf001",
  baseId,
  name: "Notify",
  description: null,
  source: "steps:\n  - succeed:\n      message: done",
  plan: {} as GridsWorkflow["plan"],
  diagnostics: [],
  enabled: true,
  position: 0,
  revision: 2,
  ownerUserId: userId,
  deletedAt: null,
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
};

let permissionLevel: PermissionLevel = "admin";
let updateRevision: number | null = null;

mock.module("../service/workflow-kernel-store", () => ({
  getWorkflow: async () => workflow,
  updateWorkflow: async (_id: string, input: { name?: string }, _actorId: string | null, expectedRevision: number) => {
    updateRevision = expectedRevision;
    if (expectedRevision !== workflow.revision) {
      return fail({
        code: "CONFLICT" as const,
        message: "Workflow changed since you opened it. Reload the latest version before saving.",
        status: 409 as const,
      });
    }
    return ok({ ...workflow, ...input, revision: workflow.revision + 1 });
  },
}));

mock.module("../service", () => ({
  gridsService: {
    workflow: {
      get: async () => workflow,
    },
    permission: {
      loadGrants: async () => [],
      resolve: () => permissionLevel,
      hasAtLeast: (actual: PermissionLevel, expected: PermissionLevel) => {
        const rank = { none: 0, read: 1, write: 2, admin: 3 };
        return rank[actual] >= rank[expected];
      },
    },
  },
}));

const { createWorkflowCatalogRoutes } = await import("./workflow-catalog-routes");

const authenticated: MiddlewareHandler<AuthContext> = async (c, next) => {
  c.set("actor", { kind: "user", user });
  c.set("accessSubject", { type: "user", userId: user.id });
  c.set("user", user);
  await next();
};

const app = () => new Hono<AuthContext>().use("*", authenticated).route("/workflows", createWorkflowCatalogRoutes());

const patchWorkflow = (revision?: number) =>
  app().request(`/workflows/${workflowId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(revision === undefined ? {} : { [WORKFLOW_REVISION_HEADER]: String(revision) }),
    },
    body: JSON.stringify({ name: "Updated" }),
  });

describe("workflow catalog update route", () => {
  beforeEach(() => {
    permissionLevel = "admin";
    updateRevision = null;
  });

  test("publishes the required revision header in OpenAPI", async () => {
    const spec = await generateSpecs(app());
    const operation = spec.paths?.["/workflows/{workflowId}"]?.patch;

    expect(operation?.parameters).toContainEqual({
      name: WORKFLOW_REVISION_HEADER,
      in: "header",
      required: true,
      description: "Current workflow revision returned by the API.",
      schema: { type: "integer", minimum: 1 },
    });
  });

  test("requires a valid workflow revision", async () => {
    const response = await patchWorkflow();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: `${WORKFLOW_REVISION_HEADER} must contain the workflow revision.` });
    expect(updateRevision).toBeNull();
  });

  test("returns 409 for a stale workflow revision", async () => {
    const response = await patchWorkflow(workflow.revision - 1);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "CONFLICT",
      message: "Workflow changed since you opened it. Reload the latest version before saving.",
    });
    expect(updateRevision).toBe(workflow.revision - 1);
  });

  test("updates the matching workflow revision", async () => {
    const response = await patchWorkflow(workflow.revision);

    expect(response.status).toBe(200);
    expect((await response.json()).revision).toBe(workflow.revision + 1);
    expect(updateRevision).toBe(workflow.revision);
  });
});
