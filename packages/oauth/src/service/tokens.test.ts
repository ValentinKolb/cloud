import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import { oauthTokens, serviceAccounts } from "@valentinkolb/cloud/services";
import oauthRoutes from "../oauth";
import { migrate } from "../migrate";
import { oauth } from "./oauth";

const canUseDatabase = async () => {
  try {
    const [row] = await sql<{
      users: string | null;
      service_accounts: string | null;
    }[]>`
      SELECT
        to_regclass('auth.users')::text AS users,
        to_regclass('auth.service_accounts')::text AS service_accounts
    `;
    if (!row?.users || !row.service_accounts) return false;
    await migrate();
    return true;
  } catch {
    return false;
  }
};

const insertUser = async () => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`oauth-token-${suffix}`}, 'local', 'user', 'OAuth Token Test', ${`oauth-token-${suffix}@example.test`}, 'OAuth', 'Token')
    RETURNING id
  `;
  return row!.id;
};

const requestClientCredentialsToken = async (params: {
  clientId: string;
  clientSecret: string;
  scope?: string;
  resource?: string;
}) => {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  if (params.scope) body.set("scope", params.scope);
  if (params.resource) body.set("resource", params.resource);

  return oauthRoutes.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
};

const actorProbe = () =>
  new Hono<AuthContext>()
    .use(auth.requireRole("authenticated"))
    .get("/probe", (c) => {
      const actor = c.get("actor");
      return c.json({
        actorKind: actor.kind,
        userId: actor.kind === "user" ? actor.user.id : actor.delegatedUser?.id ?? null,
        serviceAccountId: actor.kind === "service_account" ? actor.serviceAccount.id : null,
        accessSubject: c.get("accessSubject"),
      });
    });

describe("OAuth resource access tokens", () => {
  test("authorization-code access tokens resolve as user actors in Core auth", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping OAuth user token DB test: auth/oauth tables are not available.");
      return;
    }

    const userId = await insertUser();
    let clientId: string | null = null;

    try {
      const created = await oauth.clients.create({
        createdBy: userId,
        data: {
          name: `User token client ${crypto.randomUUID()}`,
          redirectUris: ["https://client.example.test/callback"],
          scopes: ["openid", "profile", "email"],
          audiences: ["cloud", "test-api"],
          allowedProfiles: ["user"],
          isPublic: false,
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      clientId = created.data.id;

      const tokens = await oauth.tokens.createTokens({
        userId,
        client: created.data,
        issuer: "https://localhost:3000",
      });

      const verified = await oauthTokens.verifyAccessToken(tokens.accessToken);
      expect(verified?.kind).toBe("user");
      expect(verified?.kind === "user" ? verified.user.id : null).toBe(userId);

      const response = await actorProbe().request("/probe", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        actorKind: "user",
        userId,
        serviceAccountId: null,
        accessSubject: { type: "user", userId },
      });
    } finally {
      if (clientId) await sql`DELETE FROM oauth.clients WHERE id = ${clientId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("client credentials resolve as resource service-account actors and validate scope/resource", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping OAuth client credentials DB test: auth/oauth tables are not available.");
      return;
    }

    const userId = await insertUser();
    let clientId: string | null = null;
    let serviceAccountId: string | null = null;

    try {
      const serviceAccount = await serviceAccounts.createResourceBound({
        name: `OAuth resource service ${crypto.randomUUID()}`,
        appId: "oauth-test",
        resourceType: "fixture",
        resourceId: crypto.randomUUID(),
        createdBy: userId,
      });
      expect(serviceAccount.ok).toBe(true);
      if (!serviceAccount.ok) return;
      serviceAccountId = serviceAccount.data.id;

      const publicBinding = await oauth.clients.create({
        createdBy: userId,
        data: {
          name: `Invalid public service token client ${crypto.randomUUID()}`,
          redirectUris: [],
          scopes: ["read"],
          audiences: ["cloud"],
          serviceAccountId: serviceAccount.data.id,
          allowedProfiles: ["user"],
          isPublic: true,
        },
      });
      expect(publicBinding.ok).toBe(false);

      const created = await oauth.clients.create({
        createdBy: userId,
        data: {
          name: `Service token client ${crypto.randomUUID()}`,
          redirectUris: [],
          scopes: ["read", "write"],
          audiences: ["cloud", "oauth-test-api"],
          serviceAccountId: serviceAccount.data.id,
          allowedProfiles: ["user"],
          isPublic: false,
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      clientId = created.data.id;

      const invalidScope = await requestClientCredentialsToken({
        clientId: created.data.clientId,
        clientSecret: created.data.clientSecret,
        scope: "admin",
      });
      expect(invalidScope.status).toBe(400);

      const invalidResource = await requestClientCredentialsToken({
        clientId: created.data.clientId,
        clientSecret: created.data.clientSecret,
        scope: "read",
        resource: "other-api",
      });
      expect(invalidResource.status).toBe(400);

      const tokenResponse = await requestClientCredentialsToken({
        clientId: created.data.clientId,
        clientSecret: created.data.clientSecret,
        scope: "read",
        resource: "oauth-test-api",
      });
      expect(tokenResponse.status).toBe(200);
      const tokenBody = (await tokenResponse.json()) as {
        access_token: string;
        token_type: string;
        id_token: string | null;
        scope: string;
      };
      expect(tokenBody.token_type).toBe("Bearer");
      expect(tokenBody.id_token).toBeNull();
      expect(tokenBody.scope).toBe("read");

      const verified = await oauthTokens.verifyAccessToken(tokenBody.access_token);
      expect(verified?.kind).toBe("service_account");
      expect(verified?.kind === "service_account" ? verified.serviceAccount.id : null).toBe(serviceAccount.data.id);

      const response = await actorProbe().request("/probe", {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        actorKind: "service_account",
        userId: null,
        serviceAccountId: serviceAccount.data.id,
        accessSubject: { type: "service_account", serviceAccountId: serviceAccount.data.id },
      });
    } finally {
      if (clientId) await sql`DELETE FROM oauth.clients WHERE id = ${clientId}::uuid`;
      if (serviceAccountId) await sql`DELETE FROM auth.service_accounts WHERE id = ${serviceAccountId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });
});
