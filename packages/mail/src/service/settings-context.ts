import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { MailboxSettingsContext } from "../settings-context";
import * as mailboxAccess from "./access";
import type { MailRequestContext } from "./auth";
import * as bindings from "./bindings";
import * as mailboxes from "./mailboxes";
import * as messages from "./messages";
import * as providerConnections from "./provider-connections";
import * as senderIdentities from "./sender-identities";
import * as workflows from "./workflows";

export const loadMailboxSettingsContext = async (
  context: MailRequestContext,
  mailboxId: string,
): Promise<Result<MailboxSettingsContext>> => {
  const permission = await mailboxAccess.getMailboxPermission(context, mailboxId);
  if (permission === "none") return fail(err.forbidden("Access denied"));

  const mailboxResult = await mailboxes.getMailbox(context, mailboxId);
  if (!mailboxResult.ok) return fail(mailboxResult.error);

  if (permission !== "admin") return ok({ mailbox: mailboxResult.data, permission, admin: null });

  const [accessResult, connectionResult, bindingResult, folderResult, identityResult, workflowResult] = await Promise.all([
    mailboxAccess.listMailboxAccess(context, mailboxId),
    providerConnections.listProviderConnections(context, mailboxId),
    bindings.listProviderBindings(context, mailboxId),
    messages.listFolders(context, mailboxId),
    senderIdentities.listSenderIdentities(context, mailboxId),
    workflows.listWorkflows(context, mailboxId),
  ]);
  if (!accessResult.ok) return fail(accessResult.error);
  if (!connectionResult.ok) return fail(connectionResult.error);
  if (!bindingResult.ok) return fail(bindingResult.error);
  if (!folderResult.ok) return fail(folderResult.error);
  if (!identityResult.ok) return fail(identityResult.error);
  if (!workflowResult.ok) return fail(workflowResult.error);

  return ok({
    mailbox: mailboxResult.data,
    permission,
    admin: {
      accessEntries: accessResult.data,
      connections: connectionResult.data,
      bindings: bindingResult.data,
      folders: folderResult.data,
      identities: identityResult.data,
      workflows: workflowResult.data,
    },
  });
};
