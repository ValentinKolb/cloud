import { type AccessUser, listUsersWithAccess } from "@valentinkolb/cloud/server";
import { sql } from "bun";

type SqlClient = typeof sql;

const uniqueUserIds = (userIds: string[]): string[] => [...new Set(userIds)];

const activeUsers = async (db: SqlClient, userIds: string[]): Promise<Array<{ id: string; admin: boolean }>> => {
  const ids = uniqueUserIds(userIds);
  if (ids.length === 0) return [];
  return db<{ id: string; admin: boolean }[]>`
    SELECT id, admin
    FROM auth.users
    WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids}::jsonb))
      AND (account_expires IS NULL OR account_expires > now())
  `;
};

const providerEligibleUserIds = async (db: SqlClient, mailboxId: string, userIds: string[]): Promise<Set<string>> => {
  const ids = uniqueUserIds(userIds);
  if (ids.length === 0) return new Set();
  const [mailbox] = await db<{ connection_policy: "shared_connection" | "personal_provider_account" }[]>`
    SELECT connection_policy
    FROM mail.mailboxes
    WHERE id = ${mailboxId}::uuid AND deleted_at IS NULL
  `;
  if (!mailbox) return new Set();
  if (mailbox.connection_policy === "shared_connection") return new Set(ids);
  const rows = await db<{ id: string }[]>`
    SELECT DISTINCT connection.owner_user_id AS id
    FROM mail.remote_resources resource
    JOIN mail.provider_bindings binding ON binding.remote_resource_id = resource.id
    JOIN mail.provider_connections connection ON connection.id = binding.connection_id
    WHERE resource.mailbox_id = ${mailboxId}::uuid
      AND connection.owner_user_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids}::jsonb))
      AND binding.state = 'active'
      AND binding.verified_scope_fingerprint = resource.scope_fingerprint
      AND binding.verified_secret_revision = connection.secret_revision
      AND connection.status = 'active'
      AND connection.encrypted_secret IS NOT NULL
  `;
  return new Set(rows.map((row) => row.id));
};

export const listCurrentMailboxUsers = async (params: {
  mailboxId: string;
  db?: SqlClient;
  userIds?: string[];
  minimumPermission?: "read" | "write" | "admin";
  search?: string;
  limit?: number;
}): Promise<AccessUser[]> => {
  const db = params.db ?? sql;
  const rows = await db<{ access_id: string }[]>`
    SELECT access_id FROM mail.mailbox_access WHERE mailbox_id = ${params.mailboxId}::uuid
  `;
  const requestedLimit = Math.min(Math.max(params.limit ?? params.userIds?.length ?? 20, 1), 500);
  const users = await listUsersWithAccess({
    accessIds: rows.map((row) => row.access_id),
    userIds: params.userIds,
    minimumPermission: params.minimumPermission,
    search: params.search,
    // Provider eligibility is applied after Cloud access resolution. Fetch the
    // full supported window so revoked personal bindings cannot underfill an
    // otherwise valid search result.
    limit: 500,
    db,
  });
  const activeUserIds = new Set(
    (
      await activeUsers(
        db,
        users.map((user) => user.id),
      )
    ).map((user) => user.id),
  );
  const providerEligible = await providerEligibleUserIds(db, params.mailboxId, [...activeUserIds]);
  return users.filter((user) => activeUserIds.has(user.id) && providerEligible.has(user.id)).slice(0, requestedLimit);
};

export const currentMailboxUserIds = async (params: {
  mailboxId: string;
  userIds: string[];
  minimumPermission: "read" | "write" | "admin";
  db?: SqlClient;
}): Promise<Set<string>> => {
  const db = params.db ?? sql;
  const active = await activeUsers(db, params.userIds);
  const providerEligible = await providerEligibleUserIds(
    db,
    params.mailboxId,
    active.map((user) => user.id),
  );
  const eligibleActive = active.filter((user) => providerEligible.has(user.id));
  const result = new Set(eligibleActive.filter((user) => user.admin).map((user) => user.id));
  const candidates = eligibleActive.filter((user) => !user.admin).map((user) => user.id);
  if (candidates.length === 0) return result;
  const users = await listCurrentMailboxUsers({
    mailboxId: params.mailboxId,
    db,
    userIds: candidates,
    minimumPermission: params.minimumPermission,
    limit: candidates.length,
  });
  for (const user of users) result.add(user.id);
  return result;
};

export const hasCurrentMailboxUserPermission = async (params: {
  mailboxId: string;
  userId: string;
  minimumPermission: "read" | "write" | "admin";
  db?: SqlClient;
}): Promise<boolean> => {
  const users = await currentMailboxUserIds({ ...params, userIds: [params.userId] });
  return users.has(params.userId);
};
