import { sql } from "bun";
import { describe, expect, test } from "bun:test";
import { migrate } from "../migrate";
import { proxyAuthService } from "./index";

const canUseDatabase = async () => {
  try {
    const [row] = await sql<
      {
        users: string | null;
        groups: string | null;
      }[]
    >`
      SELECT
        to_regclass('auth.users')::text AS users,
        to_regclass('auth.groups')::text AS groups
    `;
    if (!row?.users || !row.groups) return false;
    await migrate();
    return true;
  } catch {
    return false;
  }
};

const insertUser = async () => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`proxy-auth-${suffix}`}, 'local', 'user', 'Proxy Auth Test', ${`proxy-auth-${suffix}@example.test`}, 'Proxy', 'Auth')
    RETURNING id
  `;
  return row!.id;
};

const insertGroup = async () => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.groups (cn, provider, name, description)
    VALUES (${`proxy-auth-${suffix}`}, 'local', ${`Proxy Auth ${suffix}`}, 'Proxy auth test group')
    RETURNING id
  `;
  return row!.id;
};

describe("Proxy Auth service", () => {
  test("does not persist a new client when allowed groups are invalid", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping Proxy Auth service DB test: auth/proxy_auth tables are not available.");
      return;
    }

    const userId = await insertUser();
    const name = `Invalid proxy client ${crypto.randomUUID()}`;

    try {
      const result = await proxyAuthService.client.create({
        createdBy: userId,
        data: {
          name,
          allowedGroupIds: [crypto.randomUUID()],
        },
      });

      expect(result.ok).toBe(false);
      const rows = await sql<{ id: string }[]>`SELECT id FROM proxy_auth.clients WHERE name = ${name}`;
      expect(rows).toHaveLength(0);
    } finally {
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("keeps existing allowed groups when an update references invalid groups", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping Proxy Auth service DB test: auth/proxy_auth tables are not available.");
      return;
    }

    const userId = await insertUser();
    const groupId = await insertGroup();
    let clientId: string | null = null;

    try {
      const created = await proxyAuthService.client.create({
        createdBy: userId,
        data: {
          name: `Stable proxy client ${crypto.randomUUID()}`,
          allowedGroupIds: [groupId],
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      clientId = created.data.id;

      const updated = await proxyAuthService.client.update({
        id: clientId,
        data: {
          allowedGroupIds: [crypto.randomUUID()],
        },
      });

      expect(updated.ok).toBe(false);
      const current = await proxyAuthService.client.get({ id: clientId });
      expect(current?.allowedGroups.map((group) => group.id)).toEqual([groupId]);
    } finally {
      if (clientId) await sql`DELETE FROM proxy_auth.clients WHERE id = ${clientId}::uuid`;
      await sql`DELETE FROM auth.groups WHERE id = ${groupId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });
});
