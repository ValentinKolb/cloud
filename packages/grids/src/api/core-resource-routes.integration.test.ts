import { beforeAll, describe, expect } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { serviceAccountCredentials, serviceAccounts } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import { Hono } from "hono";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { dropFieldUniqueIndex, ensureFieldUniqueIndex } from "../service/field-indexes";
import basesRoutes from "./bases";
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
  foreignViewId: string;
  uniqueFieldId: string;
  serviceAccountIds: string[];
  accessIds: string[];
  tokens: Record<"read" | "write" | "admin" | "delegated", string>;
};

const app = new Hono<AuthContext>()
  .route("/bases", basesRoutes)
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

const sideEffectCounts = async (baseId: string): Promise<{ audit: number; outbox: number }> => {
  const [row] = await sql<Array<{ audit: number; outbox: number }>>`
    SELECT
      (
        SELECT count(*)::int
        FROM grids.audit_log
        WHERE base_id = ${baseId}::uuid
          OR table_id IN (SELECT id FROM grids.tables WHERE base_id = ${baseId}::uuid)
      ) AS audit,
      (SELECT count(*)::int FROM grids.record_event_outbox WHERE base_id = ${baseId}::uuid) AS outbox
  `;
  return { audit: Number(row?.audit ?? 0), outbox: Number(row?.outbox ?? 0) };
};

const newFixture = (): Fixture => {
  const userId = testUuid();
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

  return {
    user,
    baseId: testUuid(),
    foreignBaseId: testUuid(),
    tableId: testUuid(),
    foreignTableId: testUuid(),
    foreignViewId: testUuid(),
    uniqueFieldId: testUuid(),
    serviceAccountIds: [],
    accessIds: [],
    tokens: { read: "", write: "", admin: "", delegated: "" },
  };
};

const setupFixture = async (fixture: Fixture): Promise<void> => {
  await sql`
    INSERT INTO auth.users (id, uid, provider, profile, display_name, given_name, sn)
    VALUES (
      ${fixture.user.id}::uuid,
      ${fixture.user.uid},
      'local',
      'user',
      ${fixture.user.displayName},
      ${fixture.user.givenname},
      ${fixture.user.sn}
    )
  `;
  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES
      (${fixture.baseId}::uuid, ${testShortId("B")}, 'Route matrix'),
      (${fixture.foreignBaseId}::uuid, ${testShortId("X")}, 'Foreign route matrix')
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES
      (${fixture.tableId}::uuid, ${testShortId("T")}, ${fixture.baseId}::uuid, 'Items', 0),
      (${fixture.foreignTableId}::uuid, ${testShortId("F")}, ${fixture.foreignBaseId}::uuid, 'Foreign items', 0)
  `;
  await sql`
    INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position, unique_constraint)
    VALUES (
      ${fixture.uniqueFieldId}::uuid,
      ${testShortId("U")},
      ${fixture.tableId}::uuid,
      'Serial',
      'text',
      '{}'::jsonb,
      0,
      TRUE
    )
  `;
  await ensureFieldUniqueIndex(fixture.uniqueFieldId, "text", fixture.tableId);
  await sql`
    INSERT INTO grids.views (id, short_id, table_id, base_id, name, source, ui, position)
    VALUES (
      ${fixture.foreignViewId}::uuid,
      ${testShortId("V")},
      ${fixture.foreignTableId}::uuid,
      ${fixture.foreignBaseId}::uuid,
      'Foreign view',
      ${`from table {${fixture.foreignTableId}}`},
      '{}'::jsonb,
      0
    )
  `;

  const account = await serviceAccounts.getOrCreateResourceBound({
    name: "Grids route matrix",
    appId: "grids",
    resourceType: "base",
    resourceId: fixture.baseId,
    createdBy: fixture.user.id,
  });
  if (!account.ok) throw new Error(account.error.message);
  fixture.serviceAccountIds.push(account.data.id);

  for (const authorizedBaseId of [fixture.baseId, fixture.foreignBaseId]) {
    const accessId = testUuid();
    fixture.accessIds.push(accessId);
    await sql`
      INSERT INTO auth.access (id, service_account_id, permission)
      VALUES (${accessId}::uuid, ${account.data.id}::uuid, 'admin'::auth.permission_level)
    `;
    await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${authorizedBaseId}::uuid, ${accessId}::uuid)`;
  }

  for (const scope of ["read", "write", "admin"] as const) {
    const credential = await serviceAccountCredentials.createResourceApiToken({
      serviceAccountId: account.data.id,
      actor: fixture.user,
      name: `Route matrix ${scope}`,
      scopes: [`grids:${scope}`],
    });
    if (!credential.ok) throw new Error(credential.error.message);
    fixture.tokens[scope] = credential.data.token;
  }

  const userAccessId = testUuid();
  fixture.accessIds.push(userAccessId);
  await sql`
    INSERT INTO auth.access (id, user_id, permission)
    VALUES (${userAccessId}::uuid, ${fixture.user.id}::uuid, 'read'::auth.permission_level)
  `;
  await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${fixture.baseId}::uuid, ${userAccessId}::uuid)`;

  const delegatedAccount = await serviceAccounts.createUserDelegated({
    name: "Grids route matrix delegated",
    delegatedUserId: fixture.user.id,
    createdBy: fixture.user.id,
  });
  if (!delegatedAccount.ok) throw new Error(delegatedAccount.error.message);
  fixture.serviceAccountIds.push(delegatedAccount.data.id);
  const delegatedCredential = await serviceAccountCredentials.createApiToken({
    serviceAccountId: delegatedAccount.data.id,
    name: "Route matrix delegated admin scope",
    createdBy: fixture.user.id,
    scopes: ["grids:admin"],
  });
  if (!delegatedCredential.ok) throw new Error(delegatedCredential.error.message);
  fixture.tokens.delegated = delegatedCredential.data.token;
};

const cleanupFixture = async (fixture: Fixture) => {
  const errors: unknown[] = [];
  const attempt = async (cleanup: () => Promise<unknown>) => {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  };

  await attempt(() => dropFieldUniqueIndex(fixture.uniqueFieldId, { throwOnError: true }));
  await attempt(
    () => sql`
      DELETE FROM grids.audit_log
      WHERE base_id IN (${fixture.baseId}::uuid, ${fixture.foreignBaseId}::uuid)
        OR table_id IN (${fixture.tableId}::uuid, ${fixture.foreignTableId}::uuid)
    `,
  );
  await attempt(() => sql`DELETE FROM grids.bases WHERE id IN (${fixture.baseId}::uuid, ${fixture.foreignBaseId}::uuid)`);
  for (const accessId of fixture.accessIds) await attempt(() => sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`);
  for (const serviceAccountId of fixture.serviceAccountIds) {
    await attempt(() => sql`DELETE FROM auth.service_accounts WHERE id = ${serviceAccountId}::uuid`);
  }
  await attempt(() => sql`DELETE FROM auth.users WHERE id = ${fixture.user.id}::uuid`);

  if (errors.length > 0) throw new AggregateError(errors, "Route matrix fixture cleanup failed");
};

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("classic resource route contracts", () => {
  postgresTest(
    "enforces auth, credential caps, resource binding, validation, and result mappings",
    async () => {
      const fixture = newFixture();
      let primaryError: unknown;
      let primaryFailed = false;
      try {
        await setupFixture(fixture);

        expect((await app.request(`/tables/by-base/${fixture.baseId}`)).status).toBe(401);

        const readable = await app.request(`/tables/by-base/${fixture.baseId}`, bearer(fixture.tokens.read));
        expect(readable.status).toBe(200);
        expect((await readable.json()).map((table: { id: string }) => table.id)).toContain(fixture.tableId);

        const foreign = await app.request(`/tables/by-base/${fixture.foreignBaseId}`, bearer(fixture.tokens.admin));
        expect(foreign.status).toBe(403);

        expect((await app.request(`/bases/${fixture.baseId}`, bearer(fixture.tokens.delegated))).status).toBe(200);
        expect((await app.request(`/bases/${fixture.foreignBaseId}`, bearer(fixture.tokens.delegated))).status).toBe(403);
        expect((await app.request(`/tables/${fixture.foreignTableId}`, bearer(fixture.tokens.delegated))).status).toBe(403);
        expect((await app.request(`/views/${fixture.foreignViewId}`, bearer(fixture.tokens.delegated))).status).toBe(404);

        const unknown = await app.request(`/fields/by-table/${testUuid()}`, bearer(fixture.tokens.admin));
        expect(unknown.status).toBe(404);
        expect(await unknown.json()).toEqual({ message: "Table not found" });

        const invalidId = await app.request("/fields/by-table/not-a-uuid", bearer(fixture.tokens.admin));
        expect(invalidId.status).toBe(404);
        expect(await invalidId.json()).toEqual({ message: "Table not found" });

        for (const [path, options, message] of [
          ["/bases/not-a-uuid", bearer(fixture.tokens.admin), "Base not found"],
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
        const initialSideEffects = await sideEffectCounts(fixture.baseId);
        const deniedTableCreate = await app.request(
          `/tables/by-base/${fixture.baseId}`,
          jsonRequest(fixture.tokens.write, { name: "Denied table" }),
        );
        expect(deniedTableCreate.status).toBe(403);
        expect(await count("tables", "base_id", fixture.baseId)).toBe(tableCount);
        expect(await sideEffectCounts(fixture.baseId)).toEqual(initialSideEffects);

        const invalidTableCreate = await app.request(`/tables/by-base/${fixture.baseId}`, jsonRequest(fixture.tokens.admin, { name: "" }));
        expect(invalidTableCreate.status).toBe(400);
        expect(await count("tables", "base_id", fixture.baseId)).toBe(tableCount);
        expect(await sideEffectCounts(fixture.baseId)).toEqual(initialSideEffects);

        const fieldCount = await count("fields", "table_id", fixture.tableId);
        const deniedFieldCreate = await app.request(
          `/fields/by-table/${fixture.tableId}`,
          jsonRequest(fixture.tokens.write, { name: "Denied field", type: "text" }),
        );
        expect(deniedFieldCreate.status).toBe(403);
        expect(await count("fields", "table_id", fixture.tableId)).toBe(fieldCount);
        expect(await sideEffectCounts(fixture.baseId)).toEqual(initialSideEffects);

        const invalidFieldCreate = await app.request(
          `/fields/by-table/${fixture.tableId}`,
          jsonRequest(fixture.tokens.admin, { name: "", type: "text" }),
        );
        expect(invalidFieldCreate.status).toBe(400);
        expect(await count("fields", "table_id", fixture.tableId)).toBe(fieldCount);
        expect(await sideEffectCounts(fixture.baseId)).toEqual(initialSideEffects);

        const createdField = await app.request(
          `/fields/by-table/${fixture.tableId}`,
          jsonRequest(fixture.tokens.admin, { name: "Notes", type: "text" }),
        );
        expect(createdField.status).toBe(201);
        expect(await count("fields", "table_id", fixture.tableId)).toBe(fieldCount + 1);

        const beforeDeniedRecord = await sideEffectCounts(fixture.baseId);
        const deniedRecordCreate = await app.request(
          `/records/by-table/${fixture.tableId}`,
          jsonRequest(fixture.tokens.read, { [fixture.uniqueFieldId]: "SERIAL-1" }),
        );
        expect(deniedRecordCreate.status).toBe(403);
        expect(await count("records", "table_id", fixture.tableId)).toBe(0);
        expect(await sideEffectCounts(fixture.baseId)).toEqual(beforeDeniedRecord);

        const beforeCreatedRecord = await sideEffectCounts(fixture.baseId);
        const createdRecord = await app.request(
          `/records/by-table/${fixture.tableId}`,
          jsonRequest(fixture.tokens.write, { [fixture.uniqueFieldId]: "SERIAL-1" }),
        );
        expect(createdRecord.status).toBe(201);
        expect(await count("records", "table_id", fixture.tableId)).toBe(1);
        expect(await sideEffectCounts(fixture.baseId)).toEqual({
          audit: beforeCreatedRecord.audit + 1,
          outbox: beforeCreatedRecord.outbox + 1,
        });

        const [recordBeforeConflict] = await sql<Array<{ data: Record<string, unknown>; version: number }>>`
          SELECT data, version
          FROM grids.records
          WHERE table_id = ${fixture.tableId}::uuid
        `;
        const beforeConflict = await sideEffectCounts(fixture.baseId);
        const duplicateRecord = await app.request(
          `/records/by-table/${fixture.tableId}`,
          jsonRequest(fixture.tokens.write, { [fixture.uniqueFieldId]: "SERIAL-1" }),
        );
        expect(duplicateRecord.status).toBe(409);
        expect(await count("records", "table_id", fixture.tableId)).toBe(1);
        const [recordAfterConflict] = await sql<Array<{ data: Record<string, unknown>; version: number }>>`
          SELECT data, version
          FROM grids.records
          WHERE table_id = ${fixture.tableId}::uuid
        `;
        expect(recordAfterConflict).toEqual(recordBeforeConflict);
        expect(await sideEffectCounts(fixture.baseId)).toEqual(beforeConflict);

        const views = await app.request(`/views/by-table/${fixture.tableId}`, bearer(fixture.tokens.read));
        expect(views.status).toBe(200);

        const viewCount = await count("views", "table_id", fixture.tableId);
        const beforeInvalidView = await sideEffectCounts(fixture.baseId);
        const invalidView = await app.request(
          `/views/by-table/${fixture.tableId}`,
          jsonRequest(fixture.tokens.admin, { name: "Broken view", shared: true, source: "from table Missing" }),
        );
        expect(invalidView.status).toBe(400);
        expect(await count("views", "table_id", fixture.tableId)).toBe(viewCount);
        expect(await sideEffectCounts(fixture.baseId)).toEqual(beforeInvalidView);
      } catch (error) {
        primaryError = error;
        primaryFailed = true;
        throw error;
      } finally {
        try {
          await cleanupFixture(fixture);
        } catch (cleanupError) {
          if (primaryFailed) {
            throw new AggregateError([primaryError, cleanupError], "Route matrix failed and fixture cleanup also failed");
          }
          throw cleanupError;
        }
      }
    },
    20_000,
  );
});
