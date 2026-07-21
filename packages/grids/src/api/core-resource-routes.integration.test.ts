import { beforeAll, describe, expect } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { serviceAccountCredentials, serviceAccounts } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import { Hono } from "hono";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { dropFieldUniqueIndex, ensureFieldUniqueIndex } from "../service/field-indexes";
import fieldsRoutes from "./fields";
import recordsRoutes from "./records";
import tablesRoutes from "./tables";
import viewsRoutes from "./views";

type Fixture = {
  user: User;
  baseId: string;
  foreignBaseId: string;
  tableId: string;
  foreignTableId: string;
  uniqueFieldId: string;
  serviceAccountId: string;
  accessIds: string[];
  tokens: Record<"read" | "write" | "admin", string>;
};

const app = new Hono<AuthContext>()
  .route("/tables", tablesRoutes)
  .route("/fields", fieldsRoutes)
  .route("/records", recordsRoutes)
  .route("/views", viewsRoutes);

const jsonRequest = (token: string, body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(body),
});

const bearer = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });

const count = async (table: "tables" | "fields" | "records" | "views", column: string, value: string): Promise<number> => {
  const rows = await sql.unsafe(`SELECT count(*)::int AS count FROM grids.${table} WHERE ${column} = $1::uuid`, [value]);
  return Number((rows[0] as { count: number } | undefined)?.count ?? 0);
};

const createFixture = async (): Promise<Fixture> => {
  const userId = testUuid();
  const baseId = testUuid();
  const foreignBaseId = testUuid();
  const tableId = testUuid();
  const foreignTableId = testUuid();
  const uniqueFieldId = testUuid();
  const user: User = {
    id: userId,
    uid: `route-matrix-${userId}`,
    roles: ["user"],
    provider: "local",
    profile: "user",
    givenname: "Route",
    sn: "Matrix",
    displayName: "Route Matrix",
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

  await sql`
    INSERT INTO auth.users (id, uid, provider, profile, display_name, given_name, sn)
    VALUES (${user.id}::uuid, ${user.uid}, 'local', 'user', ${user.displayName}, ${user.givenname}, ${user.sn})
  `;
  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES
      (${baseId}::uuid, ${testShortId("B")}, 'Route matrix'),
      (${foreignBaseId}::uuid, ${testShortId("X")}, 'Foreign route matrix')
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES
      (${tableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Items', 0),
      (${foreignTableId}::uuid, ${testShortId("F")}, ${foreignBaseId}::uuid, 'Foreign items', 0)
  `;
  await sql`
    INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position, unique_constraint)
    VALUES (${uniqueFieldId}::uuid, ${testShortId("U")}, ${tableId}::uuid, 'Serial', 'text', '{}'::jsonb, 0, TRUE)
  `;
  await ensureFieldUniqueIndex(uniqueFieldId, "text", tableId);

  const account = await serviceAccounts.getOrCreateResourceBound({
    name: "Grids route matrix",
    appId: "grids",
    resourceType: "base",
    resourceId: baseId,
    createdBy: user.id,
  });
  if (!account.ok) throw new Error(account.error.message);

  const accessIds: string[] = [];
  for (const authorizedBaseId of [baseId, foreignBaseId]) {
    const accessId = testUuid();
    accessIds.push(accessId);
    await sql`
      INSERT INTO auth.access (id, service_account_id, permission)
      VALUES (${accessId}::uuid, ${account.data.id}::uuid, 'admin'::auth.permission_level)
    `;
    await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${authorizedBaseId}::uuid, ${accessId}::uuid)`;
  }

  const tokens = {} as Fixture["tokens"];
  for (const scope of ["read", "write", "admin"] as const) {
    const credential = await serviceAccountCredentials.createResourceApiToken({
      serviceAccountId: account.data.id,
      actor: user,
      name: `Route matrix ${scope}`,
      scopes: [`grids:${scope}`],
    });
    if (!credential.ok) throw new Error(credential.error.message);
    tokens[scope] = credential.data.token;
  }

  return {
    user,
    baseId,
    foreignBaseId,
    tableId,
    foreignTableId,
    uniqueFieldId,
    serviceAccountId: account.data.id,
    accessIds,
    tokens,
  };
};

const cleanupFixture = async (fixture: Fixture) => {
  await dropFieldUniqueIndex(fixture.uniqueFieldId);
  await sql`DELETE FROM grids.audit_log WHERE base_id IN (${fixture.baseId}::uuid, ${fixture.foreignBaseId}::uuid)`;
  await sql`DELETE FROM grids.bases WHERE id IN (${fixture.baseId}::uuid, ${fixture.foreignBaseId}::uuid)`;
  for (const accessId of fixture.accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
  await sql`DELETE FROM auth.service_accounts WHERE id = ${fixture.serviceAccountId}::uuid`;
  await sql`DELETE FROM auth.users WHERE id = ${fixture.user.id}::uuid`;
};

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("classic resource route contracts", () => {
  postgresTest(
    "enforces auth, credential caps, resource binding, validation, and result mappings",
    async () => {
      const fixture = await createFixture();
      try {
        expect((await app.request(`/tables/by-base/${fixture.baseId}`)).status).toBe(401);

        const readable = await app.request(`/tables/by-base/${fixture.baseId}`, bearer(fixture.tokens.read));
        expect(readable.status).toBe(200);
        expect((await readable.json()).map((table: { id: string }) => table.id)).toContain(fixture.tableId);

        const foreign = await app.request(`/tables/by-base/${fixture.foreignBaseId}`, bearer(fixture.tokens.admin));
        expect(foreign.status).toBe(403);

        const unknown = await app.request(`/fields/by-table/${testUuid()}`, bearer(fixture.tokens.admin));
        expect(unknown.status).toBe(404);
        expect(await unknown.json()).toEqual({ message: "Table not found" });

        const invalidId = await app.request("/fields/by-table/not-a-uuid", bearer(fixture.tokens.admin));
        expect(invalidId.status).toBe(404);
        expect(await invalidId.json()).toEqual({ message: "Table not found" });

        for (const [path, options, message] of [
          ["/tables/by-base/not-a-uuid", bearer(fixture.tokens.admin), "Base not found"],
          ["/records/by-table/not-a-uuid", jsonRequest(fixture.tokens.admin, {}), "Table not found"],
          [`/records/${fixture.tableId}/not-a-uuid`, bearer(fixture.tokens.admin), "Record not found"],
          ["/views/not-a-uuid", bearer(fixture.tokens.admin), "View not found"],
          ["/tables/not-a-uuid/query", jsonRequest(fixture.tokens.admin, { query: {} }), "Table not found"],
        ] as const) {
          const response = await app.request(path, options);
          expect(response.status).toBe(404);
          expect(await response.json()).toEqual({ message });
        }

        const tableCount = await count("tables", "base_id", fixture.baseId);
        const deniedTableCreate = await app.request(
          `/tables/by-base/${fixture.baseId}`,
          jsonRequest(fixture.tokens.write, { name: "Denied table" }),
        );
        expect(deniedTableCreate.status).toBe(403);
        expect(await count("tables", "base_id", fixture.baseId)).toBe(tableCount);

        const invalidTableCreate = await app.request(`/tables/by-base/${fixture.baseId}`, jsonRequest(fixture.tokens.admin, { name: "" }));
        expect(invalidTableCreate.status).toBe(400);
        expect(await count("tables", "base_id", fixture.baseId)).toBe(tableCount);

        const fieldCount = await count("fields", "table_id", fixture.tableId);
        const deniedFieldCreate = await app.request(
          `/fields/by-table/${fixture.tableId}`,
          jsonRequest(fixture.tokens.write, { name: "Denied field", type: "text" }),
        );
        expect(deniedFieldCreate.status).toBe(403);
        expect(await count("fields", "table_id", fixture.tableId)).toBe(fieldCount);

        const invalidFieldCreate = await app.request(
          `/fields/by-table/${fixture.tableId}`,
          jsonRequest(fixture.tokens.admin, { name: "", type: "text" }),
        );
        expect(invalidFieldCreate.status).toBe(400);
        expect(await count("fields", "table_id", fixture.tableId)).toBe(fieldCount);

        const createdField = await app.request(
          `/fields/by-table/${fixture.tableId}`,
          jsonRequest(fixture.tokens.admin, { name: "Notes", type: "text" }),
        );
        expect(createdField.status).toBe(201);
        expect(await count("fields", "table_id", fixture.tableId)).toBe(fieldCount + 1);

        const deniedRecordCreate = await app.request(
          `/records/by-table/${fixture.tableId}`,
          jsonRequest(fixture.tokens.read, { [fixture.uniqueFieldId]: "SERIAL-1" }),
        );
        expect(deniedRecordCreate.status).toBe(403);
        expect(await count("records", "table_id", fixture.tableId)).toBe(0);

        const createdRecord = await app.request(
          `/records/by-table/${fixture.tableId}`,
          jsonRequest(fixture.tokens.write, { [fixture.uniqueFieldId]: "SERIAL-1" }),
        );
        expect(createdRecord.status).toBe(201);
        expect(await count("records", "table_id", fixture.tableId)).toBe(1);

        const duplicateRecord = await app.request(
          `/records/by-table/${fixture.tableId}`,
          jsonRequest(fixture.tokens.write, { [fixture.uniqueFieldId]: "SERIAL-1" }),
        );
        expect(duplicateRecord.status).toBe(409);
        expect(await count("records", "table_id", fixture.tableId)).toBe(1);

        const views = await app.request(`/views/by-table/${fixture.tableId}`, bearer(fixture.tokens.read));
        expect(views.status).toBe(200);

        const viewCount = await count("views", "table_id", fixture.tableId);
        const invalidView = await app.request(
          `/views/by-table/${fixture.tableId}`,
          jsonRequest(fixture.tokens.admin, { name: "Broken view", shared: true, source: "from table Missing" }),
        );
        expect(invalidView.status).toBe(400);
        expect(await count("views", "table_id", fixture.tableId)).toBe(viewCount);
      } finally {
        await cleanupFixture(fixture);
      }
    },
    20_000,
  );
});
