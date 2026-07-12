import { audit } from "@valentinkolb/cloud/services";
import { err, fail, isServiceError, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import {
  type CreateSenderIdentityInput,
  createSenderIdentityInputSchema,
  type DefaultSenderSetupInput,
  defaultSenderSetupInputSchema,
  type SenderIdentity,
  type UpdateSenderIdentityInput,
  updateSenderIdentityInputSchema,
} from "../contracts";
import { requireMailboxPermission } from "./access";
import { auditActorFromRequest, type MailRequestContext } from "./auth";
import { imapSmtpConnector } from "./connectors";
import { getProviderConnection, loadProviderConnectionRuntimeSnapshot } from "./provider-connections";
import { resolveRoleFolder } from "./folders";

type DbIdentity = {
  id: string;
  mailbox_id: string;
  display_name: string;
  from_address: string;
  reply_to: string | null;
  envelope_sender: string | null;
  interactive_policy: "mailbox" | "actor";
  automation_policy: "disabled" | "mailbox" | "pool";
  sent_folder_id: string | null;
  drafts_folder_id: string | null;
  is_default: boolean;
  status: SenderIdentity["status"];
  created_at: Date | string;
  updated_at: Date | string;
};

const identityColumns = sql`
  si.id,
  si.mailbox_id,
  si.display_name,
  si.from_address,
  si.reply_to,
  si.envelope_sender,
  si.interactive_policy,
  si.automation_policy,
  si.sent_folder_id,
  si.drafts_folder_id,
  si.is_default,
  si.status,
  si.created_at,
  si.updated_at
`;

const mapIdentity = (row: DbIdentity): SenderIdentity => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  displayName: row.display_name,
  fromAddress: row.from_address,
  replyTo: row.reply_to,
  envelopeSender: row.envelope_sender,
  authenticationPolicy: { interactive: row.interactive_policy, automation: row.automation_policy },
  sentFolderId: row.sent_folder_id,
  draftsFolderId: row.drafts_folder_id,
  isDefault: row.is_default,
  status: row.status,
  createdAt: (row.created_at instanceof Date ? row.created_at : new Date(row.created_at)).toISOString(),
  updatedAt: (row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)).toISOString(),
});

const foldersBelongToMailbox = async (mailboxId: string, folderIds: Array<string | null | undefined>, db: typeof sql): Promise<boolean> => {
  const ids = folderIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return true;
  const [row] = await db<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM mail.folders f
    JOIN mail.remote_resources rr ON rr.id = f.remote_resource_id
    WHERE rr.mailbox_id = ${mailboxId}::uuid
      AND f.id IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids}::jsonb))
  `;
  return row?.count === new Set(ids).size;
};

const validateAuthenticationPolicy = (
  connectionPolicy: "shared_connection" | "personal_provider_account",
  authenticationPolicy: SenderIdentity["authenticationPolicy"],
): Result<void> => {
  if (connectionPolicy === "shared_connection" && authenticationPolicy.interactive !== "mailbox") {
    return fail(err.badInput("Shared connection mailboxes require mailbox-authenticated interactive sending"));
  }
  if (connectionPolicy === "personal_provider_account" && authenticationPolicy.interactive !== "actor") {
    return fail(err.badInput("Personal provider mailboxes require actor-authenticated interactive sending"));
  }
  if (connectionPolicy === "personal_provider_account" && authenticationPolicy.automation === "mailbox") {
    return fail(err.badInput("Personal provider mailboxes cannot use mailbox-authenticated automation"));
  }
  return ok();
};

export const createSenderIdentity = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: CreateSenderIdentityInput;
}): Promise<Result<SenderIdentity>> => {
  const parsed = createSenderIdentityInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid sender identity"));
  try {
    return await sql.begin(async (tx) => {
      const [mailbox] = await tx<{ connection_policy: "shared_connection" | "personal_provider_account" }[]>`
        SELECT connection_policy
        FROM mail.mailboxes
        WHERE id = ${params.mailboxId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (!mailbox) return fail(err.notFound("Mailbox"));
      const allowed = await requireMailboxPermission(params.context, params.mailboxId, "admin", tx);
      if (!allowed.ok) return allowed;
      const policy = validateAuthenticationPolicy(mailbox.connection_policy, parsed.data.authenticationPolicy);
      if (!policy.ok) return policy;
      if (!(await foldersBelongToMailbox(params.mailboxId, [parsed.data.sentFolderId, parsed.data.draftsFolderId], tx))) {
        return fail(err.badInput("Sender identity folder mapping does not belong to this mailbox"));
      }
      const [count] = await tx<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM mail.sender_identities WHERE mailbox_id = ${params.mailboxId}::uuid AND status <> 'disabled'
      `;
      const isDefault = parsed.data.isDefault ?? (count?.count ?? 0) === 0;
      if (isDefault) {
        await tx`UPDATE mail.sender_identities SET is_default = false WHERE mailbox_id = ${params.mailboxId}::uuid`;
      }
      const [row] = await tx<DbIdentity[]>`
        INSERT INTO mail.sender_identities AS si (
          mailbox_id,
          display_name,
          from_address,
          reply_to,
          envelope_sender,
          interactive_policy,
          automation_policy,
          sent_folder_id,
          drafts_folder_id,
          is_default,
          status
        )
        VALUES (
          ${params.mailboxId}::uuid,
          ${parsed.data.displayName},
          ${parsed.data.fromAddress.toLowerCase()},
          ${parsed.data.replyTo?.toLowerCase() ?? null},
          ${parsed.data.envelopeSender?.toLowerCase() ?? null},
          ${parsed.data.authenticationPolicy.interactive},
          ${parsed.data.authenticationPolicy.automation},
          ${parsed.data.sentFolderId ?? null}::uuid,
          ${parsed.data.draftsFolderId ?? null}::uuid,
          ${isDefault},
          'unverified'
        )
        RETURNING ${identityColumns}
      `;
      if (!row) throw new Error("Sender identity insert returned no row");
      await audit.record(
        {
          action: "mail.sender_identity.create",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "sender_identity", id: row.id, label: row.from_address },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, authenticationPolicy: parsed.data.authenticationPolicy },
        },
        tx,
      );
      return ok(mapIdentity(row));
    });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "23505") return fail(err.conflict("Sender identity"));
    return fail(err.internal("Failed to create sender identity"));
  }
};

export const listSenderIdentities = async (context: MailRequestContext, mailboxId: string): Promise<Result<SenderIdentity[]>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<DbIdentity[]>`
    SELECT ${identityColumns}
    FROM mail.sender_identities si
    WHERE si.mailbox_id = ${mailboxId}::uuid AND si.status <> 'disabled'
    ORDER BY si.is_default DESC, si.from_address, si.id
  `;
  return ok(rows.map(mapIdentity));
};

export const updateSenderIdentity = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  senderIdentityId: string;
  input: UpdateSenderIdentityInput;
}): Promise<Result<SenderIdentity>> => {
  const parsed = updateSenderIdentityInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid sender identity update"));
  try {
    return await sql.begin(async (tx) => {
      const permission = await requireMailboxPermission(params.context, params.mailboxId, "admin", tx);
      if (!permission.ok) return permission;
      const [current] = await tx<(DbIdentity & { connection_policy: "shared_connection" | "personal_provider_account" })[]>`
        SELECT ${identityColumns}, mailbox.connection_policy
        FROM mail.sender_identities si
        JOIN mail.mailboxes mailbox ON mailbox.id = si.mailbox_id
        WHERE si.id = ${params.senderIdentityId}::uuid
          AND si.mailbox_id = ${params.mailboxId}::uuid
          AND mailbox.deleted_at IS NULL
        FOR UPDATE OF si, mailbox
      `;
      if (!current) return fail(err.notFound("Sender identity"));
      const nextPolicy = parsed.data.authenticationPolicy ?? {
        interactive: current.interactive_policy,
        automation: current.automation_policy,
      };
      const policy = validateAuthenticationPolicy(current.connection_policy, nextPolicy);
      if (!policy.ok) return policy;
      const sentFolderId = parsed.data.sentFolderId === undefined ? current.sent_folder_id : parsed.data.sentFolderId;
      const draftsFolderId = parsed.data.draftsFolderId === undefined ? current.drafts_folder_id : parsed.data.draftsFolderId;
      if (!(await foldersBelongToMailbox(params.mailboxId, [sentFolderId, draftsFolderId], tx))) {
        return fail(err.badInput("Sender identity folder mapping does not belong to this mailbox"));
      }
      const fromAddress = parsed.data.fromAddress?.toLowerCase() ?? current.from_address;
      const replyTo = parsed.data.replyTo === undefined ? current.reply_to : parsed.data.replyTo?.toLowerCase() ?? null;
      const envelopeSender =
        parsed.data.envelopeSender === undefined ? current.envelope_sender : parsed.data.envelopeSender?.toLowerCase() ?? null;
      const providerRelevantChanged =
        fromAddress !== current.from_address ||
        replyTo !== current.reply_to ||
        envelopeSender !== current.envelope_sender ||
        nextPolicy.interactive !== current.interactive_policy ||
        nextPolicy.automation !== current.automation_policy ||
        sentFolderId !== current.sent_folder_id ||
        draftsFolderId !== current.drafts_folder_id;
      if (parsed.data.isDefault === true) {
        await tx`
          UPDATE mail.sender_identities
          SET is_default = false
          WHERE mailbox_id = ${params.mailboxId}::uuid AND id <> ${params.senderIdentityId}::uuid
        `;
      }
      if (providerRelevantChanged) {
        await tx`
          UPDATE mail.sender_identity_bindings
          SET revoked_at = COALESCE(revoked_at, now()), last_error_code = 'IDENTITY_CONFIGURATION_CHANGED'
          WHERE sender_identity_id = ${params.senderIdentityId}::uuid AND revoked_at IS NULL
        `;
      }
      const [updated] = await tx<DbIdentity[]>`
        UPDATE mail.sender_identities si
        SET
          display_name = ${parsed.data.displayName ?? current.display_name},
          from_address = ${fromAddress},
          reply_to = ${replyTo},
          envelope_sender = ${envelopeSender},
          interactive_policy = ${nextPolicy.interactive},
          automation_policy = ${nextPolicy.automation},
          sent_folder_id = ${sentFolderId}::uuid,
          drafts_folder_id = ${draftsFolderId}::uuid,
          is_default = ${parsed.data.isDefault ?? current.is_default},
          status = CASE WHEN ${providerRelevantChanged} THEN 'unverified' ELSE status END,
          last_provider_rejection = CASE WHEN ${providerRelevantChanged} THEN NULL ELSE last_provider_rejection END
        WHERE si.id = ${params.senderIdentityId}::uuid
        RETURNING ${identityColumns}
      `;
      if (!updated) return fail(err.internal("Sender identity update returned no row"));
      await audit.record(
        {
          action: "mail.sender_identity.update",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "sender_identity", id: updated.id, label: updated.from_address },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, providerRelevantChanged },
        },
        tx,
      );
      return ok(mapIdentity(updated));
    });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "23505") return fail(err.conflict("Sender identity"));
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to update sender identity"));
  }
};

export const disableSenderIdentity = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  senderIdentityId: string;
}): Promise<Result<void>> => {
  try {
    return await sql.begin(async (tx) => {
      const permission = await requireMailboxPermission(params.context, params.mailboxId, "admin", tx);
      if (!permission.ok) return permission;
      const [disabled] = await tx<{ id: string; from_address: string }[]>`
        UPDATE mail.sender_identities
        SET status = 'disabled', is_default = false
        WHERE id = ${params.senderIdentityId}::uuid
          AND mailbox_id = ${params.mailboxId}::uuid
          AND status <> 'disabled'
        RETURNING id, from_address
      `;
      if (!disabled) return fail(err.notFound("Sender identity"));
      await tx`
        UPDATE mail.sender_identity_bindings
        SET revoked_at = COALESCE(revoked_at, now()), last_error_code = 'IDENTITY_DISABLED'
        WHERE sender_identity_id = ${params.senderIdentityId}::uuid AND revoked_at IS NULL
      `;
      await tx`
        UPDATE mail.sender_identities
        SET is_default = true
        WHERE id = (
          SELECT id FROM mail.sender_identities
          WHERE mailbox_id = ${params.mailboxId}::uuid AND status = 'verified'
          ORDER BY created_at, id LIMIT 1
        )
        AND NOT EXISTS (
          SELECT 1 FROM mail.sender_identities
          WHERE mailbox_id = ${params.mailboxId}::uuid AND is_default AND status <> 'disabled'
        )
      `;
      await audit.record(
        {
          action: "mail.sender_identity.disable",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "sender_identity", id: disabled.id, label: disabled.from_address },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId },
        },
        tx,
      );
      return ok();
    });
  } catch {
    return fail(err.internal("Failed to disable sender identity"));
  }
};

export const setupDefaultSender = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: DefaultSenderSetupInput;
}): Promise<Result<SenderIdentity>> => {
  const parsed = defaultSenderSetupInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid default sender setup"));
  const permission = await requireMailboxPermission(params.context, params.mailboxId, "admin");
  if (!permission.ok) return permission;
  const [binding] = await sql<{
    connection_id: string;
    email: string;
    connection_policy: "shared_connection" | "personal_provider_account";
    current_verification: boolean;
  }[]>`
    SELECT
      binding.connection_id,
      connection.email,
      mailbox.connection_policy,
      EXISTS (
        SELECT 1
        FROM mail.sender_identities identity
        JOIN mail.sender_identity_bindings identity_binding ON identity_binding.sender_identity_id = identity.id
        WHERE identity.mailbox_id = ${params.mailboxId}::uuid
          AND lower(identity.from_address) = lower(connection.email)
          AND identity.status = 'verified'
          AND identity_binding.binding_id = binding.id
          AND identity_binding.verified_secret_revision = connection.secret_revision
          AND identity_binding.saves_sent_automatically = ${parsed.data.savesSentAutomatically}
          AND identity_binding.revoked_at IS NULL
      ) AS current_verification
    FROM mail.provider_bindings binding
    JOIN mail.remote_resources resource ON resource.id = binding.remote_resource_id
    JOIN mail.mailboxes mailbox ON mailbox.id = resource.mailbox_id
    JOIN mail.provider_connections connection ON connection.id = binding.connection_id
    WHERE binding.id = ${parsed.data.bindingId}::uuid
      AND resource.mailbox_id = ${params.mailboxId}::uuid
      AND binding.state = 'active'
      AND binding.verified_secret_revision = connection.secret_revision
      AND connection.status = 'active'
      AND connection.encrypted_secret IS NOT NULL
  `;
  if (!binding) return fail(err.notFound("Active provider binding"));
  const sent = parsed.data.savesSentAutomatically ? null : await resolveRoleFolder(params.mailboxId, "sent");
  if (sent && !sent.ok) return sent;
  const drafts = await resolveRoleFolder(params.mailboxId, "drafts");
  const [existing] = await sql<DbIdentity[]>`
    SELECT ${identityColumns}
    FROM mail.sender_identities si
    WHERE si.mailbox_id = ${params.mailboxId}::uuid AND lower(si.from_address) = lower(${binding.email})
  `;
  const authenticationPolicy = {
    interactive: binding.connection_policy === "shared_connection" ? ("mailbox" as const) : ("actor" as const),
    automation: "disabled" as const,
  };
  let identity: Result<SenderIdentity>;
  if (existing) {
    identity = await updateSenderIdentity({
      context: params.context,
      mailboxId: params.mailboxId,
      senderIdentityId: existing.id,
      input: {
        ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
        authenticationPolicy,
        sentFolderId: sent?.data.id ?? null,
        draftsFolderId: drafts.ok ? drafts.data.id : null,
        isDefault: true,
      },
    });
  } else {
    identity = await createSenderIdentity({
      context: params.context,
      mailboxId: params.mailboxId,
      input: {
        displayName: parsed.data.displayName ?? "",
        fromAddress: binding.email,
        authenticationPolicy,
        sentFolderId: sent?.data.id ?? null,
        draftsFolderId: drafts.ok ? drafts.data.id : null,
        isDefault: true,
      },
    });
  }
  if (!identity.ok) return identity;
  if (binding.current_verification && identity.data.status === "verified") return identity;
  return verifySenderIdentity({
    context: params.context,
    mailboxId: params.mailboxId,
    senderIdentityId: identity.data.id,
    bindingId: parsed.data.bindingId,
    verificationRecipient: binding.email,
    savesSentAutomatically: parsed.data.savesSentAutomatically,
  });
};

export const verifySenderIdentity = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  senderIdentityId: string;
  bindingId: string;
  verificationRecipient: string;
  savesSentAutomatically: boolean;
}): Promise<Result<SenderIdentity>> => {
  const recipient = params.verificationRecipient.trim().toLowerCase();
  if (!/^.+@.+\..+$/.test(recipient) || recipient.length > 320) return fail(err.badInput("Invalid verification recipient"));
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "admin");
  if (!allowed.ok) return allowed;
  const [record] = await sql<(DbIdentity & { connection_id: string; authenticated_principal: string | null })[]>`
    SELECT ${identityColumns}, pb.connection_id, pb.authenticated_principal
    FROM mail.sender_identities si
    JOIN mail.remote_resources rr ON rr.mailbox_id = si.mailbox_id
    JOIN mail.provider_bindings pb ON pb.remote_resource_id = rr.id
    JOIN mail.provider_connections pc ON pc.id = pb.connection_id
    WHERE si.id = ${params.senderIdentityId}::uuid
      AND si.mailbox_id = ${params.mailboxId}::uuid
      AND pb.id = ${params.bindingId}::uuid
      AND pb.state = 'active'
      AND pb.verified_secret_revision = pc.secret_revision
      AND pc.status = 'active'
      AND pc.encrypted_secret IS NOT NULL
  `;
  if (!record) return fail(err.notFound("Sender identity or provider binding"));
  const connection = await getProviderConnection(params.context, record.connection_id);
  if (!connection.ok) return connection;
  if (!params.savesSentAutomatically) {
    if (!record.sent_folder_id) return fail(err.badInput("A Sent folder is required when the provider does not save sent mail"));
    const [sentRef] = await sql<{ allowed: boolean }[]>`
      SELECT 'insert' = ANY(effective_rights) AS allowed
      FROM mail.binding_folder_refs
      WHERE binding_id = ${params.bindingId}::uuid AND folder_id = ${record.sent_folder_id}::uuid
    `;
    if (!sentRef?.allowed) return fail(err.badInput("The selected binding cannot append to the configured Sent folder"));
  }

  const messageId = `<cloud-sender-verification-${crypto.randomUUID()}@${record.from_address.split("@")[1] ?? "mail.invalid"}>`;
  let verifiedSecretRevision: number;
  try {
    const snapshot = await loadProviderConnectionRuntimeSnapshot(record.connection_id);
    verifiedSecretRevision = snapshot.secretRevision;
    const result = await imapSmtpConnector.send(snapshot.runtime, {
      from: { name: record.display_name, address: record.from_address },
      replyTo: record.reply_to,
      envelopeFrom: record.envelope_sender,
      to: [{ address: recipient }],
      subject: "Cloud Mail sender identity verification",
      text: `Cloud Mail verified that ${record.from_address} can be submitted through this provider binding.`,
      messageId,
    });
    if (result.accepted.length === 0 || result.rejected.includes(recipient)) {
      return fail(err.badInput("The provider did not accept the sender identity verification message"));
    }
  } catch {
    await sql`
      UPDATE mail.sender_identities
      SET status = 'rejected', last_provider_rejection = 'Provider rejected sender identity verification'
      WHERE id = ${params.senderIdentityId}::uuid
    `.catch(() => undefined);
    return fail(err.badInput("The provider rejected sender identity verification"));
  }

  try {
    return await sql.begin(async (tx) => {
      const permission = await requireMailboxPermission(params.context, params.mailboxId, "admin", tx);
      if (!permission.ok) return permission;
      const [current] = await tx<{ authenticated_principal: string | null; secret_revision: number }[]>`
        SELECT pb.authenticated_principal, pc.secret_revision
        FROM mail.sender_identities si
        JOIN mail.remote_resources rr ON rr.mailbox_id = si.mailbox_id
        JOIN mail.provider_bindings pb ON pb.remote_resource_id = rr.id
        JOIN mail.provider_connections pc ON pc.id = pb.connection_id
        WHERE si.id = ${params.senderIdentityId}::uuid
          AND si.mailbox_id = ${params.mailboxId}::uuid
          AND pb.id = ${params.bindingId}::uuid
          AND pb.connection_id = ${record.connection_id}::uuid
          AND pb.state = 'active'
          AND pb.verified_secret_revision = pc.secret_revision
          AND pc.secret_revision = ${verifiedSecretRevision}
          AND pc.status = 'active'
          AND pc.encrypted_secret IS NOT NULL
        FOR UPDATE OF si, pb, pc
      `;
      if (!current) return fail(err.badInput("Sender identity or provider binding changed during verification"));
      await tx`
        INSERT INTO mail.sender_identity_bindings (
          sender_identity_id,
          binding_id,
          provider_principal,
          verified_at,
          verified_secret_revision,
          saves_sent_automatically,
          revoked_at,
          last_error_code
        )
        VALUES (
          ${params.senderIdentityId}::uuid,
          ${params.bindingId}::uuid,
          ${current.authenticated_principal ?? connection.data.username},
          now(),
          ${current.secret_revision},
          ${params.savesSentAutomatically},
          NULL,
          NULL
        )
        ON CONFLICT (sender_identity_id, binding_id) DO UPDATE SET
          provider_principal = EXCLUDED.provider_principal,
          verified_at = now(),
          verified_secret_revision = EXCLUDED.verified_secret_revision,
          saves_sent_automatically = EXCLUDED.saves_sent_automatically,
          revoked_at = NULL,
          last_error_code = NULL
      `;
      const [updated] = await tx<DbIdentity[]>`
        UPDATE mail.sender_identities si
        SET status = 'verified', last_provider_rejection = NULL
        WHERE si.id = ${params.senderIdentityId}::uuid AND si.mailbox_id = ${params.mailboxId}::uuid
        RETURNING ${identityColumns}
      `;
      if (!updated) throw Object.assign(new Error("Sender identity disappeared during verification"), { code: "SENDER_IDENTITY_MISSING" });
      await audit.record(
        {
          action: "mail.sender_identity.verify",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "sender_identity", id: updated.id, label: updated.from_address },
          requestId: params.context.requestId,
          metadata: { bindingId: params.bindingId, savesSentAutomatically: params.savesSentAutomatically },
        },
        tx,
      );
      return ok(mapIdentity(updated));
    });
  } catch {
    return fail(err.internal("Failed to store sender identity verification"));
  }
};
