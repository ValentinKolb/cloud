import { beforeAll, describe, expect } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import type { MiddlewareHandler } from "hono";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { createBasesApi } from "./bases";

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("retention policy routes", () => {
  postgresTest("requires Base admin and keeps public IDs at the API boundary", async () => {
    const userId = testUuid();
    const baseId = testUuid();
    const accessId = testUuid();
    const baseShortId = testShortId("B");
    const user: User = {
      id: userId,
      uid: `retention-${userId}`,
      roles: ["user"],
      provider: "local",
      profile: "user",
      givenname: "Retention",
      sn: "Admin",
      displayName: "Retention Admin",
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
    const auth: MiddlewareHandler<AuthContext> = async (c, next) => {
      c.set("actor", { kind: "user", user });
      c.set("accessSubject", { type: "user", userId });
      c.set("user", user);
      await next();
    };
    const app = createBasesApi({ requireAuthenticated: auth });
    try {
      await sql`INSERT INTO auth.users (id, uid, provider, profile, display_name, given_name, sn) VALUES (${userId}::uuid, ${user.uid}, 'local', 'user', ${user.displayName}, ${user.givenname}, ${user.sn})`;
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${baseShortId}, 'Retention routes')`;
      await sql`INSERT INTO auth.access (id, user_id, permission) VALUES (${accessId}::uuid, ${userId}::uuid, 'read')`;
      await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${baseId}::uuid, ${accessId}::uuid)`;
      const path = `/${baseShortId}/retention-policy`;
      expect((await app.request(path)).status).toBe(403);
      await sql`UPDATE auth.access SET permission = 'admin' WHERE id = ${accessId}::uuid`;
      const initial = await app.request(path);
      expect(initial.status).toBe(200);
      expect(await initial.json()).toEqual({ policy: null });
      const updated = await app.request(path, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minimumDays: 90 }),
      });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ policy: { baseId: baseShortId, minimumDays: 90 } });
      const preview = await app.request(`${path}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minimumDays: 90 }),
      });
      expect(preview.status).toBe(200);
      expect(await preview.json()).toMatchObject({
        minimumDays: 90,
        counts: { trashedRecords: 0 },
        files: { counts: { unreferenced: 0, sizeBytes: 0 }, examples: [], truncated: false },
      });
      expect(
        (
          await app.request(path, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ minimumDays: 0 }),
          })
        ).status,
      ).toBe(400);
      expect((await app.request(`/${baseId}/retention-policy`)).status).toBe(404);
      expect((await app.request(path, { method: "DELETE" })).status).toBe(204);
    } finally {
      await sql`DELETE FROM grids.audit_log WHERE base_id = ${baseId}::uuid`;
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
      await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });
});
