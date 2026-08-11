import { beforeAll, describe, expect } from "bun:test";
import { err, fail, ok } from "@k2b/stdlib";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { Hono } from "hono";
import { postgresTest, testShortId as shortId, testUuid as uuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { createAccessEntryRoutes } from "./access-entry-routes";
import { createAccessResourceRoutes } from "./access-resource-routes";

type Fixture = {
  userId: string;
  baseId: string;
  customAppId: string;
  baseAccessId: string;
  customAppAccessId: string;
  foreignBaseId: string;
  foreignCustomAppId: string;
  foreignAccessId: string;
  accessIds: string[];
};

const appFor = (fixture: Fixture) => {
  const gate: NonNullable<Parameters<typeof createAccessResourceRoutes>[0]>["gate"] = async (_context, target) =>
    target.baseId === fixture.baseId ? ok("admin" as const) : fail(err.forbidden("You do not have permission to access this resource."));
  const deps = {
    gate,
    actorId: () => fixture.userId,
    authorization: () => ({ subject: { type: "user" as const, userId: fixture.userId }, permissionCap: "admin" as const }),
  };
  return new Hono<AuthContext>().route("/", createAccessResourceRoutes(deps)).route("/", createAccessEntryRoutes(deps));
};

const insertAccess = async (permission: "read" | "admin", userId: string | null): Promise<string> => {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.access (user_id, permission)
    VALUES (${userId}::uuid, ${permission}::auth.permission_level)
    RETURNING id::text AS id
  `;
  if (!row) throw new Error("Failed to create access fixture");
  return row.id;
};

const insertFixture = async (): Promise<Fixture> => {
  const [authUser] = await sql<{ id: string }[]>`SELECT id::text AS id FROM auth.users ORDER BY id LIMIT 1`;
  if (!authUser) throw new Error("Access route integration test needs one auth user");
  const baseId = uuid();
  const customAppId = uuid();
  const foreignBaseId = uuid();
  const foreignCustomAppId = uuid();
  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES
      (${baseId}::uuid, ${shortId("B")}, 'Access routes'),
      (${foreignBaseId}::uuid, ${shortId("F")}, 'Foreign access routes')
  `;
  await sql`
    INSERT INTO grids.custom_apps (id, short_id, base_id, name, draft_definition, draft_capabilities)
    VALUES
      (${customAppId}::uuid, ${shortId("A")}, ${baseId}::uuid, 'Portal', '{}'::jsonb, '{}'::jsonb),
      (${foreignCustomAppId}::uuid, ${shortId("X")}, ${foreignBaseId}::uuid, 'Foreign portal', '{}'::jsonb, '{}'::jsonb)
  `;

  const baseAccessId = await insertAccess("admin", authUser.id);
  const customAppAccessId = await insertAccess("read", null);
  const foreignAccessId = await insertAccess("read", null);
  await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${baseId}::uuid, ${baseAccessId}::uuid)`;
  await sql`INSERT INTO grids.custom_app_access (custom_app_id, access_id) VALUES (${customAppId}::uuid, ${customAppAccessId}::uuid)`;
  await sql`INSERT INTO grids.custom_app_access (custom_app_id, access_id) VALUES (${foreignCustomAppId}::uuid, ${foreignAccessId}::uuid)`;
  return {
    userId: authUser.id,
    baseId,
    customAppId,
    baseAccessId,
    customAppAccessId,
    foreignBaseId,
    foreignCustomAppId,
    foreignAccessId,
    accessIds: [baseAccessId, customAppAccessId, foreignAccessId],
  };
};

const cleanup = async (fixture: Fixture) => {
  await sql`DELETE FROM grids.audit_log WHERE base_id IN (${fixture.baseId}::uuid, ${fixture.foreignBaseId}::uuid)`;
  await sql`DELETE FROM grids.bases WHERE id IN (${fixture.baseId}::uuid, ${fixture.foreignBaseId}::uuid)`;
  for (const accessId of fixture.accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
};

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("access routes integration", () => {
  postgresTest("preserves Base list and mutation permission boundaries after route extraction", async () => {
    const fixture = await insertFixture();
    const app = appFor(fixture);
    try {
      const listed = await app.request(`/by-base/${fixture.baseId}`);
      expect(listed.status).toBe(200);
      expect(await listed.json()).toHaveLength(1);

      expect((await app.request(`/by-base/${uuid()}`)).status).toBe(403);
      expect((await app.request(`/by-base/${fixture.foreignBaseId}`)).status).toBe(403);

      const updated = await app.request(`/${fixture.baseAccessId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permission: "write" }),
      });
      expect(updated.status).toBe(204);

      expect((await app.request(`/${uuid()}`, { method: "DELETE" })).status).toBe(404);
      expect((await app.request(`/${fixture.foreignAccessId}`, { method: "DELETE" })).status).toBe(403);
    } finally {
      await cleanup(fixture);
    }
  });

  postgresTest("keeps Grids App grants exact and separate from Base grants", async () => {
    const fixture = await insertFixture();
    const app = appFor(fixture);
    try {
      const createdResponse = await app.request(`/by-custom-app/${fixture.customAppId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principal: { type: "user", userId: fixture.userId },
          permission: "read",
        }),
      });
      expect(createdResponse.status).toBe(201);
      const created = (await createdResponse.json()) as { accessId: string };
      fixture.accessIds.push(created.accessId);

      const appEntries = (await (await app.request(`/by-custom-app/${fixture.customAppId}`)).json()) as Array<{
        id: string;
        permission: string;
      }>;
      expect(appEntries.map((entry) => entry.id).sort()).toEqual([fixture.customAppAccessId, created.accessId].sort());
      expect(appEntries.find((entry) => entry.id === created.accessId)?.permission).toBe("read");

      const baseEntries = (await (await app.request(`/by-base/${fixture.baseId}`)).json()) as Array<{ id: string }>;
      expect(baseEntries.map((entry) => entry.id)).toEqual([fixture.baseAccessId]);

      const updated = await app.request(`/${created.accessId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permission: "none" }),
      });
      expect(updated.status).toBe(204);

      const invalid = await app.request(`/${created.accessId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permission: "write" }),
      });
      expect(invalid.status).toBe(400);
      expect((await app.request(`/by-custom-app/${fixture.foreignCustomAppId}`)).status).toBe(403);
    } finally {
      await cleanup(fixture);
    }
  });
});
