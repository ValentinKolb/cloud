import { describe, expect, mock, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { ServiceAccount, ServiceAccountCredentialOverview } from "@valentinkolb/cloud/services";
import type { GridsWorkflowPrincipal } from "../workflows/contracts";
import { revalidateWorkflowPrincipal, type WorkflowAuthorizationDeps } from "./workflow-authorization";

const BASE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SERVICE_ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const CREDENTIAL_ID = "44444444-4444-4444-8444-444444444444";

const user = (overrides: Partial<User> = {}): User =>
  ({
    id: USER_ID,
    accountExpires: null,
    ...overrides,
  }) as User;

const serviceAccount = (overrides: Partial<ServiceAccount> = {}): ServiceAccount => ({
  id: SERVICE_ACCOUNT_ID,
  name: "Grids base credential",
  kind: "resource_bound",
  status: "active",
  delegatedUserId: null,
  appId: "grids",
  resourceType: "base",
  resourceId: BASE_ID,
  createdBy: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  ...overrides,
});

const credential = (scopes: string[] = ["grids:write"]): ServiceAccountCredentialOverview =>
  ({
    id: CREDENTIAL_ID,
    serviceAccountId: SERVICE_ACCOUNT_ID,
    name: "Workflow key",
    kind: "api_token",
    status: "active",
    tokenPrefix: "prefix",
    scopes,
    expiresAt: "2026-07-16T00:00:00.000Z",
    lastUsedAt: null,
    createdBy: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    revokedAt: null,
    revokedBy: null,
    serviceAccount: serviceAccount(),
    owner: { type: "resource", appId: "grids", resourceType: "base", resourceId: BASE_ID },
  }) as ServiceAccountCredentialOverview;

const principal = (): GridsWorkflowPrincipal => ({
  userId: null,
  groupIds: [],
  serviceAccountId: SERVICE_ACCOUNT_ID,
  actorServiceAccountId: SERVICE_ACCOUNT_ID,
  credential: {
    kind: "api_token",
    id: CREDENTIAL_ID,
    scopes: ["grids:write"],
    permissionCap: "write",
    expiresAt: "2026-07-16T00:00:00.000Z",
    resourceBinding: { appId: "grids", resourceType: "base", resourceId: BASE_ID },
  },
});

const deps = (overrides: Partial<WorkflowAuthorizationDeps> = {}): WorkflowAuthorizationDeps => ({
  findCredential: mock(async () => credential()),
  getServiceAccount: mock(async () => serviceAccount()),
  getUser: mock(async () => user()),
  now: () => new Date("2026-07-15T12:00:00.000Z"),
  ...overrides,
});

describe("workflow principal revalidation", () => {
  test("uses a user id as the canonical subject without trusting stored groups", async () => {
    const result = await revalidateWorkflowPrincipal(
      { userId: USER_ID, groupIds: ["55555555-5555-4555-8555-555555555555"], serviceAccountId: null },
      BASE_ID,
      deps(),
    );

    expect(result).toEqual({
      ok: true,
      subject: { type: "user", userId: USER_ID },
      permissionCap: "admin",
      credential: null,
    });
  });

  test("fails closed when an API credential was revoked", async () => {
    const result = await revalidateWorkflowPrincipal(principal(), BASE_ID, deps({ findCredential: mock(async () => null) }));

    expect(result).toEqual({ ok: false, reason: "Workflow API credential is revoked or inactive." });
  });

  test("fails closed when the credential overview is revoked", async () => {
    const revoked = {
      ...credential(),
      status: "revoked",
      revokedAt: "2026-07-15T11:00:00.000Z",
    } as ServiceAccountCredentialOverview;
    const result = await revalidateWorkflowPrincipal(principal(), BASE_ID, deps({ findCredential: mock(async () => revoked) }));

    expect(result).toEqual({ ok: false, reason: "Workflow API credential is revoked or inactive." });
  });

  test("fails closed when a user principal was removed or expired", async () => {
    const removed = await revalidateWorkflowPrincipal(
      { userId: USER_ID, groupIds: [], serviceAccountId: null },
      BASE_ID,
      deps({ getUser: mock(async () => null) }),
    );
    const expiredUser = await revalidateWorkflowPrincipal(
      { userId: USER_ID, groupIds: [], serviceAccountId: null },
      BASE_ID,
      deps({ getUser: mock(async () => user({ accountExpires: "2026-07-15T11:59:59.000Z" })) }),
    );

    expect(removed).toEqual({ ok: false, reason: "Workflow user is inactive." });
    expect(expiredUser).toEqual({ ok: false, reason: "Workflow user is inactive." });
  });

  test("applies the lower of accepted and current credential scopes", async () => {
    const result = await revalidateWorkflowPrincipal(
      principal(),
      BASE_ID,
      deps({ findCredential: mock(async () => credential(["grids:read"])) }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.permissionCap).toBe("read");
  });

  test("rejects resource binding drift and cross-base execution", async () => {
    const otherBase = "66666666-6666-4666-8666-666666666666";
    const result = await revalidateWorkflowPrincipal(principal(), otherBase, deps());

    expect(result).toEqual({ ok: false, reason: "Workflow credential is not bound to this Grids base." });
  });

  test("rejects expired OAuth snapshots even while the service account remains active", async () => {
    const oauth: GridsWorkflowPrincipal = {
      ...principal(),
      credential: {
        ...principal().credential!,
        kind: "oauth",
        id: null,
        expiresAt: "2026-07-15T11:59:59.000Z",
      },
    };

    const result = await revalidateWorkflowPrincipal(oauth, BASE_ID, deps());

    expect(result).toEqual({ ok: false, reason: "Workflow credential expired." });
  });
});
