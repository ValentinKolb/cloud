import { audit, decryptSecret, encryptSecret, logger } from "@valentinkolb/cloud/services";
import { err, fail, isServiceError, ok, type Result, type ServiceError } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { ConnectionOwner, ConnectorVerification, ProviderConnection, ProviderConnectionInput, ProviderSecret } from "../contracts";
import { providerSecretSchema } from "../contracts";
import { requireMailboxPermission } from "./access";
import { auditActorFromRequest, type MailRequestContext, permissionFromScopes } from "./auth";
import { imapSmtpConnector } from "./connectors";
import { EndpointPolicyError } from "./connectors/endpoint-policy";
import { logDatabaseFailure } from "./database-errors";

type SqlClient = typeof sql;

const log = logger("mail:provider-connections");

type DbProviderConnection = {
  id: string;
  owner_user_id: string | null;
  owner_service_account_id: string | null;
  owner_mailbox_id: string | null;
  name: string;
  email: string;
  username: string;
  connector_kind: "imap_smtp";
  imap_host: string;
  imap_port: number;
  imap_tls_mode: "implicit" | "starttls";
  smtp_host: string;
  smtp_port: number;
  smtp_tls_mode: "implicit" | "starttls";
  secret_kind: "password" | "oauth2";
  encrypted_secret: string | null;
  secret_revision: number;
  status: "active" | "degraded" | "revoked";
  authenticated_principal: string | null;
  last_verified_at: Date | string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const connectionColumns = sql`
  pc.id,
  pc.owner_user_id,
  pc.owner_service_account_id,
  pc.owner_mailbox_id,
  pc.name,
  pc.email,
  pc.username,
  pc.connector_kind,
  pc.imap_host,
  pc.imap_port,
  pc.imap_tls_mode,
  pc.smtp_host,
  pc.smtp_port,
  pc.smtp_tls_mode,
  pc.secret_kind,
  pc.encrypted_secret,
  pc.secret_revision,
  pc.status,
  pc.authenticated_principal,
  pc.last_verified_at,
  pc.last_error_code,
  pc.last_error_message,
  pc.created_at,
  pc.updated_at
`;

const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const toNullableIso = (value: Date | string | null): string | null => (value ? toIso(value) : null);

const ownerFromRow = (row: DbProviderConnection): ConnectionOwner => {
  if (row.owner_user_id) return { type: "user", userId: row.owner_user_id };
  if (row.owner_service_account_id) return { type: "service_account", serviceAccountId: row.owner_service_account_id };
  if (row.owner_mailbox_id) return { type: "mailbox", mailboxId: row.owner_mailbox_id };
  throw new Error("Provider connection has no owner");
};

const mapConnection = (row: DbProviderConnection): ProviderConnection => ({
  id: row.id,
  owner: ownerFromRow(row),
  name: row.name,
  email: row.email,
  username: row.username,
  connectorKind: row.connector_kind,
  imap: { host: row.imap_host, port: row.imap_port, tlsMode: row.imap_tls_mode },
  smtp: { host: row.smtp_host, port: row.smtp_port, tlsMode: row.smtp_tls_mode },
  secret: { kind: row.secret_kind, isSet: Boolean(row.encrypted_secret) },
  status: row.status,
  authenticatedPrincipal: row.authenticated_principal,
  lastVerifiedAt: toNullableIso(row.last_verified_at),
  lastError: row.last_error_message,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const normalizeProviderError = (error: unknown): ServiceError => {
  if (isServiceError(error)) return error;
  if (error instanceof EndpointPolicyError) return err.badInput(error.message);
  const value = error as { code?: unknown; responseCode?: unknown; authenticationFailed?: unknown; tlsFailed?: unknown } | null;
  const code = typeof value?.code === "string" ? value.code.toUpperCase() : "";
  if (value?.authenticationFailed === true || code === "EAUTH" || code.includes("AUTH")) {
    return err.badInput("Provider authentication failed");
  }
  if (value?.tlsFailed === true || code.includes("CERT") || code.includes("TLS")) {
    return err.badInput("Provider TLS verification failed");
  }
  if (["ETIMEDOUT", "ECONNREFUSED", "ECONNECTION", "ESOCKET", "EHOSTUNREACH", "ENETUNREACH", "EDNS"].includes(code)) {
    return err.badInput("Could not connect to the provider endpoint");
  }
  return err.badInput("Provider verification failed");
};

const requireCredentialAdminScope = (context: MailRequestContext): Result<void> => {
  if (context.actor.kind !== "service_account") return ok();
  return permissionFromScopes(context.actor.scopes) === "admin"
    ? ok()
    : fail(err.forbidden("Provider connection changes require admin scope"));
};

const authorizeOwner = async (context: MailRequestContext, owner: ConnectionOwner, db: SqlClient = sql): Promise<Result<void>> => {
  const scope = requireCredentialAdminScope(context);
  if (!scope.ok) return scope;
  if (owner.type === "mailbox") {
    const permission = await requireMailboxPermission(context, owner.mailboxId, "admin", db);
    return permission.ok ? ok() : permission;
  }
  if (owner.type === "user") {
    return context.accessSubject.type === "user" && context.accessSubject.userId === owner.userId
      ? ok()
      : fail(err.forbidden("Private provider connections can be managed only by their owner"));
  }
  return context.actor.kind === "service_account" && context.actor.serviceAccount.id === owner.serviceAccountId
    ? ok()
    : fail(err.forbidden("Service-account provider connections can be managed only by their owner"));
};

const assertMailboxConnectionPolicy = async (mailboxId: string, db: SqlClient): Promise<Result<void>> => {
  const [row] = await db<{ connection_policy: string }[]>`
    SELECT connection_policy
    FROM mail.mailboxes
    WHERE id = ${mailboxId}::uuid AND deleted_at IS NULL
  `;
  if (!row) return fail(err.notFound("Mailbox"));
  return row.connection_policy === "shared_connection"
    ? ok()
    : fail(err.badInput("Mailbox-owned credentials require the Shared connection policy"));
};

const connectionFromInput = (input: ProviderConnectionInput, secret: ProviderSecret): ProviderConnectionInput => ({
  name: input.name,
  email: input.email,
  username: input.username,
  imap: input.imap,
  smtp: input.smtp,
  secret,
});

export const verifyProviderConnection = async (input: ProviderConnectionInput): Promise<Result<ConnectorVerification>> => {
  try {
    return ok(await imapSmtpConnector.verify(input));
  } catch (error) {
    return fail(normalizeProviderError(error));
  }
};

export const createProviderConnection = async (params: {
  context: MailRequestContext;
  owner: ConnectionOwner;
  input: ProviderConnectionInput;
}): Promise<Result<{ connection: ProviderConnection; verification: ConnectorVerification }>> => {
  const ownerAccess = await authorizeOwner(params.context, params.owner);
  if (!ownerAccess.ok) return ownerAccess;
  if (params.owner.type === "mailbox") {
    const policy = await assertMailboxConnectionPolicy(params.owner.mailboxId, sql);
    if (!policy.ok) return policy;
  }

  const verification = await verifyProviderConnection(params.input);
  if (!verification.ok) return verification;

  let encryptedSecret: string;
  try {
    encryptedSecret = await encryptSecret(params.input.secret);
  } catch {
    return fail(err.internal("Could not encrypt provider credentials"));
  }

  try {
    return await sql.begin(async (tx) => {
      const recheck = await authorizeOwner(params.context, params.owner, tx);
      if (!recheck.ok) return recheck;
      if (params.owner.type === "mailbox") {
        const [locked] = await tx<{ id: string }[]>`
          SELECT id FROM mail.mailboxes WHERE id = ${params.owner.mailboxId}::uuid AND deleted_at IS NULL FOR UPDATE
        `;
        if (!locked) return fail(err.notFound("Mailbox"));
        const policy = await assertMailboxConnectionPolicy(params.owner.mailboxId, tx);
        if (!policy.ok) return policy;
      }

      const [row] = await tx<DbProviderConnection[]>`
        INSERT INTO mail.provider_connections AS pc (
          owner_user_id,
          owner_service_account_id,
          owner_mailbox_id,
          name,
          email,
          username,
          connector_kind,
          imap_host,
          imap_port,
          imap_tls_mode,
          smtp_host,
          smtp_port,
          smtp_tls_mode,
          secret_kind,
          encrypted_secret,
          status,
          authenticated_principal,
          capabilities,
          server_identity,
          last_verified_at
        )
        VALUES (
          ${params.owner.type === "user" ? params.owner.userId : null}::uuid,
          ${params.owner.type === "service_account" ? params.owner.serviceAccountId : null}::uuid,
          ${params.owner.type === "mailbox" ? params.owner.mailboxId : null}::uuid,
          ${params.input.name.trim()},
          ${params.input.email.trim().toLowerCase()},
          ${params.input.username.trim()},
          'imap_smtp',
          ${params.input.imap.host.trim().toLowerCase()},
          ${params.input.imap.port},
          ${params.input.imap.tlsMode},
          ${params.input.smtp.host.trim().toLowerCase()},
          ${params.input.smtp.port},
          ${params.input.smtp.tlsMode},
          ${params.input.secret.kind},
          ${encryptedSecret},
          'active',
          ${verification.data.authenticatedPrincipal},
          ${verification.data.capabilities}::jsonb,
          ${verification.data.serverIdentity}::jsonb,
          now()
        )
        RETURNING ${connectionColumns}
      `;
      if (!row) throw new Error("Provider connection insert returned no row");
      await audit.record(
        {
          action: "mail.provider_connection.create",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "provider_connection", id: row.id, label: row.name },
          requestId: params.context.requestId,
          metadata: {
            owner: params.owner,
            connectorKind: row.connector_kind,
            secretKind: row.secret_kind,
            imapHost: row.imap_host,
            smtpHost: row.smtp_host,
          },
        },
        tx,
      );
      return ok({ connection: mapConnection(row), verification: verification.data });
    });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "23505") return fail(err.conflict("Provider connection name"));
    logDatabaseFailure(log.error, "store", "provider connection", error);
    return fail(err.internal("Failed to store provider connection"));
  }
};

export const listProviderConnections = async (
  context: MailRequestContext,
  mailboxId?: string | null,
): Promise<Result<ProviderConnection[]>> => {
  const scope = requireCredentialAdminScope(context);
  if (!scope.ok) return scope;
  let includeMailboxOwned = false;
  if (mailboxId) {
    const access = await requireMailboxPermission(context, mailboxId, "read");
    if (!access.ok) return access;
    includeMailboxOwned = access.data === "admin";
  }
  const ownerUserId = context.accessSubject.type === "user" ? context.accessSubject.userId : null;
  const ownerServiceAccountId = context.actor.kind === "service_account" ? context.actor.serviceAccount.id : null;
  const rows = await sql<DbProviderConnection[]>`
    SELECT ${connectionColumns}
    FROM mail.provider_connections pc
    WHERE pc.owner_user_id = ${ownerUserId}::uuid
       OR pc.owner_service_account_id = ${ownerServiceAccountId}::uuid
       OR (${includeMailboxOwned} AND pc.owner_mailbox_id = ${mailboxId ?? null}::uuid)
    ORDER BY pc.updated_at DESC, pc.id DESC
  `;
  return ok(rows.map(mapConnection));
};

const loadConnectionRow = async (connectionId: string, db: SqlClient = sql, lock = false): Promise<DbProviderConnection | null> => {
  const lockClause = lock ? sql`FOR UPDATE` : sql``;
  const [row] = await db<DbProviderConnection[]>`
    SELECT ${connectionColumns}
    FROM mail.provider_connections pc
    WHERE pc.id = ${connectionId}::uuid
    ${lockClause}
  `;
  return row ?? null;
};

const invalidateSenderBindingVerifications = async (db: SqlClient, bindingIds: string[], code: string): Promise<void> => {
  if (bindingIds.length === 0) return;
  await db`
    UPDATE mail.sender_identity_bindings
    SET revoked_at = COALESCE(revoked_at, now()), last_error_code = ${code}
    WHERE binding_id IN (
      SELECT value::uuid FROM jsonb_array_elements_text(${bindingIds}::jsonb)
    )
  `;
  await db`
    UPDATE mail.sender_identities identity
    SET status = 'unverified'
    WHERE identity.status <> 'disabled'
      AND EXISTS (
        SELECT 1
        FROM mail.sender_identity_bindings affected
        WHERE affected.sender_identity_id = identity.id
          AND affected.binding_id IN (
            SELECT value::uuid FROM jsonb_array_elements_text(${bindingIds}::jsonb)
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM mail.sender_identity_bindings valid
        JOIN mail.provider_bindings binding ON binding.id = valid.binding_id
        JOIN mail.provider_connections connection ON connection.id = binding.connection_id
        JOIN mail.remote_resources resource ON resource.id = binding.remote_resource_id
        WHERE valid.sender_identity_id = identity.id
          AND valid.revoked_at IS NULL
          AND valid.verified_secret_revision = connection.secret_revision
          AND binding.state = 'active'
          AND binding.verified_scope_fingerprint = resource.scope_fingerprint
          AND binding.verified_secret_revision = connection.secret_revision
          AND connection.status = 'active'
          AND connection.encrypted_secret IS NOT NULL
      )
  `;
};

export const getProviderConnection = async (context: MailRequestContext, connectionId: string): Promise<Result<ProviderConnection>> => {
  const row = await loadConnectionRow(connectionId);
  if (!row) return fail(err.notFound("Provider connection"));
  const allowed = await authorizeOwner(context, ownerFromRow(row));
  return allowed.ok ? ok(mapConnection(row)) : allowed;
};

export const replaceProviderConnection = async (params: {
  context: MailRequestContext;
  connectionId: string;
  input: ProviderConnectionInput;
}): Promise<Result<{ connection: ProviderConnection; verification: ConnectorVerification }>> => {
  const current = await loadConnectionRow(params.connectionId);
  if (!current) return fail(err.notFound("Provider connection"));
  const allowed = await authorizeOwner(params.context, ownerFromRow(current));
  if (!allowed.ok) return allowed;

  const verification = await verifyProviderConnection(params.input);
  if (!verification.ok) return verification;
  let encryptedSecret: string;
  try {
    encryptedSecret = await encryptSecret(params.input.secret);
  } catch {
    return fail(err.internal("Could not encrypt provider credentials"));
  }

  try {
    return await sql.begin(async (tx) => {
      const locked = await loadConnectionRow(params.connectionId, tx, true);
      if (!locked) return fail(err.notFound("Provider connection"));
      const recheck = await authorizeOwner(params.context, ownerFromRow(locked), tx);
      if (!recheck.ok) return recheck;
      const [row] = await tx<DbProviderConnection[]>`
        UPDATE mail.provider_connections pc
        SET
          name = ${params.input.name.trim()},
          email = ${params.input.email.trim().toLowerCase()},
          username = ${params.input.username.trim()},
          imap_host = ${params.input.imap.host.trim().toLowerCase()},
          imap_port = ${params.input.imap.port},
          imap_tls_mode = ${params.input.imap.tlsMode},
          smtp_host = ${params.input.smtp.host.trim().toLowerCase()},
          smtp_port = ${params.input.smtp.port},
          smtp_tls_mode = ${params.input.smtp.tlsMode},
          secret_kind = ${params.input.secret.kind},
          encrypted_secret = ${encryptedSecret},
          secret_revision = secret_revision + 1,
          status = 'active',
          authenticated_principal = ${verification.data.authenticatedPrincipal},
          capabilities = ${verification.data.capabilities}::jsonb,
          server_identity = ${verification.data.serverIdentity}::jsonb,
          last_verified_at = now(),
          last_error_code = NULL,
          last_error_message = NULL
        WHERE pc.id = ${params.connectionId}::uuid
        RETURNING ${connectionColumns}
      `;
      if (!row) throw new Error("Provider connection update returned no row");
      const affectedBindings = await tx<{ id: string; remote_resource_id: string }[]>`
        UPDATE mail.provider_bindings
        SET
          state = 'pending',
          last_error_code = 'CREDENTIAL_REVERIFICATION_REQUIRED',
          last_error_message = 'Provider credentials changed; verify this remote resource again'
        WHERE connection_id = ${params.connectionId}::uuid
        RETURNING id, remote_resource_id
      `;
      if (affectedBindings.length > 0) {
        await invalidateSenderBindingVerifications(
          tx,
          affectedBindings.map((binding) => binding.id),
          "CREDENTIAL_REVERIFICATION_REQUIRED",
        );
        const affectedResourceIds = [...new Set(affectedBindings.map((binding) => binding.remote_resource_id))];
        await tx`
          UPDATE mail.remote_resources resource
          SET
            status = 'connection_required',
            last_error_code = 'CREDENTIAL_REVERIFICATION_REQUIRED',
            last_error_message = 'No verified provider binding remains after a credential change'
          WHERE resource.id IN (
            SELECT value::uuid
            FROM jsonb_array_elements_text(${affectedResourceIds}::jsonb)
          )
            AND NOT EXISTS (
              SELECT 1
              FROM mail.provider_bindings binding
              JOIN mail.provider_connections connection ON connection.id = binding.connection_id
              WHERE binding.remote_resource_id = resource.id
                AND binding.state = 'active'
                AND binding.verified_secret_revision = connection.secret_revision
                AND connection.status = 'active'
                AND connection.encrypted_secret IS NOT NULL
            )
        `;
        await tx`
          UPDATE mail.mailboxes mailbox
          SET
            health = 'connection_required',
            health_reason = 'Provider credentials changed; verify the remote resource again'
          FROM mail.remote_resources resource
          WHERE resource.mailbox_id = mailbox.id
            AND resource.id IN (
              SELECT value::uuid
              FROM jsonb_array_elements_text(${affectedResourceIds}::jsonb)
            )
            AND resource.status = 'connection_required'
        `;
      }
      await audit.record(
        {
          action: "mail.provider_connection.replace",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "provider_connection", id: row.id, label: row.name },
          requestId: params.context.requestId,
          metadata: {
            secretReplaced: true,
            secretKind: row.secret_kind,
            invalidatedBindings: affectedBindings.length,
          },
        },
        tx,
      );
      return ok({ connection: mapConnection(row), verification: verification.data });
    });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "23505") return fail(err.conflict("Provider connection name"));
    logDatabaseFailure(log.error, "replace", "provider connection", error);
    return fail(err.internal("Failed to replace provider connection"));
  }
};

export const revokeProviderConnection = async (context: MailRequestContext, connectionId: string): Promise<Result<void>> => {
  try {
    return await sql.begin(async (tx) => {
      const row = await loadConnectionRow(connectionId, tx, true);
      if (!row) return fail(err.notFound("Provider connection"));
      const allowed = await authorizeOwner(context, ownerFromRow(row), tx);
      if (!allowed.ok) return allowed;
      await tx`
        UPDATE mail.provider_connections
        SET status = 'revoked', encrypted_secret = NULL, last_error_code = NULL, last_error_message = NULL
        WHERE id = ${connectionId}::uuid
      `;
      const affectedBindings = await tx<{ id: string; remote_resource_id: string }[]>`
        UPDATE mail.provider_bindings
        SET state = 'revoked', last_error_code = 'CONNECTION_REVOKED', last_error_message = 'Provider connection revoked'
        WHERE connection_id = ${connectionId}::uuid AND state <> 'revoked'
        RETURNING id, remote_resource_id
      `;
      await invalidateSenderBindingVerifications(
        tx,
        affectedBindings.map((binding) => binding.id),
        "CONNECTION_REVOKED",
      );
      for (const resourceId of new Set(affectedBindings.map((item) => item.remote_resource_id))) {
        const [active] = await tx<{ exists: boolean }[]>`
          SELECT EXISTS (
            SELECT 1
            FROM mail.provider_bindings binding
            JOIN mail.provider_connections connection ON connection.id = binding.connection_id
            JOIN mail.remote_resources resource ON resource.id = binding.remote_resource_id
            WHERE binding.remote_resource_id = ${resourceId}::uuid
              AND binding.state = 'active'
              AND binding.verified_scope_fingerprint = resource.scope_fingerprint
              AND binding.verified_secret_revision = connection.secret_revision
              AND connection.status = 'active'
              AND connection.encrypted_secret IS NOT NULL
          ) AS exists
        `;
        if (!active?.exists) {
          await tx`
            UPDATE mail.remote_resources rr
            SET status = 'connection_required', last_error_code = 'NO_ACTIVE_BINDING', last_error_message = 'No active provider binding remains'
            WHERE rr.id = ${resourceId}::uuid
          `;
          await tx`
            UPDATE mail.mailboxes m
            SET health = 'connection_required', health_reason = 'No active provider binding remains'
            FROM mail.remote_resources rr
            WHERE rr.id = ${resourceId}::uuid AND m.id = rr.mailbox_id
          `;
        }
      }
      await audit.record(
        {
          action: "mail.provider_connection.revoke",
          outcome: "allowed",
          actor: auditActorFromRequest(context),
          target: { type: "provider_connection", id: row.id, label: row.name },
          requestId: context.requestId,
          metadata: { credentialDestroyed: true },
        },
        tx,
      );
      return ok();
    });
  } catch {
    return fail(err.internal("Failed to revoke provider connection"));
  }
};

export const loadProviderConnectionRuntime = async (connectionId: string): Promise<ProviderConnectionInput> => {
  const snapshot = await loadProviderConnectionRuntimeSnapshot(connectionId);
  return snapshot.runtime;
};

export const loadProviderConnectionRuntimeSnapshot = async (
  connectionId: string,
): Promise<{ runtime: ProviderConnectionInput; secretRevision: number }> => {
  const row = await loadConnectionRow(connectionId);
  if (!row || row.status === "revoked" || !row.encrypted_secret)
    throw Object.assign(new Error("Provider connection is unavailable"), { code: "CONNECTION_UNAVAILABLE" });
  let secret: ProviderSecret;
  try {
    secret = providerSecretSchema.parse(await decryptSecret<ProviderSecret>(row.encrypted_secret));
  } catch {
    throw Object.assign(new Error("Provider credential could not be decrypted"), { code: "CREDENTIAL_DECRYPTION_FAILED" });
  }
  if (secret.kind === "oauth2" && secret.expiresAt && new Date(secret.expiresAt).getTime() <= Date.now()) {
    throw Object.assign(new Error("Provider OAuth credential expired"), { code: "CREDENTIAL_EXPIRED" });
  }
  return {
    runtime: connectionFromInput(
      {
        name: row.name,
        email: row.email,
        username: row.username,
        imap: { host: row.imap_host, port: row.imap_port, tlsMode: row.imap_tls_mode },
        smtp: { host: row.smtp_host, port: row.smtp_port, tlsMode: row.smtp_tls_mode },
        secret,
      },
      secret,
    ),
    secretRevision: row.secret_revision,
  };
};
