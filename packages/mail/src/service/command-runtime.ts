import {
  createRuntimeLifecycle,
  createRuntimeTaskTracker,
  logger,
  stopRuntimeJobs,
  stopRuntimeResources,
} from "@valentinkolb/cloud/services";
import { toPgTextArray } from "@valentinkolb/cloud/services/postgres";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { job, mutex, scheduler } from "@valentinkolb/sync";
import { sql } from "bun";
import { z } from "zod";
import type { CommandState, MailCommand, RemoteMessagePrecondition } from "../contracts";
import { remoteMessagePreconditionSchema } from "../contracts";
import { requireMailboxPermission } from "./access";
import type { MailRequestContext } from "./auth";
import { rediscoverProviderBinding } from "./bindings";
import { commandStillAuthorized } from "./command-authorization";
import { imapSmtpConnector, type RemoteMessageState, type RemoteMutationTarget } from "./connectors";
import { withLeaseHeartbeat } from "./lease-heartbeat";
import {
  enqueueMaintenanceCommand,
  startMaintenanceRuntime,
  stopMaintenanceRuntime,
  submitDueMaintenanceCommands,
} from "./maintenance-runtime";
import { createBlobReadable, getStoredBlob, storeReadableBlob } from "./message-blobs";
import { buildMimeStream, outboundDraftSnapshotSchema, outboundRecipients } from "./outbound-mime";
import { type loadProviderConnectionRuntime, loadProviderConnectionRuntimeSnapshot } from "./provider-connections";
import { publishMailWorkflowDependency } from "./workflow-dependencies";

const log = logger("mail:commands");
const STALE_EXECUTION_MINUTES = 10;
const MUTATION_JOB_LEASE_MS = 3 * 60_000;
const OUTBOX_JOB_LEASE_MS = 4 * 60_000;
const JOB_HEARTBEAT_INTERVAL_MS = 30_000;
const PROVIDER_OPERATION_LEASE_MS = 5 * 60_000;
const commandTasks = createRuntimeTaskTracker();
const providerOperationMutex = mutex({ id: "mail:remote-resource-sync", defaultTtl: PROVIDER_OPERATION_LEASE_MS, retryCount: 0 });

type JsonRecord = Record<string, unknown>;
type SqlClient = typeof sql;

type DbCommandExecution = {
  id: string;
  mailbox_id: string;
  kind: MailCommand["kind"];
  state: MailCommand["state"];
  actor_kind: "user" | "service_account" | "workflow" | "system";
  actor_id: string | null;
  initiator_actor_kind: "user" | "service_account" | null;
  initiator_actor_id: string | null;
  access_subject_kind: "user" | "service_account" | "system";
  access_subject_id: string | null;
  credential_scopes: string[] | null;
  credential_id: string | null;
  credential_expires_at: Date | string | null;
  target: JsonRecord | string;
  payload: JsonRecord | string;
  transport_metadata: JsonRecord | string;
  selected_binding_id: string;
  selected_secret_revision: number;
  attempt: number;
};

type DbPinnedBinding = {
  remote_resource_id: string;
  connection_id: string;
  connection_policy: "shared_connection" | "personal_provider_account";
  owner_user_id: string | null;
  owner_service_account_id: string | null;
  owner_mailbox_id: string | null;
  capabilities: JsonRecord | string;
  verified_secret_revision: number;
  remote_locator: JsonRecord | string;
};

type DbRemoteMessage = {
  remote_message_ref_id: string;
  message_content_id: string;
  message_id: string | null;
  folder_id: string;
  folder_path: string;
  uid_validity: string | number;
  uid: string | number;
  effective_rights: string[];
};

type DbDestinationFolder = {
  folder_id: string;
  folder_path: string;
  uid_validity: string | number | null;
  effective_rights: string[];
};

const parseJsonRecord = (value: JsonRecord | string): JsonRecord => (typeof value === "string" ? (JSON.parse(value) as JsonRecord) : value);

const normalizeCode = (error: unknown, fallback: string): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code) ? code : fallback;
};

const errorMessage = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : fallback;
  return message.slice(0, 1_000);
};

const loadPinnedBinding = async (command: DbCommandExecution): Promise<DbPinnedBinding> => {
  const [binding] = await sql<DbPinnedBinding[]>`
    SELECT
      pb.remote_resource_id,
      pb.connection_id,
      m.connection_policy,
      pc.owner_user_id,
      pc.owner_service_account_id,
      pc.owner_mailbox_id,
      pb.capabilities,
      pb.verified_secret_revision,
      pb.remote_locator
    FROM mail.provider_bindings pb
    JOIN mail.remote_resources rr ON rr.id = pb.remote_resource_id
    JOIN mail.mailboxes m ON m.id = rr.mailbox_id
    JOIN mail.provider_connections pc ON pc.id = pb.connection_id
    WHERE pb.id = ${command.selected_binding_id}::uuid
      AND rr.mailbox_id = ${command.mailbox_id}::uuid
      AND pb.state = 'active'
      AND pb.verified_scope_fingerprint = rr.scope_fingerprint
      AND pb.verified_secret_revision = ${command.selected_secret_revision}
      AND pc.secret_revision = ${command.selected_secret_revision}
      AND pc.status = 'active'
      AND pc.encrypted_secret IS NOT NULL
      AND m.deleted_at IS NULL
  `;
  if (!binding) throw Object.assign(new Error("Pinned provider binding is no longer active"), { code: "BINDING_UNAVAILABLE" });

  const ownsBinding =
    binding.connection_policy === "shared_connection"
      ? binding.owner_mailbox_id === command.mailbox_id
      : command.access_subject_kind === "user"
        ? binding.owner_user_id === command.access_subject_id
        : command.access_subject_kind === "service_account"
          ? binding.owner_service_account_id === command.access_subject_id
          : false;
  if (!ownsBinding)
    throw Object.assign(new Error("Pinned provider binding no longer belongs to the execution principal"), {
      code: "BINDING_OWNER_CHANGED",
    });
  return binding;
};

const loadPinnedRuntime = async (binding: DbPinnedBinding) => {
  const snapshot = await loadProviderConnectionRuntimeSnapshot(binding.connection_id);
  if (snapshot.secretRevision !== binding.verified_secret_revision) {
    throw Object.assign(new Error("Pinned provider credentials changed before execution"), {
      code: "CREDENTIAL_REVISION_CHANGED",
    });
  }
  return snapshot.runtime;
};

const sourceTargetSchema = z.object({
  remoteMessageRefId: z.string().uuid(),
  folderId: z.string().uuid().optional(),
  sourceFolderId: z.string().uuid().optional(),
  destinationFolderId: z.string().uuid().optional(),
  expectedRemoteState: remoteMessagePreconditionSchema.optional(),
});

const loadRemoteMessage = async (command: DbCommandExecution, target: z.infer<typeof sourceTargetSchema>): Promise<DbRemoteMessage> => {
  const folderId = target.folderId ?? target.sourceFolderId;
  if (!folderId) throw Object.assign(new Error("Command source folder is missing"), { code: "INVALID_COMMAND_TARGET" });
  const [message] = await sql<DbRemoteMessage[]>`
    SELECT
      rmr.id AS remote_message_ref_id,
      rmr.message_id AS message_content_id,
      mc.message_id,
      rmr.folder_id,
      bfr.remote_path AS folder_path,
      rmr.uid_validity,
      rmr.uid,
      bfr.effective_rights
    FROM mail.remote_message_refs rmr
    JOIN mail.message_contents mc ON mc.id = rmr.message_id
    JOIN mail.folders f ON f.id = rmr.folder_id
    JOIN mail.remote_resources rr ON rr.id = f.remote_resource_id
    JOIN mail.binding_folder_refs bfr
      ON bfr.folder_id = rmr.folder_id
     AND bfr.binding_id = ${command.selected_binding_id}::uuid
    WHERE rmr.id = ${target.remoteMessageRefId}::uuid
      AND rmr.folder_id = ${folderId}::uuid
      AND rr.mailbox_id = ${command.mailbox_id}::uuid
      AND rmr.stale_at IS NULL
      AND bfr.uid_validity = rmr.uid_validity
  `;
  if (!message) throw Object.assign(new Error("Remote message reference is no longer current"), { code: "REMOTE_MESSAGE_STALE" });
  return message;
};

const loadDestinationFolder = async (command: DbCommandExecution, folderId: string): Promise<DbDestinationFolder> => {
  const [folder] = await sql<DbDestinationFolder[]>`
    SELECT
      bfr.folder_id,
      bfr.remote_path AS folder_path,
      bfr.uid_validity,
      bfr.effective_rights
    FROM mail.binding_folder_refs bfr
    JOIN mail.folders f ON f.id = bfr.folder_id
    JOIN mail.remote_resources rr ON rr.id = f.remote_resource_id
    WHERE bfr.binding_id = ${command.selected_binding_id}::uuid
      AND bfr.folder_id = ${folderId}::uuid
      AND rr.mailbox_id = ${command.mailbox_id}::uuid
  `;
  if (!folder)
    throw Object.assign(new Error("Destination folder is unavailable on the pinned binding"), { code: "DESTINATION_UNAVAILABLE" });
  return folder;
};

const requireRights = (rights: readonly string[], required: readonly string[]): void => {
  if (required.every((right) => rights.includes(right))) return;
  throw Object.assign(new Error("Provider rights changed before command execution"), { code: "PROVIDER_RIGHTS_CHANGED" });
};

const remoteTarget = (message: DbRemoteMessage): RemoteMutationTarget => ({
  folderPath: message.folder_path,
  uidValidity: String(message.uid_validity),
  uid: Number(message.uid),
});

const commandState = async (
  command: Pick<DbCommandExecution, "id" | "attempt">,
  state: CommandState,
  error?: unknown,
): Promise<boolean> => {
  const code = error ? normalizeCode(error, "MAIL_COMMAND_FAILED") : null;
  const message = error ? errorMessage(error, "Mail command failed") : null;
  const updated = await sql.begin(async (tx) => {
    const [updated] = await tx<{ mailbox_id: string; actor_kind: string; actor_id: string | null }[]>`
      UPDATE mail.commands
      SET
        state = ${state},
        finished_at = CASE WHEN ${state} IN ('confirmed', 'failed', 'cancelled', 'reconciled', 'needs_attention') THEN now() ELSE NULL END,
        worker_heartbeat_at = NULL,
        last_error_code = ${code},
        last_error_message = ${message},
        updated_at = now()
      WHERE id = ${command.id}::uuid
        AND attempt = ${command.attempt}
        AND state = 'executing'
      RETURNING mailbox_id, actor_kind, actor_id
    `;
    if (!updated) return null;
    await tx`
      INSERT INTO mail.activity_events (
        mailbox_id, command_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
      )
      VALUES (
        ${updated.mailbox_id}::uuid,
        ${command.id}::uuid,
        ${updated.actor_kind},
        ${updated.actor_id}::uuid,
        'command.execute',
        ${state === "confirmed" || state === "reconciled" ? "confirmed" : state === "ambiguous" ? "requested" : "failed"},
        'command',
        ${command.id}::uuid,
        ${{ state, code }}::jsonb
      )
    `;
    return updated;
  });
  if (!updated) return false;
  if (["confirmed", "failed", "cancelled", "reconciled", "needs_attention"].includes(state)) {
    await publishMailWorkflowDependency({
      mailboxId: updated.mailbox_id,
      dependency: { kind: "mail.command", key: command.id },
    });
  }
  return true;
};

const claimCommand = async (
  commandId: string,
  allowedKinds: string[],
): Promise<{ command: DbCommandExecution; previousState: string } | null> =>
  sql.begin(async (tx) => {
    const [current] = await tx<DbCommandExecution[]>`
      SELECT
        id, mailbox_id, kind, state, actor_kind, actor_id, initiator_actor_kind, initiator_actor_id,
        access_subject_kind, access_subject_id,
        credential_scopes, credential_id, credential_expires_at, target, payload, transport_metadata,
        selected_binding_id, selected_secret_revision, attempt
      FROM mail.commands
      WHERE id = ${commandId}::uuid
      FOR UPDATE
    `;
    if (!current || !allowedKinds.includes(current.kind) || !["queued", "ambiguous"].includes(current.state)) return null;
    if (current.actor_kind === "workflow") {
      const [target] = await tx<{ id: string }[]>`
        SELECT target.id
        FROM mail.workflow_step_runs step
        JOIN mail.workflow_run_targets target ON target.id = step.target_id
        WHERE step.command_id = ${current.id}::uuid
          AND step.execution_generation = target.execution_generation
          AND target.state IN ('running', 'waiting')
          AND target.cancel_requested_at IS NULL
        FOR UPDATE OF target
      `;
      if (!target) {
        await tx`
          UPDATE mail.commands
          SET
            state = 'cancelled',
            finished_at = now(),
            last_error_code = 'WORKFLOW_CANCELED',
            last_error_message = 'The workflow target was canceled before command execution',
            updated_at = now()
          WHERE id = ${current.id}::uuid AND state IN ('queued', 'ambiguous')
        `;
        return null;
      }
    }
    const previousState = current.state;
    const [claimed] = await tx<DbCommandExecution[]>`
      UPDATE mail.commands
      SET
        state = 'executing',
        attempt = attempt + 1,
        started_at = now(),
        worker_heartbeat_at = now(),
        finished_at = NULL,
        updated_at = now()
      WHERE id = ${commandId}::uuid
      RETURNING
        id, mailbox_id, kind, state, actor_kind, actor_id, initiator_actor_kind, initiator_actor_id,
        access_subject_kind, access_subject_id,
        credential_scopes, credential_id, credential_expires_at, target, payload, transport_metadata,
        selected_binding_id, selected_secret_revision, attempt
    `;
    return claimed ? { command: claimed, previousState } : null;
  });

const updateMutationProjection = async (params: {
  command: DbCommandExecution;
  source: DbRemoteMessage;
  destination?: DbDestinationFolder | null;
  destinationUidValidity?: string | null;
  destinationUid?: number | null;
  flags?: string[];
  keywords?: string[];
}): Promise<boolean> => {
  return sql.begin(async (tx) => {
    const [active] = await tx<{ id: string }[]>`
      SELECT id
      FROM mail.commands
      WHERE id = ${params.command.id}::uuid
        AND attempt = ${params.command.attempt}
        AND state = 'executing'
      FOR UPDATE
    `;
    if (!active) return false;
    if (params.flags) {
      await tx`
        UPDATE mail.message_placements
        SET flags = ${toPgTextArray(params.flags)}::text[], updated_at = now()
        WHERE remote_message_ref_id = ${params.source.remote_message_ref_id}::uuid
      `;
    }
    if (params.keywords) {
      await tx`
        UPDATE mail.message_placements
        SET keywords = ${toPgTextArray(params.keywords)}::text[], updated_at = now()
        WHERE remote_message_ref_id = ${params.source.remote_message_ref_id}::uuid
      `;
    }
    if ((params.command.kind === "copy" || params.command.kind === "move") && params.destination) {
      if (params.destinationUidValidity && params.destinationUid) {
        const [remoteRef] = await tx<{ id: string }[]>`
          INSERT INTO mail.remote_message_refs (
            folder_id, message_id, uid_validity, uid, connector_ref, first_seen_at, last_seen_at
          )
          VALUES (
            ${params.destination.folder_id}::uuid,
            ${params.source.message_content_id}::uuid,
            ${params.destinationUidValidity},
            ${params.destinationUid},
            ${{ source: "command", commandId: params.command.id }}::jsonb,
            now(),
            now()
          )
          ON CONFLICT (folder_id, uid_validity, uid) DO UPDATE SET
            message_id = EXCLUDED.message_id,
            last_seen_at = now(),
            stale_at = NULL
          RETURNING id
        `;
        if (remoteRef) {
          await tx`
            INSERT INTO mail.message_placements (remote_message_ref_id, folder_id, message_id, flags, keywords)
            SELECT
              ${remoteRef.id}::uuid,
              ${params.destination.folder_id}::uuid,
              ${params.source.message_content_id}::uuid,
              mp.flags,
              mp.keywords
            FROM mail.message_placements mp
            WHERE mp.remote_message_ref_id = ${params.source.remote_message_ref_id}::uuid
            ON CONFLICT (remote_message_ref_id) DO UPDATE SET
              folder_id = EXCLUDED.folder_id,
              message_id = EXCLUDED.message_id,
              flags = EXCLUDED.flags,
              keywords = EXCLUDED.keywords,
              deleted_at = NULL,
              updated_at = now()
          `;
        }
      }
    }
    if (params.command.kind === "move" || params.command.kind === "delete") {
      await tx`
        UPDATE mail.remote_message_refs
        SET stale_at = now(), last_seen_at = now()
        WHERE id = ${params.source.remote_message_ref_id}::uuid
      `;
      await tx`
        UPDATE mail.message_placements
        SET deleted_at = now(), updated_at = now()
        WHERE remote_message_ref_id = ${params.source.remote_message_ref_id}::uuid
      `;
    }
    return true;
  });
};

const storeMutationBaseline = async (command: DbCommandExecution, uids: number[]): Promise<void> => {
  await sql`
    UPDATE mail.commands
    SET transport_metadata = transport_metadata || ${{ destinationBaselineUids: uids }}::jsonb
    WHERE id = ${command.id}::uuid AND attempt = ${command.attempt} AND state = 'executing'
  `;
};

const baselineUids = (command: DbCommandExecution): number[] => {
  const metadata = parseJsonRecord(command.transport_metadata);
  const values = metadata.destinationBaselineUids;
  return Array.isArray(values) ? values.filter((value): value is number => Number.isInteger(value) && value > 0) : [];
};

const isAmbiguousTransportError = (error: unknown): boolean => {
  const code = normalizeCode(error, "");
  return [
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNABORTED",
    "EPIPE",
    "ESOCKET",
    "ECONNECTION",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "IMAP_CONNECTION_CLOSED",
  ].includes(code);
};

const PARTIAL_MUTATION_CODES = new Set([
  "DELETE_RECONCILIATION_FAILED",
  "FLAG_RECONCILIATION_FAILED",
  "MOVE_RECONCILIATION_FAILED",
  "MOVE_SOURCE_DELETE_MARK_FAILED",
  "REMOTE_DELETE_FAILED",
  "REMOTE_MOVE_FAILED",
]);

const AMBIGUOUS_COMMAND_CODES = new Set([
  "AMBIGUOUS_LOCAL_PERSISTENCE",
  "COMMAND_JOB_LEASE_LOST",
  "REMOTE_CREATE_SUBSCRIBE_PARTIAL",
  "REMOTE_FLAGS_UNCONFIRMED",
  "REMOTE_STATE_PARTIAL",
  "REMOTE_STATE_UNCONFIRMED",
  "REMOTE_SUBSCRIPTION_UNCONFIRMED",
  "STATE_RECONCILIATION_FAILED",
  "STALE_COMMAND_FENCE",
]);

export const mutationFailureState = (error: unknown): CommandState => {
  const code = normalizeCode(error, "");
  if (PARTIAL_MUTATION_CODES.has(code)) return "needs_attention";
  if (AMBIGUOUS_COMMAND_CODES.has(code)) return "ambiguous";
  return isAmbiguousTransportError(error) ? "ambiguous" : "failed";
};

const persistMutationOutcome = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (cause) {
    throw Object.assign(new Error("Provider mutation completed but its local outcome could not be persisted"), {
      code: "AMBIGUOUS_LOCAL_PERSISTENCE",
      cause,
    });
  }
};

type LeaseAssertion = () => Promise<void>;
const noLeaseAssertion: LeaseAssertion = async () => undefined;

const beginProviderEffect = async (command: DbCommandExecution): Promise<void> =>
  sql.begin(async (tx) => {
    const [current] = await tx<{ id: string }[]>`
      SELECT id
      FROM mail.commands
      WHERE id = ${command.id}::uuid
        AND state = 'executing'
        AND attempt = ${command.attempt}
      FOR UPDATE
    `;
    if (!current) {
      throw Object.assign(new Error("Mail command lease was lost before the provider effect"), { code: "COMMAND_JOB_LEASE_LOST" });
    }
    if (command.actor_kind === "workflow") {
      const [target] = await tx<{ id: string }[]>`
        SELECT target.id
        FROM mail.workflow_step_runs step
        JOIN mail.workflow_run_targets target ON target.id = step.target_id
        WHERE step.command_id = ${command.id}::uuid
          AND step.execution_generation = target.execution_generation
          AND target.state IN ('running', 'waiting')
          AND target.cancel_requested_at IS NULL
        FOR UPDATE OF target
      `;
      if (!target) {
        throw Object.assign(new Error("Workflow target was canceled before the provider effect"), { code: "WORKFLOW_CANCELED" });
      }
    }
    if (!(await commandStillAuthorized(command, "write", tx))) {
      throw Object.assign(new Error("Mailbox write access was revoked before the provider effect"), { code: "ACCESS_REVOKED" });
    }
    const updated = await tx`
      UPDATE mail.commands
      SET
        provider_effect_started_at = COALESCE(provider_effect_started_at, now()),
        provider_effect_attempt = ${command.attempt}
      WHERE id = ${command.id}::uuid
        AND state = 'executing'
        AND attempt = ${command.attempt}
      RETURNING id
    `;
    if (updated.length === 0) {
      throw Object.assign(new Error("Mail command lease was lost before the provider effect"), { code: "COMMAND_JOB_LEASE_LOST" });
    }
  });

const recordCommandTransportMetadata = async (command: DbCommandExecution, metadata: JsonRecord): Promise<void> => {
  await sql`
    UPDATE mail.commands
    SET transport_metadata = transport_metadata || ${metadata}::jsonb
    WHERE id = ${command.id}::uuid AND attempt = ${command.attempt} AND state = 'executing'
  `;
};

type MutationRuntime = Awaited<ReturnType<typeof loadPinnedRuntime>>;
type MutationTarget = z.infer<typeof sourceTargetSchema>;

const flagsPayloadSchema = z.object({ flags: z.array(z.string().min(1).max(100)).max(100) });
const messageStatePayloadSchema = z.object({
  addFlags: z.array(z.enum(["seen", "answered", "flagged", "draft"])).max(4),
  removeFlags: z.array(z.enum(["seen", "answered", "flagged", "draft"])).max(4),
  addKeywords: z.array(z.string().min(1).max(100)).max(100),
  removeKeywords: z.array(z.string().min(1).max(100)).max(100),
});

const IMAP_SYSTEM_FLAGS = {
  seen: "\\Seen",
  answered: "\\Answered",
  flagged: "\\Flagged",
  draft: "\\Draft",
} as const;

const remoteStateChange = (payload: z.infer<typeof messageStatePayloadSchema>) => ({
  addFlags: payload.addFlags.map((flag) => IMAP_SYSTEM_FLAGS[flag]),
  removeFlags: payload.removeFlags.map((flag) => IMAP_SYSTEM_FLAGS[flag]),
  addKeywords: payload.addKeywords,
  removeKeywords: payload.removeKeywords,
});

const stateChangeMatches = (
  state: { exists: boolean; flags: string[]; keywords: string[] },
  change: ReturnType<typeof remoteStateChange>,
): boolean => {
  if (!state.exists) return false;
  const flags = new Set(state.flags.map((value) => value.toLowerCase()));
  const keywords = new Set(state.keywords.map((value) => value.toLowerCase()));
  return (
    change.addFlags.every((value) => flags.has(value.toLowerCase())) &&
    change.removeFlags.every((value) => !flags.has(value.toLowerCase())) &&
    change.addKeywords.every((value) => keywords.has(value.toLowerCase())) &&
    change.removeKeywords.every((value) => !keywords.has(value.toLowerCase()))
  );
};

const assertRemoteMessageIdentity = async (
  runtime: MutationRuntime,
  source: DbRemoteMessage,
  target: RemoteMutationTarget,
): Promise<RemoteMessageState> => {
  const current = await imapSmtpConnector.getMessageState(runtime, target);
  if (!current.exists) throw Object.assign(new Error("Remote message no longer exists"), { code: "REMOTE_MESSAGE_MISSING" });
  if (source.message_id && current.messageId?.trim().toLowerCase() !== source.message_id.trim().toLowerCase()) {
    throw Object.assign(new Error("Remote UID no longer identifies the expected message"), { code: "REMOTE_IDENTITY_MISMATCH" });
  }
  return current;
};

const normalizedStandardFlags = (flags: readonly string[]): string[] => {
  const standard: Record<string, string> = {
    "\\answered": "answered",
    answered: "answered",
    "\\draft": "draft",
    draft: "draft",
    "\\flagged": "flagged",
    flagged: "flagged",
    "\\seen": "seen",
    seen: "seen",
  };
  return [...new Set(flags.map((flag) => standard[flag.toLowerCase()]).filter((flag): flag is string => Boolean(flag)))].sort();
};

const normalizedKeywords = (keywords: readonly string[]): string[] => [...new Set(keywords.map((keyword) => keyword.toLowerCase()))].sort();

const assertRemoteMessagePrecondition = (current: RemoteMessageState, expected?: RemoteMessagePrecondition): void => {
  if (!expected) return;
  const modseqChanged = expected.modseq != null && current.modseq !== expected.modseq;
  const flagsChanged =
    expected.flags !== undefined &&
    JSON.stringify(normalizedStandardFlags(current.flags)) !== JSON.stringify(normalizedStandardFlags(expected.flags));
  const keywordsChanged =
    expected.keywords !== undefined &&
    JSON.stringify(normalizedKeywords(current.keywords)) !== JSON.stringify(normalizedKeywords(expected.keywords));
  if (modseqChanged || flagsChanged || keywordsChanged) {
    throw Object.assign(new Error("Remote message state changed after workflow preview"), { code: "REMOTE_STATE_CHANGED" });
  }
};

const executeSetFlagsMutation = async (params: {
  command: DbCommandExecution;
  runtime: MutationRuntime;
  source: DbRemoteMessage;
  target: RemoteMutationTarget;
  assertLeaseActive: LeaseAssertion;
  assertAuthorized: LeaseAssertion;
  beginEffect: LeaseAssertion;
}): Promise<void> => {
  requireRights(params.source.effective_rights, ["write_flags"]);
  const payload = flagsPayloadSchema.parse(parseJsonRecord(params.command.payload));
  await params.assertAuthorized();
  await params.beginEffect();
  await imapSmtpConnector.setFlags(params.runtime, params.target, payload.flags);
  await params.assertLeaseActive();
  const verified = await imapSmtpConnector.getMessageState(params.runtime, params.target);
  const actual = [...verified.flags].sort();
  const expected = [...payload.flags].sort();
  if (!verified.exists || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw Object.assign(new Error("Provider did not confirm the requested flags"), { code: "FLAG_RECONCILIATION_FAILED" });
  }
  await persistMutationOutcome(async () => {
    if (!(await updateMutationProjection({ command: params.command, source: params.source, flags: expected }))) return;
    await commandState(params.command, "confirmed");
  });
};

const executeMessageStateMutation = async (params: {
  command: DbCommandExecution;
  runtime: MutationRuntime;
  source: DbRemoteMessage;
  target: RemoteMutationTarget;
  assertLeaseActive: LeaseAssertion;
  assertAuthorized: LeaseAssertion;
  beginEffect: LeaseAssertion;
}): Promise<void> => {
  requireRights(params.source.effective_rights, ["write_flags"]);
  const payload = messageStatePayloadSchema.parse(parseJsonRecord(params.command.payload));
  const change = remoteStateChange(payload);
  await params.assertAuthorized();
  await params.beginEffect();
  const state = await imapSmtpConnector.changeMessageState(params.runtime, params.target, change);
  await params.assertLeaseActive();
  if (!stateChangeMatches(state, change)) {
    throw Object.assign(new Error("Provider did not confirm the requested message state"), { code: "STATE_RECONCILIATION_FAILED" });
  }
  await persistMutationOutcome(async () => {
    if (!(await updateMutationProjection({ command: params.command, source: params.source, flags: state.flags, keywords: state.keywords })))
      return;
    await commandState(params.command, "confirmed");
  });
};

const executeDeleteMutation = async (params: {
  command: DbCommandExecution;
  runtime: MutationRuntime;
  source: DbRemoteMessage;
  target: RemoteMutationTarget;
  assertLeaseActive: LeaseAssertion;
  assertAuthorized: LeaseAssertion;
  beginEffect: LeaseAssertion;
}): Promise<void> => {
  requireRights(params.source.effective_rights, ["delete_messages"]);
  await params.assertAuthorized();
  await params.beginEffect();
  await imapSmtpConnector.delete(params.runtime, params.target);
  await params.assertLeaseActive();
  const verified = await imapSmtpConnector.getMessageState(params.runtime, params.target);
  if (verified.exists) {
    throw Object.assign(new Error("Provider did not confirm message deletion"), { code: "DELETE_RECONCILIATION_FAILED" });
  }
  await persistMutationOutcome(async () => {
    if (!(await updateMutationProjection({ command: params.command, source: params.source }))) return;
    await commandState(params.command, "confirmed");
  });
};

const resolveTransferDestination = async (params: {
  runtime: MutationRuntime;
  source: DbRemoteMessage;
  destination: DbDestinationFolder;
  baseline: number[];
  result: { destinationUid: number | null; destinationUidValidity: string | null };
}): Promise<{ destinationUid: number | null; destinationUidValidity: string | null }> => {
  if ((params.result.destinationUid && params.result.destinationUidValidity) || !params.source.message_id) return params.result;
  const matches = await imapSmtpConnector.findMessageById(params.runtime, params.destination.folder_path, params.source.message_id);
  const destinationUid = matches.find((uid) => !params.baseline.includes(uid)) ?? null;
  return {
    destinationUid,
    destinationUidValidity: destinationUid ? String(params.destination.uid_validity ?? "") || null : null,
  };
};

const verifyMoveSource = async (params: {
  runtime: MutationRuntime;
  target: RemoteMutationTarget;
  expungePending: boolean;
}): Promise<boolean> => {
  const sourceAfter = await imapSmtpConnector.getMessageState(params.runtime, params.target);
  if (params.expungePending) {
    if (sourceAfter.exists && !sourceAfter.flags.includes("\\Deleted")) {
      throw Object.assign(new Error("Provider did not retain the source deletion marker after move"), {
        code: "MOVE_RECONCILIATION_FAILED",
      });
    }
    return sourceAfter.exists;
  }
  if (sourceAfter.exists) {
    throw Object.assign(new Error("Provider did not confirm source removal after move"), { code: "MOVE_RECONCILIATION_FAILED" });
  }
  return false;
};

const executeTransferMutation = async (params: {
  command: DbCommandExecution;
  runtime: MutationRuntime;
  source: DbRemoteMessage;
  target: MutationTarget;
  remoteTarget: RemoteMutationTarget;
  assertLeaseActive: LeaseAssertion;
  assertAuthorized: LeaseAssertion;
  beginEffect: LeaseAssertion;
}): Promise<void> => {
  const { command, runtime, source, target } = params;
  if (command.kind !== "copy" && command.kind !== "move") {
    throw Object.assign(new Error("Unsupported actor command kind"), { code: "UNSUPPORTED_COMMAND" });
  }
  if (!target.destinationFolderId) throw Object.assign(new Error("Destination folder is missing"), { code: "INVALID_COMMAND_TARGET" });
  requireRights(source.effective_rights, command.kind === "move" ? ["read", "move"] : ["read"]);
  const destination = await loadDestinationFolder(command, target.destinationFolderId);
  requireRights(destination.effective_rights, ["insert"]);

  await params.assertAuthorized();
  const baseline = source.message_id ? await imapSmtpConnector.findMessageById(runtime, destination.folder_path, source.message_id) : [];
  await storeMutationBaseline(command, baseline);
  await params.assertAuthorized();
  await params.beginEffect();
  const result =
    command.kind === "copy"
      ? await imapSmtpConnector.copy(runtime, params.remoteTarget, destination.folder_path)
      : await imapSmtpConnector.move(runtime, params.remoteTarget, destination.folder_path);
  await params.assertLeaseActive();
  const { destinationUid, destinationUidValidity } = await resolveTransferDestination({
    runtime,
    source,
    destination,
    baseline,
    result,
  });
  const expungePending =
    command.kind === "move"
      ? await verifyMoveSource({ runtime, target: params.remoteTarget, expungePending: result.expungePending })
      : result.expungePending;
  await persistMutationOutcome(async () => {
    if (!(await updateMutationProjection({ command, source, destination, destinationUid, destinationUidValidity }))) return;
    if (expungePending) {
      await recordCommandTransportMetadata(command, {
        expungePending: true,
        expungePendingFolderId: source.folder_id,
        expungePendingUid: Number(source.uid),
      });
    }
    await commandState(command, "confirmed");
  });
};

const executeFreshMutation = async (command: DbCommandExecution, assertLeaseActive: LeaseAssertion): Promise<void> => {
  if (!(await commandStillAuthorized(command, "write"))) {
    await commandState(
      command,
      "failed",
      Object.assign(new Error("Mailbox write access was revoked before execution"), { code: "ACCESS_REVOKED" }),
    );
    return;
  }
  const runtime = await loadPinnedRuntime(await loadPinnedBinding(command));
  const target = sourceTargetSchema.parse(parseJsonRecord(command.target));
  const source = await loadRemoteMessage(command, target);
  const remote = remoteTarget(source);
  const assertAuthorized = async (): Promise<void> => {
    await assertLeaseActive();
    if (!(await commandStillAuthorized(command, "write"))) {
      throw Object.assign(new Error("Mailbox write access was revoked before provider execution"), { code: "ACCESS_REVOKED" });
    }
    const current = await assertRemoteMessageIdentity(runtime, source, remote);
    assertRemoteMessagePrecondition(current, target.expectedRemoteState);
    await assertLeaseActive();
    if (!(await commandStillAuthorized(command, "write"))) {
      throw Object.assign(new Error("Mailbox write access was revoked before provider execution"), { code: "ACCESS_REVOKED" });
    }
  };
  const params = {
    command,
    runtime,
    source,
    target: remote,
    assertLeaseActive,
    assertAuthorized,
    beginEffect: () => beginProviderEffect(command),
  };
  if (command.kind === "set_flags") return executeSetFlagsMutation(params);
  if (command.kind === "change_message_state") return executeMessageStateMutation(params);
  if (command.kind === "delete") return executeDeleteMutation(params);
  return executeTransferMutation({ ...params, target, remoteTarget: remote });
};

const loadReconciliationSource = async (command: DbCommandExecution, target: MutationTarget): Promise<DbRemoteMessage> => {
  try {
    return await loadRemoteMessage(command, target);
  } catch (error) {
    if (command.kind !== "delete" && command.kind !== "move") throw error;
    const [stale] = await sql<DbRemoteMessage[]>`
      SELECT
        rmr.id AS remote_message_ref_id,
        rmr.message_id AS message_content_id,
        mc.message_id,
        rmr.folder_id,
        bfr.remote_path AS folder_path,
        rmr.uid_validity,
        rmr.uid,
        bfr.effective_rights
      FROM mail.remote_message_refs rmr
      JOIN mail.message_contents mc ON mc.id = rmr.message_id
      JOIN mail.binding_folder_refs bfr
        ON bfr.folder_id = rmr.folder_id
       AND bfr.binding_id = ${command.selected_binding_id}::uuid
      WHERE rmr.id = ${target.remoteMessageRefId}::uuid
    `;
    if (stale) return stale;
    throw error;
  }
};

const reconcileSetFlagsMutation = async (params: {
  command: DbCommandExecution;
  runtime: MutationRuntime;
  source: DbRemoteMessage;
  target: RemoteMutationTarget;
}): Promise<void> => {
  const payload = flagsPayloadSchema.parse(parseJsonRecord(params.command.payload));
  const state = await imapSmtpConnector.getMessageState(params.runtime, params.target);
  const matches = state.exists && JSON.stringify([...state.flags].sort()) === JSON.stringify([...payload.flags].sort());
  if (matches) {
    if (!(await updateMutationProjection({ command: params.command, source: params.source, flags: payload.flags }))) return;
    await commandState(params.command, "reconciled");
    return;
  }
  await sql`
    UPDATE mail.commands
    SET state = 'queued', worker_heartbeat_at = NULL, updated_at = now()
    WHERE id = ${params.command.id}::uuid AND attempt = ${params.command.attempt} AND state = 'executing'
  `;
};

const reconcileMessageStateMutation = async (params: {
  command: DbCommandExecution;
  runtime: MutationRuntime;
  source: DbRemoteMessage;
  target: RemoteMutationTarget;
}): Promise<void> => {
  const change = remoteStateChange(messageStatePayloadSchema.parse(parseJsonRecord(params.command.payload)));
  const state = await imapSmtpConnector.getMessageState(params.runtime, params.target);
  if (stateChangeMatches(state, change)) {
    if (!(await updateMutationProjection({ command: params.command, source: params.source, flags: state.flags, keywords: state.keywords })))
      return;
    await commandState(params.command, "reconciled");
    return;
  }
  await sql`
    UPDATE mail.commands
    SET state = 'queued', worker_heartbeat_at = NULL, updated_at = now()
    WHERE id = ${params.command.id}::uuid AND attempt = ${params.command.attempt} AND state = 'executing'
  `;
};

const reconcileDeleteMutation = async (params: {
  command: DbCommandExecution;
  source: DbRemoteMessage;
  sourceExists: boolean;
}): Promise<void> => {
  if (!params.sourceExists) {
    if (!(await updateMutationProjection({ command: params.command, source: params.source }))) return;
    await commandState(params.command, "reconciled");
    return;
  }
  await commandState(
    params.command,
    "needs_attention",
    Object.assign(new Error("Deletion outcome is ambiguous"), { code: "AMBIGUOUS_DELETE" }),
  );
};

const reconcileTransferMutation = async (params: {
  command: DbCommandExecution;
  runtime: MutationRuntime;
  target: MutationTarget;
  source: DbRemoteMessage;
  sourceState: Awaited<ReturnType<typeof imapSmtpConnector.getMessageState>>;
}): Promise<boolean> => {
  const { command, runtime, target, source, sourceState } = params;
  if ((command.kind !== "copy" && command.kind !== "move") || !target.destinationFolderId || !source.message_id) return false;
  const destination = await loadDestinationFolder(command, target.destinationFolderId);
  const matches = await imapSmtpConnector.findMessageById(runtime, destination.folder_path, source.message_id);
  const newUid = matches.find((uid) => !baselineUids(command).includes(uid)) ?? null;
  const expungePending = command.kind === "move" && Boolean(newUid && sourceState.exists && sourceState.flags.includes("\\Deleted"));
  const successful = command.kind === "copy" ? Boolean(newUid) : Boolean(newUid && (!sourceState.exists || expungePending));
  if (!successful) return false;
  if (
    !(await updateMutationProjection({
      command,
      source,
      destination,
      destinationUid: newUid,
      destinationUidValidity: newUid ? String(destination.uid_validity ?? "") || null : null,
    }))
  ) {
    return true;
  }
  if (expungePending) {
    await recordCommandTransportMetadata(command, {
      expungePending: true,
      expungePendingFolderId: source.folder_id,
      expungePendingUid: Number(source.uid),
    });
  }
  await commandState(command, "reconciled");
  return true;
};

const reconcileMutation = async (command: DbCommandExecution): Promise<void> => {
  if (!(await commandStillAuthorized(command, "write"))) {
    await commandState(
      command,
      "needs_attention",
      Object.assign(new Error("Access was revoked before ambiguous command reconciliation"), { code: "ACCESS_REVOKED" }),
    );
    return;
  }
  const runtime = await loadPinnedRuntime(await loadPinnedBinding(command));
  const target = sourceTargetSchema.parse(parseJsonRecord(command.target));
  const source = await loadReconciliationSource(command, target);
  const remote = remoteTarget(source);
  if (command.kind === "set_flags") {
    await reconcileSetFlagsMutation({ command, runtime, source, target: remote });
    return;
  }
  if (command.kind === "change_message_state") {
    await reconcileMessageStateMutation({ command, runtime, source, target: remote });
    return;
  }
  const sourceState = await imapSmtpConnector.getMessageState(runtime, remote);
  if (command.kind === "delete") return reconcileDeleteMutation({ command, source, sourceExists: sourceState.exists });
  if (await reconcileTransferMutation({ command, runtime, target, source, sourceState })) return;
  await commandState(
    command,
    "needs_attention",
    Object.assign(new Error("Remote mutation outcome could not be proven"), { code: "AMBIGUOUS_MUTATION" }),
  );
};

const FOLDER_COMMAND_KINDS = ["create_folder", "rename_folder", "delete_folder", "set_folder_subscription"] as const;
type FolderCommandKind = (typeof FOLDER_COMMAND_KINDS)[number];

const isFolderCommandKind = (kind: string): kind is FolderCommandKind => FOLDER_COMMAND_KINDS.includes(kind as FolderCommandKind);

type DbFolderCommandTarget = {
  folder_id: string;
  parent_id: string | null;
  role: string;
  selectable: boolean;
  remote_path: string;
  delimiter: string | null;
  subscribed: boolean;
  effective_rights: string[];
  rights_source: "acl" | "select" | "probe" | "unknown";
};

const folderTargetSchema = z.object({
  folderId: z.string().uuid().optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
});
const createFolderPayloadSchema = z.object({ name: z.string().min(1).max(255), subscribe: z.boolean() });
const renameFolderPayloadSchema = z.object({ name: z.string().min(1).max(255) });
const subscriptionPayloadSchema = z.object({ subscribed: z.boolean() });

const loadFolderCommandTarget = async (command: DbCommandExecution, folderId: string): Promise<DbFolderCommandTarget> => {
  const [folder] = await sql<DbFolderCommandTarget[]>`
    SELECT
      folder.id AS folder_id,
      folder.parent_id,
      folder.role,
      folder.selectable,
      ref.remote_path,
      ref.delimiter,
      ref.subscribed,
      ref.effective_rights,
      ref.rights_source
    FROM mail.folders folder
    JOIN mail.remote_resources resource ON resource.id = folder.remote_resource_id
    JOIN mail.binding_folder_refs ref
      ON ref.folder_id = folder.id
     AND ref.binding_id = ${command.selected_binding_id}::uuid
     AND ref.missing_since IS NULL
    WHERE folder.id = ${folderId}::uuid
      AND resource.mailbox_id = ${command.mailbox_id}::uuid
      AND folder.discovery_state = 'active'
  `;
  if (!folder) throw Object.assign(new Error("Folder is unavailable on the pinned binding"), { code: "FOLDER_UNAVAILABLE" });
  return folder;
};

const assertFolderAclRight = (folder: DbFolderCommandTarget, right: "create_children" | "delete_folder"): void => {
  if (folder.rights_source !== "acl" || folder.effective_rights.includes(right)) return;
  throw Object.assign(new Error("Provider ACL does not allow this folder operation"), { code: "PROVIDER_RIGHTS_CHANGED" });
};

const leafPath = (parentPath: string, delimiter: string | null, name: string): string => {
  if (delimiter && name.includes(delimiter)) {
    throw Object.assign(new Error("Folder name contains the provider hierarchy delimiter"), { code: "INVALID_FOLDER_NAME" });
  }
  if (!parentPath) return name;
  if (!delimiter)
    throw Object.assign(new Error("Provider does not expose a folder hierarchy delimiter"), { code: "FOLDER_HIERARCHY_UNAVAILABLE" });
  return `${parentPath}${delimiter}${name}`;
};

const replacementPath = (folder: DbFolderCommandTarget, name: string): string => {
  if (!folder.delimiter) return name;
  if (name.includes(folder.delimiter)) {
    throw Object.assign(new Error("Folder name contains the provider hierarchy delimiter"), { code: "INVALID_FOLDER_NAME" });
  }
  const separator = folder.remote_path.lastIndexOf(folder.delimiter);
  return separator < 0 ? name : `${folder.remote_path.slice(0, separator)}${folder.delimiter}${name}`;
};

const rootPathFromBinding = (binding: DbPinnedBinding): string => {
  const locator = parseJsonRecord(binding.remote_locator);
  return typeof locator.rootPath === "string" ? locator.rootPath : "";
};

const defaultBindingDelimiter = async (bindingId: string): Promise<string | null> => {
  const [row] = await sql<{ delimiter: string | null }[]>`
    SELECT delimiter
    FROM mail.binding_folder_refs
    WHERE binding_id = ${bindingId}::uuid AND delimiter IS NOT NULL AND missing_since IS NULL
    ORDER BY char_length(remote_path), remote_path
    LIMIT 1
  `;
  return row?.delimiter ?? null;
};

const requeueCommand = async (command: DbCommandExecution, code: string, message: string): Promise<void> => {
  await sql`
    UPDATE mail.commands
    SET
      state = 'queued',
      worker_heartbeat_at = NULL,
      last_error_code = ${code},
      last_error_message = ${message.slice(0, 1_000)},
      updated_at = now()
    WHERE id = ${command.id}::uuid AND attempt = ${command.attempt} AND state = 'executing'
  `;
};

const recordCommandResult = async (command: DbCommandExecution, result: JsonRecord): Promise<void> => {
  await sql`
    UPDATE mail.commands
    SET result = ${result}::jsonb, updated_at = now()
    WHERE id = ${command.id}::uuid AND attempt = ${command.attempt} AND state = 'executing'
  `;
};

type PreparedFolderOperation = {
  binding: DbPinnedBinding;
  runtime: MutationRuntime;
  rootPath: string;
  path: string;
  newPath: string | null;
  subscribed: boolean | null;
  folder: DbFolderCommandTarget | null;
};

const prepareFolderOperation = async (command: DbCommandExecution): Promise<PreparedFolderOperation> => {
  const binding = await loadPinnedBinding(command);
  const runtime = await loadPinnedRuntime(binding);
  const target = folderTargetSchema.parse(parseJsonRecord(command.target));
  const rootPath = rootPathFromBinding(binding);
  if (command.kind === "create_folder") {
    const payload = createFolderPayloadSchema.parse(parseJsonRecord(command.payload));
    const parent = target.parentFolderId ? await loadFolderCommandTarget(command, target.parentFolderId) : null;
    if (parent) assertFolderAclRight(parent, "create_children");
    const delimiter = parent?.delimiter ?? (await defaultBindingDelimiter(command.selected_binding_id));
    const path = leafPath(parent?.remote_path ?? rootPath, delimiter, payload.name);
    return { binding, runtime, rootPath, path, newPath: null, subscribed: payload.subscribe, folder: parent };
  }
  if (!target.folderId) throw Object.assign(new Error("Folder command target is missing"), { code: "INVALID_COMMAND_TARGET" });
  const folder = await loadFolderCommandTarget(command, target.folderId);
  if (command.kind === "rename_folder") {
    if (folder.remote_path === rootPath)
      throw Object.assign(new Error("The selected remote root cannot be renamed"), { code: "PROTECTED_FOLDER" });
    assertFolderAclRight(folder, "delete_folder");
    if (folder.parent_id) {
      const parent = await loadFolderCommandTarget(command, folder.parent_id);
      assertFolderAclRight(parent, "create_children");
    }
    const payload = renameFolderPayloadSchema.parse(parseJsonRecord(command.payload));
    return {
      binding,
      runtime,
      rootPath,
      path: folder.remote_path,
      newPath: replacementPath(folder, payload.name),
      subscribed: null,
      folder,
    };
  }
  if (command.kind === "delete_folder") {
    if (folder.remote_path === rootPath || ["inbox", "all"].includes(folder.role)) {
      throw Object.assign(new Error("Protected provider folders cannot be deleted"), { code: "PROTECTED_FOLDER" });
    }
    assertFolderAclRight(folder, "delete_folder");
    return { binding, runtime, rootPath, path: folder.remote_path, newPath: null, subscribed: null, folder };
  }
  const payload = subscriptionPayloadSchema.parse(parseJsonRecord(command.payload));
  return { binding, runtime, rootPath, path: folder.remote_path, newPath: null, subscribed: payload.subscribed, folder };
};

const remoteFolderByPath = async (operation: PreparedFolderOperation) => {
  const folders = await imapSmtpConnector.discoverFolders(operation.runtime, operation.rootPath);
  return {
    current: folders.find((folder) => folder.path === operation.path) ?? null,
    replacement: operation.newPath ? (folders.find((folder) => folder.path === operation.newPath) ?? null) : null,
  };
};

const verifyEmptyFolderDelete = async (command: DbCommandExecution, operation: PreparedFolderOperation): Promise<void> => {
  if (!operation.folder?.selectable)
    throw Object.assign(new Error("Only selectable folders can be deleted"), { code: "FOLDER_NOT_SELECTABLE" });
  const [children] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM mail.folders child
    WHERE child.parent_id = ${operation.folder.folder_id}::uuid AND child.discovery_state = 'active'
  `;
  if ((children?.count ?? 0) > 0) throw Object.assign(new Error("Folder has child folders"), { code: "FOLDER_NOT_EMPTY" });
  const status = await imapSmtpConnector.getFolderStatus(operation.runtime, operation.path);
  if (status.messages > 0) throw Object.assign(new Error("Folder contains remote messages"), { code: "FOLDER_NOT_EMPTY" });
  await recordCommandTransportMetadata(command, { emptyFolderVerifiedAt: new Date().toISOString(), uidValidity: status.uidValidity });
};

const finishFolderOperation = async (
  command: DbCommandExecution,
  operation: PreparedFolderOperation,
  state: "confirmed" | "reconciled",
): Promise<void> => {
  await persistMutationOutcome(async () => {
    const discovery = await rediscoverProviderBinding({ bindingId: command.selected_binding_id });
    await recordCommandResult(command, {
      path: operation.path,
      newPath: operation.newPath,
      subscribed: operation.subscribed,
      discoveryGeneration: discovery.discoveryGeneration,
    });
    await commandState(command, state);
  });
};

const executeFreshFolderOperation = async (
  command: DbCommandExecution,
  operation: PreparedFolderOperation,
  assertLeaseActive: LeaseAssertion,
  assertAuthorized: LeaseAssertion,
): Promise<void> => {
  await assertAuthorized();
  const before = await remoteFolderByPath(operation);
  if (command.kind === "create_folder") {
    if (before.current) throw Object.assign(new Error("A remote folder with this name already exists"), { code: "FOLDER_ALREADY_EXISTS" });
    await assertAuthorized();
    await imapSmtpConnector.createFolder(operation.runtime, operation.path, operation.subscribed === true);
  } else if (command.kind === "rename_folder") {
    if (!before.current) throw Object.assign(new Error("Remote folder no longer exists"), { code: "FOLDER_UNAVAILABLE" });
    if (before.replacement)
      throw Object.assign(new Error("A remote folder with the new name already exists"), { code: "FOLDER_ALREADY_EXISTS" });
    await assertAuthorized();
    await imapSmtpConnector.renameFolder(operation.runtime, operation.path, operation.newPath!);
  } else if (command.kind === "delete_folder") {
    if (!before.current) throw Object.assign(new Error("Remote folder no longer exists"), { code: "FOLDER_UNAVAILABLE" });
    await assertAuthorized();
    await verifyEmptyFolderDelete(command, operation);
    await assertAuthorized();
    await imapSmtpConnector.deleteFolder(operation.runtime, operation.path);
  } else {
    if (!before.current) throw Object.assign(new Error("Remote folder no longer exists"), { code: "FOLDER_UNAVAILABLE" });
    await assertAuthorized();
    await imapSmtpConnector.setFolderSubscription(operation.runtime, operation.path, operation.subscribed === true);
  }
  await recordCommandTransportMetadata(command, {
    remoteApplied: true,
    path: operation.path,
    newPath: operation.newPath,
    subscribed: operation.subscribed,
  });
  await assertLeaseActive();
  await finishFolderOperation(command, operation, "confirmed");
};

const reconcileFolderOperation = async (
  command: DbCommandExecution,
  operation: PreparedFolderOperation,
  assertLeaseActive: LeaseAssertion,
  assertAuthorized: LeaseAssertion,
): Promise<void> => {
  await assertAuthorized();
  let remote = await remoteFolderByPath(operation);
  if (command.kind === "create_folder" && remote.current && operation.subscribed === true && !remote.current.subscribed) {
    await assertAuthorized();
    await imapSmtpConnector.setFolderSubscription(operation.runtime, operation.path, true);
    await assertLeaseActive();
    remote = await remoteFolderByPath(operation);
  }
  const applied =
    command.kind === "create_folder"
      ? Boolean(remote.current) && (operation.subscribed !== true || remote.current?.subscribed === true)
      : command.kind === "rename_folder"
        ? !remote.current && Boolean(remote.replacement)
        : command.kind === "delete_folder"
          ? !remote.current
          : remote.current?.subscribed === operation.subscribed;
  if (applied) return finishFolderOperation(command, operation, "reconciled");
  const safelyRetryable =
    (command.kind === "create_folder" && !remote.current) ||
    (command.kind === "rename_folder" && Boolean(remote.current) && !remote.replacement) ||
    (command.kind === "delete_folder" && Boolean(remote.current)) ||
    (command.kind === "set_folder_subscription" && Boolean(remote.current));
  if (safelyRetryable) {
    await requeueCommand(
      command,
      "FOLDER_OPERATION_NOT_APPLIED",
      "Provider state shows that the idempotent folder operation can be retried",
    );
    return;
  }
  await commandState(
    command,
    "needs_attention",
    Object.assign(new Error("Remote folder outcome could not be proven"), { code: "AMBIGUOUS_FOLDER_OPERATION" }),
  );
};

const runFolderOperation = async (
  claimed: { command: DbCommandExecution; previousState: string },
  assertJobLeaseActive: LeaseAssertion,
): Promise<void> => {
  const { command } = claimed;
  if (!(await commandStillAuthorized(command, "admin"))) {
    await commandState(
      command,
      claimed.previousState === "ambiguous" ? "needs_attention" : "failed",
      Object.assign(new Error("Mailbox administration access was revoked before folder execution"), { code: "ACCESS_REVOKED" }),
    );
    return;
  }
  const operation = await prepareFolderOperation(command);
  const lock = await providerOperationMutex.acquire(operation.binding.remote_resource_id, PROVIDER_OPERATION_LEASE_MS);
  if (!lock) {
    await requeueCommand(command, "REMOTE_RESOURCE_BUSY", "Remote mailbox is currently being synchronized or administered");
    return;
  }
  try {
    await withLeaseHeartbeat({
      intervalMs: JOB_HEARTBEAT_INTERVAL_MS,
      heartbeat: async () => {
        await assertJobLeaseActive();
        if (!(await providerOperationMutex.extend(lock, PROVIDER_OPERATION_LEASE_MS))) {
          throw Object.assign(new Error("Remote mailbox operation lease was lost"), { code: "COMMAND_JOB_LEASE_LOST" });
        }
      },
      work: async (assertHeartbeatActive) => {
        const assertLeaseActive = async (): Promise<void> => {
          await assertHeartbeatActive();
          await assertJobLeaseActive();
          if (!(await providerOperationMutex.extend(lock, PROVIDER_OPERATION_LEASE_MS))) {
            throw Object.assign(new Error("Remote mailbox operation lease was lost"), { code: "COMMAND_JOB_LEASE_LOST" });
          }
        };
        const assertAuthorized = async (): Promise<void> => {
          await assertLeaseActive();
          if (!(await commandStillAuthorized(command, "admin"))) {
            throw Object.assign(new Error("Mailbox administration access was revoked before provider execution"), {
              code: "ACCESS_REVOKED",
            });
          }
        };
        if (claimed.previousState === "ambiguous") {
          await reconcileFolderOperation(command, operation, assertLeaseActive, assertAuthorized);
        } else {
          await executeFreshFolderOperation(command, operation, assertLeaseActive, assertAuthorized);
        }
      },
    });
  } finally {
    await providerOperationMutex.release(lock).catch(() => false);
  }
};

const runMessageMutation = async (
  claimed: { command: DbCommandExecution; previousState: string },
  assertJobLeaseActive: LeaseAssertion,
): Promise<void> => {
  const binding = await loadPinnedBinding(claimed.command);
  const lock = await providerOperationMutex.acquire(binding.remote_resource_id, PROVIDER_OPERATION_LEASE_MS);
  if (!lock) {
    await requeueCommand(claimed.command, "REMOTE_RESOURCE_BUSY", "Remote mailbox is currently being synchronized or changed");
    return;
  }
  try {
    await withLeaseHeartbeat({
      intervalMs: JOB_HEARTBEAT_INTERVAL_MS,
      heartbeat: async () => {
        await assertJobLeaseActive();
        if (!(await providerOperationMutex.extend(lock, PROVIDER_OPERATION_LEASE_MS))) {
          throw Object.assign(new Error("Remote mailbox operation lease was lost"), { code: "COMMAND_JOB_LEASE_LOST" });
        }
      },
      work: async (assertMutexLeaseActive) => {
        const assertLeaseActive = async (): Promise<void> => {
          await assertJobLeaseActive();
          await assertMutexLeaseActive();
        };
        if (claimed.previousState === "ambiguous") await reconcileMutation(claimed.command);
        else await executeFreshMutation(claimed.command, assertLeaseActive);
      },
    });
  } finally {
    await providerOperationMutex.release(lock).catch(() => false);
  }
};

const runClaimedMutation = async (
  claimed: { command: DbCommandExecution; previousState: string },
  assertLeaseActive: LeaseAssertion,
): Promise<CommandState | null> => {
  try {
    if (claimed.previousState === "ambiguous" && claimed.command.attempt >= 5) {
      await commandState(
        claimed.command,
        "needs_attention",
        Object.assign(new Error("Remote mutation outcome could not be reconciled after repeated attempts"), {
          code: "AMBIGUOUS_RECONCILIATION_EXHAUSTED",
        }),
      );
    } else if (isFolderCommandKind(claimed.command.kind)) {
      await runFolderOperation(claimed, assertLeaseActive);
    } else {
      await runMessageMutation(claimed, assertLeaseActive);
    }
  } catch (error) {
    await commandState(claimed.command, mutationFailureState(error), error);
  }
  const [state] = await sql<{ state: CommandState }[]>`
    SELECT state FROM mail.commands WHERE id = ${claimed.command.id}::uuid
  `;
  return state?.state ?? null;
};

const executeMutationCommandWithHeartbeat = async (
  commandId: string,
  heartbeat?: (fence: { id: string; attempt: number }) => Promise<void>,
): Promise<CommandState | null> => {
  const claimed = await claimCommand(commandId, ["set_flags", "change_message_state", "move", "copy", "delete", ...FOLDER_COMMAND_KINDS]);
  if (!claimed) return null;
  const work = (assertLeaseActive: LeaseAssertion) => runClaimedMutation(claimed, assertLeaseActive);
  if (!heartbeat) return work(noLeaseAssertion);
  return withLeaseHeartbeat({
    intervalMs: JOB_HEARTBEAT_INTERVAL_MS,
    heartbeat: () => heartbeat(claimed.command),
    work,
  });
};

export const executeMutationCommand = async (commandId: string): Promise<CommandState | null> =>
  executeMutationCommandWithHeartbeat(commandId);

type DbOutboxExecution = {
  id: string;
  mailbox_id: string;
  draft_id: string;
  command_id: string;
  sender_identity_id: string;
  selected_binding_id: string;
  stable_message_id: string;
  state: string;
  scheduled_at: Date | string;
  undo_until: Date | string | null;
  draft_snapshot: JsonRecord | string;
  mime_blob_id: string | null;
  attempt: number;
  created_at: Date | string;
};

type DbOutboxExecutionRow = DbOutboxExecution & {
  command_mailbox_id: string;
  command_kind: DbCommandExecution["kind"];
  command_state: DbCommandExecution["state"];
  command_actor_kind: DbCommandExecution["actor_kind"];
  command_actor_id: string | null;
  command_initiator_actor_kind: DbCommandExecution["initiator_actor_kind"];
  command_initiator_actor_id: string | null;
  command_access_subject_kind: DbCommandExecution["access_subject_kind"];
  command_access_subject_id: string | null;
  command_credential_scopes: string[] | null;
  command_credential_id: string | null;
  command_credential_expires_at: Date | string | null;
  command_target: JsonRecord | string;
  command_payload: JsonRecord | string;
  command_transport_metadata: JsonRecord | string;
  command_selected_binding_id: string;
  command_selected_secret_revision: number;
  command_attempt: number;
};

type DbSenderBinding = {
  interactive_policy: "mailbox" | "actor";
  saves_sent_automatically: boolean;
  sent_folder_id: string | null;
  sent_path: string | null;
  sent_rights: string[] | null;
};

const loadOutbox = async (outboxId: string): Promise<{ outbox: DbOutboxExecution; command: DbCommandExecution } | null> => {
  const [row] = await sql<DbOutboxExecutionRow[]>`
    SELECT
      o.id,
      o.mailbox_id,
      o.draft_id,
      o.command_id,
      o.sender_identity_id,
      o.selected_binding_id,
      o.stable_message_id,
      o.state,
      o.scheduled_at,
      o.undo_until,
      o.draft_snapshot,
      o.mime_blob_id,
      o.attempt,
      o.created_at,
      c.mailbox_id AS command_mailbox_id,
      c.kind AS command_kind,
      c.state AS command_state,
      c.actor_kind AS command_actor_kind,
      c.actor_id AS command_actor_id,
      c.initiator_actor_kind AS command_initiator_actor_kind,
      c.initiator_actor_id AS command_initiator_actor_id,
      c.access_subject_kind AS command_access_subject_kind,
      c.access_subject_id AS command_access_subject_id,
      c.credential_scopes AS command_credential_scopes,
      c.credential_id AS command_credential_id,
      c.credential_expires_at AS command_credential_expires_at,
      c.target AS command_target,
      c.payload AS command_payload,
      c.transport_metadata AS command_transport_metadata,
      c.selected_binding_id AS command_selected_binding_id,
      c.selected_secret_revision AS command_selected_secret_revision,
      c.attempt AS command_attempt
    FROM mail.outbox_submissions o
    JOIN mail.commands c
      ON c.id = o.command_id
     AND c.mailbox_id = o.mailbox_id
     AND c.selected_binding_id = o.selected_binding_id
    WHERE o.id = ${outboxId}::uuid
  `;
  if (!row) return null;
  return {
    outbox: {
      id: row.id,
      mailbox_id: row.mailbox_id,
      draft_id: row.draft_id,
      command_id: row.command_id,
      sender_identity_id: row.sender_identity_id,
      selected_binding_id: row.selected_binding_id,
      stable_message_id: row.stable_message_id,
      state: row.state,
      scheduled_at: row.scheduled_at,
      undo_until: row.undo_until,
      draft_snapshot: row.draft_snapshot,
      mime_blob_id: row.mime_blob_id,
      attempt: row.attempt,
      created_at: row.created_at,
    },
    command: {
      id: row.command_id,
      mailbox_id: row.command_mailbox_id,
      kind: row.command_kind,
      state: row.command_state,
      actor_kind: row.command_actor_kind,
      actor_id: row.command_actor_id,
      initiator_actor_kind: row.command_initiator_actor_kind,
      initiator_actor_id: row.command_initiator_actor_id,
      access_subject_kind: row.command_access_subject_kind,
      access_subject_id: row.command_access_subject_id,
      credential_scopes: row.command_credential_scopes,
      credential_id: row.command_credential_id,
      credential_expires_at: row.command_credential_expires_at,
      target: row.command_target,
      payload: row.command_payload,
      transport_metadata: row.command_transport_metadata,
      selected_binding_id: row.command_selected_binding_id,
      selected_secret_revision: row.command_selected_secret_revision,
      attempt: Number(row.command_attempt),
    },
  };
};

const lockOutboxFence = async (db: SqlClient, outbox: DbOutboxExecution, command: DbCommandExecution): Promise<boolean> => {
  const [active] = await db<{ id: string }[]>`
    SELECT o.id
    FROM mail.outbox_submissions o
    JOIN mail.commands c ON c.id = o.command_id
    WHERE o.id = ${outbox.id}::uuid
      AND o.attempt = ${outbox.attempt}
      AND o.state = ${outbox.state}
      AND c.id = ${command.id}::uuid
      AND c.attempt = ${command.attempt}
      AND c.state = ${command.state}
    FOR UPDATE OF o, c
  `;
  return Boolean(active);
};

const staleWorkerFence = (): Error => Object.assign(new Error("Mail worker execution fence is stale"), { code: "STALE_COMMAND_FENCE" });

const heartbeatCommandFence = async (fence: { id: string; attempt: number }): Promise<void> => {
  await sql.begin(async (tx) => {
    const [current] = await tx<{ attempt: number; state: string }[]>`
      SELECT attempt, state
      FROM mail.commands
      WHERE id = ${fence.id}::uuid
      FOR UPDATE
    `;
    if (!current || current.attempt !== fence.attempt || current.state !== "executing") throw staleWorkerFence();
    await tx`
      UPDATE mail.commands
      SET worker_heartbeat_at = now(), updated_at = now()
      WHERE id = ${fence.id}::uuid
    `;
  });
};

const heartbeatOutboxFence = async (loaded: { outbox: DbOutboxExecution; command: DbCommandExecution }): Promise<void> => {
  await sql.begin(async (tx) => {
    const [current] = await tx<
      {
        outbox_attempt: number;
        outbox_state: string;
        command_attempt: number;
        command_state: string;
      }[]
    >`
      SELECT
        o.attempt AS outbox_attempt,
        o.state AS outbox_state,
        c.attempt AS command_attempt,
        c.state AS command_state
      FROM mail.outbox_submissions o
      JOIN mail.commands c ON c.id = o.command_id
      WHERE o.id = ${loaded.outbox.id}::uuid
        AND c.id = ${loaded.command.id}::uuid
      FOR UPDATE OF o, c
    `;
    if (!current || current.outbox_attempt !== loaded.outbox.attempt || current.command_attempt !== loaded.command.attempt) {
      throw staleWorkerFence();
    }
    if (current.outbox_state !== loaded.outbox.state || current.command_state !== loaded.command.state) throw staleWorkerFence();
    if (current.command_state === "executing") {
      await tx`
        UPDATE mail.commands
        SET worker_heartbeat_at = now(), updated_at = now()
        WHERE id = ${loaded.command.id}::uuid
      `;
    }
    await tx`
      UPDATE mail.outbox_submissions
      SET updated_at = now()
      WHERE id = ${loaded.outbox.id}::uuid
    `;
  });
};

const claimOutbox = async (outboxId: string): Promise<{ previousState: string } | null> =>
  sql.begin(async (tx) => {
    const [current] = await tx<
      {
        state: string;
        command_id: string;
        command_state: string;
        due: boolean;
      }[]
    >`
      SELECT
        o.state,
        o.command_id,
        c.state AS command_state,
        GREATEST(o.scheduled_at, COALESCE(o.undo_until, o.scheduled_at)) <= now() AS due
      FROM mail.outbox_submissions o
      JOIN mail.commands c ON c.id = o.command_id
      WHERE o.id = ${outboxId}::uuid
      FOR UPDATE
    `;
    if (!current || !["scheduled", "undo_window", "unknown", "sent_sync_pending"].includes(current.state)) return null;
    if (
      ((current.state === "scheduled" || current.state === "undo_window") && current.command_state !== "queued") ||
      (current.state === "unknown" && current.command_state !== "ambiguous") ||
      (current.state === "sent_sync_pending" && current.command_state !== "confirmed")
    ) {
      return null;
    }
    if ((current.state === "scheduled" || current.state === "undo_window") && !current.due) return null;
    const previousState = current.state;
    if (current.state === "scheduled" || current.state === "undo_window") {
      await tx`
        UPDATE mail.outbox_submissions
        SET state = 'sending', attempt = attempt + 1, last_error_code = NULL, last_error_message = NULL, updated_at = now()
        WHERE id = ${outboxId}::uuid
      `;
      await tx`
        UPDATE mail.commands
        SET
          state = 'executing',
          attempt = attempt + 1,
          started_at = now(),
          worker_heartbeat_at = now(),
          finished_at = NULL,
          updated_at = now()
        WHERE id = ${current.command_id}::uuid AND state = 'queued'
      `;
      await tx`UPDATE mail.drafts SET state = 'sending' WHERE id = (SELECT draft_id FROM mail.outbox_submissions WHERE id = ${outboxId}::uuid)`;
    } else if (current.state === "unknown") {
      await tx`
        UPDATE mail.outbox_submissions
        SET attempt = attempt + 1, updated_at = now()
        WHERE id = ${outboxId}::uuid AND state = 'unknown'
      `;
      await tx`
        UPDATE mail.commands
        SET
          state = 'executing',
          attempt = attempt + 1,
          started_at = now(),
          worker_heartbeat_at = now(),
          finished_at = NULL,
          updated_at = now()
        WHERE id = ${current.command_id}::uuid AND state = 'ambiguous'
      `;
    } else if (current.state === "sent_sync_pending") {
      await tx`
        UPDATE mail.outbox_submissions
        SET state = 'accepted', attempt = attempt + 1, last_error_code = NULL, last_error_message = NULL, updated_at = now()
        WHERE id = ${outboxId}::uuid AND state = 'sent_sync_pending'
      `;
    }
    return { previousState };
  });

const loadSenderBinding = async (command: DbCommandExecution, senderIdentityId: string): Promise<DbSenderBinding> => {
  const [sender] = await sql<DbSenderBinding[]>`
    SELECT
      si.interactive_policy,
      sib.saves_sent_automatically,
      si.sent_folder_id,
      sent_ref.remote_path AS sent_path,
      sent_ref.effective_rights AS sent_rights
    FROM mail.sender_identities si
    JOIN mail.sender_identity_bindings sib
      ON sib.sender_identity_id = si.id
     AND sib.binding_id = ${command.selected_binding_id}::uuid
     AND sib.verified_secret_revision = ${command.selected_secret_revision}
     AND sib.revoked_at IS NULL
    LEFT JOIN mail.binding_folder_refs sent_ref
      ON sent_ref.binding_id = sib.binding_id
     AND sent_ref.folder_id = si.sent_folder_id
    WHERE si.id = ${senderIdentityId}::uuid
      AND si.mailbox_id = ${command.mailbox_id}::uuid
      AND si.status = 'verified'
  `;
  if (!sender)
    throw Object.assign(new Error("Sender identity is no longer verified on the pinned binding"), { code: "SENDER_IDENTITY_UNAVAILABLE" });
  if (!sender.saves_sent_automatically) {
    if (!sender.sent_folder_id || !sender.sent_path || !sender.sent_rights?.includes("insert")) {
      throw Object.assign(new Error("Sent folder append rights are no longer available"), { code: "SENT_FOLDER_UNAVAILABLE" });
    }
  }
  return sender;
};

const ensureMimeBlob = async (
  outbox: DbOutboxExecution,
): Promise<{ blobId: string; byteLength: number; snapshot: z.infer<typeof outboundDraftSnapshotSchema> }> => {
  const snapshot = outboundDraftSnapshotSchema.parse(parseJsonRecord(outbox.draft_snapshot));
  if (outbox.mime_blob_id) {
    const blob = await getStoredBlob(outbox.mime_blob_id);
    return { blobId: blob.id, byteLength: blob.byteLength, snapshot };
  }
  const source = buildMimeStream({
    snapshot,
    messageId: outbox.stable_message_id,
    date: new Date(outbox.created_at),
    openAttachment: createBlobReadable,
  });
  const blob = await storeReadableBlob(source);
  const [updated] = await sql<{ mime_blob_id: string }[]>`
    UPDATE mail.outbox_submissions
    SET mime_blob_id = COALESCE(mime_blob_id, ${blob.id}::uuid), updated_at = now()
    WHERE id = ${outbox.id}::uuid
      AND attempt = ${outbox.attempt}
      AND state = ${outbox.state}
    RETURNING mime_blob_id
  `;
  if (!updated) throw Object.assign(new Error("Outbox execution fence is stale"), { code: "STALE_COMMAND_FENCE" });
  const selected = updated.mime_blob_id === blob.id ? blob : await getStoredBlob(updated.mime_blob_id);
  return { blobId: selected.id, byteLength: selected.byteLength, snapshot };
};

const finishOutbox = async (params: {
  outbox: DbOutboxExecution;
  command: DbCommandExecution;
  outboxState: string;
  commandState: CommandState;
  draftState: "draft" | "sent";
  providerResponse?: JsonRecord;
  error?: unknown;
}): Promise<boolean> => {
  const code = params.error ? normalizeCode(params.error, "MAIL_SEND_FAILED") : null;
  const message = params.error ? errorMessage(params.error, "Mail send failed") : null;
  return sql.begin(async (tx) => {
    if (!(await lockOutboxFence(tx, params.outbox, params.command))) return false;
    await tx`
      UPDATE mail.outbox_submissions
      SET
        state = ${params.outboxState},
        accepted_at = CASE WHEN ${params.outboxState} IN ('accepted', 'sent_sync_pending', 'sent', 'reconciled_accepted') THEN COALESCE(accepted_at, now()) ELSE accepted_at END,
        provider_response = provider_response || ${params.providerResponse ?? {}}::jsonb,
        last_error_code = ${code},
        last_error_message = ${message},
        updated_at = now()
      WHERE id = ${params.outbox.id}::uuid
    `;
    await tx`
      UPDATE mail.commands
      SET
        state = ${params.commandState},
        finished_at = CASE WHEN ${params.commandState} IN ('confirmed', 'failed', 'cancelled', 'reconciled', 'needs_attention') THEN now() ELSE NULL END,
        worker_heartbeat_at = NULL,
        last_error_code = ${code},
        last_error_message = ${message},
        updated_at = now()
      WHERE id = ${params.outbox.command_id}::uuid
    `;
    await tx`UPDATE mail.drafts SET state = ${params.draftState} WHERE id = ${params.outbox.draft_id}::uuid`;
    await tx`
      INSERT INTO mail.activity_events (
        mailbox_id, command_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
      )
      SELECT
        c.mailbox_id,
        c.id,
        c.actor_kind,
        c.actor_id,
        'command.send',
        ${params.commandState === "confirmed" || params.commandState === "reconciled" ? "confirmed" : "failed"},
        'outbox_submission',
        ${params.outbox.id}::uuid,
        ${{ outboxState: params.outboxState, commandState: params.commandState, code }}::jsonb
      FROM mail.commands c
      WHERE c.id = ${params.outbox.command_id}::uuid
    `;
    return true;
  });
};

const isRetryablePreDispatchError = (error: unknown): boolean => {
  if (isAmbiguousTransportError(error)) return true;
  const code = normalizeCode(error, "");
  return code.startsWith("08") || ["40001", "40P01", "53300", "57P01", "57P03", "COMMAND_JOB_LEASE_LOST"].includes(code);
};

const scheduleOutboxRetry = async (params: {
  outbox: DbOutboxExecution;
  command: DbCommandExecution;
  error: unknown;
  code: string;
  fallbackMessage: string;
}): Promise<void> => {
  const delaySeconds = Math.min(15 * 60, 15 * 2 ** Math.max(0, params.outbox.attempt));
  await sql.begin(async (tx) => {
    if (!(await lockOutboxFence(tx, params.outbox, params.command))) return;
    await tx`
      UPDATE mail.outbox_submissions
      SET
        state = 'scheduled',
        scheduled_at = now() + (${delaySeconds}::text || ' seconds')::interval,
        undo_until = NULL,
        last_error_code = ${params.code},
        last_error_message = ${errorMessage(params.error, params.fallbackMessage)},
        updated_at = now()
      WHERE id = ${params.outbox.id}::uuid
    `;
    await tx`
      UPDATE mail.commands
      SET
        state = 'queued',
        worker_heartbeat_at = NULL,
        last_error_code = ${params.code},
        last_error_message = ${errorMessage(params.error, params.fallbackMessage)},
        updated_at = now()
      WHERE id = ${params.command.id}::uuid
    `;
    await tx`UPDATE mail.drafts SET state = 'scheduled' WHERE id = ${params.outbox.draft_id}::uuid`;
  });
};

const sentMatches = async (params: {
  runtime: Awaited<ReturnType<typeof loadProviderConnectionRuntime>>;
  sentPath: string | null;
  messageId: string;
}): Promise<number[]> => (params.sentPath ? imapSmtpConnector.findMessageById(params.runtime, params.sentPath, params.messageId) : []);

const appendSentCopy = async (params: {
  outbox: DbOutboxExecution;
  sender: DbSenderBinding;
  runtime: Awaited<ReturnType<typeof loadProviderConnectionRuntime>>;
  mimeBlobId: string;
  mimeByteLength: number;
  assertLeaseActive: LeaseAssertion;
}): Promise<boolean> => {
  if (params.sender.saves_sent_automatically) return true;
  if (!params.sender.sent_path) return false;
  const existing = await sentMatches({
    runtime: params.runtime,
    sentPath: params.sender.sent_path,
    messageId: params.outbox.stable_message_id,
  });
  if (existing.length > 0) return true;
  await params.assertLeaseActive();
  try {
    await imapSmtpConnector.appendSource(
      params.runtime,
      params.sender.sent_path,
      createBlobReadable(params.mimeBlobId),
      params.mimeByteLength,
      ["\\Seen"],
      new Date(params.outbox.created_at),
    );
    await params.assertLeaseActive();
  } catch (error) {
    const reconciled = await sentMatches({
      runtime: params.runtime,
      sentPath: params.sender.sent_path,
      messageId: params.outbox.stable_message_id,
    }).catch(() => []);
    if (reconciled.length > 0) return true;
    log.warn("Sent copy append remains pending", { outboxId: params.outbox.id, code: normalizeCode(error, "SENT_APPEND_FAILED") });
    return false;
  }
  const confirmed = await sentMatches({
    runtime: params.runtime,
    sentPath: params.sender.sent_path,
    messageId: params.outbox.stable_message_id,
  });
  return confirmed.length > 0;
};

const prepareFreshOutbox = async (
  outbox: DbOutboxExecution,
  command: DbCommandExecution,
  assertLeaseActive: LeaseAssertion,
): Promise<{
  sender: DbSenderBinding;
  runtime: Awaited<ReturnType<typeof loadProviderConnectionRuntime>>;
  mimeBlobId: string;
  mimeByteLength: number;
  snapshot: z.infer<typeof outboundDraftSnapshotSchema>;
  alreadySent: boolean;
}> => {
  const sender = await loadSenderBinding(command, outbox.sender_identity_id);
  const runtime = await loadPinnedRuntime(await loadPinnedBinding(command));
  const mime = await ensureMimeBlob(outbox);
  await assertLeaseActive();
  const beforeSend = await sentMatches({ runtime, sentPath: sender.sent_path, messageId: outbox.stable_message_id });
  return {
    sender,
    runtime,
    mimeBlobId: mime.blobId,
    mimeByteLength: mime.byteLength,
    snapshot: mime.snapshot,
    alreadySent: beforeSend.length > 0,
  };
};

type PreparedFreshOutbox = Awaited<ReturnType<typeof prepareFreshOutbox>>;

const prepareFreshOutboxOrFinish = async (
  outbox: DbOutboxExecution,
  command: DbCommandExecution,
  assertLeaseActive: LeaseAssertion,
): Promise<PreparedFreshOutbox | null> => {
  try {
    return await prepareFreshOutbox(outbox, command, assertLeaseActive);
  } catch (error) {
    if (outbox.attempt < 5 && isRetryablePreDispatchError(error)) {
      await scheduleOutboxRetry({
        outbox,
        command,
        error,
        code: "OUTBOX_PREDISPATCH_RETRY",
        fallbackMessage: "Mail provider was temporarily unavailable before dispatch",
      });
    } else {
      await finishOutbox({ outbox, command, outboxState: "failed", commandState: "failed", draftState: "draft", error });
    }
    return null;
  }
};

const persistSmtpResult = async (params: {
  outbox: DbOutboxExecution;
  command: DbCommandExecution;
  prepared: PreparedFreshOutbox;
  result: Awaited<ReturnType<typeof imapSmtpConnector.sendSource>>;
  assertLeaseActive: LeaseAssertion;
}): Promise<void> => {
  const { outbox, command, prepared, result } = params;
  const response = { accepted: result.accepted, rejected: result.rejected, response: result.response, messageId: result.messageId };
  if (result.accepted.length === 0) {
    await finishOutbox({
      outbox,
      command,
      outboxState: "failed",
      commandState: "failed",
      draftState: "draft",
      providerResponse: response,
      error: Object.assign(new Error("SMTP provider accepted no recipients"), { code: "SMTP_NO_RECIPIENTS_ACCEPTED" }),
    });
    return;
  }
  if (result.rejected.length > 0) {
    await finishOutbox({
      outbox,
      command,
      outboxState: "needs_attention",
      commandState: "needs_attention",
      draftState: "sent",
      providerResponse: response,
      error: Object.assign(new Error("SMTP provider accepted only some recipients"), { code: "SMTP_PARTIAL_ACCEPTANCE" }),
    });
    return;
  }
  const sentStored = await appendSentCopy({
    outbox,
    sender: prepared.sender,
    runtime: prepared.runtime,
    mimeBlobId: prepared.mimeBlobId,
    mimeByteLength: prepared.mimeByteLength,
    assertLeaseActive: params.assertLeaseActive,
  });
  await finishOutbox({
    outbox,
    command,
    outboxState: sentStored ? "sent" : "sent_sync_pending",
    commandState: "confirmed",
    draftState: "sent",
    providerResponse: response,
  });
};

const persistSmtpFailure = async (params: {
  outbox: DbOutboxExecution;
  command: DbCommandExecution;
  prepared: PreparedFreshOutbox;
  error: unknown;
}): Promise<void> => {
  const { outbox, command, prepared, error } = params;
  const responseCode = Number((error as { responseCode?: unknown } | null)?.responseCode);
  if (Number.isInteger(responseCode) && responseCode >= 400 && responseCode < 500 && outbox.attempt < 5) {
    await scheduleOutboxRetry({
      outbox,
      command,
      error,
      code: "SMTP_TRANSIENT_REJECTION",
      fallbackMessage: "SMTP temporarily rejected the message",
    });
    return;
  }
  if (Number.isInteger(responseCode) && responseCode >= 400) {
    await finishOutbox({ outbox, command, outboxState: "failed", commandState: "failed", draftState: "draft", error });
    return;
  }
  const reconciled = await sentMatches({
    runtime: prepared.runtime,
    sentPath: prepared.sender.sent_path,
    messageId: outbox.stable_message_id,
  }).catch(() => []);
  if (reconciled.length > 0) {
    await finishOutbox({ outbox, command, outboxState: "reconciled_accepted", commandState: "reconciled", draftState: "sent", error });
    return;
  }
  await finishOutbox({ outbox, command, outboxState: "unknown", commandState: "ambiguous", draftState: "sent", error });
};

const executeFreshOutbox = async (
  outbox: DbOutboxExecution,
  command: DbCommandExecution,
  assertLeaseActive: LeaseAssertion,
): Promise<void> => {
  if (!(await commandStillAuthorized(command, "write"))) {
    await finishOutbox({
      outbox,
      command,
      outboxState: "failed",
      commandState: "failed",
      draftState: "draft",
      error: Object.assign(new Error("Mailbox write access was revoked before sending"), { code: "ACCESS_REVOKED" }),
    });
    return;
  }
  const prepared = await prepareFreshOutboxOrFinish(outbox, command, assertLeaseActive);
  if (!prepared) return;
  if (prepared.alreadySent) {
    await finishOutbox({ outbox, command, outboxState: "reconciled_accepted", commandState: "reconciled", draftState: "sent" });
    return;
  }
  await assertLeaseActive();
  if (!(await commandStillAuthorized(command, "write"))) {
    await finishOutbox({
      outbox,
      command,
      outboxState: "failed",
      commandState: "failed",
      draftState: "draft",
      error: Object.assign(new Error("Mailbox write access was revoked before sending"), { code: "ACCESS_REVOKED" }),
    });
    return;
  }

  try {
    await assertLeaseActive();
    const result = await imapSmtpConnector.sendSource(prepared.runtime, {
      source: createBlobReadable(prepared.mimeBlobId),
      envelopeFrom: prepared.snapshot.envelopeFrom ?? prepared.snapshot.from.address,
      recipients: outboundRecipients(prepared.snapshot),
      messageId: outbox.stable_message_id,
    });
    await assertLeaseActive();
    await persistSmtpResult({ outbox, command, prepared, result, assertLeaseActive });
  } catch (error) {
    await persistSmtpFailure({ outbox, command, prepared, error });
  }
};

const reconcileUnknownOutbox = async (outbox: DbOutboxExecution, command: DbCommandExecution): Promise<void> => {
  const binding = await loadPinnedBinding(command);
  const sender = await loadSenderBinding(command, outbox.sender_identity_id);
  const runtime = await loadPinnedRuntime(binding);
  const matches = await sentMatches({ runtime, sentPath: sender.sent_path, messageId: outbox.stable_message_id });
  if (matches.length > 0) {
    await finishOutbox({ outbox, command, outboxState: "reconciled_accepted", commandState: "reconciled", draftState: "sent" });
  } else {
    await finishOutbox({
      outbox,
      command,
      outboxState: "needs_attention",
      commandState: "needs_attention",
      draftState: "sent",
      error: Object.assign(new Error("SMTP outcome could not be proven; the message was not resent"), { code: "AMBIGUOUS_SMTP_OUTCOME" }),
    });
  }
};

const reconcileSentCopy = async (
  outbox: DbOutboxExecution,
  command: DbCommandExecution,
  assertLeaseActive: LeaseAssertion,
): Promise<void> => {
  const binding = await loadPinnedBinding(command);
  const sender = await loadSenderBinding(command, outbox.sender_identity_id);
  const runtime = await loadPinnedRuntime(binding);
  const mime = await ensureMimeBlob(outbox);
  const stored = await appendSentCopy({
    outbox,
    sender,
    runtime,
    mimeBlobId: mime.blobId,
    mimeByteLength: mime.byteLength,
    assertLeaseActive,
  });
  if (stored) {
    await sql`
      UPDATE mail.outbox_submissions
      SET state = 'sent', last_error_code = NULL, last_error_message = NULL, updated_at = now()
      WHERE id = ${outbox.id}::uuid
        AND attempt = ${outbox.attempt}
        AND state = ${outbox.state}
    `;
  } else {
    await deferSentCopy(outbox);
  }
};

const deferSentCopy = async (outbox: DbOutboxExecution, error?: unknown): Promise<void> => {
  const exhausted = outbox.attempt >= 5;
  await sql`
    UPDATE mail.outbox_submissions
    SET
      state = ${exhausted ? "needs_attention" : "sent_sync_pending"},
      last_error_code = ${error ? normalizeCode(error, "SENT_APPEND_FAILED") : "SENT_APPEND_FAILED"},
      last_error_message = ${errorMessage(error, "Message was delivered but could not be stored in Sent")},
      updated_at = now()
    WHERE id = ${outbox.id}::uuid
      AND attempt = ${outbox.attempt}
      AND state = ${outbox.state}
  `;
};

const runClaimedOutbox = async (
  outboxId: string,
  claim: { previousState: string },
  loaded: { outbox: DbOutboxExecution; command: DbCommandExecution },
  assertLeaseActive: LeaseAssertion,
): Promise<string | null> => {
  try {
    if (claim.previousState === "unknown") await reconcileUnknownOutbox(loaded.outbox, loaded.command);
    else if (claim.previousState === "sent_sync_pending") await reconcileSentCopy(loaded.outbox, loaded.command, assertLeaseActive);
    else await executeFreshOutbox(loaded.outbox, loaded.command, assertLeaseActive);
  } catch (error) {
    if (claim.previousState === "sent_sync_pending") {
      log.warn("Sent copy reconciliation failed", { outboxId, code: normalizeCode(error, "SENT_RECONCILIATION_FAILED") });
      await deferSentCopy(loaded.outbox, error);
    } else {
      await finishOutbox({
        outbox: loaded.outbox,
        command: loaded.command,
        outboxState: claim.previousState === "unknown" ? "needs_attention" : "unknown",
        commandState: claim.previousState === "unknown" ? "needs_attention" : "ambiguous",
        draftState: "sent",
        error,
      });
    }
  }
  const [state] = await sql<{ state: string }[]>`SELECT state FROM mail.outbox_submissions WHERE id = ${outboxId}::uuid`;
  return state?.state ?? null;
};

const executeOutboxSubmissionWithHeartbeat = async (
  outboxId: string,
  heartbeat?: (fence: { outbox: DbOutboxExecution; command: DbCommandExecution }) => Promise<void>,
): Promise<string | null> => {
  const claim = await claimOutbox(outboxId);
  if (!claim) return null;
  const loaded = await loadOutbox(outboxId);
  if (!loaded) return null;
  const work = (assertLeaseActive: LeaseAssertion) => runClaimedOutbox(outboxId, claim, loaded, assertLeaseActive);
  if (!heartbeat) return work(noLeaseAssertion);
  return withLeaseHeartbeat({
    intervalMs: JOB_HEARTBEAT_INTERVAL_MS,
    heartbeat: () => heartbeat(loaded),
    work,
  });
};

export const executeOutboxSubmission = async (outboxId: string): Promise<string | null> => executeOutboxSubmissionWithHeartbeat(outboxId);

export const cancelSendCommand = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  commandId: string;
}): Promise<Result<void>> => {
  const permission = await requireMailboxPermission(params.context, params.mailboxId, "write");
  if (!permission.ok) return permission;
  try {
    return await sql.begin(async (tx) => {
      const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write", tx);
      if (!allowed.ok) return allowed;
      const [outbox] = await tx<{ id: string; command_id: string; draft_id: string; state: string }[]>`
        SELECT id, command_id, draft_id, state
        FROM mail.outbox_submissions
        WHERE command_id = ${params.commandId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!outbox) return fail(err.notFound("Scheduled send"));
      if (!["scheduled", "undo_window"].includes(outbox.state)) {
        return fail(err.conflict("Outbox submission is already being processed"));
      }
      await tx`
        UPDATE mail.outbox_submissions
        SET state = 'cancelled', last_error_code = NULL, last_error_message = NULL
        WHERE id = ${outbox.id}::uuid
      `;
      await tx`
        UPDATE mail.commands
        SET state = 'cancelled', finished_at = now(), last_error_code = NULL, last_error_message = NULL
        WHERE id = ${outbox.command_id}::uuid
      `;
      await tx`UPDATE mail.drafts SET state = 'draft' WHERE id = ${outbox.draft_id}::uuid`;
      return ok();
    });
  } catch {
    return fail(err.internal("Failed to cancel scheduled send"));
  }
};

const recoverStaleExecutions = async (): Promise<number> => {
  const result = await sql.begin(async (tx) => {
    const staleOutboxes = await tx<{ id: string; command_id: string }[]>`
      WITH stale AS MATERIALIZED (
        SELECT o.id AS outbox_id, c.id AS command_id
        FROM mail.outbox_submissions o
        JOIN mail.commands c ON c.id = o.command_id
        WHERE o.state = 'sending'
          AND c.state = 'executing'
          AND c.kind = 'send'
          AND COALESCE(c.worker_heartbeat_at, c.started_at) < now() - (${STALE_EXECUTION_MINUTES}::text || ' minutes')::interval
        ORDER BY c.id, o.id
        FOR UPDATE OF o, c SKIP LOCKED
        LIMIT 500
      ), recovered_commands AS (
        UPDATE mail.commands c
        SET
          state = 'ambiguous',
          worker_heartbeat_at = NULL,
          last_error_code = 'WORKER_LEASE_EXPIRED',
          last_error_message = 'Worker stopped before the SMTP outcome was persisted',
          updated_at = now()
        FROM stale
        WHERE c.id = stale.command_id
        RETURNING c.id
      )
      UPDATE mail.outbox_submissions o
      SET
        state = 'unknown',
        last_error_code = 'WORKER_LEASE_EXPIRED',
        last_error_message = 'Send worker stopped before the SMTP outcome was persisted',
        updated_at = now()
      FROM stale
      JOIN recovered_commands c ON c.id = stale.command_id
      WHERE o.id = stale.outbox_id
      RETURNING o.id, o.command_id
    `;
    const staleMutations = await tx<{ id: string }[]>`
      WITH stale AS MATERIALIZED (
        SELECT id
        FROM mail.commands
        WHERE state = 'executing'
          AND kind IN (
            'set_flags', 'change_message_state', 'move', 'copy', 'delete',
            'create_folder', 'rename_folder', 'delete_folder', 'set_folder_subscription'
          )
          AND COALESCE(worker_heartbeat_at, started_at) < now() - (${STALE_EXECUTION_MINUTES}::text || ' minutes')::interval
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT 500
      )
      UPDATE mail.commands c
      SET
        state = 'ambiguous',
        worker_heartbeat_at = NULL,
        last_error_code = 'WORKER_LEASE_EXPIRED',
        last_error_message = 'Worker stopped before the IMAP outcome was persisted',
        updated_at = now()
      FROM stale
      WHERE c.id = stale.id
      RETURNING c.id
    `;
    const staleSentCopies = await tx<{ id: string }[]>`
      WITH stale AS MATERIALIZED (
        SELECT id
        FROM mail.outbox_submissions
        WHERE state = 'accepted'
          AND updated_at < now() - (${STALE_EXECUTION_MINUTES}::text || ' minutes')::interval
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT 500
      )
      UPDATE mail.outbox_submissions o
      SET
        state = CASE WHEN attempt >= 5 THEN 'needs_attention' ELSE 'sent_sync_pending' END,
        last_error_code = 'SENT_COPY_LEASE_EXPIRED',
        last_error_message = 'Sent copy worker stopped before completion',
        updated_at = now()
      FROM stale
      WHERE o.id = stale.id
      RETURNING o.id
    `;
    return staleOutboxes.length + staleMutations.length + staleSentCopies.length;
  });
  return result;
};

const mutationJob = job<{ commandId: string }, { state: CommandState | null } | null>({
  id: "mail:execute-command",
  defaults: { leaseMs: MUTATION_JOB_LEASE_MS, keyTtlMs: 7 * 24 * 60 * 60_000 },
  process: ({ ctx }) =>
    commandTasks.run(async () => ({
      state: await executeMutationCommandWithHeartbeat(ctx.input.commandId, async (fence) => {
        try {
          await ctx.heartbeat({ leaseMs: MUTATION_JOB_LEASE_MS });
        } catch (cause) {
          throw Object.assign(new Error("Mail command job lease was lost"), { code: "COMMAND_JOB_LEASE_LOST", cause });
        }
        await heartbeatCommandFence(fence);
      }),
    })) ?? Promise.resolve(null),
  after: ({ ctx }) => {
    if (ctx.data?.state === "ambiguous" || ctx.data?.state === "queued") ctx.reschedule({ delayMs: 2_000 });
    else if (ctx.error && ctx.failureCount < 5) ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 5_000, maxMs: 5 * 60_000 }) });
  },
});

const outboxJob = job<{ outboxId: string }, { state: string | null; delayMs: number | null } | null>({
  id: "mail:execute-outbox",
  defaults: { leaseMs: OUTBOX_JOB_LEASE_MS, keyTtlMs: 7 * 24 * 60 * 60_000 },
  process: ({ ctx }) =>
    commandTasks.run(async () => {
      const state = await executeOutboxSubmissionWithHeartbeat(ctx.input.outboxId, async (loaded) => {
        try {
          await ctx.heartbeat({ leaseMs: OUTBOX_JOB_LEASE_MS });
        } catch (cause) {
          throw Object.assign(new Error("Mail outbox job lease was lost"), { code: "COMMAND_JOB_LEASE_LOST", cause });
        }
        await heartbeatOutboxFence(loaded);
      });
      const [pending] = await sql<{ state: string; delay_ms: string | number }[]>`
      SELECT
        state,
        GREATEST(
          0,
          EXTRACT(EPOCH FROM (GREATEST(scheduled_at, COALESCE(undo_until, scheduled_at)) - now())) * 1000
        )::bigint AS delay_ms
      FROM mail.outbox_submissions
      WHERE id = ${ctx.input.outboxId}::uuid
        AND state IN ('scheduled', 'undo_window')
      `;
      return {
        state: state ?? pending?.state ?? null,
        delayMs: pending ? Math.max(1_000, Math.min(Number(pending.delay_ms), 60_000)) : null,
      };
    }) ?? Promise.resolve(null),
  after: ({ ctx }) => {
    if (ctx.data?.delayMs != null) ctx.reschedule({ delayMs: ctx.data.delayMs });
    else if (ctx.data?.state === "unknown") ctx.reschedule({ delayMs: 2_000 });
    else if (ctx.data?.state === "sent_sync_pending") ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 10_000, maxMs: 10 * 60_000 }) });
    else if (ctx.error && ctx.failureCount < 5) ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 5_000, maxMs: 5 * 60_000 }) });
  },
});

const submitMutationJob = async (commandId: string): Promise<void> => {
  await (commandTasks.run(() => mutationJob.submit({ key: `command:${commandId}`, input: { commandId } })) ?? Promise.resolve());
};

const submitOutboxJob = async (outboxId: string, at?: number): Promise<void> => {
  await (commandTasks.run(() =>
    outboxJob.submit({
      key: `outbox:${outboxId}`,
      input: { outboxId },
      ...(at === undefined ? {} : { at }),
    }),
  ) ?? Promise.resolve());
};

export const enqueueMailCommand = async (commandId: string, kind: MailCommand["kind"]): Promise<void> => {
  if (kind === "send") {
    const [outbox] = await sql<{ id: string; due_at: Date | string }[]>`
      SELECT id, GREATEST(scheduled_at, COALESCE(undo_until, scheduled_at)) AS due_at
      FROM mail.outbox_submissions
      WHERE command_id = ${commandId}::uuid
    `;
    if (outbox) {
      await submitOutboxJob(outbox.id, new Date(outbox.due_at).getTime());
    }
    return;
  }
  if (["set_flags", "change_message_state", "move", "copy", "delete", ...FOLDER_COMMAND_KINDS].includes(kind)) {
    await submitMutationJob(commandId);
    return;
  }
  if (["sync_mailbox", "sync_folder", "discover_folders", "verify_binding", "rebuild_folder", "hydrate_missing"].includes(kind)) {
    await enqueueMaintenanceCommand(commandId);
  }
};

const submitDueCommands = async (): Promise<{ commands: number; maintenance: number; outbox: number; recovered: number }> => {
  const recovered = await recoverStaleExecutions();
  const maintenance = await submitDueMaintenanceCommands();
  const commands = await sql<{ id: string; kind: MailCommand["kind"] }[]>`
    SELECT id, kind
    FROM mail.commands
    WHERE state IN ('queued', 'ambiguous')
      AND kind IN (
        'set_flags', 'change_message_state', 'move', 'copy', 'delete',
        'create_folder', 'rename_folder', 'delete_folder', 'set_folder_subscription'
      )
    ORDER BY created_at, id
    LIMIT 500
  `;
  for (const command of commands) {
    await submitMutationJob(command.id);
  }
  const outboxes = await sql<{ id: string }[]>`
    SELECT id
    FROM mail.outbox_submissions
    WHERE (
      state IN ('scheduled', 'undo_window')
      AND GREATEST(scheduled_at, COALESCE(undo_until, scheduled_at)) <= now()
    ) OR state IN ('unknown', 'sent_sync_pending')
    ORDER BY scheduled_at, id
    LIMIT 500
  `;
  for (const outbox of outboxes) {
    await submitOutboxJob(outbox.id);
  }
  return {
    commands: commands.length,
    maintenance: maintenance.queued,
    outbox: outboxes.length,
    recovered: recovered + maintenance.recovered,
  };
};

const commandScheduler = scheduler({ id: "mail-commands" });

const stopCommandJobs = async (): Promise<void> => {
  await stopRuntimeJobs(commandTasks, [mutationJob, outboxJob]);
};

const commandRuntimeLifecycle = createRuntimeLifecycle({
  start: async () => {
    commandTasks.open();
    startMaintenanceRuntime();
    await commandScheduler.create({
      id: "mail:commands-due",
      cron: "* * * * *",
      meta: { appId: "mail", family: "mail:commands", label: "Mail command dispatch" },
      process: async () => submitDueCommands(),
    });
    commandScheduler.start();
    await submitDueCommands();
  },
  stop: async () => {
    commandTasks.close();
    await stopRuntimeResources([() => commandScheduler.stop(), stopMaintenanceRuntime, stopCommandJobs]);
  },
});

export const commandRuntime = {
  start: commandRuntimeLifecycle.start,
  stop: commandRuntimeLifecycle.stop,
};
