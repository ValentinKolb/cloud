import { audit, logger, toPgTextArray } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { ConnectorVerification, ProviderBinding, ProviderConnection, RemoteFolder, RemoteNamespace } from "../contracts";
import { requireMailboxPermission } from "./access";
import { auditActorFromRequest, type MailRequestContext } from "./auth";
import { sha256Json } from "./canonical";
import { imapSmtpConnector } from "./connectors";
import { logDatabaseFailure } from "./database-errors";
import { getProviderConnection, type loadProviderConnectionRuntime, loadProviderConnectionRuntimeSnapshot } from "./provider-connections";

type SqlClient = typeof sql;

const log = logger("mail:bindings");

type FolderEvidence = {
  relativePath: string;
  parentRelativePath: string | null;
  name: string;
  role: RemoteFolder["role"];
  remotePath: string;
  delimiter: string | null;
  selectable: boolean;
  subscribed: boolean;
  uidValidity: string | null;
  uidNext: string | null;
  highestModseq: string | null;
  rights: string[];
  samples: string[];
};

type ScopeEvidence = {
  version: 1;
  serverKey: string;
  rootPath: string;
  namespaces: RemoteNamespace[];
  folders: FolderEvidence[];
};

type DbBinding = {
  id: string;
  mailbox_id: string;
  connection_id: string;
  state: ProviderBinding["state"];
  authenticated_principal: string | null;
  remote_locator: Record<string, unknown> | string;
  capabilities: Record<string, unknown> | string;
  last_verified_at: Date | string | null;
  last_error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const parseRecord = (value: Record<string, unknown> | string): Record<string, unknown> =>
  typeof value === "string" ? (JSON.parse(value) as Record<string, unknown>) : value;

const mapBinding = (row: DbBinding): ProviderBinding => {
  const locator = parseRecord(row.remote_locator);
  return {
    id: row.id,
    mailboxId: row.mailbox_id,
    connectionId: row.connection_id,
    state: row.state,
    authenticatedPrincipal: row.authenticated_principal,
    rootPath: typeof locator["rootPath"] === "string" ? locator["rootPath"] : "",
    capabilities: parseRecord(row.capabilities),
    lastVerifiedAt: row.last_verified_at ? toIso(row.last_verified_at) : null,
    lastError: row.last_error_message,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
};

const sha256 = sha256Json;

const normalizeRoot = (rootPath: string | null | undefined): string => rootPath?.trim() ?? "";

const relativePathFor = (folder: RemoteFolder, rootPath: string): string => {
  if (!rootPath) return folder.path.toUpperCase() === "INBOX" ? "INBOX" : folder.path;
  if (folder.path === rootPath) return ".";
  const prefix = `${rootPath}${folder.delimiter ?? ""}`;
  return folder.path.startsWith(prefix) ? folder.path.slice(prefix.length) : folder.path;
};

const parentRelativePathFor = (folder: RemoteFolder, rootPath: string): string | null => {
  if (!folder.parentPath) return null;
  if (folder.parentPath === rootPath) return ".";
  const prefix = `${rootPath}${folder.delimiter ?? ""}`;
  return rootPath && folder.parentPath.startsWith(prefix) ? folder.parentPath.slice(prefix.length) : folder.parentPath;
};

const messageSampleFingerprint = (message: Awaited<ReturnType<typeof imapSmtpConnector.fetchEnvelopeBatch>>["messages"][number]): string =>
  sha256({
    providerMessageId: message.providerMessageId,
    messageId: message.messageId,
    sentAt: message.sentAt?.toISOString() ?? null,
    internalDate: message.internalDate.toISOString(),
    sizeBytes: message.sizeBytes,
    subject: message.subject,
    from: message.addresses.from.map((item) => item.address),
  });

const buildScopeEvidence = async (params: {
  verification: ConnectorVerification;
  folders: RemoteFolder[];
  rootPath: string;
  runtime: Awaited<ReturnType<typeof loadProviderConnectionRuntime>>;
}): Promise<ScopeEvidence> => {
  const snapshots: FolderEvidence[] = params.folders.map((folder) => ({
    relativePath: relativePathFor(folder, params.rootPath),
    parentRelativePath: parentRelativePathFor(folder, params.rootPath),
    name: folder.name,
    role: folder.role,
    remotePath: folder.path,
    delimiter: folder.delimiter,
    selectable: folder.selectable,
    subscribed: folder.subscribed,
    uidValidity: folder.uidValidity,
    uidNext: folder.uidNext,
    highestModseq: folder.highestModseq,
    rights: [...folder.rights].sort(),
    samples: [],
  }));

  const candidates = snapshots
    .filter((folder) => folder.selectable && folder.rights.includes("read") && folder.uidValidity && Number(folder.uidNext) > 1)
    .sort((left, right) => {
      if (left.role === "inbox" && right.role !== "inbox") return -1;
      if (right.role === "inbox" && left.role !== "inbox") return 1;
      return left.relativePath.localeCompare(right.relativePath);
    })
    .slice(0, 3);

  for (const folder of candidates) {
    const highUid = Math.max(1, Number(folder.uidNext) - 1);
    const batch = await imapSmtpConnector.fetchEnvelopeBatch(params.runtime, {
      folderPath: folder.remotePath,
      folderStableKey: sha256({ relativePath: folder.relativePath }),
      uidValidity: folder.uidValidity ?? "0",
      highUid,
      limit: 20,
    });
    folder.samples = batch.messages.map(messageSampleFingerprint).sort();
  }

  return {
    version: 1,
    serverKey: sha256({
      host: params.runtime.imap.host.toLowerCase(),
      port: params.runtime.imap.port,
      tlsMode: params.runtime.imap.tlsMode,
      serverInfo: params.verification.serverIdentity["serverInfo"] ?? {},
    }),
    rootPath: params.rootPath,
    namespaces: params.verification.accounts[0]?.namespaces ?? [],
    folders: snapshots.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  };
};

type EvidenceComparison = { state: "verified" | "ambiguous" | "different"; reason: string };

const compareEvidence = (expected: ScopeEvidence, candidate: ScopeEvidence): EvidenceComparison => {
  if (expected.serverKey !== candidate.serverKey) return { state: "different", reason: "Provider server identity differs" };
  const expectedFolders = new Map(
    expected.folders.filter((item) => item.uidValidity).map((item) => [`${item.relativePath}\n${item.uidValidity}`, item]),
  );
  const folderMatches = candidate.folders.filter((item) => expectedFolders.has(`${item.relativePath}\n${item.uidValidity}`));
  if (folderMatches.length === 0) return { state: "different", reason: "No matching folder identity was found" };

  const expectedSamples = new Set(expected.folders.flatMap((folder) => folder.samples));
  const candidateSamples = candidate.folders.flatMap((folder) => folder.samples);
  if (expectedSamples.size === 0 || candidateSamples.length === 0) {
    return { state: "ambiguous", reason: "The remote resource has no overlapping immutable message sample" };
  }
  if (!candidateSamples.some((sample) => expectedSamples.has(sample))) {
    return { state: "different", reason: "Immutable message samples do not overlap" };
  }
  return { state: "verified", reason: "Folder identities and immutable message samples overlap" };
};

const canonicalFolderKey = (relativePath: string): string => sha256({ version: 1, relativePath });

const projectFolders = async (params: {
  db: SqlClient;
  remoteResourceId: string;
  bindingId: string;
  discoveryGeneration: number;
  evidence: ScopeEvidence;
}): Promise<void> => {
  const rows = params.evidence.folders.map((folder) => ({
    remote_resource_id: params.remoteResourceId,
    stable_key: canonicalFolderKey(folder.relativePath),
    name: folder.name,
    role: folder.role,
    selectable: folder.selectable,
    selected_for_sync: folder.selectable && folder.rights.includes("read"),
    discovery_generation: params.discoveryGeneration,
    sync_status: folder.selectable && folder.rights.includes("read") ? "pending" : "excluded",
  }));
  if (rows.length === 0) return;
  await params.db`
    INSERT INTO mail.folders ${sql(
      rows,
      "remote_resource_id",
      "stable_key",
      "name",
      "role",
      "selectable",
      "selected_for_sync",
      "discovery_generation",
      "sync_status",
    )}
    ON CONFLICT (remote_resource_id, stable_key) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      selectable = EXCLUDED.selectable,
      selected_for_sync = EXCLUDED.selected_for_sync,
      discovery_generation = EXCLUDED.discovery_generation,
      sync_status = CASE WHEN mail.folders.sync_status = 'current' THEN mail.folders.sync_status ELSE EXCLUDED.sync_status END
  `;

  const parentMapping = params.evidence.folders
    .filter((folder) => folder.parentRelativePath)
    .map((folder) => ({
      child_key: canonicalFolderKey(folder.relativePath),
      parent_key: canonicalFolderKey(folder.parentRelativePath ?? ""),
    }));
  if (parentMapping.length > 0) {
    await params.db`
      WITH mapping AS (
        SELECT child_key, parent_key
        FROM jsonb_to_recordset(${parentMapping}::jsonb) AS x(child_key TEXT, parent_key TEXT)
      )
      UPDATE mail.folders child
      SET parent_id = parent.id
      FROM mapping
      JOIN mail.folders parent
        ON parent.remote_resource_id = ${params.remoteResourceId}::uuid
       AND parent.stable_key = mapping.parent_key
      WHERE child.remote_resource_id = ${params.remoteResourceId}::uuid
        AND child.stable_key = mapping.child_key
    `;
  }

  const folderRows = await params.db<{ id: string; stable_key: string }[]>`
    SELECT id, stable_key FROM mail.folders WHERE remote_resource_id = ${params.remoteResourceId}::uuid
  `;
  const folderIds = new Map(folderRows.map((folder) => [folder.stable_key, folder.id]));
  const refs = params.evidence.folders.flatMap((folder) => {
    const folderId = folderIds.get(canonicalFolderKey(folder.relativePath));
    return folderId
      ? [
          {
            binding_id: params.bindingId,
            folder_id: folderId,
            remote_path: folder.remotePath,
            delimiter: folder.delimiter,
            namespace_kind: null,
            uid_validity: folder.uidValidity,
            highest_modseq: folder.highestModseq,
            uid_next: folder.uidNext,
            subscribed: folder.subscribed,
            effective_rights: toPgTextArray(folder.rights),
            rights_source: "select",
            last_verified_at: new Date(),
          },
        ]
      : [];
  });
  if (refs.length > 0) {
    await params.db`
      INSERT INTO mail.binding_folder_refs ${sql(
        refs,
        "binding_id",
        "folder_id",
        "remote_path",
        "delimiter",
        "namespace_kind",
        "uid_validity",
        "highest_modseq",
        "uid_next",
        "subscribed",
        "effective_rights",
        "rights_source",
        "last_verified_at",
      )}
      ON CONFLICT (binding_id, folder_id) DO UPDATE SET
        remote_path = EXCLUDED.remote_path,
        delimiter = EXCLUDED.delimiter,
        uid_validity = EXCLUDED.uid_validity,
        highest_modseq = EXCLUDED.highest_modseq,
        uid_next = EXCLUDED.uid_next,
        subscribed = EXCLUDED.subscribed,
        effective_rights = EXCLUDED.effective_rights,
        rights_source = EXCLUDED.rights_source,
        last_verified_at = EXCLUDED.last_verified_at
    `;
  }
};

const assertConnectionMatchesPolicy = (
  policy: "shared_connection" | "personal_provider_account",
  mailboxId: string,
  connection: ProviderConnection,
  context: MailRequestContext,
): Result<void> => {
  if (policy === "shared_connection") {
    return connection.owner.type === "mailbox" && connection.owner.mailboxId === mailboxId
      ? ok()
      : fail(err.badInput("Shared connection mailboxes require a mailbox-owned provider connection"));
  }
  if (connection.owner.type === "mailbox") return fail(err.badInput("Personal provider mailboxes require a private provider connection"));
  if (connection.owner.type === "user") {
    return context.accessSubject.type === "user" && context.accessSubject.userId === connection.owner.userId
      ? ok()
      : fail(err.forbidden("A personal provider binding can be attached only by its credential owner"));
  }
  return context.actor.kind === "service_account" && context.actor.serviceAccount.id === connection.owner.serviceAccountId
    ? ok()
    : fail(err.forbidden("A service-account binding can be attached only by its credential owner"));
};

export const attachProviderBinding = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  connectionId: string;
  rootPath?: string | null;
}): Promise<Result<{ binding: ProviderBinding; requiresConfirmation: boolean; comparisonReason: string }>> => {
  const rootPath = normalizeRoot(params.rootPath);
  if (rootPath.length > 4_000) return fail(err.badInput("Remote root path is too long"));

  const [mailbox] = await sql<{ connection_policy: "shared_connection" | "personal_provider_account" }[]>`
    SELECT connection_policy FROM mail.mailboxes WHERE id = ${params.mailboxId}::uuid AND deleted_at IS NULL
  `;
  if (!mailbox) return fail(err.notFound("Mailbox"));
  const requiredPermission = mailbox.connection_policy === "shared_connection" ? "admin" : "read";
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, requiredPermission);
  if (!allowed.ok) return allowed;

  const connectionResult = await getProviderConnection(params.context, params.connectionId);
  if (!connectionResult.ok) return connectionResult;
  const policyCheck = assertConnectionMatchesPolicy(mailbox.connection_policy, params.mailboxId, connectionResult.data, params.context);
  if (!policyCheck.ok) return policyCheck;

  let runtime: Awaited<ReturnType<typeof loadProviderConnectionRuntime>>;
  let verifiedSecretRevision: number;
  let verification: ConnectorVerification;
  let folders: RemoteFolder[];
  try {
    const snapshot = await loadProviderConnectionRuntimeSnapshot(params.connectionId);
    runtime = snapshot.runtime;
    verifiedSecretRevision = snapshot.secretRevision;
    [verification, folders] = await Promise.all([imapSmtpConnector.verify(runtime), imapSmtpConnector.discoverFolders(runtime, rootPath)]);
  } catch {
    return fail(err.badInput("Provider binding verification failed"));
  }
  if (folders.length === 0) return fail(err.badInput("The selected remote root contains no visible folders"));
  if (rootPath && !folders.some((folder) => folder.path === rootPath || folder.path.startsWith(rootPath))) {
    return fail(err.badInput("The selected remote root is not visible to this provider connection"));
  }

  let evidence: ScopeEvidence;
  try {
    evidence = await buildScopeEvidence({ verification, folders, rootPath, runtime });
  } catch {
    return fail(err.badInput("Remote resource fingerprint verification failed"));
  }
  const evidenceFingerprint = sha256(evidence);
  const account = verification.accounts[0];
  if (!account) return fail(err.badInput("The provider did not expose a remote account"));

  try {
    return await sql.begin(async (tx) => {
      const [lockedMailbox] = await tx<{ connection_policy: "shared_connection" | "personal_provider_account" }[]>`
        SELECT connection_policy
        FROM mail.mailboxes
        WHERE id = ${params.mailboxId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (!lockedMailbox) return fail(err.notFound("Mailbox"));
      if (lockedMailbox.connection_policy !== mailbox.connection_policy) {
        return fail(err.badInput("Mailbox connection policy changed during verification"));
      }
      const permission = await requireMailboxPermission(params.context, params.mailboxId, requiredPermission, tx);
      if (!permission.ok) return permission;
      const [lockedConnection] = await tx<
        {
          status: string;
          secret_revision: number;
          owner_user_id: string | null;
          owner_service_account_id: string | null;
          owner_mailbox_id: string | null;
        }[]
      >`
        SELECT status, secret_revision, owner_user_id, owner_service_account_id, owner_mailbox_id
        FROM mail.provider_connections
        WHERE id = ${params.connectionId}::uuid
        FOR UPDATE
      `;
      if (!lockedConnection || lockedConnection.status !== "active") return fail(err.badInput("Provider connection is no longer active"));
      if (lockedConnection.secret_revision !== verifiedSecretRevision) {
        return fail(err.conflict("Provider credentials changed during remote verification"));
      }

      let [resource] = await tx<
        {
          id: string;
          scope_fingerprint: string;
          discovery_generation: string | number;
        }[]
      >`
        SELECT id, scope_fingerprint, discovery_generation
        FROM mail.remote_resources
        WHERE mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      let existingEvidence: ScopeEvidence | null = null;
      let comparison: EvidenceComparison = { state: "verified", reason: "Initial verified provider binding" };

      if (!resource) {
        [resource] = await tx<
          {
            id: string;
            scope_fingerprint: string;
            discovery_generation: string | number;
          }[]
        >`
          INSERT INTO mail.remote_resources (
            mailbox_id,
            connector_kind,
            remote_locator,
            server_identity,
            scope_fingerprint,
            status,
            discovery_generation
          )
          VALUES (
            ${params.mailboxId}::uuid,
            'imap_smtp',
            ${{ accountId: account.id, rootPath }}::jsonb,
            ${verification.serverIdentity}::jsonb,
            ${evidenceFingerprint},
            'active',
            1
          )
          RETURNING id, scope_fingerprint, discovery_generation
        `;
      } else {
        const [prior] = await tx<{ verification_evidence: ScopeEvidence | string }[]>`
          SELECT verification_evidence
          FROM mail.provider_bindings
          WHERE remote_resource_id = ${resource.id}::uuid
            AND verified_scope_fingerprint = ${resource.scope_fingerprint}
          ORDER BY (state = 'active') DESC, last_verified_at DESC NULLS LAST, created_at
          LIMIT 1
        `;
        if (!prior) return fail(err.internal("Remote resource has no trusted verification evidence"));
        existingEvidence =
          typeof prior.verification_evidence === "string"
            ? (JSON.parse(prior.verification_evidence) as ScopeEvidence)
            : prior.verification_evidence;
        comparison = compareEvidence(existingEvidence, evidence);
        if (comparison.state === "different") return fail(err.badInput(comparison.reason));
        await tx`
          UPDATE mail.remote_resources
          SET discovery_generation = discovery_generation + 1
          WHERE id = ${resource.id}::uuid
          RETURNING discovery_generation
        `;
        resource.discovery_generation = Number(resource.discovery_generation) + 1;
      }
      if (!resource) throw new Error("Remote resource insert returned no row");

      const requiresConfirmation = comparison.state === "ambiguous";
      const bindingState = requiresConfirmation ? "pending" : "active";
      const [binding] = await tx<DbBinding[]>`
        INSERT INTO mail.provider_bindings AS pb (
          remote_resource_id,
          connection_id,
          state,
          authenticated_principal,
          remote_locator,
          capabilities,
          rights,
          verification_evidence,
          verified_scope_fingerprint,
          verified_secret_revision,
          last_verified_at
        )
        VALUES (
          ${resource.id}::uuid,
          ${params.connectionId}::uuid,
          ${bindingState},
          ${verification.authenticatedPrincipal},
          ${{ accountId: account.id, rootPath }}::jsonb,
          ${verification.capabilities}::jsonb,
          ${{}}::jsonb,
          ${{ ...evidence, comparisonReason: comparison.reason }}::jsonb,
          ${requiresConfirmation ? null : resource.scope_fingerprint},
          ${verifiedSecretRevision},
          now()
        )
        ON CONFLICT (remote_resource_id, connection_id) DO UPDATE SET
          state = EXCLUDED.state,
          authenticated_principal = EXCLUDED.authenticated_principal,
          remote_locator = EXCLUDED.remote_locator,
          capabilities = EXCLUDED.capabilities,
          rights = EXCLUDED.rights,
          verification_evidence = EXCLUDED.verification_evidence,
          verified_scope_fingerprint = EXCLUDED.verified_scope_fingerprint,
          verified_secret_revision = EXCLUDED.verified_secret_revision,
          last_verified_at = EXCLUDED.last_verified_at,
          last_error_code = NULL,
          last_error_message = NULL
        RETURNING
          pb.id,
          (SELECT mailbox_id FROM mail.remote_resources WHERE id = pb.remote_resource_id) AS mailbox_id,
          pb.connection_id,
          pb.state,
          pb.authenticated_principal,
          pb.remote_locator,
          pb.capabilities,
          pb.last_verified_at,
          pb.last_error_message,
          pb.created_at,
          pb.updated_at
      `;
      if (!binding) throw new Error("Provider binding insert returned no row");
      await tx`DELETE FROM mail.remote_namespaces WHERE binding_id = ${binding.id}::uuid`;
      await tx`DELETE FROM mail.binding_folder_refs WHERE binding_id = ${binding.id}::uuid`;

      if (!requiresConfirmation) {
        await projectFolders({
          db: tx,
          remoteResourceId: resource.id,
          bindingId: binding.id,
          discoveryGeneration: Number(resource.discovery_generation),
          evidence,
        });
        if (evidence.namespaces.length > 0) {
          const namespaceRows = evidence.namespaces.map((namespace) => ({
            binding_id: binding.id,
            kind: namespace.kind === "other_users" ? "other_users" : namespace.kind,
            prefix: namespace.prefix,
            delimiter: namespace.delimiter,
          }));
          await tx`
            INSERT INTO mail.remote_namespaces ${sql(namespaceRows, "binding_id", "kind", "prefix", "delimiter")}
            ON CONFLICT (binding_id, kind, prefix) DO UPDATE SET delimiter = EXCLUDED.delimiter, discovered_at = now()
          `;
        }
        await tx`
          UPDATE mail.remote_resources
          SET status = 'active', last_error_code = NULL, last_error_message = NULL
          WHERE id = ${resource.id}::uuid
        `;
        await tx`
          UPDATE mail.mailboxes
          SET health = 'bootstrapping', health_reason = 'Initial synchronization pending'
          WHERE id = ${params.mailboxId}::uuid
        `;
      }

      await audit.record(
        {
          action: "mail.provider_binding.attach",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "mailbox", id: params.mailboxId },
          requestId: params.context.requestId,
          metadata: {
            bindingId: binding.id,
            connectionId: params.connectionId,
            rootPath,
            state: bindingState,
            comparisonReason: comparison.reason,
          },
        },
        tx,
      );
      return ok({ binding: mapBinding(binding), requiresConfirmation, comparisonReason: comparison.reason });
    });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "23505") return fail(err.conflict("Provider binding"));
    logDatabaseFailure(log.error, "attach", "provider binding", error);
    return fail(err.internal("Failed to attach provider binding"));
  }
};

export const confirmProviderBinding = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  bindingId: string;
}): Promise<Result<ProviderBinding>> => {
  try {
    return await sql.begin(async (tx) => {
      const [mailbox] = await tx<{ id: string }[]>`
        SELECT id FROM mail.mailboxes WHERE id = ${params.mailboxId}::uuid AND deleted_at IS NULL FOR UPDATE
      `;
      if (!mailbox) return fail(err.notFound("Mailbox"));
      const allowed = await requireMailboxPermission(params.context, params.mailboxId, "admin", tx);
      if (!allowed.ok) return allowed;
      const [row] = await tx<
        (DbBinding & {
          remote_resource_id: string;
          scope_fingerprint: string;
          discovery_generation: number;
          verification_evidence: ScopeEvidence | string;
          verified_secret_revision: number;
          secret_revision: number;
        })[]
      >`
        SELECT
          pb.id,
          rr.mailbox_id,
          pb.connection_id,
          pb.state,
          pb.authenticated_principal,
          pb.remote_locator,
          pb.capabilities,
          pb.last_verified_at,
          pb.last_error_message,
          pb.created_at,
          pb.updated_at,
          pb.remote_resource_id,
          rr.scope_fingerprint,
          rr.discovery_generation,
          pb.verification_evidence,
          pb.verified_secret_revision,
          pc.secret_revision
        FROM mail.provider_bindings pb
        JOIN mail.remote_resources rr ON rr.id = pb.remote_resource_id
        JOIN mail.provider_connections pc ON pc.id = pb.connection_id
        WHERE pb.id = ${params.bindingId}::uuid AND rr.mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE OF pb, rr, pc
      `;
      if (!row) return fail(err.notFound("Provider binding"));
      if (row.state !== "pending") return fail(err.badInput("Only pending provider bindings can be confirmed"));
      if (row.verified_secret_revision !== row.secret_revision) {
        return fail(err.badInput("Provider credentials changed; verify the remote resource again"));
      }
      const evidence =
        typeof row.verification_evidence === "string"
          ? (JSON.parse(row.verification_evidence) as ScopeEvidence)
          : row.verification_evidence;
      await projectFolders({
        db: tx,
        remoteResourceId: row.remote_resource_id,
        bindingId: row.id,
        discoveryGeneration: row.discovery_generation,
        evidence,
      });
      if (evidence.namespaces.length > 0) {
        const namespaceRows = evidence.namespaces.map((namespace) => ({
          binding_id: row.id,
          kind: namespace.kind,
          prefix: namespace.prefix,
          delimiter: namespace.delimiter,
        }));
        await tx`
          INSERT INTO mail.remote_namespaces ${sql(namespaceRows, "binding_id", "kind", "prefix", "delimiter")}
          ON CONFLICT (binding_id, kind, prefix) DO UPDATE SET delimiter = EXCLUDED.delimiter, discovered_at = now()
        `;
      }
      const [updated] = await tx<DbBinding[]>`
        UPDATE mail.provider_bindings pb
        SET state = 'active', verified_scope_fingerprint = ${row.scope_fingerprint}, last_verified_at = now()
        WHERE pb.id = ${row.id}::uuid
        RETURNING
          pb.id,
          ${params.mailboxId}::uuid AS mailbox_id,
          pb.connection_id,
          pb.state,
          pb.authenticated_principal,
          pb.remote_locator,
          pb.capabilities,
          pb.last_verified_at,
          pb.last_error_message,
          pb.created_at,
          pb.updated_at
      `;
      if (!updated) throw new Error("Provider binding update returned no row");
      await tx`
        UPDATE mail.remote_resources
        SET status = 'active', last_error_code = NULL, last_error_message = NULL
        WHERE id = ${row.remote_resource_id}::uuid
      `;
      await tx`
        UPDATE mail.mailboxes
        SET health = 'bootstrapping', health_reason = 'Initial synchronization pending'
        WHERE id = ${params.mailboxId}::uuid
      `;
      await audit.record(
        {
          action: "mail.provider_binding.confirm",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "mailbox", id: params.mailboxId },
          requestId: params.context.requestId,
          metadata: { bindingId: params.bindingId, explicitAdminConfirmation: true },
        },
        tx,
      );
      return ok(mapBinding(updated));
    });
  } catch (error) {
    logDatabaseFailure(log.error, "confirm", "provider binding", error);
    return fail(err.internal("Failed to confirm provider binding"));
  }
};

export const listProviderBindings = async (context: MailRequestContext, mailboxId: string): Promise<Result<ProviderBinding[]>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<DbBinding[]>`
    SELECT
      pb.id,
      rr.mailbox_id,
      pb.connection_id,
      pb.state,
      pb.authenticated_principal,
      pb.remote_locator,
      pb.capabilities,
      pb.last_verified_at,
      pb.last_error_message,
      pb.created_at,
      pb.updated_at
    FROM mail.provider_bindings pb
    JOIN mail.remote_resources rr ON rr.id = pb.remote_resource_id
    WHERE rr.mailbox_id = ${mailboxId}::uuid
    ORDER BY pb.created_at, pb.id
  `;
  return ok(rows.map(mapBinding));
};
