import { beforeAll, describe, expect, test } from "bun:test";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { err, fail, ok } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { Hono } from "hono";
import { migrate } from "../migrate";
import { createAccessEntryRoutes } from "./access-entry-routes";
import { createAccessResourceRoutes } from "./access-resource-routes";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;
const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

type Fixture = {
  userId: string;
  baseId: string;
  tableId: string;
  tableAccessId: string;
  foreignBaseId: string;
  foreignTableId: string;
  foreignAccessId: string;
  accessIds: string[];
};

const appFor = (fixture: Fixture) => {
  const gate: NonNullable<Parameters<typeof createAccessResourceRoutes>[0]>["gate"] = async (_context, target) =>
    target.baseId === fixture.baseId ? ok("admin" as const) : fail(err.forbidden("You do not have permission to access this resource."));
  const deps = {
    gate,
    actorId: () => fixture.userId,
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
  const tableId = uuid();
  const foreignBaseId = uuid();
  const foreignTableId = uuid();
  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES
      (${baseId}::uuid, ${shortId("B")}, 'Access routes'),
      (${foreignBaseId}::uuid, ${shortId("F")}, 'Foreign access routes')
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name)
    VALUES
      (${tableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'Items'),
      (${foreignTableId}::uuid, ${shortId("X")}, ${foreignBaseId}::uuid, 'Foreign items')
  `;

  const baseAdminId = await insertAccess("admin", authUser.id);
  const tableAccessId = await insertAccess("read", null);
  const foreignAccessId = await insertAccess("read", null);
  await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${baseId}::uuid, ${baseAdminId}::uuid)`;
  await sql`INSERT INTO grids.table_access (table_id, access_id) VALUES (${tableId}::uuid, ${tableAccessId}::uuid)`;
  await sql`INSERT INTO grids.table_access (table_id, access_id) VALUES (${foreignTableId}::uuid, ${foreignAccessId}::uuid)`;
  return {
    userId: authUser.id,
    baseId,
    tableId,
    tableAccessId,
    foreignBaseId,
    foreignTableId,
    foreignAccessId,
    accessIds: [baseAdminId, tableAccessId, foreignAccessId],
  };
};

const cleanup = async (fixture: Fixture) => {
  await sql`DELETE FROM grids.audit_log WHERE base_id IN (${fixture.baseId}::uuid, ${fixture.foreignBaseId}::uuid)`;
  await sql`DELETE FROM grids.bases WHERE id IN (${fixture.baseId}::uuid, ${fixture.foreignBaseId}::uuid)`;
  for (const accessId of fixture.accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
};

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("access routes integration", () => {
  postgresTest("preserves list and mutation permission boundaries after route extraction", async () => {
    const fixture = await insertFixture();
    const app = appFor(fixture);
    try {
      const listed = await app.request(`/by-table/${fixture.tableId}`);
      expect(listed.status).toBe(200);
      expect(await listed.json()).toHaveLength(1);

      expect((await app.request(`/by-table/${uuid()}`)).status).toBe(404);
      expect((await app.request(`/by-table/${fixture.foreignTableId}`)).status).toBe(403);

      const updated = await app.request(`/${fixture.tableAccessId}`, {
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
});
