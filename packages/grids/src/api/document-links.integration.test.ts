import { beforeAll, describe, expect, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { Hono, type MiddlewareHandler } from "hono";
import { migrate } from "../migrate";
import { createDocumentsApi } from "./documents";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

type DocumentLinkApiFixture = {
  baseId: string;
  tableId: string;
  recordId: string;
  snapshotId: string;
  runId: string;
  accessIds: string[];
};

const testUser = (id: string): User => ({
  id,
  uid: `document-links-${id}`,
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Document",
  sn: "Links",
  displayName: "Document Links",
  mail: `document-links-${id}@example.test`,
  avatarHash: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: [],
  manages: [],
  managesGroupIds: [],
  ipa: null,
});

const authenticateAs =
  (user: User): MiddlewareHandler<AuthContext> =>
  async (c, next) => {
    c.set("actor", { kind: "user", user });
    c.set("accessSubject", { type: "user", userId: user.id });
    c.set("user", user);
    await next();
  };

const apiFor = (user: User) => new Hono<AuthContext>().route("/documents", createDocumentsApi({ requireAuthenticated: authenticateAs(user) }));

const existingAuthUserId = async (): Promise<string> => {
  const [row] = await sql<{ id: string }[]>`
    SELECT id::text AS id FROM auth.users ORDER BY id LIMIT 1
  `;
  if (!row) throw new Error("Document links API integration test needs one existing auth.users row");
  return row.id;
};

const insertAccess = async (baseId: string, userId: string, permission: "read" | "write"): Promise<string> => {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.access (user_id, permission)
    VALUES (${userId}::uuid, ${permission}::auth.permission_level)
    RETURNING id::text AS id
  `;
  if (!row) throw new Error("Failed to create access row");
  await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${baseId}::uuid, ${row.id}::uuid)`;
  return row.id;
};

const insertFixture = async (userId: string): Promise<DocumentLinkApiFixture> => {
  const baseId = uuid();
  const tableId = uuid();
  const recordId = uuid();
  const snapshotId = uuid();
  const runId = uuid();
  const documentNumber = `INV-API-${runId.slice(0, 8)}`;

  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${baseId}::uuid, ${shortId("B")}, 'Document links API integration')
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES (${tableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'Invoices', 0)
  `;
  await sql`
    INSERT INTO grids.record_snapshots (id, base_id, table_id, record_id, root, graph)
    VALUES (
      ${snapshotId}::uuid,
      ${baseId}::uuid,
      ${tableId}::uuid,
      ${recordId}::uuid,
      ${{ id: recordId, tableId, data: { Name: "Invoice 1" } }}::jsonb,
      ${{ rootId: `${tableId}:${recordId}`, records: {} }}::jsonb
    )
  `;
  await sql`
    INSERT INTO grids.document_runs (
      id, short_id, template_id, snapshot_id, base_id, table_id, record_id,
      document_number, filename, tags, template_snapshot, render_data
    )
    VALUES (
      ${runId}::uuid,
      ${shortId("D")},
      NULL,
      ${snapshotId}::uuid,
      ${baseId}::uuid,
      ${tableId}::uuid,
      ${recordId}::uuid,
      ${documentNumber},
      'invoice-api-1.pdf',
      '{}'::text[],
      ${{ html: "<p>{{ document.number }}</p>", headerHtml: null, footerHtml: null, pageCss: null }}::jsonb,
      ${{ document: { number: documentNumber, generatedAt: "2026-07-07T00:00:00.000Z" } }}::jsonb
    )
  `;

  return {
    baseId,
    tableId,
    recordId,
    snapshotId,
    runId,
    accessIds: [await insertAccess(baseId, userId, "read")],
  };
};

const cleanupFixture = async (fixture: DocumentLinkApiFixture): Promise<void> => {
  await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
  for (const accessId of fixture.accessIds) {
    await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
  }
};

const jsonRequest = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("document link API permissions", () => {
  postgresTest("requires document write access to list and create public links", async () => {
    const userId = await existingAuthUserId();
    const app = apiFor(testUser(userId));
    const fixture = await insertFixture(userId);
    try {
      const linksPath = `/documents/runs/${fixture.runId}/links`;
      const readList = await app.request(linksPath);
      expect(readList.status).toBe(403);

      const readCreate = await app.request(linksPath, jsonRequest({ expiresIn: "30d", comment: "Reader should not create links" }));
      expect(readCreate.status).toBe(403);

      fixture.accessIds.push(await insertAccess(fixture.baseId, userId, "write"));

      const writeCreate = await app.request(linksPath, jsonRequest({ expiresIn: "30d", comment: "Writer copy" }));
      expect(writeCreate.status).toBe(201);

      const writeList = await app.request(linksPath);
      expect(writeList.status).toBe(200);
      const listed = (await writeList.json()) as { items: Array<{ comment: string | null }> };
      expect(listed.items.map((link) => link.comment)).toContain("Writer copy");
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
