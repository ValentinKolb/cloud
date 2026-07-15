import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { grantSpaceAccess, resolveSpaceApiKeyPermission, revokeSpaceAccess, updateSpaceAccessPermission } from "./access";
import { checkOverlap, listCalendar, searchAcross } from "./items";
import { list as listSpaces } from "./spaces";

const resourceSubject = {
  type: "service_account" as const,
  serviceAccountId: "11111111-1111-4111-8111-111111111111",
};

describe("resolveSpaceApiKeyPermission", () => {
  test("caps credential scopes by the resource access permission", () => {
    expect(resolveSpaceApiKeyPermission("admin", ["read"])).toBe("read");
    expect(resolveSpaceApiKeyPermission("admin", ["write"])).toBe("write");
    expect(resolveSpaceApiKeyPermission("write", ["admin"])).toBe("write");
    expect(resolveSpaceApiKeyPermission("read", ["admin"])).toBe("read");
  });

  test("uses the strongest credential scope and denies credentials without usable scopes", () => {
    expect(resolveSpaceApiKeyPermission("admin", ["read", "write"])).toBe("write");
    expect(resolveSpaceApiKeyPermission("admin", [])).toBe("none");
    expect(resolveSpaceApiKeyPermission("none", ["admin"])).toBe("none");
  });
});

test("resource service-account collections fail closed without a valid space binding", async () => {
  expect(await listSpaces({ subject: resourceSubject })).toEqual([]);
  expect(await searchAcross({ subject: resourceSubject, query: "test", kinds: "all", limit: 10 })).toEqual([]);
  expect(await listCalendar({ subject: resourceSubject, from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" })).toEqual([]);
  expect(await checkOverlap({ subject: resourceSubject, from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" })).toEqual([]);
});

test("Space access mutations preserve an administrator and can recover an orphaned Space", async () => {
  const [tables] = await sql<{ spaces: string | null; users: string | null }[]>`
    SELECT to_regclass('spaces.spaces')::text AS spaces, to_regclass('auth.users')::text AS users
  `.catch(() => [{ spaces: null, users: null }]);
  if (!tables?.spaces || !tables.users) return;

  const suffix = crypto.randomUUID();
  const users = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail)
    VALUES
      (${`spaces-access-first-${suffix}`}, 'local', 'user', 'First Space Admin', ${`first.${suffix}@example.test`}),
      (${`spaces-access-second-${suffix}`}, 'local', 'user', 'Second Space Admin', ${`second.${suffix}@example.test`})
    RETURNING id
  `;
  const [space] = await sql<{ id: string }[]>`
    INSERT INTO spaces.spaces (name) VALUES (${`Access Guard ${suffix}`}) RETURNING id
  `;
  const [orphaned] = await sql<{ id: string }[]>`
    INSERT INTO spaces.spaces (name) VALUES (${`Orphaned ${suffix}`}) RETURNING id
  `;
  const accessEntries = await sql<{ id: string }[]>`
    INSERT INTO auth.access (user_id, permission)
    VALUES (${users[0]!.id}::uuid, 'admin'), (${users[1]!.id}::uuid, 'admin')
    RETURNING id
  `;
  await sql`
    INSERT INTO spaces.space_access (space_id, access_id)
    VALUES (${space!.id}::uuid, ${accessEntries[0]!.id}::uuid), (${space!.id}::uuid, ${accessEntries[1]!.id}::uuid)
  `;

  try {
    const demoted = await updateSpaceAccessPermission({
      spaceId: space!.id,
      accessId: accessEntries[0]!.id,
      permission: "write",
    });
    expect(demoted.ok).toBe(true);

    const lastAdmin = await updateSpaceAccessPermission({
      spaceId: space!.id,
      accessId: accessEntries[1]!.id,
      permission: "write",
    });
    expect(lastAdmin.ok).toBe(false);
    if (!lastAdmin.ok) expect(lastAdmin.error.message).toBe("Cannot remove the last admin");

    expect(await revokeSpaceAccess({ spaceId: space!.id, accessId: accessEntries[0]!.id })).toEqual({ ok: true, data: undefined });
    const lastEntry = await revokeSpaceAccess({ spaceId: space!.id, accessId: accessEntries[1]!.id });
    expect(lastEntry.ok).toBe(false);
    if (!lastEntry.ok) expect(lastEntry.error.message).toBe("Cannot remove the last access entry");

    const recovered = await grantSpaceAccess({
      spaceId: orphaned!.id,
      principal: { type: "user", userId: users[0]!.id },
      permission: "admin",
    });
    expect(recovered.ok).toBe(true);
  } finally {
    await sql`DELETE FROM spaces.spaces WHERE id IN (${space!.id}::uuid, ${orphaned!.id}::uuid)`;
    await sql`DELETE FROM auth.access WHERE id IN (${accessEntries[0]!.id}::uuid, ${accessEntries[1]!.id}::uuid)`;
    await sql`DELETE FROM auth.users WHERE id IN (${users[0]!.id}::uuid, ${users[1]!.id}::uuid)`;
  }
});
