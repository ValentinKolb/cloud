import { describe, expect, test } from "bun:test";
import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { oauthTokens, serviceAccounts } from "@valentinkolb/cloud/services";
import { redis, sql } from "bun";
import { Hono } from "hono";
import * as jose from "jose";
import { migrate } from "../migrate";
import oauthRoutes from "../oauth";
import { oauth } from "./oauth";

const canUseDatabase = async () => {
  try {
    const [row] = await sql<
      {
        users: string | null;
        service_accounts: string | null;
        groups: string | null;
        user_groups: string | null;
        group_groups: string | null;
      }[]
    >`
      SELECT
        to_regclass('auth.users')::text AS users,
        to_regclass('auth.service_accounts')::text AS service_accounts,
        to_regclass('auth.groups')::text AS groups,
        to_regclass('auth.user_groups_v2')::text AS user_groups,
        to_regclass('auth.group_groups_v2')::text AS group_groups
    `;
    if (!row?.users || !row.service_accounts || !row.groups || !row.user_groups || !row.group_groups) return false;
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

const insertGroup = async (name: string) => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.groups (cn, provider, name, description)
    VALUES (${`${name}-${suffix}`}, 'local', ${`${name}-${suffix}`}, ${`${name} group`})
    RETURNING id
  `;
  return row!.id;
};

const createSessionToken = async (userId: string): Promise<string> => {
  const randomToken = crypto.randomUUID();
  await redis.set(`session:${userId}:${randomToken}`, JSON.stringify({ userId, gen: 0 }), "EX", 60);
  return `${userId}:${randomToken}`;
};

const requestClientCredentialsToken = async (params: { clientId: string; clientSecret: string; scope?: string; resource?: string }) => {
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
  new Hono<AuthContext>().use(auth.requireRole("authenticated")).get("/probe", (c) => {
    const actor = c.get("actor");
    return c.json({
      actorKind: actor.kind,
      userId: actor.kind === "user" ? actor.user.id : (actor.delegatedUser?.id ?? null),
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
          accessMode: "profiles",
          allowedUserIds: [],
          allowedGroupIds: [],
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

  test("authorization codes can only be consumed once under concurrent exchange", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping OAuth authorization code race DB test: auth/oauth tables are not available.");
      return;
    }

    const userId = await insertUser();
    let clientId: string | null = null;

    try {
      const created = await oauth.clients.create({
        createdBy: userId,
        data: {
          name: `Authorization code race client ${crypto.randomUUID()}`,
          redirectUris: ["https://client.example.test/callback"],
          scopes: ["openid", "profile", "email"],
          audiences: ["cloud"],
          allowedProfiles: ["user"],
          accessMode: "profiles",
          allowedUserIds: [],
          allowedGroupIds: [],
          isPublic: false,
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      clientId = created.data.id;

      const code = await oauth.codes.create({
        clientId: created.data.clientId,
        userId,
        redirectUri: "https://client.example.test/callback",
        scopes: created.data.scopes,
      });

      const results = await Promise.all([
        oauth.codes.consume({
          code,
          clientId: created.data.clientId,
          redirectUri: "https://client.example.test/callback",
        }),
        oauth.codes.consume({
          code,
          clientId: created.data.clientId,
          redirectUri: "https://client.example.test/callback",
        }),
      ]);

      expect(results.filter((result) => result !== null)).toHaveLength(1);
      expect(results.filter((result) => result === null)).toHaveLength(1);
    } finally {
      if (clientId) await sql`DELETE FROM oauth.clients WHERE id = ${clientId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("authorization requests without scope use conservative default scopes", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping OAuth authorization scope default DB test: auth/oauth tables are not available.");
      return;
    }

    const userId = await insertUser();
    const sessionToken = await createSessionToken(userId);
    let clientId: string | null = null;

    try {
      const created = await oauth.clients.create({
        createdBy: userId,
        data: {
          name: `Authorization scope default client ${crypto.randomUUID()}`,
          redirectUris: ["https://client.example.test/callback"],
          scopes: ["openid", "profile", "email", "offline_access", "read", "write"],
          audiences: ["cloud"],
          allowedProfiles: ["user"],
          accessMode: "profiles",
          allowedUserIds: [],
          allowedGroupIds: [],
          isPublic: false,
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      clientId = created.data.id;

      const authorizeResponse = await oauthRoutes.request(
        `/oauth/authorize?${new URLSearchParams({
          client_id: created.data.clientId,
          redirect_uri: "https://client.example.test/callback",
          response_type: "code",
        })}`,
        {
          headers: { cookie: `session_token=${sessionToken}` },
          redirect: "manual",
        },
      );
      expect(authorizeResponse.status).toBe(302);
      const location = authorizeResponse.headers.get("location");
      expect(location).toBeTruthy();
      const code = new URL(location!).searchParams.get("code");
      expect(code).toBeTruthy();

      const consumed = await oauth.codes.consume({
        code: code!,
        clientId: created.data.clientId,
        redirectUri: "https://client.example.test/callback",
      });
      expect(consumed?.scopes).toEqual(["openid"]);
    } finally {
      await redis.del(`session:${sessionToken}`);
      if (clientId) await sql`DELETE FROM oauth.clients WHERE id = ${clientId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("refresh tokens rotate and reused tokens revoke the token family", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping OAuth refresh token DB test: auth/oauth tables are not available.");
      return;
    }

    const userId = await insertUser();
    let clientId: string | null = null;

    try {
      const created = await oauth.clients.create({
        createdBy: userId,
        data: {
          name: `Refresh token client ${crypto.randomUUID()}`,
          redirectUris: ["https://client.example.test/callback"],
          scopes: ["openid", "profile", "email", "offline_access"],
          audiences: ["cloud"],
          allowedProfiles: ["user"],
          accessMode: "profiles",
          allowedUserIds: [],
          allowedGroupIds: [],
          isPublic: false,
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      clientId = created.data.id;

      const code = await oauth.codes.create({
        clientId: created.data.clientId,
        userId,
        redirectUri: "https://client.example.test/callback",
        scopes: created.data.scopes,
      });
      const codeBody = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: created.data.clientId,
        client_secret: created.data.clientSecret,
        code,
        redirect_uri: "https://client.example.test/callback",
      });
      const codeResponse = await oauthRoutes.request("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: codeBody,
      });
      expect(codeResponse.status).toBe(200);
      const codeToken = (await codeResponse.json()) as { refresh_token: string; scope: string };
      expect(codeToken.scope.split(" ")).toContain("offline_access");
      expect(codeToken.refresh_token.startsWith("cld_rt_")).toBe(true);

      const refreshBody = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: created.data.clientId,
        client_secret: created.data.clientSecret,
        refresh_token: codeToken.refresh_token,
      });
      const refreshResponse = await oauthRoutes.request("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: refreshBody,
      });
      expect(refreshResponse.status).toBe(200);
      const refreshed = (await refreshResponse.json()) as { refresh_token: string };
      expect(refreshed.refresh_token.startsWith("cld_rt_")).toBe(true);
      expect(refreshed.refresh_token).not.toBe(codeToken.refresh_token);

      const reuseResponse = await oauthRoutes.request("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: refreshBody,
      });
      expect(reuseResponse.status).toBe(400);

      const revokedFamilyResponse = await oauthRoutes.request("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: created.data.clientId,
          client_secret: created.data.clientSecret,
          refresh_token: refreshed.refresh_token,
        }),
      });
      expect(revokedFamilyResponse.status).toBe(400);
    } finally {
      if (clientId) await sql`DELETE FROM oauth.clients WHERE id = ${clientId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("loopback redirect validation allows ephemeral native app ports only for matching paths", async () => {
    const client = {
      id: crypto.randomUUID(),
      name: "Loopback client",
      description: null,
      clientId: "loopback-client",
      redirectUris: ["http://127.0.0.1/callback"],
      logoutUri: null,
      scopes: ["openid", "offline_access"],
      audiences: ["cloud"],
      serviceAccountId: null,
      allowedProfiles: ["user"],
      accessMode: "profiles",
      accessUsers: [],
      accessGroups: [],
      isPublic: true,
      createdAt: new Date().toISOString(),
      createdBy: null,
    } satisfies Awaited<ReturnType<typeof oauth.clients.list>>[number];

    expect(oauth.clients.validateRedirectUri(client, "http://127.0.0.1:49152/callback")).toBe(true);
    expect(oauth.clients.validateRedirectUri(client, "http://127.0.0.1:49152/other")).toBe(false);
    expect(oauth.clients.validateRedirectUri(client, "https://127.0.0.1/callback")).toBe(false);
    expect(oauth.clients.validateRedirectUri(client, "http://example.test/callback")).toBe(false);
    expect(
      oauth.clients.validateRedirectUri({ ...client, redirectUris: ["http://localhost/callback"] }, "http://localhost:49152/callback"),
    ).toBe(false);
  });

  test("openid configuration advertises native-cli compatible OAuth capabilities", () => {
    const configuration = oauth.tokens.getOpenIdConfiguration("https://cloud.example.test");

    expect(configuration.grant_types_supported).toContain("authorization_code");
    expect(configuration.grant_types_supported).toContain("refresh_token");
    expect(configuration.scopes_supported).toContain("offline_access");
    expect(configuration.token_endpoint_auth_methods_supported).toContain("none");
    expect(configuration.revocation_endpoint).toBe("https://cloud.example.test/oauth/revoke");
    expect(configuration.code_challenge_methods_supported).toContain("S256");
  });

  test("public clients must use PKCE S256", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping OAuth public PKCE DB test: auth/oauth tables are not available.");
      return;
    }

    const userId = await insertUser();
    let clientId: string | null = null;

    try {
      const created = await oauth.clients.create({
        createdBy: userId,
        data: {
          name: `Public PKCE client ${crypto.randomUUID()}`,
          redirectUris: ["http://127.0.0.1/callback"],
          scopes: ["openid"],
          audiences: ["cloud"],
          allowedProfiles: ["user"],
          accessMode: "profiles",
          allowedUserIds: [],
          allowedGroupIds: [],
          isPublic: true,
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      clientId = created.data.id;

      const missingMethod = await oauthRoutes.request(
        `/oauth/authorize?${new URLSearchParams({
          client_id: created.data.clientId,
          redirect_uri: "http://127.0.0.1:49152/callback",
          response_type: "code",
          code_challenge: "a".repeat(43),
        })}`,
      );
      expect(missingMethod.status).toBe(400);

      const plainMethod = await oauthRoutes.request(
        `/oauth/authorize?${new URLSearchParams({
          client_id: created.data.clientId,
          redirect_uri: "http://127.0.0.1:49152/callback",
          response_type: "code",
          code_challenge: "a".repeat(43),
          code_challenge_method: "plain",
        })}`,
      );
      expect(plainMethod.status).toBe(400);
    } finally {
      if (clientId) await sql`DELETE FROM oauth.clients WHERE id = ${clientId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("refresh tokens keep the original grant audiences after client changes", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping OAuth refresh audience DB test: auth/oauth tables are not available.");
      return;
    }

    const userId = await insertUser();
    let clientId: string | null = null;

    try {
      const created = await oauth.clients.create({
        createdBy: userId,
        data: {
          name: `Refresh audience client ${crypto.randomUUID()}`,
          redirectUris: ["https://client.example.test/callback"],
          scopes: ["openid", "offline_access"],
          audiences: ["old-api"],
          allowedProfiles: ["user"],
          accessMode: "profiles",
          allowedUserIds: [],
          allowedGroupIds: [],
          isPublic: false,
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      clientId = created.data.id;

      const code = await oauth.codes.create({
        clientId: created.data.clientId,
        userId,
        redirectUri: "https://client.example.test/callback",
        scopes: created.data.scopes,
      });
      const codeResponse = await oauthRoutes.request("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: created.data.clientId,
          client_secret: created.data.clientSecret,
          code,
          redirect_uri: "https://client.example.test/callback",
        }),
      });
      expect(codeResponse.status).toBe(200);
      const codeToken = (await codeResponse.json()) as { refresh_token: string };

      await sql`
        UPDATE oauth.clients
        SET audiences = ARRAY['old-api', 'new-api']
        WHERE id = ${clientId}::uuid
      `;

      const refreshResponse = await oauthRoutes.request("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: created.data.clientId,
          client_secret: created.data.clientSecret,
          refresh_token: codeToken.refresh_token,
        }),
      });
      expect(refreshResponse.status).toBe(200);
      const refreshed = (await refreshResponse.json()) as { access_token: string };
      const payload = jose.decodeJwt(refreshed.access_token);
      const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      expect(audience).toContain("old-api");
      expect(audience).not.toContain("new-api");
    } finally {
      if (clientId) await sql`DELETE FROM oauth.clients WHERE id = ${clientId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("refresh token revocation invalidates the grant without exposing token details", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping OAuth refresh token revocation DB test: auth/oauth tables are not available.");
      return;
    }

    const userId = await insertUser();
    let clientId: string | null = null;

    try {
      const created = await oauth.clients.create({
        createdBy: userId,
        data: {
          name: `Refresh token revocation client ${crypto.randomUUID()}`,
          redirectUris: ["https://client.example.test/callback"],
          scopes: ["openid", "profile", "email", "offline_access"],
          audiences: ["cloud"],
          allowedProfiles: ["user"],
          accessMode: "profiles",
          allowedUserIds: [],
          allowedGroupIds: [],
          isPublic: false,
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      clientId = created.data.id;

      const code = await oauth.codes.create({
        clientId: created.data.clientId,
        userId,
        redirectUri: "https://client.example.test/callback",
        scopes: created.data.scopes,
      });
      const codeResponse = await oauthRoutes.request("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: created.data.clientId,
          client_secret: created.data.clientSecret,
          code,
          redirect_uri: "https://client.example.test/callback",
        }),
      });
      expect(codeResponse.status).toBe(200);
      const codeToken = (await codeResponse.json()) as { refresh_token: string };

      const revokeResponse = await oauthRoutes.request("/oauth/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: codeToken.refresh_token,
          token_type_hint: "unsupported_hint",
          client_id: created.data.clientId,
          client_secret: created.data.clientSecret,
        }),
      });
      expect(revokeResponse.status).toBe(200);

      const refreshResponse = await oauthRoutes.request("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: created.data.clientId,
          client_secret: created.data.clientSecret,
          refresh_token: codeToken.refresh_token,
        }),
      });
      expect(refreshResponse.status).toBe(400);
    } finally {
      if (clientId) await sql`DELETE FROM oauth.clients WHERE id = ${clientId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("specific client access allows direct users and recursive group members only", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping OAuth specific access DB test: auth/oauth tables are not available.");
      return;
    }

    const creatorId = await insertUser();
    const directUserId = await insertUser();
    const nestedUserId = await insertUser();
    const deniedUserId = await insertUser();
    const parentGroupId = await insertGroup("oauth-parent");
    const childGroupId = await insertGroup("oauth-child");
    let clientId: string | null = null;

    try {
      await sql`INSERT INTO auth.group_groups_v2 (parent_group_id, child_group_id) VALUES (${parentGroupId}::uuid, ${childGroupId}::uuid)`;
      await sql`INSERT INTO auth.user_groups_v2 (user_id, group_id) VALUES (${nestedUserId}::uuid, ${childGroupId}::uuid)`;

      const created = await oauth.clients.create({
        createdBy: creatorId,
        data: {
          name: `Specific access client ${crypto.randomUUID()}`,
          redirectUris: ["https://client.example.test/callback"],
          scopes: ["openid", "profile", "email"],
          audiences: ["cloud"],
          allowedProfiles: ["user", "guest"],
          accessMode: "specific",
          allowedUserIds: [directUserId],
          allowedGroupIds: [parentGroupId],
          isPublic: false,
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      clientId = created.data.id;

      expect(await oauth.clients.canAuthorizeUser({ client: created.data, userId: directUserId, profile: "user" })).toBe(true);
      expect(await oauth.clients.canAuthorizeUser({ client: created.data, userId: nestedUserId, profile: "user" })).toBe(true);
      expect(await oauth.clients.canAuthorizeUser({ client: created.data, userId: deniedUserId, profile: "user" })).toBe(false);
    } finally {
      if (clientId) await sql`DELETE FROM oauth.clients WHERE id = ${clientId}::uuid`;
      await sql`DELETE FROM auth.user_groups_v2 WHERE user_id IN (${directUserId}::uuid, ${nestedUserId}::uuid, ${deniedUserId}::uuid)`;
      await sql`DELETE FROM auth.group_groups_v2 WHERE parent_group_id = ${parentGroupId}::uuid OR child_group_id = ${childGroupId}::uuid`;
      await sql`DELETE FROM auth.groups WHERE id IN (${parentGroupId}::uuid, ${childGroupId}::uuid)`;
      await sql`DELETE FROM auth.users WHERE id IN (${creatorId}::uuid, ${directUserId}::uuid, ${nestedUserId}::uuid, ${deniedUserId}::uuid)`;
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
          accessMode: "profiles",
          allowedUserIds: [],
          allowedGroupIds: [],
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
          accessMode: "profiles",
          allowedUserIds: [],
          allowedGroupIds: [],
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
