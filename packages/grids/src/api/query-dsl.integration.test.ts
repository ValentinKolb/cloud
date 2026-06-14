import { beforeAll, describe, expect, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { Hono, type MiddlewareHandler } from "hono";
import { migrate } from "../migrate";
import apiRoutes from "./index";
import { createGqlApi } from "./query-dsl";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

type GqlApiFixture = {
  baseId: string;
  tableId: string;
  viewId: string;
  amountId: string;
  stageId: string;
};

type GqlRelationApiFixture = {
  baseId: string;
  ordersTableId: string;
  customersTableId: string;
  byCustomerViewId: string;
  amountId: string;
  customerLinkId: string;
  customerNameId: string;
};

type SaveResponse =
  | {
      ok: true;
      query: {
        id: string;
        baseId: string;
        tableId: string;
        name: string;
        source: string;
        ownerUserId: string | null;
      };
    }
  | { ok: false; diagnostics: Array<{ message: string; line?: number; column?: number }> };

type ListResponse = Array<{
  id: string;
  name: string;
  ownerUserId: string | null;
}>;

const testUser = (overrides: { id?: string; uid?: string; roles?: User["roles"] } = {}): User => {
  const id = overrides.id ?? uuid();
  return {
    id,
    uid: overrides.uid ?? `gql-api-${id}`,
    roles: overrides.roles ?? ["admin"],
    provider: "local",
    profile: "user",
    givenname: "GQL",
    sn: "API",
    displayName: "GQL API",
    mail: `gql-api-${id}@example.test`,
    accountExpires: null,
    lastLoginLocal: null,
    memberofGroup: [],
    memberofGroupIds: [],
    manages: [],
    managesGroupIds: [],
    ipa: null,
  };
};

const authenticateAs =
  (user: User): MiddlewareHandler<AuthContext> =>
  async (c, next) => {
    c.set("actor", { kind: "user", user });
    c.set("accessSubject", { type: "user", userId: user.id });
    c.set("user", user);
    await next();
  };

const apiFor = (user: User) => new Hono<AuthContext>().route("/gql", createGqlApi({ requireAuthenticated: authenticateAs(user) }));

const jsonRequest = (method: "POST" | "PATCH", body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const existingAuthUserId = async (): Promise<string> => {
  const [row] = await sql<{ id: string }[]>`
    SELECT id::text AS id FROM auth.users ORDER BY id LIMIT 1
  `;
  if (!row) throw new Error("GQL API integration test needs one existing auth.users row for audit-log actor FK");
  return row.id;
};

const insertFixture = async (): Promise<GqlApiFixture> => {
  const baseId = uuid();
  const tableId = uuid();
  const viewId = uuid();
  const amountId = uuid();
  const stageId = uuid();

  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${baseId}::uuid, ${shortId("B")}, 'GQL API integration')
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES (${tableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'Orders', 0)
  `;
  await sql`
    INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
    VALUES
      (${amountId}::uuid, 'AMT01', ${tableId}::uuid, 'Amount', 'number', '{}'::jsonb, 0),
      (
        ${stageId}::uuid,
        'STAGE',
        ${tableId}::uuid,
        'Stage',
        'select',
        ${{
          options: [
            { id: "open", label: "Open" },
            { id: "closed", label: "Closed" },
            { id: "hold", label: "On hold" },
          ],
        }}::jsonb,
        1
      )
  `;
  await sql`
    INSERT INTO grids.views (id, short_id, table_id, name, query, position)
    VALUES (${viewId}::uuid, ${shortId("V")}, ${tableId}::uuid, 'Visible orders', '{}'::jsonb, 0)
  `;

  return { baseId, tableId, viewId, amountId, stageId };
};

const insertRelationFixture = async (): Promise<GqlRelationApiFixture> => {
  const baseId = uuid();
  const ordersTableId = uuid();
  const customersTableId = uuid();
  const byCustomerViewId = uuid();
  const amountId = uuid();
  const customerLinkId = uuid();
  const customerNameId = uuid();
  const orderAId = uuid();
  const orderBId = uuid();
  const customerAId = uuid();
  const customerBId = uuid();

  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${baseId}::uuid, ${shortId("B")}, 'GQL API relation integration')
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES
      (${ordersTableId}::uuid, ${shortId("O")}, ${baseId}::uuid, 'Orders', 0),
      (${customersTableId}::uuid, ${shortId("C")}, ${baseId}::uuid, 'Customers', 1)
  `;
  await sql`
    INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
    VALUES
      (${amountId}::uuid, 'AMT01', ${ordersTableId}::uuid, 'Amount', 'number', '{}'::jsonb, 0),
      (${customerLinkId}::uuid, 'CUSTL', ${ordersTableId}::uuid, 'Customer', 'relation', ${{ targetTableId: customersTableId }}::jsonb, 1),
      (${customerNameId}::uuid, 'NAME1', ${customersTableId}::uuid, 'Name', 'text', '{}'::jsonb, 0)
  `;
  await sql`
    INSERT INTO grids.views (id, short_id, table_id, name, query, position)
    VALUES (
      ${byCustomerViewId}::uuid,
      'BYCUS',
      ${ordersTableId}::uuid,
      'Revenue by customer',
      ${{
        groupBy: [{ fieldId: customerLinkId }],
        aggregations: [{ fieldId: amountId, agg: "sum", label: "revenue" }],
      }}::jsonb,
      0
    )
  `;
  await sql`
    INSERT INTO grids.records (id, table_id, data, version)
    VALUES
      (${customerAId}::uuid, ${customersTableId}::uuid, ${{ [customerNameId]: "Alice" }}::jsonb, 1),
      (${customerBId}::uuid, ${customersTableId}::uuid, ${{ [customerNameId]: "Bob" }}::jsonb, 1),
      (${orderAId}::uuid, ${ordersTableId}::uuid, ${{ [amountId]: "12.50" }}::jsonb, 1),
      (${orderBId}::uuid, ${ordersTableId}::uuid, ${{ [amountId]: "4.00" }}::jsonb, 1)
  `;
  await sql`
    INSERT INTO grids.record_links (from_record_id, from_field_id, to_record_id, position)
    VALUES
      (${orderAId}::uuid, ${customerLinkId}::uuid, ${customerAId}::uuid, 0),
      (${orderBId}::uuid, ${customerLinkId}::uuid, ${customerBId}::uuid, 0)
  `;

  return { baseId, ordersTableId, customersTableId, byCustomerViewId, amountId, customerLinkId, customerNameId };
};

const cleanupFixture = async (baseId: string): Promise<void> => {
  await sql`DELETE FROM grids.audit_log WHERE base_id = ${baseId}::uuid`;
  await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
};

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("GQL API route contract", () => {
  postgresTest("exposes GQL under /gql and leaves the legacy /query-dsl alias removed", async () => {
    const baseId = uuid();

    const gqlResponse = await apiRoutes.request(`/gql/by-base/${baseId}/saved`);
    expect(gqlResponse.status).toBe(401);
    expect(await gqlResponse.json()).toEqual({ message: "Authentication required" });

    const legacyResponse = await apiRoutes.request(`/query-dsl/by-base/${baseId}/saved`);
    expect(legacyResponse.status).toBe(404);
  });

  postgresTest("lists private saved GQL queries for base admins", async () => {
    const fixture = await insertFixture();
    const ownerId = await existingAuthUserId();
    const privateQueryId = uuid();
    const admin = testUser({ id: uuid(), roles: ["admin"] });
    const app = apiFor(admin);

    try {
      await sql`
        INSERT INTO grids.gql_queries (id, short_id, base_id, table_id, name, source, owner_user_id, position)
        VALUES (
          ${privateQueryId}::uuid,
          ${shortId("Q")},
          ${fixture.baseId}::uuid,
          ${fixture.tableId}::uuid,
          'Owner private query',
          ${`from table {${fixture.tableId}}\nselect {${fixture.amountId}}`},
          ${ownerId}::uuid,
          0
        )
      `;

      const response = await app.request(`/gql/by-base/${fixture.baseId}/saved`);
      expect(response.status).toBe(200);
      const list = (await response.json()) as ListResponse;
      expect(list.map((query) => query.id)).toContain(privateQueryId);
      expect(list.find((query) => query.id === privateQueryId)?.ownerUserId).toBe(ownerId);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("returns neutral not found for unreadable saved GQL mutations", async () => {
    const fixture = await insertFixture();
    const ownerId = await existingAuthUserId();
    const privateQueryId = uuid();
    const deletedPrivateQueryId = uuid();
    const app = apiFor(testUser({ id: uuid(), roles: ["user"] }));

    try {
      await sql`
        INSERT INTO grids.gql_queries (id, short_id, base_id, table_id, name, source, owner_user_id, position, deleted_at)
        VALUES
          (
            ${privateQueryId}::uuid,
            ${shortId("Q")},
            ${fixture.baseId}::uuid,
            ${fixture.tableId}::uuid,
            'Private query',
            ${`from table {${fixture.tableId}}\nselect {${fixture.amountId}}`},
            ${ownerId}::uuid,
            0,
            NULL
          ),
          (
            ${deletedPrivateQueryId}::uuid,
            ${shortId("Q")},
            ${fixture.baseId}::uuid,
            ${fixture.tableId}::uuid,
            'Deleted private query',
            ${`from table {${fixture.tableId}}\nselect {${fixture.amountId}}`},
            ${ownerId}::uuid,
            1,
            now()
          )
      `;

      const patch = await app.request(`/gql/saved/${privateQueryId}`, jsonRequest("PATCH", { name: "Leaked" }));
      expect(patch.status).toBe(404);
      expect(await patch.json()).toEqual({ message: "GQL query not found" });

      const remove = await app.request(`/gql/saved/${privateQueryId}`, { method: "DELETE" });
      expect(remove.status).toBe(404);
      expect(await remove.json()).toEqual({ message: "GQL query not found" });

      const restore = await app.request(`/gql/saved/${deletedPrivateQueryId}/restore`, { method: "POST" });
      expect(restore.status).toBe(404);
      expect(await restore.json()).toEqual({ message: "GQL query not found" });
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("canonicalizes saved query source at the public API boundary", async () => {
    const fixture = await insertFixture();
    const user = testUser({ id: await existingAuthUserId() });
    const app = apiFor(user);

    try {
      const created = await app.request(
        `/gql/by-base/${fixture.baseId}/saved`,
        jsonRequest("POST", {
          name: "Open orders",
          shared: true,
          query: `
            from table Orders
            select Amount
            where Stage = 'Open'
            limit 5
          `,
        }),
      );
      expect(created.status).toBe(201);
      const createdBody = (await created.json()) as SaveResponse;
      expect(createdBody.ok).toBe(true);
      if (!createdBody.ok) throw new Error(createdBody.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
      expect(createdBody.query).toMatchObject({
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        name: "Open orders",
        ownerUserId: null,
        source: `from table {${fixture.tableId}}
select {${fixture.amountId}}
where {${fixture.stageId}} = 'open'
limit 5`,
      });

      const updated = await app.request(
        `/gql/saved/${createdBody.query.id}`,
        jsonRequest("PATCH", {
          name: "Closed or held orders",
          query: `
            from table Orders
            where oneof(Stage, 'Closed', 'On hold')
            include deleted
            limit 10
          `,
        }),
      );
      expect(updated.status).toBe(200);
      const updatedBody = (await updated.json()) as SaveResponse;
      expect(updatedBody.ok).toBe(true);
      if (!updatedBody.ok) throw new Error(updatedBody.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
      expect(updatedBody.query).toMatchObject({
        name: "Closed or held orders",
        source: `from table {${fixture.tableId}}
where oneof({${fixture.stageId}}, 'closed', 'hold')
limit 10
include deleted`,
      });

      const loaded = await app.request(`/gql/saved/${createdBody.query.id}`);
      expect(loaded.status).toBe(200);
      const loadedBody = (await loaded.json()) as { source: string };
      expect(loadedBody.source).toBe(updatedBody.query.source);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("canonicalizes implicit table and view current sources at the public API boundary", async () => {
    const fixture = await insertFixture();
    const user = testUser({ id: await existingAuthUserId() });
    const app = apiFor(user);

    try {
      const tableScoped = await app.request(
        `/gql/by-base/${fixture.baseId}/saved`,
        jsonRequest("POST", {
          name: "Current table query",
          shared: true,
          currentSource: { kind: "table", tableId: fixture.tableId },
          query: `
            select Amount
            where Stage = 'Open'
          `,
        }),
      );
      expect(tableScoped.status).toBe(201);
      const tableBody = (await tableScoped.json()) as SaveResponse;
      expect(tableBody.ok).toBe(true);
      if (!tableBody.ok) throw new Error(tableBody.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
      expect(tableBody.query.source).toBe(`from table {${fixture.tableId}}
select {${fixture.amountId}}
where {${fixture.stageId}} = 'open'`);

      const viewScoped = await app.request(
        `/gql/by-base/${fixture.baseId}/saved`,
        jsonRequest("POST", {
          name: "Current view query",
          shared: true,
          currentSource: { kind: "view", viewId: fixture.viewId },
          query: `
            select Amount
            limit 2
          `,
        }),
      );
      expect(viewScoped.status).toBe(201);
      const viewBody = (await viewScoped.json()) as SaveResponse;
      expect(viewBody.ok).toBe(true);
      if (!viewBody.ok) throw new Error(viewBody.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
      expect(viewBody.query.source).toBe(`from view {${fixture.viewId}}
select {${fixture.amountId}}
limit 2`);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("previews derived relation search by target labels without an explicit join", async () => {
    const fixture = await insertRelationFixture();
    const app = apiFor(testUser());

    try {
      const response = await app.request(
        `/gql/by-base/${fixture.baseId}/preview`,
        jsonRequest("POST", {
          currentSource: { kind: "view", viewId: fixture.byCustomerViewId },
          query: `
            search 'Alice' in Customer
            select Customer, revenue
          `,
        }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ok: true;
        mode: "groups";
        rows: Array<{ values: Record<string, unknown> }>;
      };
      expect(body.ok).toBe(true);
      expect(body.mode).toBe("groups");
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0]?.values.gk_0).toBe("Alice");
      expect(Number(body.rows[0]?.values[`${fixture.amountId}__sum`])).toBe(12.5);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("returns parser and canonicalization diagnostics instead of generic API errors", async () => {
    const fixture = await insertFixture();
    const app = apiFor(testUser());

    try {
      const legacySyntax = await app.request(
        `/gql/by-base/${fixture.baseId}/saved`,
        jsonRequest("POST", {
          name: "Legacy syntax",
          query: "from table #Orders",
        }),
      );
      expect(legacySyntax.status).toBe(200);
      const legacyBody = (await legacySyntax.json()) as SaveResponse;
      expect(legacyBody.ok).toBe(false);
      if (legacyBody.ok) throw new Error("expected parser diagnostics");
      expect(legacyBody.diagnostics[0]?.message.startsWith("legacy # references are not valid in GQL")).toBe(true);

      const unknownOption = await app.request(
        `/gql/by-base/${fixture.baseId}/saved`,
        jsonRequest("POST", {
          name: "Unknown option",
          query: "from table Orders\nwhere Stage = 'Missing'",
        }),
      );
      expect(unknownOption.status).toBe(200);
      const optionBody = (await unknownOption.json()) as SaveResponse;
      expect(optionBody.ok).toBe(false);
      if (optionBody.ok) throw new Error("expected canonicalization diagnostics");
      expect(optionBody.diagnostics[0]?.message).toBe('unknown option "Missing" for "Stage"; expected one of: Open, Closed, On hold');
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });
});
