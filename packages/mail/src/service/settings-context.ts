import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { MailboxSettingsContext } from "../settings-context";
import * as mailboxAccess from "./access";
import type { MailRequestContext } from "./auth";
import * as bindings from "./bindings";
import * as composeTemplates from "./compose-templates";
import * as conversationReferences from "./conversation-reference";
import * as mailboxes from "./mailboxes";
import * as messages from "./messages";
import * as providerConnections from "./provider-connections";
import * as responseSchedules from "./response-schedule";
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

  let compose: MailboxSettingsContext["compose"] = null;
  if (permission === "write" || permission === "admin") {
    const [templateResult, defaultResult, styleResult, identityResult] = await Promise.all([
      composeTemplates.listComposeTemplates(context, mailboxId),
      composeTemplates.listComposeSignatureDefaults(context, mailboxId),
      composeTemplates.getMailboxComposeStyle(context, mailboxId),
      senderIdentities.listSenderIdentities(context, mailboxId),
    ]);
    if (!templateResult.ok) return fail(templateResult.error);
    if (!defaultResult.ok) return fail(defaultResult.error);
    if (!styleResult.ok) return fail(styleResult.error);
    if (!identityResult.ok) return fail(identityResult.error);
    compose = {
      templates: templateResult.data,
      defaults: defaultResult.data,
      style: styleResult.data,
      identities: identityResult.data,
    };
  }

  if (permission !== "admin") return ok({ mailbox: mailboxResult.data, permission, compose, admin: null });

  const [accessResult, connectionResult, bindingResult, folderResult, identityResult, referenceSchemeResult, responseScheduleResult, workflowResult] =
    await Promise.all([
    mailboxAccess.listMailboxAccess(context, mailboxId),
    providerConnections.listProviderConnections(context, mailboxId),
    bindings.listProviderBindings(context, mailboxId),
    messages.listFolders(context, mailboxId),
    senderIdentities.listSenderIdentities(context, mailboxId),
    conversationReferences.listConversationReferenceSchemes(context, mailboxId),
    responseSchedules.listResponseSchedules(context, mailboxId),
    workflows.listWorkflows(context, mailboxId),
  ]);
  if (!accessResult.ok) return fail(accessResult.error);
  if (!connectionResult.ok) return fail(connectionResult.error);
  if (!bindingResult.ok) return fail(bindingResult.error);
  if (!folderResult.ok) return fail(folderResult.error);
  if (!identityResult.ok) return fail(identityResult.error);
  if (!referenceSchemeResult.ok) return fail(referenceSchemeResult.error);
  if (!responseScheduleResult.ok) return fail(responseScheduleResult.error);
  if (!workflowResult.ok) return fail(workflowResult.error);

  return ok({
    mailbox: mailboxResult.data,
    permission,
    compose,
    admin: {
      accessEntries: accessResult.data,
      connections: connectionResult.data,
      bindings: bindingResult.data,
      folders: folderResult.data,
      identities: identityResult.data,
      referenceSchemes: referenceSchemeResult.data,
      responseSchedules: responseScheduleResult.data,
      workflows: workflowResult.data,
    },
  });
};
