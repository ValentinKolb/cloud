import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { MailExecutionOperation, SenderAuthenticationPolicy } from "../contracts";
import { requireMailboxPermission } from "./access";
import type { MailRequestContext } from "./auth";

type SqlClient = typeof sql;

export type BindingOwner = { type: "mailbox"; id: string } | { type: "user"; id: string } | { type: "service_account"; id: string };

export type BindingCandidate = {
  bindingId: string;
  connectionId: string;
  secretRevision: number;
  owner: BindingOwner;
  folders: Record<string, { path: string; rights: string[] }>;
  identityVerified: boolean;
  savesSentAutomatically: boolean | null;
  lastErrorCode: string | null;
  lastUsedAt: string | null;
};

export type BindingSelectionInput = {
  connectionPolicy: "shared_connection" | "personal_provider_account";
  mailboxId: string;
  operation: MailExecutionOperation;
  actorOwner: BindingOwner | null;
  senderPolicy: SenderAuthenticationPolicy | null;
  senderSentFolderId: string | null;
  folderRequirements: Array<{ folderId: string; rights: string[] }>;
  candidates: BindingCandidate[];
};

const ownerEquals = (left: BindingOwner, right: BindingOwner): boolean => left.type === right.type && left.id === right.id;

const mailboxOwnsCandidate = (mailboxId: string, candidate: BindingCandidate): boolean =>
  candidate.owner.type === "mailbox" && candidate.owner.id === mailboxId;

const automationOwnerAllowed = (input: BindingSelectionInput, candidate: BindingCandidate): boolean => {
  if (!input.senderPolicy) {
    return input.connectionPolicy === "shared_connection" ? mailboxOwnsCandidate(input.mailboxId, candidate) : true;
  }
  if (input.senderPolicy.automation === "disabled") return false;
  return input.senderPolicy.automation === "pool" || mailboxOwnsCandidate(input.mailboxId, candidate);
};

const senderOwnerAllowed = (input: BindingSelectionInput, candidate: BindingCandidate): boolean => {
  if (!input.senderPolicy || !input.actorOwner) return false;
  return input.senderPolicy.interactive === "mailbox"
    ? mailboxOwnsCandidate(input.mailboxId, candidate)
    : ownerEquals(candidate.owner, input.actorOwner);
};

const ownerAllowed = (input: BindingSelectionInput, candidate: BindingCandidate): boolean => {
  if (input.operation === "backgroundSync") return true;
  if (input.operation === "automation") return automationOwnerAllowed(input, candidate);
  if (input.operation === "actorSend") return senderOwnerAllowed(input, candidate);
  if (input.connectionPolicy === "shared_connection") return mailboxOwnsCandidate(input.mailboxId, candidate);
  return Boolean(input.actorOwner && ownerEquals(candidate.owner, input.actorOwner));
};

export const selectBindingCandidate = (input: BindingSelectionInput): BindingCandidate | null => {
  const candidates = input.candidates
    .filter((candidate) => ownerAllowed(input, candidate))
    .filter((candidate) =>
      input.folderRequirements.every((requirement) => {
        const folder = candidate.folders[requirement.folderId];
        return Boolean(folder && requirement.rights.every((right) => folder.rights.includes(right)));
      }),
    )
    .filter((candidate) => (input.operation === "actorSend" || input.senderPolicy ? candidate.identityVerified : true))
    .filter((candidate) => {
      if (input.operation !== "actorSend") return true;
      if (candidate.savesSentAutomatically === true) return true;
      if (!input.senderSentFolderId) return false;
      return candidate.folders[input.senderSentFolderId]?.rights.includes("insert") ?? false;
    })
    .sort((left, right) => {
      const healthOrder = Number(Boolean(left.lastErrorCode)) - Number(Boolean(right.lastErrorCode));
      if (healthOrder !== 0) return healthOrder;
      const timeOrder = (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? "");
      return timeOrder || left.bindingId.localeCompare(right.bindingId);
    });
  return candidates[0] ?? null;
};

type DbMailboxExecution = {
  connection_policy: "shared_connection" | "personal_provider_account";
  remote_resource_id: string | null;
  remote_resource_status: string | null;
  scope_fingerprint: string | null;
};

type DbCandidate = {
  binding_id: string;
  connection_id: string;
  secret_revision: number;
  owner_user_id: string | null;
  owner_service_account_id: string | null;
  owner_mailbox_id: string | null;
  folder_id: string | null;
  folder_path: string | null;
  effective_rights: string[] | null;
  identity_verified: boolean;
  saves_sent_automatically: boolean | null;
  last_error_code: string | null;
  last_used_at: Date | string | null;
};

const ownerFromCandidate = (candidate: DbCandidate): BindingOwner => {
  if (candidate.owner_mailbox_id) return { type: "mailbox", id: candidate.owner_mailbox_id };
  if (candidate.owner_user_id) return { type: "user", id: candidate.owner_user_id };
  if (candidate.owner_service_account_id) return { type: "service_account", id: candidate.owner_service_account_id };
  throw new Error("Provider binding connection has no owner");
};

const actorOwnerFromContext = (context: MailRequestContext): BindingOwner => {
  if (context.accessSubject.type === "user") return { type: "user", id: context.accessSubject.userId };
  return { type: "service_account", id: context.accessSubject.serviceAccountId };
};

export type ResolvedMailExecution = {
  mailboxId: string;
  remoteResourceId: string | null;
  bindingId: string | null;
  connectionId: string | null;
  secretRevision: number | null;
  folders: Record<string, { path: string; rights: string[] }>;
  localOnly: boolean;
  sentDelivery: null | {
    savesSentAutomatically: boolean;
    folderId: string | null;
    path: string | null;
  };
  rightsSnapshot: {
    folders: Record<string, string[]>;
    resolvedAt: string;
  };
};

const requiredPermission = (operation: MailExecutionOperation): "read" | "write" | null => {
  if (operation === "actorRead") return "read";
  if (operation === "actorMutation" || operation === "actorSend") return "write";
  return null;
};

const authorizeExecution = async (params: {
  mailboxId: string;
  operation: MailExecutionOperation;
  context?: MailRequestContext | null;
  db: SqlClient;
}): Promise<Result<void>> => {
  const permission = requiredPermission(params.operation);
  if (!permission) return ok();
  if (!params.context) return fail(err.unauthenticated());
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, permission, params.db);
  return allowed.ok ? ok() : allowed;
};

const localExecution = (mailboxId: string, remoteResourceId: string | null): ResolvedMailExecution => ({
  mailboxId,
  remoteResourceId,
  bindingId: null,
  connectionId: null,
  secretRevision: null,
  folders: {},
  localOnly: true,
  sentDelivery: null,
  rightsSnapshot: { folders: {}, resolvedAt: new Date().toISOString() },
});

type SenderSelection = {
  policy: SenderAuthenticationPolicy | null;
  sentFolderId: string | null;
};

const loadSenderSelection = async (params: {
  mailboxId: string;
  operation: MailExecutionOperation;
  senderIdentityId?: string | null;
  db: SqlClient;
}): Promise<Result<SenderSelection>> => {
  if (!params.senderIdentityId) {
    return params.operation === "actorSend"
      ? fail(err.badInput("A verified sender identity is required"))
      : ok({ policy: null, sentFolderId: null });
  }
  const [identity] = await params.db<
    {
      interactive_policy: "mailbox" | "actor";
      automation_policy: "disabled" | "mailbox" | "pool";
      sent_folder_id: string | null;
    }[]
  >`
    SELECT interactive_policy, automation_policy, sent_folder_id
    FROM mail.sender_identities
    WHERE id = ${params.senderIdentityId}::uuid
      AND mailbox_id = ${params.mailboxId}::uuid
      AND status = 'verified'
  `;
  if (!identity) return fail(err.badInput("Sender identity is not verified"));
  return ok({
    policy: { interactive: identity.interactive_policy, automation: identity.automation_policy },
    sentFolderId: identity.sent_folder_id,
  });
};

const normalizeFolderRequirements = (params: {
  operation: MailExecutionOperation;
  folderId?: string | null;
  requiredRights?: string[];
  folderRequirements?: Array<{ folderId: string; rights: string[] }>;
  senderSentFolderId: string | null;
}): Result<{ requirements: Array<{ folderId: string; rights: string[] }>; folderIds: string[] }> => {
  const requirements = [
    ...(params.folderRequirements ?? []),
    ...(params.folderId ? [{ folderId: params.folderId, rights: params.requiredRights ?? [] }] : []),
  ].map((requirement) => ({ folderId: requirement.folderId, rights: [...new Set(requirement.rights)] }));
  if (new Set(requirements.map((requirement) => requirement.folderId)).size !== requirements.length) {
    return fail(err.badInput("Each folder may appear only once in an execution request"));
  }
  return ok({
    requirements,
    folderIds: [
      ...requirements.map((requirement) => requirement.folderId),
      ...(params.operation === "actorSend" && params.senderSentFolderId ? [params.senderSentFolderId] : []),
    ],
  });
};

const groupBindingCandidates = (rows: DbCandidate[]): BindingCandidate[] => {
  const groupedCandidates = new Map<string, BindingCandidate>();
  for (const candidate of rows) {
    let grouped = groupedCandidates.get(candidate.binding_id);
    if (!grouped) {
      grouped = {
        bindingId: candidate.binding_id,
        connectionId: candidate.connection_id,
        secretRevision: candidate.secret_revision,
        owner: ownerFromCandidate(candidate),
        folders: {},
        identityVerified: candidate.identity_verified,
        savesSentAutomatically: candidate.saves_sent_automatically,
        lastErrorCode: candidate.last_error_code,
        lastUsedAt: candidate.last_used_at
          ? (candidate.last_used_at instanceof Date ? candidate.last_used_at : new Date(candidate.last_used_at)).toISOString()
          : null,
      };
      groupedCandidates.set(candidate.binding_id, grouped);
    }
    if (candidate.folder_id && candidate.folder_path) {
      grouped.folders[candidate.folder_id] = {
        path: candidate.folder_path,
        rights: candidate.effective_rights ?? [],
      };
    }
  }
  return [...groupedCandidates.values()];
};

const resolvedExecution = (params: {
  mailboxId: string;
  remoteResourceId: string;
  operation: MailExecutionOperation;
  senderSentFolderId: string | null;
  selected: BindingCandidate;
}): ResolvedMailExecution => ({
  mailboxId: params.mailboxId,
  remoteResourceId: params.remoteResourceId,
  bindingId: params.selected.bindingId,
  connectionId: params.selected.connectionId,
  secretRevision: params.selected.secretRevision,
  folders: params.selected.folders,
  localOnly: false,
  sentDelivery:
    params.operation === "actorSend"
      ? {
          savesSentAutomatically: params.selected.savesSentAutomatically === true,
          folderId: params.selected.savesSentAutomatically === true ? null : params.senderSentFolderId,
          path:
            params.selected.savesSentAutomatically === true || !params.senderSentFolderId
              ? null
              : (params.selected.folders[params.senderSentFolderId]?.path ?? null),
        }
      : null,
  rightsSnapshot: {
    folders: Object.fromEntries(Object.entries(params.selected.folders).map(([folderId, folder]) => [folderId, [...folder.rights]])),
    resolvedAt: new Date().toISOString(),
  },
});

export const resolveMailExecution = async (params: {
  mailboxId: string;
  operation: MailExecutionOperation;
  context?: MailRequestContext | null;
  folderId?: string | null;
  requiredRights?: string[];
  folderRequirements?: Array<{ folderId: string; rights: string[] }>;
  senderIdentityId?: string | null;
  db?: SqlClient;
}): Promise<Result<ResolvedMailExecution>> => {
  const db = params.db ?? sql;
  const authorized = await authorizeExecution({ ...params, db });
  if (!authorized.ok) return authorized;

  const [mailbox] = await db<DbMailboxExecution[]>`
    SELECT
      m.connection_policy,
      rr.id AS remote_resource_id,
      rr.status AS remote_resource_status,
      rr.scope_fingerprint
    FROM mail.mailboxes m
    LEFT JOIN mail.remote_resources rr ON rr.mailbox_id = m.id
    WHERE m.id = ${params.mailboxId}::uuid AND m.deleted_at IS NULL
  `;
  if (!mailbox) return fail(err.notFound("Mailbox"));

  const localReadAllowed = params.operation === "actorRead" && mailbox.connection_policy === "shared_connection";
  if (!mailbox.remote_resource_id || !mailbox.scope_fingerprint) {
    return localReadAllowed ? ok(localExecution(params.mailboxId, null)) : fail(err.forbidden("An active provider binding is required"));
  }

  const sender = await loadSenderSelection({ ...params, db });
  if (!sender.ok) return sender;

  const folders = normalizeFolderRequirements({ ...params, senderSentFolderId: sender.data.sentFolderId });
  if (!folders.ok) return folders;
  const candidateRows = await db<DbCandidate[]>`
    SELECT
      pb.id AS binding_id,
      pb.connection_id,
      pc.secret_revision,
      pc.owner_user_id,
      pc.owner_service_account_id,
      pc.owner_mailbox_id,
      bfr.folder_id,
      bfr.remote_path AS folder_path,
      COALESCE(bfr.effective_rights, ARRAY[]::text[]) AS effective_rights,
      CASE
        WHEN ${params.senderIdentityId ?? null}::uuid IS NULL THEN false
        ELSE EXISTS (
          SELECT 1
          FROM mail.sender_identity_bindings sib
          WHERE sib.sender_identity_id = ${params.senderIdentityId ?? null}::uuid
            AND sib.binding_id = pb.id
            AND sib.verified_secret_revision = pc.secret_revision
            AND sib.revoked_at IS NULL
        )
      END AS identity_verified,
      CASE
        WHEN ${params.senderIdentityId ?? null}::uuid IS NULL THEN NULL
        ELSE (
          SELECT sib.saves_sent_automatically
          FROM mail.sender_identity_bindings sib
          WHERE sib.sender_identity_id = ${params.senderIdentityId ?? null}::uuid
            AND sib.binding_id = pb.id
            AND sib.verified_secret_revision = pc.secret_revision
            AND sib.revoked_at IS NULL
        )
      END AS saves_sent_automatically,
      pb.last_error_code,
      pb.last_used_at
    FROM mail.provider_bindings pb
    JOIN mail.provider_connections pc ON pc.id = pb.connection_id
    LEFT JOIN mail.binding_folder_refs bfr
     ON bfr.binding_id = pb.id
     AND bfr.folder_id IN (
       SELECT value::uuid FROM jsonb_array_elements_text(${folders.data.folderIds}::jsonb)
     )
    WHERE pb.remote_resource_id = ${mailbox.remote_resource_id}::uuid
      AND pb.state = 'active'
      AND pb.verified_scope_fingerprint = ${mailbox.scope_fingerprint}
      AND pb.verified_secret_revision = pc.secret_revision
      AND pc.status = 'active'
      AND pc.encrypted_secret IS NOT NULL
  `;
  const actorOwner = params.context ? actorOwnerFromContext(params.context) : null;
  const selected = selectBindingCandidate({
    connectionPolicy: mailbox.connection_policy,
    mailboxId: params.mailboxId,
    operation: params.operation,
    actorOwner,
    senderPolicy: sender.data.policy,
    senderSentFolderId: sender.data.sentFolderId,
    folderRequirements: folders.data.requirements,
    candidates: groupBindingCandidates(candidateRows),
  });

  if (!selected) {
    return localReadAllowed
      ? ok(localExecution(params.mailboxId, mailbox.remote_resource_id))
      : fail(err.forbidden("No eligible provider binding has the required current rights"));
  }

  return ok(
    resolvedExecution({
      mailboxId: params.mailboxId,
      remoteResourceId: mailbox.remote_resource_id,
      operation: params.operation,
      senderSentFolderId: sender.data.sentFolderId,
      selected,
    }),
  );
};
