import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { Hono } from "hono";
import meApp from "../api/me";
import { type AuthContext, auth } from "../server/middleware/auth";
import { accounts } from "./accounts";
import { serviceAccountCredentials } from "./service-account-credentials";
import { serviceAccounts } from "./service-accounts";

const canUseDatabase = async () => {
  try {
    const [row] = await sql<
      {
        users: string | null;
        service_accounts: string | null;
        credentials: string | null;
        audit_events: string | null;
        ipa_effective_groups: string | null;
      }[]
    >`
      SELECT
        to_regclass('auth.users')::text AS users,
        to_regclass('auth.service_accounts')::text AS service_accounts,
        to_regclass('auth.service_account_credentials')::text AS credentials,
        to_regclass('audit.events')::text AS audit_events,
        to_regclass('auth.ipa_user_effective_groups')::text AS ipa_effective_groups
    `;
    return Boolean(row?.users && row.service_accounts && row.credentials && row.audit_events && row.ipa_effective_groups);
  } catch {
    return false;
  }
};

const insertUser = async () => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`api-key-${suffix}`}, 'local', 'user', 'API Key Test', ${`api-key-${suffix}@example.test`}, 'API', 'Key')
    RETURNING id
  `;
  return row!.id;
};

describe("serviceAccountCredentials", () => {
  test("creates, authenticates, lists, and revokes user delegated API keys", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping service account credential DB test: auth/audit tables are not available.");
      return;
    }

    const userId = await insertUser();
    try {
      const user = await accounts.users.get({ id: userId });
      expect(user).not.toBeNull();
      if (!user) return;

      const created = await serviceAccountCredentials.createUserApiToken({
        user,
        name: "Test key",
        expiresAt: null,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.data.token).toMatch(/^cld_[0-9a-f]{24}_[0-9a-f]{64}$/);
      expect(created.data.credential.name).toBe("Test key");

      const authenticated = await serviceAccountCredentials.authenticateApiToken(created.data.token);
      expect(authenticated?.delegatedUser?.id).toBe(user.id);
      expect(authenticated?.serviceAccount.kind).toBe("user_delegated");

      const app = new Hono<AuthContext>().use(auth.requireRole("authenticated")).get("/me", (c) =>
        c.json({
          actorKind: c.get("actor").kind,
          userId: c.get("user").id,
          accessSubject: c.get("accessSubject"),
        }),
      );
      const response = await app.request("/me", {
        headers: { Authorization: `Bearer ${created.data.token}` },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        actorKind: "service_account",
        userId: user.id,
        accessSubject: { type: "user", userId: user.id },
      });

      const meResponse = await meApp.request("/", {
        headers: { Authorization: `Bearer ${created.data.token}` },
      });
      expect(meResponse.status).toBe(200);
      expect((await meResponse.json()).id).toBe(user.id);

      const listed = await serviceAccountCredentials.listForDelegatedUser({ userId: user.id });
      expect(listed.map((key) => key.id)).toContain(created.data.credential.id);

      const overview = await serviceAccountCredentials.listOverview({
        filter: { userId: user.id, serviceAccountKind: "user_delegated", credentialStatus: "active" },
      });
      expect(overview.items.map((key) => key.id)).toContain(created.data.credential.id);
      expect(overview.items.find((key) => key.id === created.data.credential.id)?.owner).toMatchObject({
        type: "user",
        userId: user.id,
      });

      const adminRevoked = await serviceAccountCredentials.revoke({
        credentialId: created.data.credential.id,
        actor: user,
      });
      expect(adminRevoked.ok).toBe(true);

      const afterAdminRevoke = await serviceAccountCredentials.authenticateApiToken(created.data.token);
      expect(afterAdminRevoke).toBeNull();

      const second = await serviceAccountCredentials.createUserApiToken({
        user,
        name: "Second test key",
        expiresAt: null,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      const revoked = await serviceAccountCredentials.revokeForDelegatedUser({
        credentialId: second.data.credential.id,
        user,
      });
      expect(revoked.ok).toBe(true);

      const afterRevoke = await serviceAccountCredentials.authenticateApiToken(second.data.token);
      expect(afterRevoke).toBeNull();
    } finally {
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("creates, authenticates, lists, and revokes resource-bound API keys", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping resource service account credential DB test: auth/audit tables are not available.");
      return;
    }

    const userId = await insertUser();
    const resourceId = crypto.randomUUID();
    let serviceAccountId: string | null = null;

    try {
      const user = await accounts.users.get({ id: userId });
      expect(user).not.toBeNull();
      if (!user) return;

      const serviceAccount = await serviceAccounts.getOrCreateResourceBound({
        name: "Test notebook integration",
        appId: "notebooks",
        resourceType: "notebook",
        resourceId,
        createdBy: user.id,
      });
      expect(serviceAccount.ok).toBe(true);
      if (!serviceAccount.ok) return;
      serviceAccountId = serviceAccount.data.id;

      const sameServiceAccount = await serviceAccounts.getOrCreateResourceBound({
        name: "Ignored duplicate name",
        appId: "notebooks",
        resourceType: "notebook",
        resourceId,
        createdBy: user.id,
      });
      expect(sameServiceAccount.ok).toBe(true);
      expect(sameServiceAccount.ok ? sameServiceAccount.data.id : null).toBe(serviceAccount.data.id);

      const created = await serviceAccountCredentials.createResourceApiToken({
        serviceAccountId: serviceAccount.data.id,
        actor: user,
        name: "Resource key",
        expiresAt: null,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.data.token).toMatch(/^cld_[0-9a-f]{24}_[0-9a-f]{64}$/);

      const authenticated = await serviceAccountCredentials.authenticateApiToken(created.data.token);
      expect(authenticated?.delegatedUser).toBeNull();
      expect(authenticated?.serviceAccount).toMatchObject({
        kind: "resource_bound",
        appId: "notebooks",
        resourceType: "notebook",
        resourceId,
      });

      const meResponse = await meApp.request("/", {
        headers: { Authorization: `Bearer ${created.data.token}` },
      });
      expect(meResponse.status).toBe(403);
      expect(await meResponse.json()).toEqual({
        message: "Self-service endpoints require a user-backed actor",
        code: "FORBIDDEN",
      });

      const overview = await serviceAccountCredentials.listOverview({
        filter: {
          appId: "notebooks",
          resourceType: "notebook",
          resourceId,
          serviceAccountKind: "resource_bound",
          credentialStatus: "active",
        },
      });
      expect(overview.items.map((key) => key.id)).toContain(created.data.credential.id);
      expect(overview.items.find((key) => key.id === created.data.credential.id)?.owner).toEqual({
        type: "resource",
        appId: "notebooks",
        resourceType: "notebook",
        resourceId,
      });

      const revoked = await serviceAccountCredentials.revoke({
        credentialId: created.data.credential.id,
        actor: user,
      });
      expect(revoked.ok).toBe(true);
      expect(await serviceAccountCredentials.authenticateApiToken(created.data.token)).toBeNull();
    } finally {
      if (serviceAccountId) await sql`DELETE FROM auth.service_accounts WHERE id = ${serviceAccountId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });
});
