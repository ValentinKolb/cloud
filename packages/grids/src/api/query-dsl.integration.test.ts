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

type CompileViewResponse =
  | { ok: true; tableId: string; source: string }
  | { ok: false; diagnostics: Array<{ message: string; line?: number; column?: number }> };

type AutocompleteResponse = {
  ok: true;
  diagnostics: Array<{ message: string; line?: number; column?: number }>;
  items: Array<{ label: string; insertText: string; detail?: string }>;
};

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
    avatarHash: null,
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
    INSERT INTO grids.views (id, short_id, table_id, name, source, ui, position)
    VALUES (${viewId}::uuid, ${shortId("V")}, ${tableId}::uuid, 'Visible orders', ${`from table {${tableId}}`}, '{}'::jsonb, 0)
  `;

  return { baseId, tableId, viewId, amountId, stageId };
};

const insertAutocompletePermissionFixture = async (
  userId: string,
): Promise<{
  baseId: string;
  accessIds: string[];
}> => {
  const baseId = uuid();
  const publicTableId = uuid();
  const secretTableId = uuid();
  const publicAmountId = uuid();
  const secretCodeId = uuid();
  const secretViewId = uuid();

  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${baseId}::uuid, ${shortId("B")}, 'GQL autocomplete permissions')
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES
      (${publicTableId}::uuid, ${shortId("P")}, ${baseId}::uuid, 'PublicOrders', 0),
      (${secretTableId}::uuid, ${shortId("S")}, ${baseId}::uuid, 'SecretDeals', 1)
  `;
  await sql`
    INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
    VALUES
      (${publicAmountId}::uuid, 'PUBAM', ${publicTableId}::uuid, 'PublicAmount', 'number', '{}'::jsonb, 0),
      (${secretCodeId}::uuid, 'SECRT', ${secretTableId}::uuid, 'SecretCode', 'text', '{}'::jsonb, 0)
  `;
  await sql`
    INSERT INTO grids.views (id, short_id, table_id, name, source, ui, position)
    VALUES (${secretViewId}::uuid, 'SVIEW', ${secretTableId}::uuid, 'Secret view', ${`from table {${secretTableId}}`}, '{}'::jsonb, 0)
  `;

  const [baseAccess] = await sql<{ id: string }[]>`
    INSERT INTO auth.access (user_id, permission)
    VALUES (${userId}::uuid, 'read'::auth.permission_level)
    RETURNING id::text AS id
  `;
  const [secretDeny] = await sql<{ id: string }[]>`
    INSERT INTO auth.access (user_id, permission)
    VALUES (${userId}::uuid, 'none'::auth.permission_level)
    RETURNING id::text AS id
  `;
  if (!baseAccess || !secretDeny) throw new Error("Failed to create test access rows");
  await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${baseId}::uuid, ${baseAccess.id}::uuid)`;
  await sql`INSERT INTO grids.table_access (table_id, access_id) VALUES (${secretTableId}::uuid, ${secretDeny.id}::uuid)`;

  return { baseId, accessIds: [baseAccess.id, secretDeny.id] };
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
    INSERT INTO grids.views (id, short_id, table_id, name, source, ui, position)
    VALUES (
      ${byCustomerViewId}::uuid,
      'BYCUS',
      ${ordersTableId}::uuid,
      'Revenue by customer',
      ${`from table {${ordersTableId}}\ngroup by {${customerLinkId}}\naggregate sum({${amountId}}) as revenue`},
      '{}'::jsonb,
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

const cleanupAutocompletePermissionFixture = async (baseId: string, accessIds: string[]): Promise<void> => {
  await cleanupFixture(baseId);
  for (const accessId of accessIds) {
    await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
  }
};

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("GQL API route contract", () => {
  postgresTest("exposes GQL under /gql and leaves the legacy /query-dsl alias removed", async () => {
    const baseId = uuid();

    const gqlResponse = await apiRoutes.request(`/gql/by-base/${baseId}/preview`);
    expect(gqlResponse.status).toBe(401);
    expect(await gqlResponse.json()).toEqual({ message: "Authentication required" });

    const legacyResponse = await apiRoutes.request(`/query-dsl/by-base/${baseId}/preview`);
    expect(legacyResponse.status).toBe(404);
  });

  postgresTest("autocomplete filters source and field suggestions through table permissions", async () => {
    const userId = await existingAuthUserId();
    const fixture = await insertAutocompletePermissionFixture(userId);
    const app = apiFor(testUser({ id: userId, roles: ["user"] }));

    try {
      const sourceResponse = await app.request(
        `/gql/by-base/${fixture.baseId}/autocomplete`,
        jsonRequest("POST", { query: "from table " }),
      );
      expect(sourceResponse.status).toBe(200);
      const sources = (await sourceResponse.json()) as AutocompleteResponse;
      expect(sources.items.map((item) => item.label)).toContain("PublicOrders");
      expect(sources.items.map((item) => item.label)).not.toContain("SecretDeals");

      const viewResponse = await app.request(`/gql/by-base/${fixture.baseId}/autocomplete`, jsonRequest("POST", { query: "from view " }));
      const views = (await viewResponse.json()) as AutocompleteResponse;
      expect(views.items.map((item) => item.label)).not.toContain("Secret view");

      const fieldResponse = await app.request(
        `/gql/by-base/${fixture.baseId}/autocomplete`,
        jsonRequest("POST", { query: "from table PublicOrders\nselect " }),
      );
      const fields = (await fieldResponse.json()) as AutocompleteResponse;
      expect(fields.items.map((item) => item.label)).toContain("PublicAmount");
      expect(fields.items.map((item) => item.label)).not.toContain("SecretCode");

      const deniedResponse = await app.request(
        `/gql/by-base/${fixture.baseId}/autocomplete`,
        jsonRequest("POST", { query: "from table SecretDeals\nselect SecretCode" }),
      );
      const denied = (await deniedResponse.json()) as AutocompleteResponse;
      expect(denied.diagnostics.map((diagnostic) => diagnostic.message)).toContain('source "SecretDeals" is not available');
      expect(JSON.stringify(denied.items)).not.toContain("SecretCode");
    } finally {
      await cleanupAutocompletePermissionFixture(fixture.baseId, fixture.accessIds);
    }
  });

  postgresTest("canonicalizes implicit table and view current sources at the public API boundary", async () => {
    const fixture = await insertFixture();
    const user = testUser({ id: await existingAuthUserId() });
    const app = apiFor(user);

    try {
      const tableScoped = await app.request(
        `/gql/by-base/${fixture.baseId}/compile-view`,
        jsonRequest("POST", {
          currentSource: { kind: "table", tableId: fixture.tableId },
          query: `
            select Amount
            where Stage = 'Open'
          `,
        }),
      );
      expect(tableScoped.status).toBe(200);
      const tableBody = (await tableScoped.json()) as CompileViewResponse;
      expect(tableBody.ok).toBe(true);
      if (!tableBody.ok) throw new Error(tableBody.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
      expect(tableBody.source).toBe(`from table {${fixture.tableId}}
select {${fixture.amountId}}
where {${fixture.stageId}} = 'open'`);

      const viewScoped = await app.request(
        `/gql/by-base/${fixture.baseId}/compile-view`,
        jsonRequest("POST", {
          currentSource: { kind: "view", viewId: fixture.viewId },
          query: `
            select Amount
            limit 2
          `,
        }),
      );
      expect(viewScoped.status).toBe(200);
      const viewBody = (await viewScoped.json()) as CompileViewResponse;
      expect(viewBody.ok).toBe(true);
      if (!viewBody.ok) throw new Error(viewBody.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
      expect(viewBody.source).toBe(`from view {${fixture.viewId}}
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
            select Customer, "${fixture.amountId}__sum"
          `,
        }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ok: true;
        mode: "groups";
        rows: Array<{ values: Record<string, unknown> }>;
      };
      if (!body.ok) throw new Error(JSON.stringify(body));
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
        `/gql/by-base/${fixture.baseId}/compile-view`,
        jsonRequest("POST", {
          query: "from table #Orders",
        }),
      );
      expect(legacySyntax.status).toBe(200);
      const legacyBody = (await legacySyntax.json()) as CompileViewResponse;
      expect(legacyBody.ok).toBe(false);
      if (legacyBody.ok) throw new Error("expected parser diagnostics");
      expect(legacyBody.diagnostics[0]?.message.startsWith("legacy # references are not valid in GQL")).toBe(true);

      const unknownOption = await app.request(
        `/gql/by-base/${fixture.baseId}/compile-view`,
        jsonRequest("POST", {
          query: "from table Orders\nwhere Stage = 'Missing'",
        }),
      );
      expect(unknownOption.status).toBe(200);
      const optionBody = (await unknownOption.json()) as CompileViewResponse;
      expect(optionBody.ok).toBe(false);
      if (optionBody.ok) throw new Error("expected canonicalization diagnostics");
      expect(optionBody.diagnostics[0]?.message).toBe('unknown option "Missing" for "Stage"; expected one of: Open, Closed, On hold');
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });
});
