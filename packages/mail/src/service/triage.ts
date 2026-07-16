import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { type ConversationTriageInput, conversationTriageInputSchema, type MailCommand } from "../contracts";
import { requireMailboxPermission } from "./access";
import type { MailRequestContext } from "./auth";
import { createActorCommands } from "./commands";
import { resolveMailExecution } from "./execution";
import { resolveRoleFolder } from "./folders";

const MAX_CONVERSATION_TARGETS = 500;

type ConversationTarget = {
  remote_message_ref_id: string;
};

export const createConversationTriageCommands = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  input: ConversationTriageInput;
}): Promise<Result<{ correlationId: string; commands: MailCommand[] }>> => {
  const parsed = conversationTriageInputSchema.safeParse(params.input);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid conversation action"));
  const input = parsed.data;
  const permission = await requireMailboxPermission(params.context, params.mailboxId, "write");
  if (!permission.ok) return permission;
  const roleDestination = input.kind === "move_to_role" ? await resolveRoleFolder(params.mailboxId, input.role) : null;
  if (roleDestination && !roleDestination.ok) return roleDestination;
  const destinationFolderId =
    input.kind === "move_to_folder" ? input.destinationFolderId : roleDestination?.ok ? roleDestination.data.id : null;
  if (destinationFolderId === input.sourceFolderId) return fail(err.badInput("Source and destination folders must differ"));

  const execution = await resolveMailExecution({
    mailboxId: params.mailboxId,
    operation: "actorMutation",
    context: params.context,
    folderRequirements: [
      {
        folderId: input.sourceFolderId,
        rights: input.kind === "change_state" ? ["write_flags"] : ["read", "move"],
      },
      ...(destinationFolderId ? [{ folderId: destinationFolderId, rights: ["insert"] }] : []),
    ],
  });
  if (!execution.ok) return execution;

  const targets = await sql<ConversationTarget[]>`
    SELECT ref.id AS remote_message_ref_id
    FROM mail.conversation_messages conversation_message
    JOIN mail.conversations conversation ON conversation.id = conversation_message.conversation_id
    JOIN mail.remote_message_refs ref ON ref.message_id = conversation_message.message_id
    JOIN mail.message_placements placement ON placement.remote_message_ref_id = ref.id
    JOIN mail.folders folder ON folder.id = ref.folder_id
    JOIN mail.remote_resources resource ON resource.id = folder.remote_resource_id
    WHERE conversation.id = ${params.conversationId}::uuid
      AND conversation.mailbox_id = ${params.mailboxId}::uuid
      AND resource.mailbox_id = ${params.mailboxId}::uuid
      AND ref.folder_id = ${input.sourceFolderId}::uuid
      AND ref.stale_at IS NULL
      AND placement.deleted_at IS NULL
    ORDER BY conversation_message.position, ref.uid
    LIMIT ${MAX_CONVERSATION_TARGETS + 1}
  `;
  if (targets.length === 0) return fail(err.notFound("Conversation messages in the selected folder"));
  if (targets.length > MAX_CONVERSATION_TARGETS) {
    return fail(err.badInput(`Conversation action exceeds the ${MAX_CONVERSATION_TARGETS}-message safety limit`));
  }

  const correlationId = input.correlationId?.trim() || crypto.randomUUID();
  const commands = await createActorCommands({
    context: params.context,
    mailboxId: params.mailboxId,
    inputs: targets.map((target) =>
      input.kind === "change_state"
        ? {
            kind: "change_message_state",
            remoteMessageRefId: target.remote_message_ref_id,
            folderId: input.sourceFolderId,
            change: input.change,
            idempotencyKey: `${input.idempotencyKey}:${target.remote_message_ref_id}`,
            correlationId,
          }
        : {
            kind: "move",
            remoteMessageRefId: target.remote_message_ref_id,
            sourceFolderId: input.sourceFolderId,
            destinationFolderId: destinationFolderId!,
            idempotencyKey: `${input.idempotencyKey}:${target.remote_message_ref_id}`,
            correlationId,
          },
    ),
  });
  if (!commands.ok) return commands;
  return ok({ correlationId, commands: commands.data });
};
