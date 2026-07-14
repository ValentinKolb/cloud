import { describe, expect, test } from "bun:test";
import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import { grantBaseAccess, listBaseAccess } from "./base-management";
import { requireBaseAccess, type ResourceScope } from "./access-control";

const canUseDatabase = async (): Promise<boolean> => {
  try {
    const [row] = await sql<{ bases: string | null; access: string | null }[]>`
      SELECT to_regclass('pulse.bases')::text AS bases, to_regclass('auth.access')::text AS access
    `;
    return Boolean(row?.bases && row.access);
  } catch {
    return false;
  }
};

const insertUser = async (suffix: string): Promise<string> => {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail)
    VALUES (${`pulse-access-${suffix}`}, 'local', 'user', 'Pulse access test', ${`pulse-access-${suffix}@example.test`})
    RETURNING id
  `;
  return row!.id;
};

const insertGroup = async (suffix: string, label: string): Promise<string> => {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.groups (cn, provider, name, description)
    VALUES (${`pulse-access-${label}-${suffix}`}, 'local', ${`Pulse ${label}`}, 'Pulse access test')
    RETURNING id
  `;
  return row!.id;
};

const insertServiceAccount = async (params: {
  suffix: string;
  resourceType: string;
  resourceId: string;
}): Promise<string> => {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.service_accounts (name, kind, app_id, resource_type, resource_id)
    VALUES (
      ${`Pulse ${params.resourceType} ${params.suffix}`},
      'resource_bound',
      'pulse',
      ${params.resourceType},
      ${params.resourceId}
    )
    RETURNING id
  `;
  return row!.id;
};

const resourceScope = (params: {
  serviceAccountId: string;
  resourceType: string;
  resourceId: string;
  scopes: string[];
}): ResourceScope => ({
  subject: { type: "service_account", serviceAccountId: params.serviceAccountId },
  serviceAccount: {
    appId: "pulse",
    resourceType: params.resourceType,
    resourceId: params.resourceId,
  },
  scopes: params.scopes,
});

describe("Pulse base access", () => {
  test("uses effective groups and caps resource service accounts by binding and scopes", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping Pulse access DB test: required tables are not available.");
      return;
    }

    const suffix = crypto.randomUUID();
    const baseId = crypto.randomUUID();
    const userId = await insertUser(suffix);
    const parentGroupId = await insertGroup(suffix, "parent");
    const childGroupId = await insertGroup(suffix, "child");
    const baseServiceAccountId = await insertServiceAccount({ suffix, resourceType: "pulse_base", resourceId: baseId });
    const sourceServiceAccountId = await insertServiceAccount({ suffix, resourceType: "pulse_source", resourceId: crypto.randomUUID() });
    const accessIds: string[] = [];

    try {
      await sql`INSERT INTO pulse.bases (id, name) VALUES (${baseId}::uuid, 'Pulse access test')`;
      await sql`INSERT INTO auth.user_groups_v2 (user_id, group_id) VALUES (${userId}::uuid, ${childGroupId}::uuid)`;
      await sql`
        INSERT INTO auth.group_groups_v2 (parent_group_id, child_group_id)
        VALUES (${parentGroupId}::uuid, ${childGroupId}::uuid)
      `;

      const [groupAccess] = await sql<{ id: string }[]>`
        INSERT INTO auth.access (group_id, permission) VALUES (${parentGroupId}::uuid, 'write') RETURNING id
      `;
      const [authenticatedAccess] = await sql<{ id: string }[]>`
        INSERT INTO auth.access (authenticated_only, permission) VALUES (TRUE, 'read') RETURNING id
      `;
      const [publicAccess] = await sql<{ id: string }[]>`
        INSERT INTO auth.access (permission) VALUES ('read') RETURNING id
      `;
      accessIds.push(groupAccess!.id, authenticatedAccess!.id, publicAccess!.id);
      await sql`
        INSERT INTO pulse.base_access (base_id, access_id)
        VALUES
          (${baseId}::uuid, ${groupAccess!.id}::uuid),
          (${baseId}::uuid, ${authenticatedAccess!.id}::uuid),
          (${baseId}::uuid, ${publicAccess!.id}::uuid)
      `;

      expect((await requireBaseAccess(baseId, { id: userId }, "write")).ok).toBe(true);

      const readableBaseAccount = resourceScope({
        serviceAccountId: baseServiceAccountId,
        resourceType: "pulse_base",
        resourceId: baseId,
        scopes: ["read"],
      });
      expect((await requireBaseAccess(baseId, readableBaseAccount, "read")).ok).toBe(true);
      expect((await requireBaseAccess(baseId, readableBaseAccount, "write")).ok).toBe(false);

      const sourceAccount = resourceScope({
        serviceAccountId: sourceServiceAccountId,
        resourceType: "pulse_source",
        resourceId: crypto.randomUUID(),
        scopes: ["admin"],
      });
      expect((await requireBaseAccess(baseId, sourceAccount, "read")).ok).toBe(false);

      const [adminAccess] = await sql<{ id: string }[]>`
        INSERT INTO auth.access (user_id, permission) VALUES (${userId}::uuid, 'admin') RETURNING id
      `;
      accessIds.push(adminAccess!.id);
      await sql`
        INSERT INTO pulse.base_access (base_id, access_id)
        VALUES (${baseId}::uuid, ${adminAccess!.id}::uuid)
      `;

      const granted = await grantBaseAccess({
        baseId,
        user: { id: userId },
        principal: { type: "service_account", serviceAccountId: baseServiceAccountId },
        permission: "read",
      });
      expect(granted.ok).toBe(true);
      if (granted.ok) accessIds.push(granted.data.id);

      const entries = await listBaseAccess(baseId, { id: userId });
      expect(entries.ok).toBe(true);
      if (entries.ok) {
        expect(entries.data.some((entry) =>
          entry.principal.type === "service_account" && entry.principal.serviceAccountId === baseServiceAccountId,
        )).toBe(true);
      }
    } finally {
      await sql`DELETE FROM pulse.bases WHERE id = ${baseId}::uuid`;
      await sql`DELETE FROM auth.access WHERE id = ANY(${toPgUuidArray(accessIds)}::uuid[])`;
      await sql`DELETE FROM auth.group_groups_v2 WHERE parent_group_id = ${parentGroupId}::uuid OR child_group_id = ${childGroupId}::uuid`;
      await sql`DELETE FROM auth.user_groups_v2 WHERE user_id = ${userId}::uuid`;
      await sql`DELETE FROM auth.groups WHERE id IN (${parentGroupId}::uuid, ${childGroupId}::uuid)`;
      await sql`DELETE FROM auth.service_accounts WHERE id IN (${baseServiceAccountId}::uuid, ${sourceServiceAccountId}::uuid)`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });
});
