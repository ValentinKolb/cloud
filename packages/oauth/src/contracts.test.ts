import { describe, expect, test } from "bun:test";
import { CreateOAuthClientSchema, OAuthClientParamSchema, UpdateOAuthClientSchema } from "./contracts";

describe("OAuth contracts", () => {
  test("normalizes create payloads without changing valid client intent", () => {
    const parsed = CreateOAuthClientSchema.parse({
      name: "  Demo client  ",
      description: "  Used by the demo integration.  ",
      redirectUris: [" https://client.example.test/callback ", "https://client.example.test/callback"],
      logoutUri: " https://client.example.test/logout ",
      scopes: ["openid", "profile", "profile", "email"],
      audiences: [" cloud ", "cloud", "api"],
      allowedProfiles: ["user", "user", "guest"],
      accessMode: "specific",
      allowedUserIds: [
        "11111111-1111-4111-8111-111111111111",
        "11111111-1111-4111-8111-111111111111",
      ],
      allowedGroupIds: ["22222222-2222-4222-8222-222222222222"],
      isPublic: true,
    });

    expect(parsed).toEqual({
      name: "Demo client",
      description: "Used by the demo integration.",
      redirectUris: ["https://client.example.test/callback"],
      logoutUri: "https://client.example.test/logout",
      scopes: ["openid", "profile", "email"],
      audiences: ["cloud", "api"],
      serviceAccountId: undefined,
      allowedProfiles: ["user", "guest"],
      accessMode: "specific",
      allowedUserIds: ["11111111-1111-4111-8111-111111111111"],
      allowedGroupIds: ["22222222-2222-4222-8222-222222222222"],
      isPublic: true,
    });
  });

  test("keeps existing defaults for omitted optional create fields", () => {
    const parsed = CreateOAuthClientSchema.parse({ name: "Demo client" });

    expect(parsed.redirectUris).toEqual([]);
    expect(parsed.scopes).toEqual(["openid", "profile", "email"]);
    expect(parsed.audiences).toEqual(["cloud"]);
    expect(parsed.allowedProfiles).toEqual(["user", "guest"]);
    expect(parsed.accessMode).toBe("profiles");
    expect(parsed.allowedUserIds).toEqual([]);
    expect(parsed.allowedGroupIds).toEqual([]);
    expect(parsed.isPublic).toBe(false);
  });

  test("rejects invalid client params and bounded client input", () => {
    expect(OAuthClientParamSchema.safeParse({ id: crypto.randomUUID() }).success).toBe(true);
    expect(OAuthClientParamSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    expect(CreateOAuthClientSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(CreateOAuthClientSchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
    expect(CreateOAuthClientSchema.safeParse({ name: "Demo", redirectUris: ["not-a-url"] }).success).toBe(false);
    expect(CreateOAuthClientSchema.safeParse({ name: "Demo", redirectUris: Array(51).fill("https://client.example.test/callback") }).success).toBe(false);
  });

  test("normalizes update payload arrays and nullable fields", () => {
    const parsed = UpdateOAuthClientSchema.parse({
      name: "  Updated client  ",
      description: null,
      logoutUri: null,
      redirectUris: [" https://client.example.test/callback ", "https://client.example.test/callback"],
      scopes: ["read", "read", "write"],
      audiences: [" api ", "api"],
      allowedProfiles: ["guest", "guest"],
      accessMode: "specific",
      allowedUserIds: [
        "11111111-1111-4111-8111-111111111111",
        "11111111-1111-4111-8111-111111111111",
      ],
      allowedGroupIds: ["22222222-2222-4222-8222-222222222222"],
    });

    expect(parsed).toEqual({
      name: "Updated client",
      description: null,
      logoutUri: null,
      redirectUris: ["https://client.example.test/callback"],
      scopes: ["read", "write"],
      audiences: ["api"],
      allowedProfiles: ["guest"],
      accessMode: "specific",
      allowedUserIds: ["11111111-1111-4111-8111-111111111111"],
      allowedGroupIds: ["22222222-2222-4222-8222-222222222222"],
    });
  });
});
