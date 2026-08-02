import { beforeAll, describe, expect, test } from "bun:test";
import {
  type CapabilityActionDefinition,
  type CapabilityExecutionContext,
  type CapabilityQueryDefinition,
  capabilityResultSchema,
  type User,
} from "@valentinkolb/cloud/contracts";
import { sql } from "bun";
import { gridsCapabilities } from "./capabilities";
import { migrate } from "./migrate";

const postgresTest = process.env.GRIDS_DB_TEST === "1" ? test : test.skip;
const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

const testUser = (id: string): User => ({
  id,
  uid: `grids-capability-${id}`,
  roles: ["user", "local", "local/user"],
  provider: "local",
  profile: "user",
  givenname: "Grids",
  sn: "Capability",
  displayName: "Grids Capability",
  mail: `grids-capability-${id}@example.test`,
  avatarHash: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: [],
  manages: [],
  managesGroupIds: [],
  ipa: null,
});

const userContext = (user: User): CapabilityExecutionContext => ({
  actor: { kind: "user", user },
  accessSubject: { type: "user", userId: user.id },
  user,
  signal: new AbortController().signal,
});

const invoke = (kind: "query" | "action", localId: string, input: unknown, context: CapabilityExecutionContext) => {
  const catalog = (kind === "query" ? gridsCapabilities.queries : gridsCapabilities.actions) as unknown as Readonly<
    Record<string, CapabilityQueryDefinition | CapabilityActionDefinition>
  >;
  const operation = catalog[localId];
  if (!operation) throw new Error(`Missing Grids capability ${localId}`);
  const parsed = operation.input.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid test input for ${localId}: ${parsed.error.message}`);
  return Promise.resolve(operation.run(parsed.data, context)).then((result) => {
    if (result.ok) {
      const validated = capabilityResultSchema(operation.data).safeParse(result.data);
      if (!validated.success) throw new Error(`Invalid test result for ${localId}: ${validated.error.message}`);
    }
    return result;
  });
};

const existingAuthUserId = async (): Promise<string> => {
  const [row] = await sql<{ id: string }[]>`SELECT id::text AS id FROM auth.users ORDER BY id LIMIT 1`;
  if (!row) throw new Error("Grids capability integration test needs one auth.users row for audit foreign keys");
  return row.id;
};

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("Grids capabilities", () => {
  test("declares the curated v1 surface", () => {
    expect(gridsCapabilities.version).toBe(1);
    expect(Object.keys(gridsCapabilities.types ?? {}).sort()).toEqual(["base", "record", "table", "view"]);
    expect(Object.keys(gridsCapabilities.queries ?? {}).sort()).toEqual([
      "base.get",
      "base.list",
      "base.search",
      "gql.context",
      "gql.execute",
      "gql.preview",
      "gql.view.execute",
      "record.get",
    ]);
    expect(Object.keys(gridsCapabilities.actions ?? {}).sort()).toEqual(["record.create", "record.update"]);
  });

  postgresTest("discovers schema, executes GQL, and mutates records with conflict protection", async () => {
    process.env.APP_SECRET ??= "grids-capability-integration-secret";
    const user = testUser(await existingAuthUserId());
    const context = userContext(user);
    const baseId = uuid();
    const tableId = uuid();
    const secretTableId = uuid();
    const viewId = uuid();
    const fieldId = uuid();
    const selectFieldId = uuid();
    const relationFieldId = uuid();
    const auditQuestionId = uuid();
    const auditOptionId = uuid();
    const accessIds: string[] = [];

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name, description) VALUES (${baseId}::uuid, ${shortId("B")}, 'Capability Base', 'Agent data')`;
      await sql`
        INSERT INTO grids.tables (id, short_id, base_id, name, position)
        VALUES
          (${tableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'Items', 0),
          (${secretTableId}::uuid, ${shortId("S")}, ${baseId}::uuid, 'Secret items', 1)
      `;
      await sql`
        UPDATE grids.tables
        SET audit_policy = ${{
          update: {
            enabled: true,
            scope: "selected",
            fieldIds: [selectFieldId],
            questions: [
              {
                id: auditQuestionId,
                label: "Change reason",
                description: "Explain why the status changed.",
                type: "select",
                required: true,
                options: [{ id: auditOptionId, label: "Reviewed" }],
              },
            ],
          },
        }}::jsonb
        WHERE id = ${tableId}::uuid
      `;
      await sql`
        INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
        VALUES
          (${fieldId}::uuid, ${shortId("F")}, ${tableId}::uuid, 'Name', 'text', '{}'::jsonb, 0),
          (${selectFieldId}::uuid, ${shortId("O")}, ${tableId}::uuid, 'Status', 'select', ${{
            multiple: false,
            options: [
              { id: "open", label: "Open", description: "Work has started." },
              { id: "done", label: "Done", description: "Work is complete." },
            ],
          }}::jsonb, 1),
          (${relationFieldId}::uuid, ${shortId("R")}, ${tableId}::uuid, 'Secret relation', 'relation', ${{ targetTableId: secretTableId }}::jsonb, 2)
      `;
      await sql`
        INSERT INTO grids.views (id, short_id, table_id, name, source, ui, position)
        VALUES (${viewId}::uuid, ${shortId("V")}, ${tableId}::uuid, 'All items', ${`from table {${tableId}}`}, '{}'::jsonb, 0)
      `;
      const [access] = await sql<{ id: string }[]>`
        INSERT INTO auth.access (user_id, permission)
        VALUES (${user.id}::uuid, 'write'::auth.permission_level)
        RETURNING id::text AS id
      `;
      if (!access) throw new Error("Failed to create Grids capability access fixture");
      accessIds.push(access.id);
      await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${baseId}::uuid, ${access.id}::uuid)`;
      const [secretDeny] = await sql<{ id: string }[]>`
        INSERT INTO auth.access (user_id, permission)
        VALUES (${user.id}::uuid, 'none'::auth.permission_level)
        RETURNING id::text AS id
      `;
      if (!secretDeny) throw new Error("Failed to create Grids capability deny fixture");
      accessIds.push(secretDeny.id);
      await sql`INSERT INTO grids.table_access (table_id, access_id) VALUES (${secretTableId}::uuid, ${secretDeny.id}::uuid)`;

      const search = await invoke("query", "base.search", { query: "Capability", tags: [], limit: 10 }, context);
      expect(search.ok && search.data.data).toEqual([
        expect.objectContaining({ ref: { type: "grids.base", id: baseId }, title: "Capability Base" }),
      ]);

      const listed = await invoke("query", "base.list", { query: "Capability", limit: 25 }, context);
      expect(listed.ok && listed.data.data).toEqual([expect.objectContaining({ id: baseId, name: "Capability Base" })]);

      const loadedBase = await invoke("query", "base.get", { baseId }, context);
      expect(loadedBase.ok && loadedBase.data.data).toMatchObject({ id: baseId, shortId: expect.any(String) });

      const tables = await invoke("query", "gql.context", { baseId, kind: "tables", limit: 25 }, context);
      expect(tables.ok && tables.data.data).toMatchObject({
        kind: "tables",
        items: [
          {
            kind: "table",
            id: tableId,
            name: "Items",
            permission: "write",
            canCreateRecords: true,
            canUpdateRecords: true,
          },
        ],
      });

      const fields = await invoke("query", "gql.context", { baseId, kind: "fields", tableId, limit: 25 }, context);
      expect(fields.ok && fields.data.data).toMatchObject({
        kind: "fields",
        items: [
          { kind: "field", id: fieldId, name: "Name", writable: true, valueHint: expect.stringContaining("String") },
          { kind: "field", id: selectFieldId, name: "Status", writable: true, valueHint: expect.stringContaining("option IDs") },
          {
            kind: "field",
            id: relationFieldId,
            name: "Secret relation",
            writable: true,
            targetTableId: null,
            relationCardinality: "multiple",
          },
        ],
        recordWrite: {
          tableId,
          canCreateRecords: true,
          canUpdateRecords: true,
          updateAudit: {
            scope: "selected",
            fieldIds: [selectFieldId],
            questions: [
              {
                id: auditQuestionId,
                label: "Change reason",
                description: "Explain why the status changed.",
                type: "select",
                required: true,
                options: [{ id: auditOptionId, label: "Reviewed" }],
              },
            ],
          },
        },
      });

      const options = await invoke("query", "gql.context", { baseId, kind: "options", tableId, fieldId: selectFieldId, limit: 1 }, context);
      expect(options.ok && options.data.data).toMatchObject({
        kind: "options",
        items: [{ kind: "option", id: "open", fieldId: selectFieldId, label: "Open", description: "Work has started." }],
        recordWrite: null,
      });
      if (!options.ok || !options.data.page?.nextCursor) throw new Error("Expected a second select-option page");
      const remainingOptions = await invoke(
        "query",
        "gql.context",
        { baseId, kind: "options", tableId, fieldId: selectFieldId, limit: 1, cursor: options.data.page.nextCursor },
        context,
      );
      expect(remainingOptions.ok && remainingOptions.data.data).toMatchObject({
        kind: "options",
        items: [{ kind: "option", id: "done", fieldId: selectFieldId, label: "Done" }],
      });

      const views = await invoke("query", "gql.context", { baseId, kind: "views", limit: 25 }, context);
      expect(views.ok && views.data.data).toMatchObject({ kind: "views", items: [{ kind: "view", id: viewId, name: "All items" }] });

      const created = await invoke("action", "record.create", { tableId, values: { [fieldId]: "First" } }, context);
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error.message);
      const record = created.data.data as { id: string; version: number; data: Record<string, unknown> };
      expect(record).toMatchObject({ version: 1, data: { [fieldId]: "First" } });

      const loadedRecord = await invoke("query", "record.get", { tableId, recordId: record.id }, context);
      expect(loadedRecord.ok && loadedRecord.data.data).toMatchObject({ id: record.id, version: 1 });

      const preview = await invoke(
        "query",
        "gql.preview",
        { baseId, query: `from table {${tableId}}\nselect {${fieldId}}`, pageSize: 25 },
        context,
      );
      expect(preview.ok && preview.data.data).toMatchObject({ ok: true, rows: [expect.objectContaining({ recordId: record.id })] });

      const gql = await invoke(
        "query",
        "gql.execute",
        { baseId, query: `from table {${tableId}}\nselect {${fieldId}}`, pageSize: 100 },
        context,
      );
      expect(gql.ok && gql.data.data).toMatchObject({ ok: true, rows: [expect.objectContaining({ recordId: record.id })] });

      const savedView = await invoke("query", "gql.view.execute", { baseId, viewId, pageSize: 100 }, context);
      expect(savedView.ok && savedView.data.data).toMatchObject({ ok: true, rows: [expect.objectContaining({ recordId: record.id })] });

      const missingAudit = await invoke(
        "action",
        "record.update",
        { tableId, recordId: record.id, values: { [selectFieldId]: ["open"] }, ifVersion: record.version },
        context,
      );
      expect(missingAudit).toMatchObject({ ok: false, error: { code: "BAD_INPUT", status: 400 } });

      const statusUpdated = await invoke(
        "action",
        "record.update",
        {
          tableId,
          recordId: record.id,
          values: { [selectFieldId]: ["open"] },
          ifVersion: record.version,
          audit: { answers: { [auditQuestionId]: auditOptionId } },
        },
        context,
      );
      expect(statusUpdated.ok && statusUpdated.data.data).toMatchObject({ version: 2, data: { [selectFieldId]: ["open"] } });
      if (!statusUpdated.ok) throw new Error(statusUpdated.error.message);

      const updated = await invoke(
        "action",
        "record.update",
        { tableId, recordId: record.id, values: { [fieldId]: "Second" }, ifVersion: statusUpdated.data.data.version },
        context,
      );
      expect(updated.ok && updated.data.data).toMatchObject({ version: 3, data: { [fieldId]: "Second" } });

      const stale = await invoke(
        "action",
        "record.update",
        { tableId, recordId: record.id, values: { [fieldId]: "Stale" }, ifVersion: record.version },
        context,
      );
      expect(stale).toMatchObject({ ok: false, error: { code: "CONFLICT", status: 409 } });
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
      for (const accessId of accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
    }
  });

  postgresTest("confines resource-bound credentials and applies their permission cap", async () => {
    const boundBaseId = uuid();
    const otherBaseId = uuid();
    const tableId = uuid();
    const fieldId = uuid();
    const accessIds: string[] = [];
    const [serviceAccount] = await sql<{ id: string; createdAt: string }[]>`
      INSERT INTO auth.service_accounts (name, kind, app_id, resource_type, resource_id)
      VALUES ('Grids capability bound test', 'resource_bound', 'grids', 'base', ${boundBaseId})
      RETURNING id::text AS id, created_at::text AS "createdAt"
    `;
    if (!serviceAccount) throw new Error("Failed to create resource-bound capability fixture");
    try {
      await sql`
        INSERT INTO grids.bases (id, short_id, name)
        VALUES
          (${boundBaseId}::uuid, ${shortId("A")}, 'Bound capability Base'),
          (${otherBaseId}::uuid, ${shortId("B")}, 'Other capability Base')
      `;
      await sql`
        INSERT INTO grids.tables (id, short_id, base_id, name, position)
        VALUES (${tableId}::uuid, ${shortId("T")}, ${boundBaseId}::uuid, 'Bound items', 0)
      `;
      await sql`
        INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
        VALUES (${fieldId}::uuid, ${shortId("F")}, ${tableId}::uuid, 'Name', 'text', '{}'::jsonb, 0)
      `;
      for (const baseId of [boundBaseId, otherBaseId]) {
        const [access] = await sql<{ id: string }[]>`
          INSERT INTO auth.access (service_account_id, permission)
          VALUES (${serviceAccount.id}::uuid, 'admin'::auth.permission_level)
          RETURNING id::text AS id
        `;
        if (!access) throw new Error("Failed to create service-account access fixture");
        accessIds.push(access.id);
        await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${baseId}::uuid, ${access.id}::uuid)`;
      }

      const context: CapabilityExecutionContext = {
        actor: {
          kind: "service_account",
          serviceAccount: {
            id: serviceAccount.id,
            name: "Grids capability bound test",
            kind: "resource_bound",
            status: "active",
            delegatedUserId: null,
            appId: "grids",
            resourceType: "base",
            resourceId: boundBaseId,
            createdBy: null,
            createdAt: serviceAccount.createdAt,
          },
          delegatedUser: null,
          scopes: ["grids:read"],
        },
        accessSubject: { type: "service_account", serviceAccountId: serviceAccount.id },
        user: null,
        signal: new AbortController().signal,
      };

      const listed = await invoke("query", "base.list", { limit: 25 }, context);
      expect(listed.ok && listed.data.data).toEqual([expect.objectContaining({ id: boundBaseId })]);
      const crossBase = await invoke("query", "base.get", { baseId: otherBaseId }, context);
      expect(crossBase).toMatchObject({ ok: false, error: { code: "FORBIDDEN", status: 403 } });
      const tables = await invoke("query", "gql.context", { baseId: boundBaseId, kind: "tables", limit: 25 }, context);
      expect(tables.ok && tables.data.data).toMatchObject({
        items: [{ id: tableId, permission: "read", canCreateRecords: false, canUpdateRecords: false }],
      });
      const fields = await invoke("query", "gql.context", { baseId: boundBaseId, kind: "fields", tableId, limit: 25 }, context);
      expect(fields.ok && fields.data.data).toMatchObject({
        items: [{ id: fieldId, writable: false }],
        recordWrite: { canCreateRecords: false, canUpdateRecords: false, updateAudit: null },
      });
      const write = await invoke("action", "record.create", { tableId, values: {} }, context);
      expect(write).toMatchObject({ ok: false, error: { code: "FORBIDDEN", status: 403 } });
    } finally {
      await sql`DELETE FROM grids.bases WHERE id IN (${boundBaseId}::uuid, ${otherBaseId}::uuid)`;
      for (const accessId of accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
      await sql`DELETE FROM auth.service_accounts WHERE id = ${serviceAccount.id}::uuid`;
    }
  });
});
