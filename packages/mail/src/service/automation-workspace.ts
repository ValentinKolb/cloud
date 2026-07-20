import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { Mailbox, MailWorkflow, MailWorkflowRun, SenderIdentity } from "../contracts";
import * as access from "./access";
import type { MailRequestContext } from "./auth";
import { requireAutomaticReplyManagementPermission } from "./automatic-reply-access";
import type { AutomaticReplyConfiguration } from "./automatic-reply-configuration";
import * as automaticReplies from "./automatic-reply-configuration";
import type { ConversationReferenceConfiguration } from "./conversation-reference";
import * as conversationReferences from "./conversation-reference";
import * as mailboxes from "./mailboxes";
import * as senderIdentities from "./sender-identities";
import * as workflows from "./workflows";

export type MailAutomationWorkspaceData = {
  mailbox: Mailbox;
  permission: "read" | "write" | "admin";
  canManageAutomaticReplies: boolean;
  identities: SenderIdentity[];
  automaticReplies: AutomaticReplyConfiguration[];
  referenceConfiguration: ConversationReferenceConfiguration | null;
  advanced: {
    workflows: MailWorkflow[];
    workflowRuns: MailWorkflowRun[];
  } | null;
};

export const loadMailAutomationWorkspace = async (
  context: MailRequestContext,
  mailboxId: string,
): Promise<Result<MailAutomationWorkspaceData>> => {
  const permission = await access.getMailboxPermission(context, mailboxId);
  if (permission === "none") return fail(err.forbidden("Access denied"));

  const [mailboxResult, identityResult, automaticReplyResult, referenceConfigurationResult, managementPermission] = await Promise.all([
    mailboxes.getMailbox(context, mailboxId),
    senderIdentities.listSenderIdentities(context, mailboxId),
    automaticReplies.listAutomaticReplyConfigurations(context, mailboxId),
    conversationReferences.getConversationReferenceConfiguration(context, mailboxId),
    requireAutomaticReplyManagementPermission(context, mailboxId),
  ]);
  if (!mailboxResult.ok) return fail(mailboxResult.error);
  if (!identityResult.ok) return fail(identityResult.error);
  if (!automaticReplyResult.ok) return fail(automaticReplyResult.error);
  if (!referenceConfigurationResult.ok) return fail(referenceConfigurationResult.error);

  if (permission !== "admin") {
    return ok({
      mailbox: mailboxResult.data,
      permission,
      canManageAutomaticReplies: managementPermission.ok,
      identities: identityResult.data,
      automaticReplies: automaticReplyResult.data,
      referenceConfiguration: referenceConfigurationResult.data,
      advanced: null,
    });
  }

  const [workflowResult, workflowRunResult] = await Promise.all([
    workflows.listWorkflows(context, mailboxId),
    workflows.listWorkflowRuns({ context, mailboxId, limit: 20 }),
  ]);
  if (!workflowResult.ok) return fail(workflowResult.error);
  if (!workflowRunResult.ok) return fail(workflowRunResult.error);

  return ok({
    mailbox: mailboxResult.data,
    permission,
    canManageAutomaticReplies: true,
    identities: identityResult.data,
    automaticReplies: automaticReplyResult.data,
    referenceConfiguration: referenceConfigurationResult.data,
    advanced: {
      workflows: workflowResult.data,
      workflowRuns: workflowRunResult.data,
    },
  });
};
