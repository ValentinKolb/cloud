import { describe, expect, test } from "bun:test";
import { CreateProxyAuthClientSchema, ProxyAuthClientParamSchema, UpdateProxyAuthClientSchema } from "./contracts";

describe("Proxy Auth contracts", () => {
  test("normalizes create payloads", () => {
    const groupId = crypto.randomUUID();
    const parsed = CreateProxyAuthClientSchema.parse({
      name: "  Traefik dashboard  ",
      description: "  Internal proxy auth client  ",
      allowedGroupIds: [groupId, groupId],
    });

    expect(parsed).toEqual({
      name: "Traefik dashboard",
      description: "Internal proxy auth client",
      allowedGroupIds: [groupId],
    });
  });

  test("normalizes update payloads", () => {
    const groupId = crypto.randomUUID();
    const parsed = UpdateProxyAuthClientSchema.parse({
      description: "  Updated description  ",
      allowedGroupIds: [groupId, groupId],
    });

    expect(parsed).toEqual({
      description: "Updated description",
      allowedGroupIds: [groupId],
    });
  });

  test("rejects invalid params and empty group selections", () => {
    expect(ProxyAuthClientParamSchema.safeParse({ id: crypto.randomUUID() }).success).toBe(true);
    expect(ProxyAuthClientParamSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    expect(CreateProxyAuthClientSchema.safeParse({ name: "   ", allowedGroupIds: [crypto.randomUUID()] }).success).toBe(false);
    expect(CreateProxyAuthClientSchema.safeParse({ name: "Client", allowedGroupIds: [] }).success).toBe(false);
    expect(CreateProxyAuthClientSchema.safeParse({ name: "Client", allowedGroupIds: ["not-a-uuid"] }).success).toBe(false);
  });
});
